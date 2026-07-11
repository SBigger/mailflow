// ===========================================================================
// chartis-fanout  -  verteilt EINE Chat-Nachricht per E-Mail an alle Externen
// ===========================================================================
// Fuer Direkt-/Gruppenchats mit externen Teilnehmern ("geteilte Unterhaltung").
// Die interne Nachricht wird bereits vom Frontend in chartis_messages angelegt
// (kind='intern') - diese Funktion legt KEINE weitere Nachricht an, sie schickt
// den Text nur zusaetzlich per E-Mail an jede/n Externe/n. Alle teilen sich das
// stabile Faden-Token; die Antwort kommt via chartis-inbound als email_in zurueck.
// Beruehrt die produktive MS365-Integration NICHT.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders, env, replyAddress, htmlToText,
} from '../_shared/chartis.ts'
import { getMailProvider } from '../_shared/mailProvider.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    // ── Auth: eingeloggter Mitarbeiter ─────────────────────────────────────
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: profile } = await supabase.from('profiles').select('id, chat_signature').eq('id', user.id).maybeSingle()
    if (!profile) return json({ error: 'Kein Mitarbeiter-Profil' }, 403)

    const { thread_id, body } = await req.json()
    if (!thread_id || !body) return json({ error: 'thread_id und body erforderlich' }, 400)

    // ── Faden + Externe laden ──────────────────────────────────────────────
    const { data: thread } = await supabase
      .from('chartis_threads')
      .select('id, subject, thread_type, reply_token')
      .eq('id', thread_id)
      .maybeSingle()
    if (!thread) return json({ error: 'Faden nicht gefunden' }, 404)

    const { data: externals } = await supabase
      .from('chartis_thread_externals')
      .select('email, name')
      .eq('thread_id', thread_id)
    if (!externals || externals.length === 0) return json({ success: true, sent: 0 })

    // ── Body + Signatur aufbereiten (body kommt als HTML vom Frontend) ──────
    const sig = String(profile.chat_signature || '').trim()
    const sigIsHtml = /<(br|p|div|table|span|a|img|ul|ol|li|strong|em|h[1-6])\b[^>]*>/i.test(sig)
    const sigHtml = sig ? `<br><br>${sigIsHtml ? sig : sig.replace(/\n/g, '<br>')}` : ''
    const htmlBody = `${String(body)}${sigHtml}`
    const textBody = htmlToText(String(body)) + (sig ? '\n\n' + sig.replace(/<[^>]+>/g, '') : '')
    const replyTo = replyAddress(thread.reply_token)
    const subject = thread.subject && thread.subject !== 'Direkt' ? thread.subject : 'Nachricht aus Smartis'

    // ── An jede/n Externe/n einzeln senden (kein Adress-Leak untereinander) ─
    const provider = getMailProvider()
    let sent = 0
    const failed: string[] = []
    for (const ex of externals) {
      const r = await provider.send({
        to: ex.email, toName: ex.name || undefined,
        subject, htmlBody, textBody, replyTo,
      })
      if (r.ok) sent++
      else failed.push(`${ex.email}: ${r.error}`)
    }

    await supabase.from('chartis_threads').update({ updated_at: new Date().toISOString() }).eq('id', thread_id)

    return json({ success: failed.length === 0, sent, failed })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
