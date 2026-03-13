import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
const SCOPE = 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All'

// ── Token-Refresh (identisch zu sync-outlook-mails) ──────────────────────────
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

// ── SharePoint Site + Drive IDs aus Env ──────────────────────────────────────
function getSiteId()  { return Deno.env.get('SHAREPOINT_SITE_ID')  || '' }
function getDriveId() { return Deno.env.get('SHAREPOINT_DRIVE_ID') || '' }

// ── Graph-API Helper ──────────────────────────────────────────────────────────
async function graph(method: string, path: string, token: string, body?: any, isBlob = false) {
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
    throw new Error(`Graph ${method} ${path} → ${res.status}: ${err}`)
  }
  if (res.status === 204) return null
  if (isBlob) return res.arrayBuffer()
  return res.json()
}

// ── Dateiname sicher machen ───────────────────────────────────────────────────
function safeName(name: string) {
  return name.replace(/[#%*:<>?/\\|"]/g, '_')
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Auth
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  const { data: { user: authUser } } = await supabase.auth.getUser(token)
  if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile) return new Response(JSON.stringify({ error: 'Profil nicht gefunden' }), { status: 404, headers: corsHeaders })

  try {
    const accessToken = await getAccessToken(supabase, authUser.id, profile)
    const siteId  = getSiteId()
    const driveId = getDriveId()

    // Action aus URL-Parameter oder JSON-Body
    const url = new URL(req.url)
    let action = url.searchParams.get('action')
    let body: any = {}

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      // Upload: multipart
      const form = await req.formData()
      action = action || form.get('action') as string
      body = {
        file:        form.get('file') as File,
        customer_id: form.get('customer_id') as string,
        category:    form.get('category') as string,
        year:        form.get('year') as string,
        filename:    form.get('filename') as string,
      }
    } else if (contentType.includes('application/json')) {
      body = await req.json()
      action = action || body.action
    }

    // ── setup: SITE_ID + DRIVE_ID ermitteln ────────────────────────────────
    if (action === 'setup') {
      const tenant = 'artistreuhand.sharepoint.com'
      const sitePath = '/sites/ArtisMailFlow'
      const siteData = await graph('GET', `/sites/${tenant}:${sitePath}`, accessToken)
      const drivesData = await graph('GET', `/sites/${siteData.id}/drives`, accessToken)
      const defaultDrive = drivesData.value.find((d: any) => d.driveType === 'documentLibrary') || drivesData.value[0]
      return new Response(JSON.stringify({
        site_id:  siteData.id,
        drive_id: defaultDrive.id,
        site_name: siteData.displayName,
        drive_name: defaultDrive.name,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── upload ─────────────────────────────────────────────────────────────
    if (action === 'upload') {
      const { file, customer_id, category, year, filename } = body
      if (!file) throw new Error('Keine Datei')

      const safe = safeName(filename || (file as File).name)
      const ts   = Date.now()
      const spPath = `Kunden/${customer_id}/${category}/${year}/${ts}-${safe}`

      const fileData = new Uint8Array(await (file as File).arrayBuffer())

      let item: any
      if (fileData.length < 4 * 1024 * 1024) {
        // Kleine Datei: direkter PUT
        item = await graph('PUT', `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/content`, accessToken, fileData)
      } else {
        // Grosse Datei: Upload-Session
        const session = await graph('POST',
          `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/createUploadSession`,
          accessToken,
          { item: { '@microsoft.graph.conflictBehavior': 'rename' } }
        )
        const uploadUrl = session.uploadUrl
        const chunkSize = 3 * 1024 * 1024
        let offset = 0
        while (offset < fileData.length) {
          const chunk = fileData.slice(offset, offset + chunkSize)
          const end   = Math.min(offset + chunkSize - 1, fileData.length - 1)
          const res   = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.length.toString(),
              'Content-Range': `bytes ${offset}-${end}/${fileData.length}`,
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
      const { item_id } = body
      if (!item_id) throw new Error('item_id fehlt')
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
      const { item_id } = body
      if (!item_id) throw new Error('item_id fehlt')
      await graph('DELETE', `/sites/${siteId}/drives/${driveId}/items/${item_id}`, accessToken)
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── search ─────────────────────────────────────────────────────────────
    if (action === 'search') {
      const { q, customer_id } = body
      if (!q || q.trim().length < 2) throw new Error('Suchbegriff zu kurz')

      let queryString = q.trim()
      // Auf ArtisMailFlow-Site einschränken
      queryString += ` AND path:"https://artistreuhand.sharepoint.com/sites/ArtisMailFlow"`
      if (customer_id) queryString += ` AND path:"${customer_id}"`

      const result = await graph('POST', '/search/query', accessToken, {
        requests: [{
          entityTypes: ['driveItem'],
          query: { queryString },
          fields: ['id', 'name', 'webUrl', 'parentReference', 'size', 'lastModifiedDateTime', 'createdDateTime'],
          from: 0,
          size: 25,
        }],
      })

      const hits = result?.value?.[0]?.hitsContainers?.[0]?.hits || []
      const items = hits.map((h: any) => ({
        item_id:    h.resource?.id,
        name:       h.resource?.name,
        web_url:    h.resource?.webUrl,
        size:       h.resource?.size,
        modified:   h.resource?.lastModifiedDateTime,
        path:       h.resource?.parentReference?.path,
        summary:    h.summary,
      }))

      return new Response(JSON.stringify({ items, total: hits.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── migrate: einzelnes Dokument Supabase → SharePoint ─────────────────
    if (action === 'migrate') {
      const { doc_id, storage_path, customer_id, category, year, filename } = body
      if (!doc_id || !storage_path) throw new Error('doc_id und storage_path erforderlich')

      // 1. Datei von Supabase Storage holen (Service Role → direkt)
      const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
      const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const storageRes   = await fetch(
        `${supabaseUrl}/storage/v1/object/dokumente/${storage_path}`,
        { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
      )
      if (!storageRes.ok) throw new Error(`Supabase Storage: ${storageRes.status} für ${storage_path}`)
      const fileData = new Uint8Array(await storageRes.arrayBuffer())

      // Dateiname aus storage_path extrahieren falls nicht angegeben
      const fname = filename || storage_path.split('/').pop() || 'dokument'
      const safe  = safeName(fname)
      const ts    = Date.now()
      const spPath = `Kunden/${customer_id}/${category}/${year}/${ts}-${safe}`

      // 2. In SharePoint hochladen
      let item: any
      if (fileData.length < 4 * 1024 * 1024) {
        item = await graph('PUT', `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/content`, accessToken, fileData)
      } else {
        const session = await graph('POST',
          `/sites/${siteId}/drives/${driveId}/root:/${spPath}:/createUploadSession`,
          accessToken,
          { item: { '@microsoft.graph.conflictBehavior': 'rename' } }
        )
        const uploadUrl = session.uploadUrl
        const chunkSize = 3 * 1024 * 1024
        let offset = 0
        while (offset < fileData.length) {
          const chunk = fileData.slice(offset, offset + chunkSize)
          const end   = Math.min(offset + chunkSize - 1, fileData.length - 1)
          const res   = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.length.toString(),
              'Content-Range': `bytes ${offset}-${end}/${fileData.length}`,
            },
            body: chunk,
          })
          if (res.ok && res.status !== 202) item = await res.json()
          offset += chunkSize
        }
      }

      // 3. DB aktualisieren
      await supabase.from('dokumente').update({
        sharepoint_item_id: item.id,
        sharepoint_web_url: item.webUrl,
      }).eq('id', doc_id)

      return new Response(JSON.stringify({
        ok:      true,
        item_id: item.id,
        web_url: item.webUrl,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }),
      { status: 400, headers: corsHeaders })

  } catch (err: any) {
    console.error('sharepoint-files error:', err)
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
