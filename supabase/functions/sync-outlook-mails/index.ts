import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const isCronCall = req.headers.get('X-Cron-Secret') === Deno.env.get('CRON_SECRET')
  if(!isCronCall) {
    try{
      const authHeader = req.headers.get('Authorization')!
      const token = authHeader.replace('Bearer ', '')
      const { data: { user: authUser } } = await supabase.auth.getUser(token)
      if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
      console.log("isUser: TRUE")
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
  } else {
    console.log("isCron:" + isCronCall)
  }

  const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, microsoft_refresh_token, microsoft_access_token, microsoft_token_expiry, microsoft_delta_link, sync_days')
      .not('microsoft_refresh_token', 'is', null);
  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ error: 'Es ist noch kein Benutzer mit Outlook verbunden!' }), { status: 404, headers: corsHeaders })
  }
  const results = [];
  for(const profile of profiles) {
    try {
      // Token refresh
      let accessToken = profile.microsoft_access_token
      const tokenExpiry = profile.microsoft_token_expiry || 0
      // Cache: customer_id → kanban column_id (wird bei Bedarf erstellt)
      const customerColumnCache = new Map<string, string>()

      if (!accessToken || Date.now() > tokenExpiry - 60000) {
        const refreshToken = profile.microsoft_refresh_token
        if (!refreshToken) {
          results.push({email: profile.email, error: '[ERROR] refreshToken missing'})
          continue;
        }

        const tokenRes = await fetch(
            `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
            {
              method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
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
          const err = await tokenRes.json();
          results.push({email: profile.email, error: `[ERROR] Token Error: ${err.error_description}`})
          continue;
        }
        const tokens = await tokenRes.json()
        accessToken = tokens.access_token
        await supabase.from('profiles').update({
          microsoft_access_token: tokens.access_token,
          microsoft_refresh_token: tokens.refresh_token || refreshToken,
          microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
        }).eq('id', profile.id)
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
        currentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview,body&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=999`
        console.log(`[SYNC] INITIAL ${syncDays} Tage für ${profile.email}`)
      }

      // Bestehende Mails laden
      const {data: existingMails} = await supabase.from('mail_items')
          .select('id, outlook_id, is_read').eq('created_by', profile.id)
      const existingMap = new Map()
      for (const m of (existingMails || [])) {
        if (m.outlook_id) existingMap.set(m.outlook_id, {id: m.id, is_read: m.is_read})
      }

      // Outlook-Spalte
      let {data: outlookCol} = await supabase.from('kanban_columns')
          .select('*').eq('created_by', profile.id).eq('name', 'Outlook').single()
      if (!outlookCol) {
        const {data: newCol} = await supabase.from('kanban_columns')
            .insert({name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal', created_by: profile.id})
            .select().single()
        outlookCol = newCol
      }

      // Domain-Regeln + Kunden laden
      const {data: domainRules} = await supabase.from('domain_tag_rules').select('*').eq('created_by', profile.id)
      const {data: customers} = await supabase.from('customers').select('id, company_name')
      const customerMap = new Map<string, string>()
      for (const c of (customers || [])) customerMap.set(c.id, c.company_name)

      // Batch von Microsoft holen
      const response = await fetch(currentUrl, {headers: {Authorization: `Bearer ${accessToken}`}})
      if (!response.ok) {
        const errText = await response.text()
        if (response.status === 410 || errText.includes('syncStateNotFound')) {
          await supabase.from('profiles').update({microsoft_delta_link: ''}).eq('id', profile.id)
          results.push({email: profile.email, error: `[ERROR] Delta-Token abgelaufen`})
          continue;
        }
        results.push({email: profile.email, error: `[ERROR] MS Graph Error ${response.status}`})
        continue;
      }

      const data = await response.json()
      const messages = data.value || []
      const nextLink = data['@odata.nextLink'] || null
      const newDeltaLink = data['@odata.deltaLink'] || null

      console.log(`[SYNC] ${messages.length} msgs, nextLink=${!!nextLink}, deltaLink=${!!newDeltaLink}`)

      const toInsert: any[] = []
      const toUpdate: any[] = []

      for (const msg of messages) {
        if (msg['@removed']) {
          // Mail aus Outlook gelöscht → in Supabase behalten, nur als archiviert markieren
          const existing = existingMap.get(msg.id)
          if (existing?.id) {
            await supabase.from('mail_items').update({is_archived: true}).eq('id', existing.id)
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

        const existing = existingMap.get(msg.id)
        if (existing) {
          if (isDelta) {
            const newIsRead = existing.is_read ? true : (msg.isRead || false)
            toUpdate.push({id: existing.id, is_read: newIsRead, body_preview: msg.bodyPreview || ''})
          }
        } else {
          // Kunden-Spalte zuweisen wenn Domain-Regel mit customer_id gefunden
          let targetColumnId = outlookCol.id
          if (matchedCustomerId) {
            targetColumnId = await getOrCreateCustomerColumn(matchedCustomerId, customerColumnCache, customerMap, outlookCol, profile.id)
          }
          console.log(JSON.stringify(msg));
          toInsert.push({
            outlook_id: msg.id, subject, sender_name: senderName, sender_email: senderEmail,
            received_date: msg.receivedDateTime || new Date().toISOString(),
            is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
            body_preview: msg.bodyPreview || '', mailbox: 'personal',
            priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
            tags: autoTags, column_id: targetColumnId, created_by: profile.id,
            customer_id: matchedCustomerId || null
          })
        }
      }

      //get attachements from mails
      const ids = messages.filter(msg => msg.hasAttachments).map(msg => msg.id);
      if (ids.length > 0) {
        const requests = ids.map((id, index) => ({
          id: index.toString(),
          method: "GET",
          url: `messages/${id}?$hasAttachments&$expand=attachments`
        }));

        const attachResp = await fetch("https://graph.microsoft.com/v1.0/$batch", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({requests})
        });

        const attachments = await attachResp.json();
      }

      let inserted = 0, updated = 0
      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
        inserted += Math.min(50, toInsert.length - i)
        if (i + 50 < toInsert.length) await new Promise(r => setTimeout(r, 100))
      }
      for (const u of toUpdate) {
        const {id, ...data} = u
        await supabase.from('mail_items').update(data).eq('id', id)
        updated++
      }

      const hasMore = !!nextLink
      if (newDeltaLink) await supabase.from('profiles').update({microsoft_delta_link: newDeltaLink}).eq('id', profile.id)
      else if (nextLink) await supabase.from('profiles').update({microsoft_delta_link: nextLink}).eq('id', profile.id)

      // Direkt-Abgleich letzte 24h: fängt Mails ab, die Graph Delta auslässt
      let catchupInserted = 0
      if (isDelta && !hasMore) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const catchupRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,receivedDateTime,subject,from,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${since}&$top=50`,
            {headers: {Authorization: `Bearer ${accessToken}`}}
        )
        if (catchupRes.ok) {
          const catchupData = await catchupRes.json()
          const catchupMsgs = catchupData.value || []
          const catchupInserts: any[] = []
          for (const msg of catchupMsgs) {
            if (existingMap.has(msg.id)) continue
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
            if (matchedCustomerId) targetColumnId = await getOrCreateCustomerColumn(matchedCustomerId, customerColumnCache, customerMap, outlookCol, profile.id);
            catchupInserts.push({
              outlook_id: msg.id, subject: (msg.subject || '').trim() || '(Kein Betreff)',
              sender_name: senderName, sender_email: senderEmail,
              received_date: msg.receivedDateTime || new Date().toISOString(),
              is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
              body_preview: msg.bodyPreview || '', mailbox: 'personal',
              priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
              tags: autoTags, column_id: targetColumnId, created_by: profile.id,
              customer_id: matchedCustomerId || null
            })
          }

          //get attachements from mails
          const ids = catchupMsgs.filter(msg => msg.hasAttachments).map(msg => msg.id);
          if (ids.length > 0) {
            const requests = ids.map((id, index) => ({
              id: index.toString(),
              method: "GET",
              url: `me/messages/${id}?$select=body,hasAttachments&$expand=attachments`
            }));

            const attachResp = await fetch("https://graph.microsoft.com/v1.0/$batch", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({requests})
            });

            const attachments = await attachResp.json();
            console.log(attachments);
          }

          if (catchupInserts.length > 0) {
            await supabase.from('mail_items').insert(catchupInserts)
            catchupInserted = catchupInserts.length
            console.log(`[SYNC] Catchup: ${catchupInserted} fehlende Mails nachgeholt`)
          }
        }
      }
    }catch (e) {
      results.push({ email: profile.email, error: e.message })
    }
  }

  async function getOrCreateCustomerColumn(customerId: string, customerColumnCache:Map<string, string>, customerMap: Map<string, string>, outlookCol: any, profileId: string): Promise<string> {
    if (customerColumnCache.has(customerId)) return customerColumnCache.get(customerId)!
    const customerName = customerMap.get(customerId)
    if (!customerName) return outlookCol.id

    // Existierende Spalte mit gleichem Namen suchen
    const {data: existingCol} = await supabase.from('kanban_columns')
        .select('id').eq('created_by', profileId).eq('name', customerName).maybeSingle()
    if (existingCol) {
      customerColumnCache.set(customerId, existingCol.id)
      return existingCol.id
    }

    // Neue Kunden-Spalte erstellen
    const {data: lastCol} = await supabase.from('kanban_columns')
        .select('order').eq('created_by', profileId).order('order', {ascending: false}).limit(1)
    const nextOrder = ((lastCol?.[0] as any)?.order ?? 0) + 1
    const {data: newCol} = await supabase.from('kanban_columns')
        .insert({name: customerName, order: nextOrder, color: '#6366f1', mailbox: 'personal', created_by: profileId})
        .select().single()
    if (newCol) {
      customerColumnCache.set(customerId, newCol.id)
      return newCol.id
    }
    return outlookCol.id
  }

  console.log('[SYNC-OUTLOOK-MAILS]', JSON.stringify(results))
  return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
