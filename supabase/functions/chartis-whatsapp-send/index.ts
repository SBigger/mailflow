// ===========================================================================
// chartis-whatsapp-send  -  Outbound: Mitarbeiter-Nachricht via WhatsApp
// ===========================================================================
// Aufruf vom Frontend (Bearer-JWT eines Mitarbeiters). Versand DIREKT ueber
// Metas WhatsApp Cloud API (KEIN BSP wie 360dialog -> keine Monatsgebuehr;
// Meta hostet gratis). Ein service-weiter Meta-Access-Token als Secret.
//
// Kosten: Antworten im 24h-Service-Fenster sind bei Meta kostenlos. Nur
// proaktive Vorlagen (business-initiated) kosten pro Nachricht.
//
// 24h-Fenster (Meta-Regel):
//   - Liegt die LETZTE eingehende Kundennachricht < 24h zurueck -> freie
//     Textnachricht erlaubt (kostenlos).
//   - Sonst NUR genehmigte Vorlagen (type='template'). Ein Freitext ausserhalb
//     des Fensters wird mit 409 abgelehnt (der Client bietet dann Vorlagen an).
//
// Outbox-Muster wie chartis-send: ZUERST persistieren, DANN senden; bei
// Sendefehler die Zeile wieder loeschen (kein Waisen-Eintrag, kein Doppelversand).
//
// "Dry" ohne Konfig: fehlt WHATSAPP_ACCESS_TOKEN oder WHATSAPP_PHONE_NUMBER_ID
// -> 501 (not_configured), es wird nichts persistiert. So laeuft die Function
// bereits, scharf ab dem Setzen der Secrets.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, env } from '../_shared/chartis.ts'

// Meta Graph API. GRAPH_VERSION ueberschreibbar; PHONE_NUMBER_ID = die ID der
// registrierten Firmennummer aus dem Meta WhatsApp Manager.
const GRAPH_VERSION = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v21.0'
const WINDOW_MS = 24 * 60 * 60 * 1000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const apiToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
    if (!apiToken || !phoneNumberId) {
      return json({ error: 'not_configured', detail: 'WHATSAPP_ACCESS_TOKEN oder WHATSAPP_PHONE_NUMBER_ID fehlt' }, 501)
    }
    const apiUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`

    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    // ── Auth: eingeloggter Mitarbeiter (profiles-Zeile) ────────────────────
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(jwt)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (!profile) return json({ error: 'Kein Mitarbeiter-Profil' }, 403)

    // body        : Freitext (im 24h-Fenster)
    // template    : { name, language?, components? } (ausserhalb des Fensters)
    const { thread_id, body, template } = await req.json()
    if (!thread_id) return json({ error: 'thread_id erforderlich' }, 400)
    if (!body && !template) return json({ error: 'body oder template erforderlich' }, 400)

    // ── Faden + WhatsApp-Bindung laden ─────────────────────────────────────
    const { data: thread } = await supabase
      .from('chartis_threads')
      .select('id, mandant_id')
      .eq('id', thread_id)
      .maybeSingle()
    if (!thread) return json({ error: 'Faden nicht gefunden' }, 404)

    const { data: binding } = await supabase
      .from('chartis_thread_whatsapp')
      .select('wa_id')
      .eq('thread_id', thread_id)
      .maybeSingle()
    if (!binding?.wa_id) return json({ error: 'Kein WhatsApp-Kontakt am Faden (wa_id)' }, 400)
    const waId: string = binding.wa_id

    // ── 24h-Fenster bestimmen: letzte eingehende Kundennachricht ───────────
    const { data: lastIn } = await supabase
      .from('chartis_messages')
      .select('created_at')
      .eq('thread_id', thread_id)
      .eq('kind', 'whatsapp_in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const withinWindow = !!lastIn && (Date.now() - new Date(lastIn.created_at).getTime()) < WINDOW_MS

    // Freitext ausserhalb des Fensters -> Vorlage verlangen.
    if (!withinWindow && !template) {
      return json({ error: 'outside_24h_window', detail: 'Ausserhalb des 24h-Fensters ist nur eine genehmigte Vorlage erlaubt.' }, 409)
    }

    // ── Cloud-API-Payload bauen ────────────────────────────────────────────
    let waPayload: Record<string, unknown>
    let storedText: string
    if (template) {
      waPayload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language || 'de' },
          ...(template.components ? { components: template.components } : {}),
        },
      }
      storedText = `[Vorlage: ${template.name}]`
    } else {
      waPayload = {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'text',
        text: { body: String(body), preview_url: false },
      }
      storedText = String(body)
    }

    // ── Outbox: ZUERST persistieren, DANN senden ───────────────────────────
    const { data: msg, error: msgErr } = await supabase
      .from('chartis_messages')
      .insert({
        thread_id,
        mandant_id: thread.mandant_id,
        kind: 'whatsapp_out',
        body_text: storedText,
        to_addr: waId,
        message_id: null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (msgErr) return json({ error: 'DB-Fehler', details: msgErr.message }, 500)

    // ── Versand direkt ueber Meta Graph API (Bearer-Token) ─────────────────
    let sent: Response
    try {
      sent = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(waPayload),
      })
    } catch (e) {
      await supabase.from('chartis_messages').delete().eq('id', msg.id)
      return json({ error: 'Versand fehlgeschlagen', details: (e as Error).message }, 502)
    }

    const respBody = await sent.json().catch(() => ({}))
    if (!sent.ok) {
      // Versand fehlgeschlagen -> Zeile entfernen (kein Waisen-Eintrag).
      await supabase.from('chartis_messages').delete().eq('id', msg.id)
      return json({ error: 'Versand fehlgeschlagen', status: sent.status, details: respBody }, 502)
    }

    // Provider-wamid nachtragen (fuer Zuordnung von Status-Callbacks).
    const wamid: string | null = respBody?.messages?.[0]?.id || null
    await supabase.from('chartis_messages').update({ message_id: wamid }).eq('id', msg.id)

    const { error: updErr } = await supabase.from('chartis_threads')
      .update({ status: 'wartet_kunde', updated_at: new Date().toISOString() })
      .eq('id', thread_id)
    if (updErr) console.error('chartis-whatsapp-send: Thread-Status-Update fehlgeschlagen', thread_id, updErr.message)

    return json({ success: true, message_id: msg.id, wamid, within_24h_window: withinWindow })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
