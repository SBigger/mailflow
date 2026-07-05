// ===========================================================================
// chartis-send  -  Outbound: Mitarbeiter-Nachricht als E-Mail an den Kunden
// ===========================================================================
// Aufruf vom Frontend (Bearer-JWT eines Mitarbeiters). Versand ueber Postmark
// von der eigenen Domain; Reply-To traegt das stabile Faden-Token, damit die
// Kundenantwort via chartis-inbound in DENSELBEN Faden zurueckkommt.
// Beruehrt die produktive MS365-Integration NICHT.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, env, replyAddress, postmarkSend, CHARTIS_FROM, htmlToText,
} from '../_shared/chartis.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    // ── Auth: eingeloggter Mitarbeiter (profiles-Zeile) ────────────────────
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: profile } = await supabase.from('profiles').select('id, chat_signature').eq('id', user.id).maybeSingle()
    if (!profile) return json({ error: 'Kein Mitarbeiter-Profil' }, 403)

    const { thread_id, body } = await req.json()
    if (!thread_id || !body) return json({ error: 'thread_id und body erforderlich' }, 400)

    // ── Faden laden ────────────────────────────────────────────────────────
    const { data: thread } = await supabase
      .from('chartis_threads')
      .select('id, mandant_id, subject, ext_contact_email, reply_token')
      .eq('id', thread_id)
      .maybeSingle()
    if (!thread) return json({ error: 'Faden nicht gefunden' }, 404)
    if (!thread.ext_contact_email) return json({ error: 'Kein Kunden-Kontakt am Faden (ext_contact_email)' }, 400)

    // Vorherige Message-ID fuer sauberes Client-Threading (best effort)
    const { data: prev } = await supabase
      .from('chartis_messages')
      .select('message_id, references_h')
      .eq('thread_id', thread_id)
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const replyTo = replyAddress(thread.reply_token)
    const sig = String(profile.chat_signature || '').trim()
    // Nur echte HTML-Tags erkennen (nicht "Name <mail@x>") -> sonst \n->br
    const sigIsHtml = /<(br|p|div|table|span|a|img|ul|ol|li|strong|em|h[1-6])\b[^>]*>/i.test(sig)
    const sigHtml = sig ? `<br><br>${sigIsHtml ? sig : sig.replace(/\n/g, '<br>')}` : ''
    // body kommt bereits als HTML vom Frontend (markdownToEmailHtml) -> NICHT doppelt wrappen
    const htmlBody = `${String(body)}${sigHtml}`
    const references = prev?.message_id
      ? `${prev.references_h ? prev.references_h + ' ' : ''}${prev.message_id}`.trim()
      : null

    // ── Outbox-Muster: ZUERST persistieren, DANN senden ────────────────────
    // Sonst wuerde ein DB-Fehler NACH dem Versand auftreten -> Mail schon raus,
    // aber kein Faden-Eintrag; ein Retry versendet doppelt. Jetzt scheitert ein
    // DB-Fehler VOR dem Versand -> sauberer Retry ohne Doppelmail.
    const { data: msg, error: msgErr } = await supabase
      .from('chartis_messages')
      .insert({
        thread_id,
        mandant_id: thread.mandant_id,
        kind: 'email_out',
        body_text: htmlToText(String(body)),
        body_html: htmlBody,
        from_addr: CHARTIS_FROM,
        to_addr: thread.ext_contact_email,
        reply_token: thread.reply_token,
        message_id: null,
        references_h: references,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (msgErr) return json({ error: 'DB-Fehler', details: msgErr.message }, 500)

    // ── Versand ────────────────────────────────────────────────────────────
    const sent = await postmarkSend({
      to: thread.ext_contact_email,
      subject: thread.subject,
      htmlBody,
      textBody: htmlToText(String(body)) + (sig ? '\n\n' + sig.replace(/<[^>]+>/g, '') : ''),
      replyTo,
      inReplyTo: prev?.message_id || null,
      references,
    })
    if (!sent.ok) {
      // Versand fehlgeschlagen -> die eben angelegte Zeile wieder entfernen (kein Waisen-Eintrag)
      await supabase.from('chartis_messages').delete().eq('id', msg.id)
      return json({ error: 'Versand fehlgeschlagen', details: sent.error }, 502)
    }

    // Postmark-message_id nachtragen (fuer Client-Threading der Folgemails)
    await supabase.from('chartis_messages').update({ message_id: sent.messageId || null }).eq('id', msg.id)

    const { error: updErr } = await supabase.from('chartis_threads')
      .update({ status: 'wartet_kunde', updated_at: new Date().toISOString() })
      .eq('id', thread_id)
    if (updErr) console.error('chartis-send: Thread-Status-Update fehlgeschlagen', thread_id, updErr.message)

    return json({ success: true, message_id: msg.id, postmark_id: sent.messageId })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
