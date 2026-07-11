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
import { corsHeaders, env } from '../_shared/chartis.ts'
import { getMailProvider } from '../_shared/mailProvider.ts'

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

  // Provider hinter Interface: normalisiert das Payload auf kanonische Felder,
  // egal ob Postmark-JSON oder Rogers self-hosted Relay-JSON.
  const mp = getMailProvider()
  const mail = mp.parseInbound(p)
  const provider = mp.name
  const externalId: string | null = mail.externalId
  const fromEmail: string = mail.fromEmail
  const subject: string = mail.subject

  // Ohne stabile Message-ID kein deterministischer Dedup-Key (Random wuerde
  // Retries durchlassen) -> konsistent nach Unrouted parken.
  if (!externalId) {
    await supabase.from('chartis_unrouted').insert({ provider, external_message_id: null, from_addr: fromEmail, subject, reason: 'no_message_id' })
    return json({ success: true, routed: false, reason: 'no_message_id' })
  }

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
  if (mail.isBounce) return await toUnrouted('bounce')

  // ── Token -> Faden ───────────────────────────────────────────────────────
  const token = mail.token
  if (!token) return await toUnrouted('no_token')

  const { data: thread } = await supabase
    .from('chartis_threads')
    .select('id, mandant_id, ext_contact_email')
    .eq('reply_token', token)
    .maybeSingle()
  if (!thread) return await toUnrouted('bad_token')

  // ── From-Binding: Hijacking-/Stellvertreter-Schutz ──────────────────────
  // Leerer Absender darf das From-Binding NICHT umgehen (kein `fromEmail &&`)
  if (thread.ext_contact_email && thread.ext_contact_email.toLowerCase() !== fromEmail) {
    return await toUnrouted('from_mismatch')
  }

  // ── Nachricht schreiben (Reply-Stripping hat der Provider erledigt) ────────
  const bodyText = mail.bodyText
  const { data: msg, error: msgErr } = await supabase
    .from('chartis_messages')
    .insert({
      thread_id: thread.id,
      mandant_id: thread.mandant_id,
      kind: 'email_in',
      body_text: bodyText,
      body_html: mail.bodyHtml,
      from_addr: fromEmail,
      to_addr: mail.originalRecipient,
      message_id: mail.messageIdHeader,
      in_reply_to: mail.inReplyToHeader,
      references_h: mail.referencesHeader,
    })
    .select('id')
    .single()
  if (msgErr) {
    // Unique-Verletzung (gefaelschte/duplizierte Message-ID) ist NICHT transient:
    // Dedup-Guard behalten, sonst Endlos-Retry-Loop (Poison Message).
    if ((msgErr as { code?: string }).code === '23505') return json({ success: true, duplicate: true })
    // Nur bei echt transienten Fehlern den Dedup-Eintrag wieder freigeben.
    await supabase.from('chartis_inbound_dedup').delete().match({ provider, external_message_id: externalId })
    return json({ error: 'DB-Fehler', details: msgErr.message }, 500)
  }

  await supabase.from('chartis_inbound_dedup')
    .update({ thread_id: thread.id, message_id: msg.id }).match({ provider, external_message_id: externalId })
  const { error: updErr } = await supabase.from('chartis_threads')
    .update({ status: 'aktiv', updated_at: new Date().toISOString() }).eq('id', thread.id)
  if (updErr) console.error('chartis-inbound: Thread-Status-Update fehlgeschlagen', thread.id, updErr.message)

  return json({ success: true, routed: true, thread_id: thread.id, message_id: msg.id })
})
