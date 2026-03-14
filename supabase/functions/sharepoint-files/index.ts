import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GRAPH         = 'https://graph.microsoft.com/v1.0'
const SCOPE         = 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All'
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB

// ── Token-Refresh ─────────────────────────────────────────────────────────────
async function getAccessToken(supabase: any, userId: string, profile: any): Promise<string> {
  let accessToken = profile.microsoft_access_token
  const tokenExpiry = profile.microsoft_token_expiry || 0

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = profile.microsoft_refresh_token
    if (!refreshToken) throw new Error('Nicht mit Microsoft verbunden. Bitte in Einstellungen verbinden.')

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     Deno.env.get('MICROSOFT_CLIENT_ID')!,
          client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
          scope:         SCOPE,
        }),
      }
    )
    if (!tokenRes.ok) {
      const err = await tokenRes.json()
      throw new Error(`Token-Refresh fehlgeschlagen: ${err.error_description}`)
    }
    const tokens = await tokenRes.json()
    accessToken = tokens.access_token
    await supabase.from('profiles').update({
      microsoft_access_token:  tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry:  Date.now() + (tokens.expires_in * 1000),
    }).eq('id', userId)
  }
  return accessToken
}

// ── SharePoint IDs aus Env ────────────────────────────────────────────────────
function getSiteId()  { return Deno.env.get('SHAREPOINT_SITE_ID')  || '' }
function getDriveId() { return Deno.env.get('SHAREPOINT_DRIVE_ID') || '' }

// ── Graph-API Helper ──────────────────────────────────────────────────────────
async function graph(method: string, path: string, token: string, body?: any) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let fetchBody: any
  if (body instanceof Uint8Array) {
    headers['Content-Type'] = 'application/octet-stream'
    fetchBody = body
  } else if (body) {
    headers['Content-Type'] = 'application/json'
    fetchBody = JSON.stringify(body)
  }
  const res = await fetch(`${GRAPH}${path}`, { method, headers, body: fetchBody })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph ${method} ${path} \u2192 ${res.status}: ${err}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Input-Validierung (verhindert Path-Traversal & Injection) ─────────────────
function validateUUID(value: string, name: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''))
    throw new Error(`${name} ist keine gültige UUID`)
  return value.toLowerCase()
}

