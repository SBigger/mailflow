// ===========================================================================
// chartis-whatsapp-inbound  -  WhatsApp Cloud API Webhook (Meta direkt)
// ===========================================================================
// Meta POSTet eingehende WhatsApp-Nachrichten direkt hierher (kein BSP).
// Routing (analog chartis-inbound, aber ohne Faden-Token):
//   1) Dedup ueber wamid (at-least-once) via chartis_inbound_dedup
//   2) wa_id (Absender) -> Faden ueber chartis_thread_whatsapp
//   3) kein Treffer -> chartis_unrouted (kein stiller Verlust)
// Nachrichtentyp:
//   - 'messages' mit text/image/... -> als whatsapp_in in den Faden
//   - 'statuses' (delivered/read/...) -> nur ACK (200), (noch) nicht verarbeitet
// Absicherung:
//   - ?secret=... muss CHARTIS_WHATSAPP_INBOUND_SECRET matchen (wie chartis-inbound)
//   - zusaetzlich X-Hub-Signature-256 (HMAC-SHA256 mit dem Meta-App-Secret in
//     WHATSAPP_APP_SECRET). Meta signiert jede Zustellung -> empfohlen zu setzen.
// Verify-Handshake: GET mit hub.mode/hub.verify_token/hub.challenge -> challenge
// Deploy mit: supabase functions deploy chartis-whatsapp-inbound --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, env } from '../_shared/chartis.ts'

const PROVIDER = 'whatsapp'

