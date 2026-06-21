// ===========================================================================
// chartis-inbound  -  Postmark Inbound-Webhook: Kundenantwort -> Faden
// ===========================================================================
// Postmark MX -> POST geparstes JSON hierher. Routing:
//   1) Token aus Empfaenger (reply+<token>@) -> chartis_threads.reply_token
//   2) From-Binding gegen ext_contact_email (Mismatch -> Quarantaene)
//   3) Dedup (at-least-once) -> sonst chartis_unrouted (kein stiller Verlust)
// Absicherung: ?secret=... muss CHARTIS_INBOUND_SECRET matchen (Postmark hat
// keine HMAC-Signatur) + (optional) IP-Allowlist im Provider/Edge davor.
// Deploy mit: supabase functions deploy chartis-inbound --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, env, extractInboundToken, looksLikeBounce, headerValue, htmlToText,
} from '../_shared/chartis.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // ── Pfad-Secret pruefen ──────────────────────────────────────────────────
  const url = new URL(req.url)
  if (url.searchParams.get('secret') !== env('CHARTIS_INBOUND_SECRET')) {
    return json({ error: 'forbidden' }, 403)
  }

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const p = await req.json().catch(() => null)
  if (!p) return json({ error: 'bad payload' }, 400)

  const provider = 'postmark'
  const externalId: string = p.MessageID || p.Headers?.find?.((h: any) => h?.Name === 'Message-ID')?.Value || crypto.randomUUID()
  const fromEmail: string = (p.FromFull?.Email || p.From || '').toLowerCase()
  const subject: string = p.Subject || '(kein Betreff)'

  // ── Idempotenz zuerst: belegen, dass diese Mail bearbeitet wird ──────────
  // upsert + ignoreDuplicates: bei Konflikt kommt 0 Zeilen OHNE Fehler zurueck.
  const { data: dedupRows, error: dedupErr } = await supabase
    .from('chartis_inbound_dedup')
    .upsert({ provider, external_message_id: externalId },
            { onConflict: 'provider,external_message_id', ignoreDuplicates: true })
    .select('provider')
  if (dedupErr) return json({ error: 'dedup', details: dedupErr.message }, 500)
  if (!dedupRows || dedupRows.length === 0) return json({ success: true, duplicate: true })

  const toUnrouted = async (reason: string) => {
    await supabase.from('chartis_unrouted').insert({
      provider, external_message_id: externalId, from_addr: fromEmail, subject, reason,
    })
    return json({ success: true, routed: false, reason })
  }

  // ── Bounce/Autoresponder aussortieren ────────────────────────────────────
  if (looksLikeBounce(p)) return await toUnrouted('bounce')

  // ── Token -> Faden ───────────────────────────────────────────────────────
  const token = extractInboundToken(p)
  if (!token) return await toUnrouted('no_token')

  const { data: thread } = await supabase
    .from('chartis_threads')
    .select('id, mandant_id, ext_contact_email')
    .eq('reply_token', token)
    .maybeSingle()
  if (!thread) return await toUnrouted('bad_token')

  // ── From-Binding: Hijacking-/Stellvertreter-Schutz ──────────────────────
  if (thread.ext_contact_email && fromEmail && thread.ext_contact_email.toLowerCase() !== fromEmail) {
    return await toUnrouted('from_mismatch')
  }

  // ── Nachricht schreiben (DE-Reply-Stripping via Postmark StrippedTextReply) ─
  const bodyText = (p.StrippedTextReply || p.TextBody || htmlToText(p.HtmlBody || '')).trim()
  const { data: msg, error: msgErr } = await supabase
    .from('chartis_messages')
    .insert({
      thread_id: thread.id,
      mandant_id: thread.mandant_id,
      kind: 'email_in',
      body_text: bodyText,
      body_html: p.HtmlBody || null,
      from_addr: fromEmail,
      to_addr: p.OriginalRecipient || null,
      message_id: headerValue(p, 'Message-ID'),
      in_reply_to: headerValue(p, 'In-Reply-To'),
      references_h: headerValue(p, 'References'),
    })
    .select('id')
    .single()
  if (msgErr) {
    // Dedup-Eintrag wieder freigeben, damit Postmark-Retry erneut greifen kann
    await supabase.from('chartis_inbound_dedup').delete().match({ provider, external_message_id: externalId })
    return json({ error: 'DB-Fehler', details: msgErr.message }, 500)
  }

  await supabase.from('chartis_inbound_dedup')
    .update({ thread_id: thread.id, message_id: msg.id }).match({ provider, external_message_id: externalId })
  await supabase.from('chartis_threads')
    .update({ status: 'aktiv', updated_at: new Date().toISOString() }).eq('id', thread.id)

  return json({ success: true, routed: true, thread_id: thread.id, message_id: msg.id })
})
