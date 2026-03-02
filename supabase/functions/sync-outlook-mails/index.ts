import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Auth: JWT aus Header lesen
  const authHeader = req.headers.get('Authorization')!
  const token = authHeader.replace('Bearer ', '')
  const { data: { user: authUser } } = await supabase.auth.getUser(token)
  if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile) return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders })

  // Token refresh
  let accessToken = profile.microsoft_access_token
  const tokenExpiry = profile.microsoft_token_expiry || 0

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = profile.microsoft_refresh_token
    if (!refreshToken) return new Response(JSON.stringify({ error: 'Nicht mit Outlook verbunden' }), { status: 400, headers: corsHeaders })

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
          client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read'
        })
      }
    )
    if (!tokenRes.ok) {
      const err = await tokenRes.json()
      return new Response(JSON.stringify({ error: `Token Error: ${err.error_description}` }), { status: 400, headers: corsHeaders })
    }
    const tokens = await tokenRes.json()
    accessToken = tokens.access_token
    await supabase.from('profiles').update({
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
    }).eq('id', authUser.id)
  }

  // Delta vs Initial
  const deltaLink = profile.microsoft_delta_link
  const isDelta = !!(deltaLink && deltaLink.trim() !== '')
  let currentUrl: string

  if (isDelta) {
    currentUrl = deltaLink
    console.log(`[SYNC] DELTA für ${profile.email}`)
  } else {
    const syncDays = profile.sync_days || 80
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - syncDays)
    currentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=100`
    console.log(`[SYNC] INITIAL ${syncDays} Tage für ${profile.email}`)
  }

  // Bestehende Mails laden
  const { data: existingMails } = await supabase.from('mail_items')
    .select('id, outlook_id, is_read').eq('created_by', authUser.id)
  const existingMap = new Map()
  for (const m of (existingMails || [])) {
    if (m.outlook_id) existingMap.set(m.outlook_id, { id: m.id, is_read: m.is_read })
  }

  // Outlook-Spalte
  let { data: outlookCol } = await supabase.from('kanban_columns')
    .select('*').eq('created_by', authUser.id).eq('name', 'Outlook').single()
  if (!outlookCol) {
    const { data: newCol } = await supabase.from('kanban_columns')
      .insert({ name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal', created_by: authUser.id })
      .select().single()
    outlookCol = newCol
  }

  // Domain-Regeln
  const { data: domainRules } = await supabase.from('domain_tag_rules').select('*').eq('created_by', authUser.id)

  // Batch von Microsoft holen
  const response = await fetch(currentUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    const errText = await response.text()
    if (response.status === 410 || errText.includes('syncStateNotFound')) {
      await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', authUser.id)
      return new Response(JSON.stringify({ error: 'Delta-Token abgelaufen', resetDelta: true }), { status: 200, headers: corsHeaders })
    }
    return new Response(JSON.stringify({ error: `MS Graph Error ${response.status}` }), { status: 500, headers: corsHeaders })
  }

  const data = await response.json()
  const messages = data.value || []
  const nextLink = data['@odata.nextLink'] || null
  const newDeltaLink = data['@odata.deltaLink'] || null

  console.log(`[SYNC] ${messages.length} msgs, nextLink=${!!nextLink}, deltaLink=${!!newDeltaLink}`)

  const toInsert: any[] = []
  const toUpdate: any[] = []

  for (const msg of messages) {
    if (msg['@odata.removed']) {
      const existing = existingMap.get(msg.id)
      if (existing?.id) {
        await supabase.from('mail_items').update({ skip_outlook_delete: true }).eq('id', existing.id)
        await supabase.from('mail_items').delete().eq('id', existing.id)
      }
      continue
    }

    let senderName = 'Unbekannt', senderEmail = ''
    if (msg.from?.emailAddress) {
      senderName = msg.from.emailAddress.name || msg.from.emailAddress.address || 'Unbekannt'
      senderEmail = (msg.from.emailAddress.address || '').toLowerCase()
    }

    const subject = (msg.subject || '').trim() || '(Kein Betreff)'
    const autoTags: string[] = []
    for (const rule of (domainRules || [])) {
      const domain = rule.domain.toLowerCase().replace(/^@/, '')
      if (senderEmail.endsWith('@' + domain)) autoTags.push(rule.tag)
    }

    const existing = existingMap.get(msg.id)
    if (existing) {
      if (isDelta) {
        const newIsRead = existing.is_read ? true : (msg.isRead || false)
        toUpdate.push({ id: existing.id, is_read: newIsRead, subject, body_preview: msg.bodyPreview || '' })
      }
    } else {
      toInsert.push({
        outlook_id: msg.id, subject, sender_name: senderName, sender_email: senderEmail,
        received_date: msg.receivedDateTime || new Date().toISOString(),
        is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
        body_preview: msg.bodyPreview || '', mailbox: 'personal',
        priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
        tags: autoTags, column_id: outlookCol.id, created_by: authUser.id
      })
    }
  }

  let inserted = 0, updated = 0
  for (let i = 0; i < toInsert.length; i += 50) {
    await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
    inserted += Math.min(50, toInsert.length - i)
    if (i + 50 < toInsert.length) await new Promise(r => setTimeout(r, 100))
  }
  for (const u of toUpdate) {
    const { id, ...data } = u
    await supabase.from('mail_items').update(data).eq('id', id)
    updated++
  }

  const hasMore = !!nextLink
  if (newDeltaLink) await supabase.from('profiles').update({ microsoft_delta_link: newDeltaLink }).eq('id', authUser.id)
  else if (nextLink) await supabase.from('profiles').update({ microsoft_delta_link: nextLink }).eq('id', authUser.id)

  console.log(`[SYNC] Fertig: ${inserted} neu, ${updated} aktualisiert, hasMore=${hasMore}`)
  return new Response(JSON.stringify({ success: true, inserted, updated, hasMore, isDelta, syncedCount: messages.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
