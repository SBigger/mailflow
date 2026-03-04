import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // This function is called by pg_cron - verify it's an internal call or has the service role key
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

  // Get all profiles with a microsoft refresh token
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
      // Refresh token if needed
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
        if (!tokenRes.ok) {
          results.push({ email: profile.email, error: 'Token refresh failed' })
          continue
        }
        const tokens = await tokenRes.json()
        accessToken = tokens.access_token
        await supabase.from('profiles').update({
          microsoft_access_token: tokens.access_token,
          microsoft_refresh_token: tokens.refresh_token || profile.microsoft_refresh_token,
          microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
        }).eq('id', profile.id)
      }

      // Build sync URL
      const deltaLink = profile.microsoft_delta_link
      let syncUrl: string
      if (deltaLink && deltaLink.trim() !== '') {
        syncUrl = deltaLink
      } else {
        const syncDays = profile.sync_days || 80
        const fromDate = new Date()
        fromDate.setDate(fromDate.getDate() - syncDays)
        syncUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDate.toISOString()}&$top=999`
      }

      const response = await fetch(syncUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) {
        if (response.status === 410) {
          await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', profile.id)
          results.push({ email: profile.email, error: 'Delta expired, reset' })
          continue
        }
        results.push({ email: profile.email, error: `Graph ${response.status}` })
        continue
      }

      const data = await response.json()
      const messages = data.value || []
      const newDeltaLink = data['@odata.deltaLink'] || null
      const nextLink = data['@odata.nextLink'] || null

      // Get existing mails for this user
      const { data: existingMails } = await supabase.from('mail_items')
        .select('id, outlook_id, is_read').eq('created_by', profile.id)
      const existingMap = new Map()
      for (const m of (existingMails || [])) {
        if (m.outlook_id) existingMap.set(m.outlook_id, { id: m.id, is_read: m.is_read })
      }

      // Get or create Outlook column
      let { data: outlookCol } = await supabase.from('kanban_columns')
        .select('*').eq('created_by', profile.id).eq('name', 'Outlook').single()
      if (!outlookCol) {
        const { data: newCol } = await supabase.from('kanban_columns')
          .insert({ name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal', created_by: profile.id })
          .select().single()
        outlookCol = newCol
      }

      // Get domain rules for this user
      const { data: domainRules } = await supabase.from('domain_tag_rules').select('*').eq('created_by', profile.id)

      let inserted = 0, updated = 0
      const toInsert: any[] = []
      const toUpdate: any[] = []
      const isDelta = !!(deltaLink && deltaLink.trim() !== '')

      for (const msg of messages) {
        if (msg['@odata.removed']) {
          const existing = existingMap.get(msg.id)
          if (existing?.id) {
            await supabase.from('mail_items').update({ is_archived: true }).eq('id', existing.id)
          }
          continue
        }

        let senderEmail = ''
        if (msg.from?.emailAddress) senderEmail = (msg.from.emailAddress.address || '').toLowerCase()

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
            toUpdate.push({ id: existing.id, is_read: newIsRead, body_preview: msg.bodyPreview || '' })
          }
        } else {
          const senderName = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unbekannt'
          const subject = (msg.subject || '').trim() || '(Kein Betreff)'
          toInsert.push({
            outlook_id: msg.id, subject, sender_name: senderName, sender_email: senderEmail,
            received_date: msg.receivedDateTime || new Date().toISOString(),
            is_read: msg.isRead || false, has_attachments: msg.hasAttachments || false,
            body_preview: msg.bodyPreview || '', mailbox: 'personal',
            priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
            tags: autoTags, column_id: outlookCol!.id, created_by: profile.id,
            customer_id: matchedCustomerId || null
          })
        }
      }

      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from('mail_items').insert(toInsert.slice(i, i + 50))
        inserted += Math.min(50, toInsert.length - i)
      }
      for (const u of toUpdate) {
        const { id, ...d } = u
        await supabase.from('mail_items').update(d).eq('id', id)
        updated++
      }

      if (newDeltaLink) await supabase.from('profiles').update({ microsoft_delta_link: newDeltaLink }).eq('id', profile.id)
      else if (nextLink) await supabase.from('profiles').update({ microsoft_delta_link: nextLink }).eq('id', profile.id)

      results.push({ email: profile.email, inserted, updated, messages: messages.length })
    } catch (e) {
      results.push({ email: profile.email, error: e.message })
    }
  }

  console.log('[AUTO-SYNC]', JSON.stringify(results))
  return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