// Meta HMAC-SHA256 der ROHEN Payload gegen X-Hub-Signature-256 pruefen.
// Nur aktiv, wenn WHATSAPP_APP_SECRET gesetzt ist (360dialog reicht die
// Meta-Signatur nicht immer durch -> dann traegt allein das Pfad-Secret).
async function validSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!secret) return true // nicht konfiguriert -> Signaturpruefung uebersprungen
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = 'sha256=' + Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  // Laengengleich -> konstanter Vergleich
  if (expected.length !== header.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

// Text aus den unterstuetzten Nachrichtentypen ziehen (Cloud-API-Schema).
function extractBody(m: any): { text: string | null; note: string | null } {
  switch (m?.type) {
    case 'text':     return { text: m.text?.body ?? null, note: null }
    case 'button':   return { text: m.button?.text ?? null, note: null }
    case 'interactive': {
      const i = m.interactive
      return { text: i?.button_reply?.title ?? i?.list_reply?.title ?? null, note: null }
    }
    case 'image': case 'document': case 'audio': case 'video': case 'sticker':
      return { text: m[m.type]?.caption ?? null, note: `[${m.type}]` }
    case 'location':
      return { text: null, note: '[location]' }
    case 'contacts':
      return { text: null, note: '[contacts]' }
    default:
      return { text: null, note: m?.type ? `[${m.type}]` : null }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const url = new URL(req.url)

  // ── GET: Meta/Cloud-API Verify-Handshake ──────────────────────────────────
  // Beim Einrichten des Webhooks schickt Meta ein GET mit hub.challenge.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const verifyToken = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN')
    if (mode === 'subscribe' && expected && verifyToken === expected) {
      return new Response(challenge ?? '', { status: 200, headers: corsHeaders })
    }
    return json({ error: 'forbidden' }, 403)
  }

  // ── Pfad-Secret pruefen (wie chartis-inbound) ─────────────────────────────
  if (url.searchParams.get('secret') !== env('CHARTIS_WHATSAPP_INBOUND_SECRET')) {
    return json({ error: 'forbidden' }, 403)
  }

  // Rohtext lesen (fuer optionale Signaturpruefung), dann JSON parsen.
  const rawBody = await req.text()
  if (!(await validSignature(rawBody, req.headers.get('x-hub-signature-256')))) {
    return json({ error: 'bad signature' }, 403)
  }
  let payload: any = null
  try { payload = JSON.parse(rawBody) } catch { /* faellt unten auf bad payload */ }
  if (!payload) return json({ error: 'bad payload' }, 400)

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  // Cloud-API-Struktur: entry[].changes[].value.{messages,statuses,contacts}
  const changes: any[] = (payload.entry || []).flatMap((e: any) => e?.changes || [])
  const results: any[] = []

  for (const ch of changes) {
    const value = ch?.value || {}
    // Kontaktname (best effort) je wa_id merken
    const contactName: Record<string, string> = {}
    for (const c of (value.contacts || [])) {
      if (c?.wa_id) contactName[c.wa_id] = c?.profile?.name || ''
    }

    // Statuszustellungen (delivered/read/sent/failed) -> nur bestaetigen.
    if ((value.statuses || []).length && !(value.messages || []).length) {
      results.push({ kind: 'status', count: value.statuses.length })
      continue
    }

    for (const m of (value.messages || [])) {
      const wamid: string | null = m?.id || null
      const waId: string = m?.from || ''

      // Ohne stabile wamid kein deterministischer Dedup -> parken.
      if (!wamid) {
        await supabase.from('chartis_unrouted').insert({
          provider: PROVIDER, external_message_id: null, from_addr: waId, subject: null, reason: 'no_message_id',
        })
        results.push({ routed: false, reason: 'no_message_id' })
        continue
      }

      // ── Idempotenz zuerst (upsert + ignoreDuplicates) ────────────────────
      const { data: dedupRows, error: dedupErr } = await supabase
        .from('chartis_inbound_dedup')
        .upsert({ provider: PROVIDER, external_message_id: wamid },
                { onConflict: 'provider,external_message_id', ignoreDuplicates: true })
        .select('provider')
      if (dedupErr) { results.push({ error: 'dedup', details: dedupErr.message }); continue }
      if (!dedupRows || dedupRows.length === 0) { results.push({ duplicate: true, wamid }); continue }

      const toUnrouted = async (reason: string) => {
        await supabase.from('chartis_unrouted').insert({
          provider: PROVIDER, external_message_id: wamid, from_addr: waId, subject: null, reason,
        })
        results.push({ routed: false, reason, wamid })
      }

      // ── wa_id -> Faden (zuletzt aktualisierter Faden dieser Nummer) ───────
      // Sortierung in JS statt ueber PostgREST-embedded-order (robuster).
      const { data: bindings } = await supabase
        .from('chartis_thread_whatsapp')
        .select('thread_id, chartis_threads!inner(id, mandant_id, updated_at)')
        .eq('wa_id', waId)
      if (!bindings || bindings.length === 0) { await toUnrouted('no_wa_binding'); continue }
      bindings.sort((a: any, b: any) =>
        new Date(b.chartis_threads?.updated_at || 0).getTime() -
        new Date(a.chartis_threads?.updated_at || 0).getTime())
      const binding: any = bindings[0]

      const threadId = binding.thread_id
      const mandantId = binding.chartis_threads?.mandant_id ?? null

      const { text, note } = extractBody(m)
      const bodyText = [text, note].filter(Boolean).join(' ').trim() || null

      const { data: msg, error: msgErr } = await supabase
        .from('chartis_messages')
        .insert({
          thread_id: threadId,
          mandant_id: mandantId,
          kind: 'whatsapp_in',
          body_text: bodyText,
          from_addr: waId,
          message_id: wamid,
        })
        .select('id')
        .single()
      if (msgErr) {
        // Doppelte wamid (Unique message_id) ist NICHT transient -> Dedup behalten.
        if ((msgErr as { code?: string }).code === '23505') { results.push({ duplicate: true, wamid }); continue }
        // Nur echt transiente Fehler: Dedup-Eintrag freigeben fuer sauberen Retry.
        await supabase.from('chartis_inbound_dedup').delete().match({ provider: PROVIDER, external_message_id: wamid })
        results.push({ error: 'DB-Fehler', details: msgErr.message })
        continue
      }

      // Profilname best effort nachtragen, wenn Bindung noch keinen hat.
      if (contactName[waId]) {
        await supabase.from('chartis_thread_whatsapp')
          .update({ name: contactName[waId] }).eq('thread_id', threadId).is('name', null)
      }

      await supabase.from('chartis_inbound_dedup')
        .update({ thread_id: threadId, message_id: msg.id })
        .match({ provider: PROVIDER, external_message_id: wamid })
      const { error: updErr } = await supabase.from('chartis_threads')
        .update({ status: 'aktiv', updated_at: new Date().toISOString() }).eq('id', threadId)
      if (updErr) console.error('chartis-whatsapp-inbound: Thread-Status-Update fehlgeschlagen', threadId, updErr.message)

      results.push({ routed: true, thread_id: threadId, message_id: msg.id, wamid })
    }
  }

  // Immer 200, damit der Provider nicht endlos retried (Fehler stehen pro Item).
  return json({ success: true, results })
})
