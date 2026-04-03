import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Flags im delta_link Feld
const FLAG_FETCH_DELTA = 'FETCH_DELTA'

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

  const savedDeltaLink = profile.microsoft_delta_link || ''
  const syncDays = profile.sync_days || 80
  const authHeaders = { Authorization: `Bearer ${accessToken}` }

  // Bestehende Mails laden (für Duplikat-Prüfung)
  const { data: existingMails } = await supabase.from('mail_items')
    .select('id, outlook_id, internet_message_id, is_read').eq('created_by', authUser.id)
  const existingByOutlookId = new Map<string, any>()
  const existingByMsgId = new Map<string, any>()
  for (const m of (existingMails || [])) {
    if (m.outlook_id) existingByOutlookId.set(m.outlook_id, m)
    if (m.internet_message_id) existingByMsgId.set(m.internet_message_id, m)
  }

  // Outlook-Spalte sicherstellen
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

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: Erster Sync (delta_link leer)
  // → messages-Endpoint (NICHT delta) – respektiert $top=999 korrekt
  // → delta/messages ignoriert $top und gibt nur ~10 Items/Seite zurück!
  // ─────────────────────────────────────────────────────────────────────────────
  if (!savedDeltaLink) {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - syncDays)
    let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,internetMessageId,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=999&$orderby=receivedDateTime+asc`

    const allMessages: any[] = []
    let pageCount = 0
    console.log(`[SYNC] PHASE 1 – Erster Sync, letzten ${syncDays} Tage für ${profile.email}`)

    while (url && pageCount < 100) {
      pageCount++
      const resp = await fetch(url, { headers: authHeaders })
      if (!resp.ok) {
        console.error(`[SYNC] P1 Graph Error ${resp.status}`)
        break
      }
      const data = await resp.json()
      const msgs: any[] = data.value || []
      allMessages.push(...msgs)
      console.log(`[SYNC] P1 Seite ${pageCount}: ${msgs.length} Mails (total: ${allMessages.length})`)
      url = data['@odata.nextLink'] || null
      if (url) await new Promise(r => setTimeout(r, 50))
    }

    console.log(`[SYNC] P1 fertig: ${allMessages.length} Mails in ${pageCount} Seiten`)

    // Verarbeitung: nur Inserts (alles neu)
    const toInsert: any[] = []
    for (const msg of allMessages) {
      if (msg['@odata.removed']) continue
      const existing = existingByOutlookId.get(msg.id)
        || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
      if (existing) continue  // bereits vorhanden

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
      toInsert.push({
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

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
      if (!error) inserted += Math.min(50, toInsert.length - i)
      if (i + 50 < toInsert.length) await new Promise(r => setTimeout(r, 50))
    }

    // Phase abschliessen → nächste Phase: Delta-Token holen
    await supabase.from('profiles').update({ microsoft_delta_link: FLAG_FETCH_DELTA }).eq('id', authUser.id)

    console.log(`[SYNC] P1 abgeschlossen: ${inserted} eingefügt. Nächste Phase: FETCH_DELTA`)
    return new Response(JSON.stringify({ success: true, inserted, updated: 0, hasMore: false, phase: 'initial' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: Delta-Token holen (delta_link = 'FETCH_DELTA')
  // → delta-Endpoint ohne Filter, Items verarbeiten (is_read aktualisieren)
  // → am Ende: echten deltaLink speichern
  // ─────────────────────────────────────────────────────────────────────────────
  if (savedDeltaLink === FLAG_FETCH_DELTA) {
    let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,internetMessageId,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$top=999`
    let finalDeltaLink: string | null = null
    let lastNextLink: string | null = null
    const allMessages: any[] = []
    let pageCount = 0
    console.log(`[SYNC] PHASE 2 – Delta-Token holen für ${profile.email}`)

    while (url && pageCount < 200) {
      pageCount++
      const resp = await fetch(url, { headers: authHeaders })
      if (!resp.ok) {
        if (resp.status === 410) {
          // Delta abgelaufen → nochmal von vorne
          await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', authUser.id)
          return new Response(JSON.stringify({ error: 'Delta abgelaufen', reset: true }), { status: 200, headers: corsHeaders })
        }
        console.error(`[SYNC] P2 Graph Error ${resp.status}`)
        break
      }
      const data = await resp.json()
      allMessages.push(...(data.value || []))
      if (data['@odata.deltaLink']) {
        finalDeltaLink = data['@odata.deltaLink']
        url = null
      } else if (data['@odata.nextLink']) {
        lastNextLink = data['@odata.nextLink']
        url = data['@odata.nextLink']
        await new Promise(r => setTimeout(r, 50))
      } else {
        url = null
      }
    }

    console.log(`[SYNC] P2: ${allMessages.length} Mails in ${pageCount} Seiten. DeltaLink: ${!!finalDeltaLink}`)

    // Items verarbeiten (is_read und neue Mails)
    const toInsert: any[] = []
    const toUpdate: any[] = []
    for (const msg of allMessages) {
      if (msg['@odata.removed']) {
        const existing = existingByOutlookId.get(msg.id)
        if (existing?.id) await supabase.from('mail_items').update({ is_archived: true }).eq('id', existing.id)
        continue
      }
      let senderName = 'Unbekannt', senderEmail = ''
      if (msg.from?.emailAddress) {
        senderName = msg.from.emailAddress.name || msg.from.emailAddress.address || 'Unbekannt'
        senderEmail = (msg.from.emailAddress.address || '').toLowerCase()
      }
      const existing = existingByOutlookId.get(msg.id)
        || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
      if (existing) {
        toUpdate.push({
          id: existing.id,
          is_read: msg.isRead ?? existing.is_read,
          subject: (msg.subject || '').trim() || '(Kein Betreff)',
          body_preview: msg.bodyPreview || '',
          outlook_id: msg.id,
          internet_message_id: msg.internetMessageId || existing.internet_message_id || null,
        })
      } else {
        // Neue Mail die nicht im initialen Sync war
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
        toInsert.push({
          outlook_id: msg.id, internet_message_id: msg.internetMessageId || null,
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
    }

    let inserted = 0, updated = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
      if (!error) inserted += Math.min(50, toInsert.length - i)
    }
    for (let i = 0; i < toUpdate.length; i += 50) {
      const batch = toUpdate.slice(i, i + 50)
      const { error } = await supabase.from('mail_items').upsert(batch, { onConflict: 'id' })
      if (error) for (const u of batch) { const { id, ...d } = u; await supabase.from('mail_items').update(d).eq('id', id) }
      updated += batch.length
    }

    // Status speichern
    if (finalDeltaLink) {
      await supabase.from('profiles').update({ microsoft_delta_link: finalDeltaLink }).eq('id', authUser.id)
      console.log(`[SYNC] P2 abgeschlossen. DeltaLink gespeichert.`)
    } else if (lastNextLink) {
      // Noch nicht fertig → nächste Seite beim nächsten Aufruf
      await supabase.from('profiles').update({ microsoft_delta_link: lastNextLink }).eq('id', authUser.id)
      console.log(`[SYNC] P2 unterbrochen (Seite ${pageCount}). Nächster Aufruf setzt fort.`)
    }

    return new Response(JSON.stringify({ success: true, inserted, updated, hasMore: false, phase: 'fetch_delta', deltaReady: !!finalDeltaLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: Inkrementelles Delta (savedDeltaLink = echter deltaLink URL)
  // ─────────────────────────────────────────────────────────────────────────────
  let url: string | null = savedDeltaLink
  const allMessages: any[] = []
  let finalDeltaLink: string | null = null
  let pageCount = 0
  console.log(`[SYNC] PHASE 3 – Inkrementell für ${profile.email}`)

  while (url && pageCount < 20) {
    pageCount++
    const resp = await fetch(url, { headers: authHeaders })
    if (!resp.ok) {
      const errText = await resp.text()
      if (resp.status === 410 || errText.includes('syncStateNotFound')) {
        // Delta abgelaufen → von vorne
        await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', authUser.id)
        return new Response(JSON.stringify({ error: 'Delta-Token abgelaufen', resetDelta: true }), { status: 200, headers: corsHeaders })
      }
      console.error(`[SYNC] P3 Graph Error ${resp.status}: ${errText}`)
      break
    }
    const data = await resp.json()
    allMessages.push(...(data.value || []))
    if (data['@odata.deltaLink']) { finalDeltaLink = data['@odata.deltaLink']; url = null }
    else if (data['@odata.nextLink']) { url = data['@odata.nextLink']; await new Promise(r => setTimeout(r, 50)) }
    else { url = null }
  }

  console.log(`[SYNC] P3: ${allMessages.length} Änderungen in ${pageCount} Seiten`)

  const toInsert: any[] = []
  const toUpdate: any[] = []
  for (const msg of allMessages) {
    if (msg['@odata.removed']) {
      const existing = existingByOutlookId.get(msg.id)
      if (existing?.id) await supabase.from('mail_items').update({ is_archived: true }).eq('id', existing.id)
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
    const existing = existingByOutlookId.get(msg.id)
      || (msg.internetMessageId ? existingByMsgId.get(msg.internetMessageId) : null)
    if (existing) {
      toUpdate.push({
        id: existing.id,
        is_read: msg.isRead ?? existing.is_read,
        subject,
        body_preview: msg.bodyPreview || '',
        outlook_id: msg.id,
        internet_message_id: msg.internetMessageId || existing.internet_message_id || null,
      })
    } else {
      let targetColumnId = outlookCol.id
      if (matchedCustomerId) targetColumnId = await getOrCreateCustomerColumn(matchedCustomerId)
      toInsert.push({
        outlook_id: msg.id, internet_message_id: msg.internetMessageId || null,
        subject, sender_name: senderName, sender_email: senderEmail,
        received_date: msg.receivedDateTime || new Date().toISOString(),
        is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
        body_preview: msg.bodyPreview || '', mailbox: 'personal',
        priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
        tags: autoTags, column_id: targetColumnId, created_by: authUser.id,
        customer_id: matchedCustomerId || null
      })
    }
  }

  let inserted = 0, updated = 0
  for (let i = 0; i < toInsert.length; i += 50) {
    const { error } = await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
    if (!error) inserted += Math.min(50, toInsert.length - i)
    if (i + 50 < toInsert.length) await new Promise(r => setTimeout(r, 50))
  }
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50)
    const { error } = await supabase.from('mail_items').upsert(batch, { onConflict: 'id' })
    if (error) for (const u of batch) { const { id, ...d } = u; await supabase.from('mail_items').update(d).eq('id', id) }
    updated += batch.length
    if (i + 50 < toUpdate.length) await new Promise(r => setTimeout(r, 50))
  }

  if (finalDeltaLink) {
    await supabase.from('profiles').update({ microsoft_delta_link: finalDeltaLink }).eq('id', authUser.id)
  }

  console.log(`[SYNC] P3 fertig: ${inserted} neu, ${updated} aktualisiert`)
  return new Response(JSON.stringify({ success: true, inserted, updated, hasMore: false, phase: 'incremental' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
