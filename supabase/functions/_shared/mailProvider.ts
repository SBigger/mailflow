// ===========================================================================
// CHARTIS - Mail-Provider-Abstraktion (schmales Interface hinter dem Versand)
// ===========================================================================
// Ziel (mit Roger abgestimmt, 2026-07-08): Der konkrete Mail-Dienst ist nur
// EINE Implementierung hinter einem schlanken Interface. Postmark = aktueller
// Default; ohne Aenderung an der Chartis-Logik laesst sich auf Rogers self-hosted
// nodejs-Container ('relay') umschalten. Umschalten via Env CHARTIS_MAIL_PROVIDER:
//   'postmark' (Default) | 'relay' | 'selfhosted' | 'smtp'
//
// Das Interface kapselt genau die zwei providerspezifischen Beruehrpunkte:
//   1) send()         - Outbound (chartis-send / chartis-fanout)
//   2) parseInbound() - Provider-Payload -> kanonische InboundMail (chartis-inbound)
// Die Faden-/Token-/Routing-Logik bleibt vollstaendig in Supabase (chartis.ts).
// ===========================================================================
import {
  CHARTIS_FROM,
  postmarkSend,
  extractInboundToken,
  tokenFromRecipient,
  looksLikeBounce,
  headerValue,
  htmlToText,
} from './chartis.ts'

// ── Kanonische Typen (providerunabhaengig) ────────────────────────────────
export interface OutboundMail {
  to: string
  toName?: string
  subject: string
  htmlBody: string
  textBody?: string
  replyTo: string
  inReplyTo?: string | null
  references?: string | null
}

export interface SendResult {
  ok: boolean
  messageId?: string
  error?: string
}

// Auf diese Felder ist chartis-inbound reduziert - egal welcher Provider.
export interface InboundMail {
  externalId: string | null       // stabile Message-ID -> Dedup-Schluessel
  fromEmail: string               // Absender, lowercased
  subject: string
  token: string | null            // Routing-Token (reply+<token>@ / MailboxHash)
  bodyText: string                // bestes Reply-Text-Ergebnis (Zitat entfernt)
  bodyHtml: string | null
  originalRecipient: string | null
  messageIdHeader: string | null
  inReplyToHeader: string | null
  referencesHeader: string | null
  isBounce: boolean
}

export interface MailProvider {
  readonly name: string
  send(mail: OutboundMail): Promise<SendResult>
  parseInbound(payload: any): InboundMail
}

// ── Postmark (aktueller Default) ──────────────────────────────────────────
// Verhalten unveraendert: nutzt die bestehenden Helfer 1:1, damit der laufende
// smartis.me-/Prod-Pfad byte-identisch bleibt.
function postmarkProvider(): MailProvider {
  return {
    name: 'postmark',
    send: (mail) => postmarkSend(mail),
    parseInbound: (p: any): InboundMail => ({
      externalId: p?.MessageID || headerValue(p, 'Message-ID') || null,
      fromEmail: (p?.FromFull?.Email || p?.From || '').toLowerCase(),
      subject: p?.Subject || '(kein Betreff)',
      token: extractInboundToken(p),
      bodyText: (p?.StrippedTextReply || p?.TextBody || htmlToText(p?.HtmlBody || '')).trim(),
      bodyHtml: p?.HtmlBody || null,
      originalRecipient: p?.OriginalRecipient || null,
      messageIdHeader: headerValue(p, 'Message-ID'),
      inReplyToHeader: headerValue(p, 'In-Reply-To'),
      referencesHeader: headerValue(p, 'References'),
      isBounce: looksLikeBounce(p),
    }),
  }
}

// ── Self-hosted Relay (Rogers nodejs-Container) ───────────────────────────
// Outbound: POST JSON an CHARTIS_MAIL_RELAY_URL + '/send' (Bearer-Secret optional).
//   Erwartete Antwort: { ok: boolean, messageId?: string, error?: string }
//   (Postmark-Schreibweise "MessageID" wird ebenfalls akzeptiert.)
//   Gesendeter Body: { from, to, toName, subject, htmlBody, textBody,
//                      replyTo, inReplyTo, references }
// Inbound: Der Container schickt sein geparste Mail bereits als kanonisches JSON
//   (Feldnamen = InboundMail). Aliase (from/text/html/messageId/...) werden fuer
//   Bequemlichkeit akzeptiert. So bleibt chartis-inbound unveraendert.
function relayProvider(): MailProvider {
  return {
    name: 'relay',
    async send(mail: OutboundMail): Promise<SendResult> {
      const base = Deno.env.get('CHARTIS_MAIL_RELAY_URL')
      if (!base) return { ok: false, error: 'CHARTIS_MAIL_RELAY_URL nicht gesetzt' }
      const secret = Deno.env.get('CHARTIS_MAIL_RELAY_SECRET')
      try {
        const res = await fetch(base.replace(/\/$/, '') + '/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify({ from: CHARTIS_FROM, ...mail }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, error: data?.error || `Relay ${res.status}` }
        return { ok: true, messageId: data?.messageId || data?.MessageID }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    parseInbound(p: any): InboundMail {
      const from = String(p?.fromEmail || p?.from || '').toLowerCase()
      return {
        externalId: p?.externalId || p?.messageId || p?.messageIdHeader || null,
        fromEmail: from,
        subject: p?.subject || '(kein Betreff)',
        token:
          p?.token ||
          tokenFromRecipient(p?.originalRecipient) ||
          tokenFromRecipient(p?.to) ||
          null,
        bodyText: String(p?.bodyText || p?.text || '').trim(),
        bodyHtml: p?.bodyHtml || p?.html || null,
        originalRecipient: p?.originalRecipient || p?.to || null,
        messageIdHeader: p?.messageIdHeader || p?.messageId || null,
        inReplyToHeader: p?.inReplyToHeader || p?.inReplyTo || null,
        referencesHeader: p?.referencesHeader || p?.references || null,
        isBounce: Boolean(p?.isBounce),
      }
    },
  }
}

// ── Factory: Provider aus Env waehlen (Default postmark) ───────────────────
export function getMailProvider(): MailProvider {
  const which = (Deno.env.get('CHARTIS_MAIL_PROVIDER') || 'postmark').toLowerCase()
  if (which === 'relay' || which === 'selfhosted' || which === 'smtp') return relayProvider()
  return postmarkProvider()
}