function validatePathComponent(value: string, name: string): string {
  if (!value || typeof value !== 'string') throw new Error(`${name} fehlt`)
  const cleaned = value.trim()
  if (cleaned.length === 0 || cleaned.length > 200) throw new Error(`${name} hat ungültige Länge`)
  if (/[/\\<>:"|?*\x00-\x1f]|\.\./.test(cleaned)) throw new Error(`${name} enthält ungültige Zeichen`)
  return cleaned
}

function validateYear(value: string): number {
  const y = parseInt(value, 10)
  if (isNaN(y) || y < 2000 || y > 2100) throw new Error('Jahr ungültig (2000–2100)')
  return y
}

function validateItemId(value: string): string {
  if (!value || typeof value !== 'string' || value.length < 1 || value.length > 300)
    throw new Error('item_id ungültig')
  if (!/^[A-Za-z0-9!_.-]+$/.test(value)) throw new Error('item_id enthält ungültige Zeichen')
  return value
}

function safeName(name: string) {
  return name.replace(/[#%*:<>?/\\|"]/g, '_')
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // resolve-checkout-token: VOR Auth-Check (Agent ruft mit ANON-Key)
  {
    const earlyUrl    = new URL(req.url)
    const earlyAction = earlyUrl.searchParams.get('action')
    if (earlyAction === 'resolve-checkout-token') {
      const tokenId = earlyUrl.searchParams.get('token') || ''
      if (!tokenId || !/^[0-9a-f-]{36}$/i.test(tokenId))
        return new Response(JSON.stringify({ error: 'token fehlt oder ungueltig' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      const { data: tok } = await supabase
        .from('agent_tokens')
        .select('doc_id, item_id, filename, jwt, download_url, expires_at, used_at')
        .eq('id', tokenId)
        .single()

      if (!tok)
        return new Response(JSON.stringify({ error: 'Token nicht gefunden' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      if (tok.used_at)
        return new Response(JSON.stringify({ error: 'Token bereits verwendet' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      if (new Date(tok.expires_at) < new Date())
        return new Response(JSON.stringify({ error: 'Token abgelaufen' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      await supabase.from('agent_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', tokenId)

      return new Response(JSON.stringify({
        jwt:      tok.jwt,
        doc_id:   tok.doc_id,
        item_id:  tok.item_id,
        filename: tok.filename,
        filename:     tok.filename,
        download_url: tok.download_url || '',
    }
  }

  // ── Authentifizierung ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const jwtToken   = authHeader.replace('Bearer ', '').trim()
  if (!jwtToken)
    return new Response(JSON.stringify({ error: 'Kein Token' }), { status: 401, headers: corsHeaders })

  const { data: { user: authUser } } = await supabase.auth.getUser(jwtToken)
  if (!authUser)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile)
    return new Response(JSON.stringify({ error: 'Profil nicht gefunden' }), { status: 404, headers: corsHeaders })

  try {
    const accessToken = await getAccessToken(supabase, authUser.id, profile)
    const siteId  = getSiteId()
    const driveId = getDriveId()
    if (!siteId || !driveId) throw new Error('SharePoint nicht konfiguriert (SITE_ID/DRIVE_ID fehlen)')

    const url = new URL(req.url)
    let action = url.searchParams.get('action')
    let body: any = {}

    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      action = action || (form.get('action') as string)
      body = {
        file:               form.get('file') as File,
        customer_id:        form.get('customer_id') as string,
        category:           form.get('category') as string,
        year:               form.get('year') as string,
        filename:           form.get('filename') as string,
        doc_id:             form.get('doc_id') as string,
        prev_draft_item_id: form.get('prev_draft_item_id') as string,
      }
    } else if (contentType.includes('application/json')) {
      body   = await req.json()
      action = action || body.action
    }

    // ── setup: SITE_ID + DRIVE_ID ermitteln (nur Admins) ──────────────────
    if (action === 'setup') {
      if (profile.role !== 'admin')
        return new Response(JSON.stringify({ error: 'Nur für Administratoren' }), { status: 403, headers: corsHeaders })
      const siteData   = await graph('GET', `/sites/artistreuhand.sharepoint.com:/sites/ArtisMailFlow`, accessToken)
      const drivesData = await graph('GET', `/sites/${siteData.id}/drives`, accessToken)
      const drive = drivesData.value.find((d: any) => d.driveType === 'documentLibrary') || drivesData.value[0]
      return new Response(JSON.stringify({
        site_id:    siteData.id,
        drive_id:   drive.id,
        site_name:  siteData.displayName,
        drive_name: drive.name,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── upload ─────────────────────────────────────────────────────────────
    if (action === 'upload') {
      const { file, customer_id, category, year, filename } = body
      if (!file) throw new Error('Keine Datei angegeben')

      const custId   = validateUUID(customer_id, 'customer_id')
      const cat      = validatePathComponent(category, 'category')
      const yr       = validateYear(year)
      const fileData = new Uint8Array(await (file as File).arrayBuffer())
      if (fileData.length === 0)       throw new Error('Datei ist leer')
      if (fileData.length > MAX_FILE_SIZE) throw new Error('Datei zu gross (max. 100 MB)')

      const safe   = safeName(filename || (file as File).name)
      const spPath = `Kunden/${custId}/${cat}/${yr}/${Date.now()}-${safe}`

      let item: any
      if (fileData.length < 4 * 1024 * 1024) {
        // Kleine Datei: direkter PUT
        item = await graph('PUT',
          `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/content`,
          accessToken, fileData)
      } else {
        // Grosse Datei: Upload-Session mit Chunks
        const session = await graph('POST',
          `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/createUploadSession`,
          accessToken,
          { item: { '@microsoft.graph.conflictBehavior': 'rename' } }
        )
        const chunkSize = 3 * 1024 * 1024
        let offset = 0
        while (offset < fileData.length) {
          const chunk = fileData.slice(offset, offset + chunkSize)
          const end   = Math.min(offset + chunkSize - 1, fileData.length - 1)
          const res   = await fetch(session.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.length.toString(),
              'Content-Range':  `bytes ${offset}-${end}/${fileData.length}`,
            },
            body: chunk,
          })
          if (res.ok && res.status !== 202) item = await res.json()
          offset += chunkSize
        }
      }

      return new Response(JSON.stringify({
        item_id: item.id,
        web_url: item.webUrl,
        name:    item.name,
        size:    item.size,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── get-download-url ───────────────────────────────────────────────────
    if (action === 'get-download-url') {
      const item_id = validateItemId(body.item_id)

      // Sicherheit: item_id muss in unserer DB vorhanden sein
      const { data: doc } = await supabase.from('dokumente')
        .select('id').eq('sharepoint_item_id', item_id).single()
      if (!doc) throw new Error('Dokument nicht in Datenbank gefunden')

      const item = await graph('GET',
        `/sites/${siteId}/drives/${driveId}/items/${item_id}?$select=id,name,webUrl,@microsoft.graph.downloadUrl`,
        accessToken
      )
      return new Response(JSON.stringify({
        download_url: item['@microsoft.graph.downloadUrl'],
        web_url:      item.webUrl,
        name:         item.name,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── delete ─────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const item_id = validateItemId(body.item_id)

      // Sicherheit: item_id muss in unserer DB vorhanden sein
      const { data: doc } = await supabase.from('dokumente')
        .select('id').eq('sharepoint_item_id', item_id).single()
      if (!doc) throw new Error('Dokument nicht in Datenbank gefunden')

      await graph('DELETE', `/sites/${siteId}/drives/${driveId}/items/${item_id}`, accessToken)
      return new Response(JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── search ─────────────────────────────────────────────────────────────
    if (action === 'search') {
      const { q, customer_id } = body
      if (!q || typeof q !== 'string') throw new Error('Suchbegriff fehlt')
      const trimmed = q.trim()
      if (trimmed.length < 2)   throw new Error('Suchbegriff zu kurz (min. 2 Zeichen)')
      if (trimmed.length > 200) throw new Error('Suchbegriff zu lang')

      // Query-Injection verhindern
      const safeQ = trimmed.replace(/[()[\]{}"\\]/g, ' ')
      let queryString = `${safeQ} AND path:"https://artistreuhand.sharepoint.com/sites/ArtisMailFlow"`
      if (customer_id) {
        try {
          const custId = validateUUID(customer_id, 'customer_id')
          queryString += ` AND path:"${custId}"`
        } catch { /* customer_id-Filter ignorieren wenn ungültig */ }
      }

      const result = await graph('POST', '/search/query', accessToken, {
        requests: [{
          entityTypes: ['driveItem'],
          query:       { queryString },
          fields:      ['id', 'name', 'webUrl', 'parentReference', 'size', 'lastModifiedDateTime'],
          from:        0,
          size:        25,
        }],
      })

      const hits  = result?.value?.[0]?.hitsContainers?.[0]?.hits || []
      const items = hits.map((h: any) => ({
        item_id:  h.resource?.id,
        name:     h.resource?.name,
        web_url:  h.resource?.webUrl,
        size:     h.resource?.size,
        modified: h.resource?.lastModifiedDateTime,
        path:     h.resource?.parentReference?.path,
        summary:  h.summary,
      }))

      return new Response(JSON.stringify({ items, total: hits.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── checkin-save ──────────────────────────────────────────────────────────
    if (action === 'checkin-save') {
      const doc_id = validateUUID(body.doc_id, 'doc_id')
      const file   = body.file as File
      if (!file) throw new Error('Keine Datei angegeben')

      const { data: doc, error: docErr } = await supabase.from('dokumente')
        .select('id, sharepoint_item_id, checked_out_by, filename')
        .eq('id', doc_id).single()
      if (docErr || !doc) throw new Error('Dokument nicht gefunden')
      if (doc.checked_out_by !== authUser.id) throw new Error('Dokument nicht von dir ausgecheckt')
      if (!doc.sharepoint_item_id) throw new Error('Kein SharePoint-Item vorhanden')

      const fileData = new Uint8Array(await file.arrayBuffer())
      if (fileData.length === 0) throw new Error('Datei ist leer')
      if (fileData.length > MAX_FILE_SIZE) throw new Error('Datei zu gross (max. 100 MB)')

      // Bestehenden SharePoint-Item-Inhalt ersetzen (Versionsverlauf bleibt erhalten)
      let item: any
      if (fileData.length < 4 * 1024 * 1024) {
        item = await graph('PUT',
          `/sites/${siteId}/drives/${driveId}/items/${doc.sharepoint_item_id}/content`,
          accessToken, fileData)
      } else {
        const sess2 = await graph('POST',
          `/sites/${siteId}/drives/${driveId}/items/${doc.sharepoint_item_id}/createUploadSession`,
          accessToken, { item: { '@microsoft.graph.conflictBehavior': 'replace' } })
        const chunkSize = 3 * 1024 * 1024
        let offset = 0
        while (offset < fileData.length) {
          const chunk = fileData.slice(offset, offset + chunkSize)
          const end   = Math.min(offset + chunkSize - 1, fileData.length - 1)
          const res   = await fetch(sess2.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.length.toString(),
              'Content-Range':  `bytes ${offset}-${end}/${fileData.length}`,
            },
            body: chunk,
          })
          if (res.ok && res.status !== 202) item = await res.json()
          offset += chunkSize
        }
      }

      const cleanName = file.name || doc.filename
      await supabase.from('dokumente').update({
        sharepoint_item_id:  item.id,
        sharepoint_web_url:  item.webUrl,
        filename:            cleanName,
        file_size:           fileData.length,
        checked_out_by:      null,
        checked_out_by_name: null,
        checked_out_at:      null,
      }).eq('id', doc_id)

      return new Response(JSON.stringify({ ok: true, item_id: item.id, web_url: item.webUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── checkin-discard ────────────────────────────────────────────────────────
    if (action === 'checkin-discard') {
      const doc_id = validateUUID(body.doc_id, 'doc_id')

      const { data: doc } = await supabase.from('dokumente')
        .select('id, checked_out_by').eq('id', doc_id).single()
      if (!doc) throw new Error('Dokument nicht gefunden')
      if (doc.checked_out_by !== authUser.id) throw new Error('Dokument nicht von dir ausgecheckt')

      await supabase.from('dokumente').update({
        checked_out_by:      null,
        checked_out_by_name: null,
        checked_out_at:      null,
      }).eq('id', doc_id)

      return new Response(JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── upload-draft ───────────────────────────────────────────────────────────
    if (action === 'upload-draft') {
      const doc_id          = validateUUID(body.doc_id, 'doc_id')
      const file            = body.file as File
      const prevDraftItemId = (body.prev_draft_item_id || '').trim()
      if (!file) throw new Error('Keine Datei angegeben')

      const { data: doc } = await supabase.from('dokumente')
        .select('id, checked_out_by, filename')
        .eq('id', doc_id).eq('checked_out_by', authUser.id).single()
      if (!doc) throw new Error('Kein aktiver Checkout fuer dieses Dokument')

      const fileData = new Uint8Array(await file.arrayBuffer())
      if (fileData.length === 0) throw new Error('Datei ist leer')
      if (fileData.length > MAX_FILE_SIZE) throw new Error('Datei zu gross')

      if (prevDraftItemId) {
        await graph('DELETE',
          `/sites/${siteId}/drives/${driveId}/items/${prevDraftItemId}`,
          accessToken).catch(() => {})
      }

      const safe      = safeName(file.name || doc.filename)
      const draftPath = `Drafts/${doc_id}/${Date.now()}-${safe}`
      const item      = await graph('PUT',
        `/sites/${siteId}/drives/${driveId}/root:/${draftPath}:/content`,
        accessToken, fileData)

      return new Response(JSON.stringify({ ok: true, draft_item_id: item.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // checkin-storage: Datei direkt in Supabase Storage (kein SharePoint)
    if (action === 'checkin-storage') {
      const doc_id = validateUUID(body.doc_id, 'doc_id')
      const file   = body.file as File
      if (!file) throw new Error('Keine Datei angegeben')

      const { data: doc, error: docErr } = await supabase.from('dokumente')
        .select('id, checked_out_by, filename')
        .eq('id', doc_id).single()
      if (docErr || !doc) throw new Error('Dokument nicht gefunden')
      if (doc.checked_out_by !== authUser.id) throw new Error('Dokument nicht von dir ausgecheckt')

      const fileData  = new Uint8Array(await file.arrayBuffer())
      if (fileData.length === 0)           throw new Error('Datei ist leer')
      if (fileData.length > MAX_FILE_SIZE)  throw new Error('Datei zu gross (max. 100 MB)')

      const cleanName   = safeName(file.name || doc.filename)
      const storagePath = `dokumente/${doc_id}/${Date.now()}-${cleanName}`

      const { error: storErr } = await supabase.storage
        .from('dokumente')
        .upload(storagePath, fileData, { upsert: true, contentType: 'application/octet-stream' })
      if (storErr) throw new Error('Storage Upload: ' + storErr.message)

      await supabase.from('dokumente').update({
        storage_path:        storagePath,
        filename:            cleanName,
        file_size:           fileData.length,
        checked_out_by:      null,
        checked_out_by_name: null,
        checked_out_at:      null,
        sharepoint_item_id:  null,
        sharepoint_web_url:  null,
      }).eq('id', doc_id)

      return new Response(JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }


    return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }),
      { status: 400, headers: corsHeaders })

  } catch (err: any) {
    console.error('sharepoint-files error:', err)
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
