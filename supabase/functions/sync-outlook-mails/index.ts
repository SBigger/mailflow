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

  // Auth
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
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All'
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
  const syncDays = profile.sync_days || 80

  let startUrl: string
  if (isDelta) {
    startUrl = deltaLink
    console.log(`[SYNC] DELTA für ${profile.email}`)
  } else {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - syncDays)
    startUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=999`
    console.log(`[SYNC] INITIAL ${syncDays} Tage für ${profile.email}`)
  }

  // Alle bestehenden Mails laden (outlook_id + internet_message_id)
  const { data: existingMails } = await supabase.from('mail_items')
    .select('id, outlook_id, internet_message_id, is_read').eq('created_by', authUser.id)
  const existingByOutlookId = new Map<string, any>()
  const existingByMsgId = new Map<string, any>()
  for (const m of (existingMails || [])) {
    if (m.outlook_id) existingByOutlookId.set(m.outlook_id, m)
    if (m.internet_message_id) existingByMsgId.set(m.internet_message_id, m)
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

  // Domain-Regeln + Kunden laden
  const { data: domainRules } = await supabase.from('domain_tag_rules').select('*').eq('created_by', authUser.id)
  const { data: customers } = await supabase.from('customers').select('id, company_name')
  const customerMap = new Map<string, string>()
  for (const c of (customers || [])) customerMap.set(c.id, c.company_name)

  const customerColumnCache = new Map<string, string>()
  async function getOrCreateCustomerColumn(customerId: string): Promise<string> {
    if (customerColumnCache.has(customerId)) return customerColumnCache.get(customerId)!
    const customerName = customerMap.get(customerId)
    if (!customerName) return outlookCol.id
    const { data: existingCol } = await supabase.from('kanban_columns')
      .select('id').eq('created_by', authUser.id).eq('name', customerName).maybeSingle()
    if (existingCol) { customerColumnCache.set(customerId, existingCol.id); return existingCol.id }
    const { data: lastCol } = await supabase.from('kanban_columns')
      .select('order').eq('created_by', authUser.id).order('order', { ascending: false }).limit(1)
    const nextOrder = ((lastCol?.[0] as any)?.order ?? 0) + 1
    const { data: newCol } = await supabase.from('kanban_columns')
      .insert({ name: customerName, order: nextOrder, color: '#6366f1', mailbox: 'personal', created_by: authUser.id })
      .select().single()
    if (newCol) { customerColumnCache.set(customerId, newCol.id); return newCol.id }
    return outlookCol.id
  }

  // ── VOLLSTÄNDIGE PAGINATION innerhalb der Edge Function ──
  // Alle Seiten abholen bis deltaLink kommt (nicht auf Frontend-Retry verlassen)
  const allMessages: any[] = []
  let finalDeltaLink: string | null = null
  let currentUrl: string | null = startUrl
  let pageCount = 0
  const MAX_PAGES = 20  // Sicherheitslimit: max 20 Seiten × 999 = 19'980 Mails

  while (currentUrl && pageCount < MAX_PAGES) {
    pageCount++
    const response = await fetch(currentUrl, { headers: { Authorization: `Bearer ${accessToken}` } })

    if (!response.ok) {
      const errText = await response.text()
      if (response.status === 410 || errText.includes('syncStateNotFound')) {
        await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', authUser.id)
        return new Response(JSON.stringify({ error: 'Delta-Token abgelaufen', resetDelta: true }), { status: 200, headers: corsHeaders })
      }
      // Bei 429 (Rate Limit): kurz warten und nochmals versuchen
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '10') * 1000
        console.log(`[SYNC] Rate limit, warte ${retryAfter}ms`)
        await new Promise(r => setTimeout(r, retryAfter))
        continue
      }
      console.error(`[SYNC] Graph Error ${response.status}: ${errText}`)
      break
    }

    const data = await response.json()
    const msgs = data.value || []
    allMessages.push(...msgs)
    console.log(`[SYNC] Seite ${pageCount}: ${msgs.length} msgs`)

    if (data['@odata.deltaLink']) {
      finalDeltaLink = data['@odata.deltaLink']
      currentUrl = null  // fertig
    } else if (data['@odata.nextLink']) {
      currentUrl = data['@odata.nextLink']
      await new Promise(r => setTimeout(r, 50))  // kurze Pause zwischen Seiten
    } else {
      currentUrl = null
    }
  }

  console.log(`[SYNC] Total ${allMessages.length} msgs in ${pageCount} Seiten`)

  // ── Verarbeitung ──
  const toInsert: any[] = []
  const toUpdate: any[] = []

  for (const msg of allMessages) {
    if (msg['@odata.removed']) {
      // In Outlook gelöscht → als archiviert markieren
      const existing = existingByOutlookId.get(msg.id)
      if (existing?.id) {
        await supabase.from('mail_items').update({ is_archived: true }).eq('id', existing.id)
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
    let matchedCustomerId: string | null = null
    for (const rule of (domainRules || [])) {
      const domain = rule.domain.toLowerCase().replace(/^@/, '')
      if (senderEmail.endsWith('@' + domain)) {
        autoTags.push(rule.tag)
        if (rule.customer_id && !matchedCustomerId) matchedCustomerId = rule.customer_id
      }
    }

    // Match: zuerst per outlook_id, dann per internetMessageId (stabiler bei Exchange-Migration)
    const existing = existingByOutlookId.get(msg.id)
      || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)

    if (existing) {
      // Update: is_read BIDIREKTIONAL (Outlook-Wert gewinnt beim Sync)
      toUpdate.push({
        id: existing.id,
        is_read: msg.isRead ?? existing.is_read,  // FIX: nicht mehr "einmal gelesen = immer gelesen"
        subject,
        body_preview: msg.bodyPreview || '',
        outlook_id: msg.id,  // Graph-ID aktualisieren falls sie sich geändert hat
        internet_message_id: msg.internetMessageId || existing.internet_message_id || null,
      })
    } else {
      let targetColumnId = outlookCol.id
      if (matchedCustomerId) targetColumnId = await getOrCreateCustomerColumn(matchedCustomerId)
      toInsert.push({
        outlook_id: msg.id,
        internet_message_id: msg.internetMessageId || null,
        subject,
        sender_name: senderName,
        sender_email: senderEmail,
        received_date: msg.receivedDateTime || new Date().toISOString(),
        is_read: msg.isRead || false,
        has_attachments: msg.hasAttachments || false,
        body_preview: msg.bodyPreview || '',
        mailbox: 'personal',
        priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
        tags: autoTags,
        column_id: targetColumnId,
        created_by: authUser.id,
        customer_id: matchedCustomerId || null
      })
    }
  }

  // Batch-Insert/Update
  let inserted = 0, updated = 0
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50)
    const { error } = await supabase.from('mail_items').insert(batch)
    if (error) console.error(`[SYNC] Insert Fehler:`, error.message)
    else inserted += batch.length
    if (i + 50 < toInsert.length) await new Promise(r => setTimeout(r, 100))
  }
  for (const u of toUpdate) {
    const { id, ...data } = u
    await supabase.from('mail_items').update(data).eq('id', id)
    updated++
  }

  // Delta-Token speichern
  if (finalDeltaLink) {
    await supabase.from('profiles').update({ microsoft_delta_link: finalDeltaLink }).eq('id', authUser.id)
  }

  // ── CATCHUP: letzte sync_days Tage direkt abfragen (Sicherheitsnetz) ──
  // Fängt Mails auf die der Delta-Sync evtl. verpasst hat
  let catchupInserted = 0
  if (!finalDeltaLink || isDelta) {
    const sinceDays = Math.min(syncDays, 30)  // max 30 Tage für Catchup
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
    let catchupUrl: string | null =
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,internetMessageId,receivedDateTime,subject,from,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${since}&$top=999&$orderby=receivedDateTime+desc`

    let catchupPage = 0
    while (catchupUrl && catchupPage < 5) {  // max 5 Seiten × 999 = ~5000 Mails
      catchupPage++
      const catchupRes = await fetch(catchupUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!catchupRes.ok) break

      const catchupData = await catchupRes.json()
      const catchupMsgs: any[] = catchupData.value || []
      const catchupInserts: any[] = []

      for (const msg of catchupMsgs) {
        // Bereits vorhanden? (per outlook_id oder internetMessageId)
        const alreadyExists = existingByOutlookId.has(msg.id)
          || (msg.internetMessageId && existingByMsgId.has(msg.internetMessageId))
          || toInsert.some((m: any) => m.outlook_id === msg.id)
        if (alreadyExists) continue

        let senderName = 'Unbekannt', senderEmail = ''
        if (msg.from?.emailAddress) {
          senderName = msg.from.emailAddress.name || msg.from.emailAddress.address || 'Unbekannt'
          senderEmail = (msg.from.emailAddress.address || '').toLowerCase()
        }
        const autoTags: string[] = []
        let matchedCustomerId: string | null = null
        for (const rule of (domainRules || [])) {
          const domain = rule.domain.toLowerCase().replace(/^@/, '')
          if (senderEmail.endsWith('@' + domain)) {
            autoTags.push(rule.tag)
            if (rule.customer_id && !matchedCustomerId) matchedCustomerId = rule.customer_id
          }
        }
        let targetColumnId = outlookCol.id
        if (matchedCustomerId) targetColumnId = await getOrCreateCustomerColumn(matchedCustomerId)
        catchupInserts.push({
          outlook_id: msg.id,
          internet_message_id: msg.internetMessageId || null,
          subject: (msg.subject || '').trim() || '(Kein Betreff)',
          sender_name: senderName, sender_email: senderEmail,
          received_date: msg.receivedDateTime || new Date().toISOString(),
          is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
          body_preview: msg.bodyPreview || '', mailbox: 'personal',
          priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
          tags: autoTags, column_id: targetColumnId, created_by: authUser.id,
          customer_id: matchedCustomerId || null
        })
      }

      if (catchupInserts.length > 0) {
        const { error } = await supabase.from('mail_items').insert(catchupInserts)
        if (!error) catchupInserted += catchupInserts.length
        console.log(`[SYNC] Catchup Seite ${catchupPage}: ${catchupInserts.length} fehlende Mails nachgeholt`)
      }

      catchupUrl = catchupData['@odata.nextLink'] || null
    }
  }

  console.log(`[SYNC] Fertig: ${inserted} neu, ${updated} aktualisiert, catchup=${catchupInserted}, pages=${pageCount}`)
  return new Response(JSON.stringify({
    success: true,
    inserted: inserted + catchupInserted,
    updated,
    hasMore: false,  // kein hasMore mehr – alles in einem Durchgang
    isDelta,
    syncedCount: allMessages.length,
    pages: pageCount,
    catchup: catchupInserted,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
