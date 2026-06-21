// ===========================================================================
// CHARTIS - geteilte Helfer fuer Rueckkanal (Option A: eigene Domain + Postmark)
// ===========================================================================
// Bewusst unabhaengig von der produktiven MS365-Mail-Integration.
// Routing-Anker = stabiles Zufalls-Token pro Faden (chartis_threads.reply_token),
// transportiert als reply+<token>@<CHARTIS_DOMAIN>. Inbound = DB-Lookup auf
// reply_token (kein HMAC noetig: Token ist 128-bit, nicht erratbar).
// ===========================================================================

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

// Domain des Rueckkanals, z.B. "chartis.artis-gmbh.ch"
export const CHARTIS_DOMAIN = Deno.env.get('CHARTIS_DOMAIN') || 'chartis.artis-gmbh.ch'
export const CHARTIS_FROM = `chartis@${CHARTIS_DOMAIN}`

export function replyAddress(token: string): string {
  return `reply+${token}@${CHARTIS_DOMAIN}`
}

// Token aus einer Empfaenger-Adresse "reply+<token>@domain" extrahieren.
// Akzeptiert auch reine Postmark-MailboxHash-Werte.
export function tokenFromRecipient(addr: string | null | undefined): string | null {
  if (!addr) return null
  const local = addr.split('@')[0] || ''
  const plus = local.indexOf('+')
  const token = plus >= 0 ? local.slice(plus + 1) : null
  if (token && /^[a-f0-9]{16,64}$/i.test(token)) return token
  return null
}

// Postmark Inbound liefert mehrere Felder, aus denen das Token kommen kann.
export function extractInboundToken(payload: any): string | null {
  return (
    tokenFromRecipient(payload?.OriginalRecipient) ||
    (payload?.MailboxHash && /^[a-f0-9]{16,64}$/i.test(payload.MailboxHash) ? payload.MailboxHash : null) ||
    tokenFromRecipient((payload?.ToFull || [])[0]?.Email) ||
    null
  )
}

// Sehr einfache Bounce-/Autoresponder-Heuristik (RFC 3462 / mailer-daemon).
export function looksLikeBounce(payload: any): boolean {
  const from = (payload?.FromFull?.Email || payload?.From || '').toLowerCase()
  if (/^(mailer-daemon|postmaster)@/.test(from)) return true
  const headers: any[] = payload?.Headers || []
  const ct = headers.find((h) => (h?.Name || '').toLowerCase() === 'content-type')?.Value || ''
  if (/multipart\/report|report-type=delivery-status/i.test(ct)) return true
  const ar = headers.find((h) => (h?.Name || '').toLowerCase() === 'auto-submitted')?.Value || ''
  if (ar && ar.toLowerCase() !== 'no') return true
  return false
}

export function headerValue(payload: any, name: string): string | null {
  const headers: any[] = payload?.Headers || []
  const h = headers.find((x) => (x?.Name || '').toLowerCase() === name.toLowerCase())
  return h?.Value || null
}

// Outbound ueber Postmark. Reply-To traegt das Faden-Token.
export async function postmarkSend(opts: {
  to: string
  toName?: string
  subject: string
  htmlBody: string
  textBody?: string
  replyTo: string
  inReplyTo?: string | null
  references?: string | null
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const headers: Array<{ Name: string; Value: string }> = []
  if (opts.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: opts.inReplyTo })
  if (opts.references) headers.push({ Name: 'References', Value: opts.references })

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': env('POSTMARK_SERVER_TOKEN'),
    },
    body: JSON.stringify({
      From: CHARTIS_FROM,
      To: opts.toName ? `${opts.toName} <${opts.to}>` : opts.to,
      Subject: opts.subject,
      HtmlBody: opts.htmlBody,
      TextBody: opts.textBody,
      ReplyTo: opts.replyTo,
      MessageStream: Deno.env.get('POSTMARK_STREAM') || 'outbound',
      Headers: headers.length ? headers : undefined,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data?.Message || `Postmark ${res.status}` }
  return { ok: true, messageId: data?.MessageID }
}

export function htmlToText(html: string): string {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim()
}
