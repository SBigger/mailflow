import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB

function validateUUID(value: string, name: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''))
    throw new Error(`${name} ist keine gültige UUID`)
  return value.toLowerCase()
}

function safeName(name: string) {
  return name.replace(/[#%*:<>?/\\|"]/g, '_')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const ok  = (data: any) => new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const err = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // ── resolve-checkout-token (pre-auth, Agent) ───────────────────────────────
  {
    const u      = new URL(req.url)
    const action = u.searchParams.get('action')
    if (action === 'resolve-checkout-token') {
      const tokenId = u.searchParams.get('token') || ''
      if (!tokenId || !/^[0-9a-f-]{36}$/i.test(tokenId))
        return err('token fehlt oder ungueltig')

      const { data: tok } = await supabase
        .from('agent_tokens')
        .select('doc_id, filename, jwt, download_url, expires_at, used_at')
        .eq('id', tokenId).single()

      if (!tok)           return err('Token nicht gefunden', 401)
      if (tok.used_at)    return err('Token bereits verwendet', 401)
      if (new Date(tok.expires_at) < new Date()) return err('Token abgelaufen', 401)

      await supabase.from('agent_tokens').update({ used_at: new Date().toISOString() }).eq('id', tokenId)

      return ok({ doc_id: tok.doc_id, filename: tok.filename, download_url: tok.download_url || '' })
    }
  }

  // ── Agent-Operationen (pre-auth) ───────────────────────────────────────────
  {
    const u          = new URL(req.url)
    const agentToken = u.searchParams.get('agent_token') || ''
    const agentAction = u.searchParams.get('action') || ''

    if (agentToken && ['checkin-agent', 'checkin-discard'].includes(agentAction)) {
      if (!/^[0-9a-f-]{36}$/i.test(agentToken))
        return err('Ungueltige agent_token', 401)

      const { data: tok } = await supabase
        .from('agent_tokens')
        .select('user_id, used_at')
        .eq('id', agentToken).single()

      if (!tok?.used_at)
        return err('agent_token nicht gefunden oder nicht aufgeloest', 401)

      const agentUserId = tok.user_id

      // checkin-agent: Datei direkt in Supabase Storage speichern
      if (agentAction === 'checkin-agent') {
        try {
          const form   = await req.formData()
          const file   = form.get('file') as File
          const docId  = validateUUID((form.get('doc_id') as string) || '', 'doc_id')
          if (!file) throw new Error('Keine Datei angegeben')

          const { data: doc } = await supabase.from('dokumente')
            .select('id, checked_out_by, filename').eq('id', docId).single()
          if (!doc) throw new Error('Dokument nicht gefunden')

          // Bereits eingecheckt (Doppelaufruf) → stilles OK
          if (doc.checked_out_by !== null && doc.checked_out_by !== agentUserId)
            throw new Error('Dokument nicht von dir ausgecheckt')

          if (doc.checked_out_by === agentUserId) {
            const fileData = new Uint8Array(await file.arrayBuffer())
            if (fileData.length === 0) throw new Error('Datei ist leer')
            if (fileData.length > MAX_FILE_SIZE) throw new Error('Datei zu gross')
            const storagePath = `dokumente/${docId}/${Date.now()}-${safeName((file.name as string) || doc.filename)}`
            const { error: storErr } = await supabase.storage
              .from('dokumente').upload(storagePath, fileData, { upsert: true, contentType: 'application/octet-stream' })
            if (storErr) throw new Error('Storage Upload: ' + storErr.message)
            await supabase.from('dokumente').update({
              storage_path: storagePath, file_size: fileData.length,
              checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
            }).eq('id', docId)
          }
          return ok({ ok: true })
        } catch (e: any) { return err(e.message) }
      }

      // checkin-discard: Checkout freigeben ohne Upload
      if (agentAction === 'checkin-discard') {
        try {
          const body  = await req.json()
          const docId = validateUUID(body.doc_id, 'doc_id')
          const { data: doc } = await supabase.from('dokumente')
            .select('id, checked_out_by').eq('id', docId).single()
          if (!doc) throw new Error('Dokument nicht gefunden')
          if (doc.checked_out_by === agentUserId)
            await supabase.from('dokumente').update({
              checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
            }).eq('id', docId)
          return ok({ ok: true })
        } catch (e: any) { return err(e.message) }
      }
    }
  }

  // ── Authentifizierung ──────────────────────────────────────────────────────
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!jwt) return err('Kein Token', 401)

  const { data: { user: authUser } } = await supabase.auth.getUser(jwt)
  if (!authUser) return err('Unauthorized', 401)

  try {
    const u = new URL(req.url)
    let action = u.searchParams.get('action')
    let body: any = {}
    const ct = req.headers.get('content-type') || ''

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      action = action || (form.get('action') as string)
      body = {
        file:        form.get('file') as File,
        customer_id: form.get('customer_id') as string,
        doc_id:      form.get('doc_id') as string,
      }
    } else if (ct.includes('application/json')) {
      body   = await req.json()
      action = action || body.action
    }

    // ── search: Supabase DB-Suche ────────────────────────────────────────────
    if (action === 'search') {
      const { q, customer_id } = body
      if (!q || typeof q !== 'string' || q.trim().length < 2)
        throw new Error('Suchbegriff zu kurz (min. 2 Zeichen)')
      let query = supabase.from('dokumente')
        .select('id, name, filename, customer_id, category, year, file_size, storage_path, tag_ids')
        .ilike('name', `%${q.trim()}%`)
        .limit(30)
      if (customer_id) {
        try { query = query.eq('customer_id', validateUUID(customer_id, 'customer_id')) } catch {}
      }
      const { data: items } = await query
      return ok({ items: items || [] })
    }

    // ── checkin-save: Neue Version in Supabase Storage ───────────────────────
    if (action === 'checkin-save') {
      const docId = validateUUID(body.doc_id, 'doc_id')
      const file  = body.file as File
      if (!file) throw new Error('Keine Datei angegeben')
      const { data: doc } = await supabase.from('dokumente')
        .select('id, checked_out_by, storage_path, filename').eq('id', docId).single()
      if (!doc) throw new Error('Dokument nicht gefunden')
      if (doc.checked_out_by !== null && doc.checked_out_by !== authUser.id)
        throw new Error('Dokument ist von jemand anderem ausgecheckt')
      const fileData = new Uint8Array(await file.arrayBuffer())
      if (fileData.length === 0) throw new Error('Datei ist leer')
      if (fileData.length > MAX_FILE_SIZE) throw new Error('Datei zu gross')
      const cleanName   = safeName(file.name || doc.filename)
      const storagePath = `dokumente/${docId}/${Date.now()}-${cleanName}`
      if (doc.storage_path)
        await supabase.storage.from('dokumente').remove([doc.storage_path]).catch(() => {})
      const { error: storErr } = await supabase.storage
        .from('dokumente').upload(storagePath, fileData, { upsert: true, contentType: 'application/octet-stream' })
      if (storErr) throw new Error('Storage Upload: ' + storErr.message)
      await supabase.from('dokumente').update({
        storage_path: storagePath, filename: cleanName, file_size: fileData.length,
        checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
      }).eq('id', docId)
      return ok({ ok: true })
    }

    return err(`Unbekannte Aktion: ${action}`)

  } catch (e: any) {
    console.error('sharepoint-files error:', e)
    return err(e.message, 500)
  }
})
