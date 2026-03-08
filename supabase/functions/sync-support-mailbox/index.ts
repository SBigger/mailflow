import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPPORT_MAILBOX = 'support@artis-gmbh.ch'
const DELTA_KEY = 'support_mailbox_delta_link'
const LAST_SYNC_KEY = 'support_mailbox_last_sync'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Auth: JWT from user (admin required) or service role key
  const authHeader = req.headers.get('Authorization') || ''
  const isServiceCall = authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '__NO_KEY__')
  const isCronCall = req.headers.get('X-Cron-Secret') === Deno.env.get('CRON_SECRET')

  if (!isServiceCall && !isCronCall) {
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabase.auth.getUser(token)
    if (!authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', authUser.id).single()
    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin-Berechtigung erforderlich' }), { status: 403, headers: corsHeaders })
    }
  }

  // Body param: reset=true zum Zurücksetzen des Delta-Links
  let reset = false
  try {
    const body = await req.json()
    reset = body?.reset === true
  } catch { /* kein Body */ }

  if (reset) {
    await supabase.from('system_settings').upsert(
      { key: DELTA_KEY, value: '', updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    console.log('[SUPPORT-SYNC] Delta-Link zurückgesetzt')
    return new Response(JSON.stringify({ success: true, reset: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Access-Token via Client Credentials (wie send-ticket-reply)
  const tenantId = Deno.env.get('MICROSOFT_TENANT_ID')!
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  )

  const tokenData = await tokenResponse.json()
  if (!tokenData.access_token) {
    return new Response(
      JSON.stringify({ error: 'Token-Fehler', details: tokenData }),
      { status: 500, headers: corsHeaders }
    )
  }
  const accessToken = tokenData.access_token

  // Delta-Link aus system_settings lesen
  const { data: settingRow } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', DELTA_KEY)
    .maybeSingle()
  const deltaLink = settingRow?.value || null

  // Sync-URL bestimmen
  let syncUrl: string
  const isDelta = !!(deltaLink && deltaLink.trim() !== '')
  if (isDelta) {
    syncUrl = deltaLink!
    console.log('[SUPPORT-SYNC] Delta-Sync für', SUPPORT_MAILBOX)
  } else {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 90)
    syncUrl = `https://graph.microsoft.com/v1.0/users/${SUPPORT_MAILBOX}/mailFolders/inbox/messages/delta` +
      `?$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead` +
      `&$filter=receivedDateTime+ge+${fromDate.toISOString()}` +
      `&$top=50`
    console.log('[SUPPORT-SYNC] Initial-Sync (90 Tage) für', SUPPORT_MAILBOX)
  }

  // Graph API aufrufen
  const response = await fetch(syncUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!response.ok) {
    const errText = await response.text()
    if (response.status === 410 || errText.includes('syncStateNotFound')) {
      await supabase.from('system_settings').upsert(
        { key: DELTA_KEY, value: '', updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      return new Response(
        JSON.stringify({ error: 'Delta-Token abgelaufen, zurückgesetzt', resetDelta: true }),
        { status: 200, headers: corsHeaders }
      )
    }
    return new Response(
      JSON.stringify({ error: `MS Graph Fehler ${response.status}`, details: errText }),
      { status: 500, headers: corsHeaders }
    )
  }

  const data = await response.json()
  const messages: any[] = data.value || []
  const nextLink: string | null = data['@odata.nextLink'] || null
  const newDeltaLink: string | null = data['@odata.deltaLink'] || null

  console.log(`[SUPPORT-SYNC] ${messages.length} Nachrichten, hasMore=${!!nextLink}`)

  // Bereits vorhandene outlook_message_ids laden
  const { data: existingTickets } = await supabase
    .from('support_tickets')
    .select('outlook_message_id')
    .not('outlook_message_id', 'is', null)
  const existingIds = new Set((existingTickets || []).map((t: any) => t.outlook_message_id))

  // Erste Ticket-Spalte (Neu) holen
  const { data: firstColumn } = await supabase
    .from('ticket_columns')
    .select('id')
    .order('order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!firstColumn) {
    return new Response(
      JSON.stringify({ error: 'Keine Ticket-Spalten gefunden' }),
      { status: 500, headers: corsHeaders }
    )
  }

  let created = 0
  for (const msg of messages) {
    // Gelöschte Nachrichten überspringen
    if (msg['@odata.removed']) continue
    // Bereits verarbeitete überspringen
    if (existingIds.has(msg.id)) continue

    const senderEmail = (msg.from?.emailAddress?.address || '').toLowerCase()
    const senderName = msg.from?.emailAddress?.name || senderEmail || 'Unbekannt'
    const subject = (msg.subject || '').trim() || '(Kein Betreff)'
    // Vollständiger Body bevorzugen, sonst Preview
    const body = msg.body?.content || msg.bodyPreview || ''

    // Ticket anlegen
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .insert({
        column_id: firstColumn.id,
        title: subject,
        from_email: senderEmail,
        from_name: senderName,
        body: body,
        ticket_type: 'regular',
        is_read: false,
        outlook_message_id: msg.id,
      })
      .select('id')
      .single()

    if (ticketError || !ticket) {
      console.error('[SUPPORT-SYNC] Ticket-Fehler:', ticketError?.message)
      continue
    }

    // Erste Nachricht anlegen (Kundenanfrage)
    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      body: body,
      sender_type: 'customer',
    })

    created++
    existingIds.add(msg.id)
  }

  // Delta-Link speichern
  const linkToSave = newDeltaLink || nextLink
  if (linkToSave) {
    await supabase.from('system_settings').upsert(
      { key: DELTA_KEY, value: linkToSave, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
  }

  // Letzten Sync-Zeitpunkt speichern
  await supabase.from('system_settings').upsert(
    { key: LAST_SYNC_KEY, value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )

  console.log(`[SUPPORT-SYNC] Fertig: ${created} neue Tickets, hasMore=${!!nextLink}`)
  return new Response(
    JSON.stringify({ success: true, created, hasMore: !!nextLink, total: messages.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
