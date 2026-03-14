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
        file:        form.get('file') as File,
        customer_id: form.get('customer_id') as string,
        category:    form.get('category') as string,
        year:        form.get('year') as string,
        filename:    form.get('filename') as string,
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

    return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }),
      { status: 400, headers: corsHeaders })

  } catch (err: any) {
    console.error('sharepoint-files error:', err)
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
