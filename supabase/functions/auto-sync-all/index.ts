import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FLAG_FETCH_DELTA = 'FETCH_DELTA'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') || ''
  const isServiceCall = authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '__NO_KEY__')
  const isCronCall = req.headers.get('X-Cron-Secret') === Deno.env.get('CRON_SECRET')
  if (!isServiceCall && !isCronCall) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, microsoft_refresh_token, microsoft_access_token, microsoft_token_expiry, microsoft_delta_link, sync_days')
    .not('microsoft_refresh_token', 'is', null)

  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ success: true, synced: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const results = []

  for (const profile of profiles) {
    try {
      // Token refresh
      let accessToken = profile.microsoft_access_token
      const tokenExpiry = profile.microsoft_token_expiry || 0
      if (!accessToken || Date.now() > tokenExpiry - 60000) {
        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
              client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
              refresh_token: profile.microsoft_refresh_token,
              grant_type: 'refresh_token',
              scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read'
            })
          }
        )
        if (!tokenRes.ok) { results.push({ email: profile.email, error: 'Token refresh failed' }); continue }
        const tokens = await tokenRes.json()
        accessToken = tokens.access_token
        await supabase.from('profiles').update({
          microsoft_access_token: tokens.access_token,
          microsoft_refresh_token: tokens.refresh_token || profile.microsoft_refresh_token,
          microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
        }).eq('id', profile.id)
      }

      const authHeaders = { Authorization: `Bearer ${accessToken}` }
      const savedDeltaLink = profile.microsoft_delta_link || ''
      const syncDays = profile.sync_days || 80

      // Bestehende Mails laden
      const { data: existingMails } = await supabase.from('mail_items')
        .select('id, outlook_id, internet_message_id, is_read').eq('created_by', profile.id)
      const existingMap = new Map()
      const existingByMsgId = new Map()
      for (const m of (existingMails || [])) {
        if (m.outlook_id) existingMap.set(m.outlook_id, m)
        if (m.internet_message_id) existingByMsgId.set(m.internet_message_id, m)
      }

      // Outlook-Spalte
      let { data: outlookCol } = await supabase.from('kanban_columns')
        .select('*').eq('created_by', profile.id).eq('name', 'Outlook').single()
      if (!outlookCol) {
        const { data: newCol } = await supabase.from('kanban_columns')
          .insert({ name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal', created_by: profile.id })
          .select().single()
        outlookCol = newCol
      }

      // Domain-Regeln
      const { data: domainRules } = await supabase.from('domain_tag_rules').select('*').eq('created_by', profile.id)

      // ──────────────────────────────────────────────────────────────────
      // PHASE 1: Erster Sync (delta_link leer)
      // messages-Endpoint (NICHT delta) – respektiert $top=999 korrekt
      // ──────────────────────────────────────────────────────────────────
      if (!savedDeltaLink) {
        const fromDate = new Date()
        fromDate.setDate(fromDate.getDate() - syncDays)
        let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,internetMessageId,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=999&$orderby=receivedDateTime+asc`

        const allMessages: any[] = []
        let pageCount = 0
        while (url && pageCount < 100) {
          pageCount++
          const resp = await fetch(url, { headers: authHeaders })
          if (!resp.ok) { console.error(`[AUTOSYNC P1] ${profile.email} Graph ${resp.status}`); break }
          const data = await resp.json()
          allMessages.push(...(data.value || []))
          url = data['@odata.nextLink'] || null
          if (url) await new Promise(r => setTimeout(r, 50))
        }

        const toInsert: any[] = []
        for (const msg of allMessages) {
          if (msg['@odata.removed']) continue
          const existing = existingMap.get(msg.id) || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
          if (existing) continue
          let senderEmail = '', senderName = 'Unbekannt'
          if (msg.from?.emailAddress) { senderEmail = (msg.from.emailAddress.address || '').toLowerCase(); senderName = msg.from.emailAddress.name || senderEmail || 'Unbekannt' }
          const autoTags: string[] = []
          let matchedCustomerId: string | null = null
          for (const rule of (domainRules || [])) {
            const domain = rule.domain.toLowerCase().replace(/^@/, '')
            if (senderEmail.endsWith('@' + domain)) { autoTags.push(rule.tag); if (rule.customer_id && !matchedCustomerId) matchedCustomerId = rule.customer_id }
          }
          toInsert.push({
            outlook_id: msg.id, internet_message_id: msg.internetMessageId || null,
            subject: (msg.subject || '').trim() || '(Kein Betreff)',
            sender_name: senderName, sender_email: senderEmail,
            received_date: msg.receivedDateTime || new Date().toISOString(),
            is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
            body_preview: msg.bodyPreview || '', mailbox: 'personal',
            priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
            tags: autoTags, column_id: outlookCol!.id, created_by: profile.id,
            customer_id: matchedCustomerId || null
          })
        }

        let inserted = 0
        for (let i = 0; i < toInsert.length; i += 50) {
          const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
          if (!error) inserted += Math.min(50, toInsert.length - i)
        }

        await supabase.from('profiles').update({ microsoft_delta_link: FLAG_FETCH_DELTA }).eq('id', profile.id)
        results.push({ email: profile.email, phase: 'initial', inserted, messages: allMessages.length, pages: pageCount })
        continue
      }

      // ──────────────────────────────────────────────────────────────────
      // PHASE 2: Delta-Token holen (FETCH_DELTA)
      // ──────────────────────────────────────────────────────────────────
      if (savedDeltaLink === FLAG_FETCH_DELTA) {
        let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$top=999`
        let finalDeltaLink: string | null = null
        let lastNextLink: string | null = null
        const allMessages: any[] = []
        let pageCount = 0

        while (url && pageCount < 200) {
          pageCount++
          const resp = await fetch(url, { headers: authHeaders })
          if (!resp.ok) {
            if (resp.status === 410) { await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', profile.id) }
            break
          }
          const data = await resp.json()
          allMessages.push(...(data.value || []))
          if (data['@odata.deltaLink']) { finalDeltaLink = data['@odata.deltaLink']; url = null }
          else if (data['@odata.nextLink']) { lastNextLink = data['@odata.nextLink']; url = data['@odata.nextLink']; await new Promise(r => setTimeout(r, 50)) }
          else { url = null }
        }

        const toInsert: any[] = [], toUpdate: any[] = []
        for (const msg of allMessages) {
          if (msg['@odata.removed']) { const e = existingMap.get(msg.id); if (e?.id) await supabase.from('mail_items').update({ is_archived: true }).eq('id', e.id); continue }
          let senderEmail = '', senderName = 'Unbekannt'
          if (msg.from?.emailAddress) { senderEmail = (msg.from.emailAddress.address || '').toLowerCase(); senderName = msg.from.emailAddress.name || senderEmail || 'Unbekannt' }
          const existing = existingMap.get(msg.id) || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
          if (existing) {
            toUpdate.push({ id: existing.id, is_read: msg.isRead ?? existing.is_read, subject: (msg.subject || '').trim() || '(Kein Betreff)', body_preview: msg.bodyPreview || '', outlook_id: msg.id, internet_message_id: msg.internetMessageId || existing.internet_message_id || null })
          } else {
            const autoTags: string[] = []
            let matchedCustomerId: string | null = null
            for (const rule of (domainRules || [])) {
              const domain = rule.domain.toLowerCase().replace(/^@/, '')
              if (senderEmail.endsWith('@' + domain)) { autoTags.push(rule.tag); if (rule.customer_id && !matchedCustomerId) matchedCustomerId = rule.customer_id }
            }
            toInsert.push({ outlook_id: msg.id, internet_message_id: msg.internetMessageId || null, subject: (msg.subject || '').trim() || '(Kein Betreff)', sender_name: senderName, sender_email: senderEmail, received_date: msg.receivedDateTime || new Date().toISOString(), is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false, body_preview: msg.bodyPreview || '', mailbox: 'personal', priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal', tags: autoTags, column_id: outlookCol!.id, created_by: profile.id, customer_id: matchedCustomerId || null })
          }
        }

        let inserted = 0, updated = 0
        for (let i = 0; i < toInsert.length; i += 50) { const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50)); if (!error) inserted += Math.min(50, toInsert.length - i) }
        for (let i = 0; i < toUpdate.length; i += 50) {
          const batch = toUpdate.slice(i, i + 50)
          const { error } = await supabase.from('mail_items').upsert(batch, { onConflict: 'id' })
          if (error) for (const u of batch) { const { id, ...d } = u; await supabase.from('mail_items').update(d).eq('id', id) }
          updated += batch.length
        }

        if (finalDeltaLink) await supabase.from('profiles').update({ microsoft_delta_link: finalDeltaLink }).eq('id', profile.id)
        else if (lastNextLink) await supabase.from('profiles').update({ microsoft_delta_link: lastNextLink }).eq('id', profile.id)

        results.push({ email: profile.email, phase: 'fetch_delta', inserted, updated, messages: allMessages.length, pages: pageCount, deltaReady: !!finalDeltaLink })
        continue
      }

      // ──────────────────────────────────────────────────────────────────
      // PHASE 3: Inkrementelles Delta
      // ──────────────────────────────────────────────────────────────────
      let url: string | null = savedDeltaLink
      const allMessages: any[] = []
      let finalDeltaLink: string | null = null
      let pageCount = 0

      while (url && pageCount < 20) {
        pageCount++
        const resp = await fetch(url, { headers: authHeaders })
        if (!resp.ok) {
          if (resp.status === 410) { await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', profile.id); results.push({ email: profile.email, error: 'Delta expired, reset' }); url = null; break }
          results.push({ email: profile.email, error: `Graph ${resp.status}` }); url = null; break
        }
        const data = await resp.json()
        allMessages.push(...(data.value || []))
        if (data['@odata.deltaLink']) { finalDeltaLink = data['@odata.deltaLink']; url = null }
        else if (data['@odata.nextLink']) { url = data['@odata.nextLink']; await new Promise(r => setTimeout(r, 50)) }
        else { url = null }
      }

      const toInsert: any[] = [], toUpdate: any[] = []
      for (const msg of allMessages) {
        if (msg['@odata.removed']) { const e = existingMap.get(msg.id); if (e?.id) await supabase.from('mail_items').update({ is_archived: true }).eq('id', e.id); continue }
        let senderEmail = '', senderName = 'Unbekannt'
        if (msg.from?.emailAddress) { senderEmail = (msg.from.emailAddress.address || '').toLowerCase(); senderName = msg.from.emailAddress.name || senderEmail || 'Unbekannt' }
        const existing = existingMap.get(msg.id) || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
        if (existing) {
          toUpdate.push({ id: existing.id, is_read: msg.isRead ?? existing.is_read, subject: (msg.subject || '').trim() || '(Kein Betreff)', body_preview: msg.bodyPreview || '', outlook_id: msg.id, internet_message_id: msg.internetMessageId || existing.internet_message_id || null })
        } else {
          const autoTags: string[] = []
          let matchedCustomerId: string | null = null
          for (const rule of (domainRules || [])) {
            const domain = rule.domain.toLowerCase().replace(/^@/, '')
            if (senderEmail.endsWith('@' + domain)) { autoTags.push(rule.tag); if (rule.customer_id && !matchedCustomerId) matchedCustomerId = rule.customer_id }
          }
          toInsert.push({ outlook_id: msg.id, internet_message_id: msg.internetMessageId || null, subject: (msg.subject || '').trim() || '(Kein Betreff)', sender_name: senderName, sender_email: senderEmail, received_date: msg.receivedDateTime || new Date().toISOString(), is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false, body_preview: msg.bodyPreview || '', mailbox: 'personal', priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal', tags: autoTags, column_id: outlookCol!.id, created_by: profile.id, customer_id: matchedCustomerId || null })
        }
      }

      let inserted = 0, updated = 0
      for (let i = 0; i < toInsert.length; i += 50) { const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50)); if (!error) inserted += Math.min(50, toInsert.length - i) }
      for (let i = 0; i < toUpdate.length; i += 50) {
        const batch = toUpdate.slice(i, i + 50)
        const { error } = await supabase.from('mail_items').upsert(batch, { onConflict: 'id' })
        if (error) for (const u of batch) { const { id, ...d } = u; await supabase.from('mail_items').update(d).eq('id', id) }
        updated += batch.length
      }
      if (finalDeltaLink) await supabase.from('profiles').update({ microsoft_delta_link: finalDeltaLink }).eq('id', profile.id)
      results.push({ email: profile.email, phase: 'incremental', inserted, updated, messages: allMessages.length, pages: pageCount })

    } catch (e: any) {
      results.push({ email: profile.email, error: e.message })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Support-Mailbox (unverändert)
  // ──────────────────────────────────────────────────────────────────
  let supportResult: any = null
  try {
    const SUPPORT_MAILBOX = 'support@artis-gmbh.ch'
    const DELTA_KEY = 'support_mailbox_delta_link'
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!, client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!, scope: 'https://graph.microsoft.com/.default' }) }
    )
    const tokenData = await tokenResponse.json()
    if (!tokenData.access_token) throw new Error('Support Token-Fehler: ' + tokenData.error_description)
    const { data: settingRow } = await supabase.from('system_settings').select('value').eq('key', DELTA_KEY).maybeSingle()
    const supportDeltaLink = settingRow?.value || null
    const isSupportDelta = !!(supportDeltaLink && supportDeltaLink.trim() !== '')
    let supportSyncUrl: string
    if (isSupportDelta) {
      supportSyncUrl = supportDeltaLink!
    } else {
      const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 90)
      supportSyncUrl = `https://graph.microsoft.com/v1.0/users/${SUPPORT_MAILBOX}/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=50`
    }
    const supportRes = await fetch(supportSyncUrl, { headers: { Authorization: `Bearer ${tokenData.access_token}` } })
    if (!supportRes.ok) {
      const errText = await supportRes.text()
      if (supportRes.status === 410 || errText.includes('syncStateNotFound')) {
        await supabase.from('system_settings').upsert({ key: DELTA_KEY, value: '', updated_at: new Date().toISOString() }, { onConflict: 'key' })
        supportResult = { reset: true }
      } else {
        throw new Error(`Graph ${supportRes.status}: ${errText.substring(0, 200)}`)
      }
    } else {
      const supportData = await supportRes.json()
      const supportMsgs: any[] = supportData.value || []
      const supportNewDeltaLink: string | null = supportData['@odata.deltaLink'] || null
      const supportNextLink: string | null = supportData['@odata.nextLink'] || null
      const { data: existingTickets } = await supabase.from('support_tickets').select('outlook_message_id').not('outlook_message_id', 'is', null)
      const existingIds = new Set((existingTickets || []).map((t: any) => t.outlook_message_id))
      const { data: firstColumn } = await supabase.from('ticket_columns').select('id').order('order', { ascending: true }).limit(1).maybeSingle()
      if (!firstColumn) throw new Error('Keine Ticket-Spalten')
      let supportCreated = 0
      for (const msg of supportMsgs) {
        if (msg['@odata.removed'] || existingIds.has(msg.id)) continue
        const senderEmail = (msg.from?.emailAddress?.address || '').toLowerCase()
        const senderName = msg.from?.emailAddress?.name || senderEmail || 'Unbekannt'
        const subject = (msg.subject || '').trim() || '(Kein Betreff)'
        const rawHtml = msg.body?.content || ''
        const body = rawHtml ? rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim() : (msg.bodyPreview || '')
        const { data: ticket, error: ticketError } = await supabase.from('support_tickets').insert({ column_id: firstColumn.id, title: subject, from_email: senderEmail, from_name: senderName, body, ticket_type: 'regular', is_read: false, outlook_message_id: msg.id }).select('id').single()
        if (!ticketError && ticket) { supportCreated++; existingIds.add(msg.id) }
      }
      const linkToSave = supportNewDeltaLink || supportNextLink
      if (linkToSave) await supabase.from('system_settings').upsert({ key: DELTA_KEY, value: linkToSave, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      supportResult = { created: supportCreated, hasMore: !!supportNextLink }
    }
  } catch (e: any) {
    supportResult = { error: e.message }
  }

  console.log('[AUTO-SYNC]', JSON.stringify(results), 'support:', JSON.stringify(supportResult))
  return new Response(JSON.stringify({ success: true, results, support: supportResult }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
