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
  if (!isCronCall) {
    try {
      const authHeader = req.headers.get('Authorization')!
      const token = authHeader.replace('Bearer ', '')
      const { data: { user: authUser } } = await supabase.auth.getUser(token)
      if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, microsoft_refresh_token, calendar_access_token, calendar_token_expiry, calendar_delta_link, calendar_sync_days')
    .not('microsoft_refresh_token', 'is', null)

  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ error: 'Kein Benutzer mit Outlook verbunden.' }), { status: 404, headers: corsHeaders })
  }

  const results = []

  for (const profile of profiles) {
    try {
      // ── Token-Management (separates Calendar-Token, Mail-Token bleibt unberührt) ──
      let accessToken = profile.calendar_access_token
      const tokenExpiry = profile.calendar_token_expiry || 0

      if (!accessToken || Date.now() > tokenExpiry - 60000) {
        const refreshToken = profile.microsoft_refresh_token
        if (!refreshToken) {
          results.push({ email: profile.email, error: '[ERROR] refreshToken missing' })
          continue
        }

        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
              client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
              refresh_token: refreshToken,
              grant_type: 'refresh_token',
              scope: 'offline_access Calendars.Read User.Read'
            })
          }
        )

        if (!tokenRes.ok) {
          const err = await tokenRes.json()
          results.push({ email: profile.email, error: `[ERROR] Token Error: ${err.error_description}` })
          continue
        }

        const tokens = await tokenRes.json()
        accessToken = tokens.access_token
        await supabase.from('profiles').update({
          calendar_access_token: tokens.access_token,
          calendar_token_expiry: Date.now() + (tokens.expires_in * 1000),
          // Refresh-Token aktualisieren falls Microsoft ihn rotiert hat
          microsoft_refresh_token: tokens.refresh_token || refreshToken,
        }).eq('id', profile.id)
      }

      // ── Sync-Zeitraum ──
      const syncDays = profile.calendar_sync_days || 30
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - syncDays)
      const endDate = new Date()
      endDate.setFullYear(endDate.getFullYear() + 1)

      // ── Delta vs. Initial ──
      const deltaLink = profile.calendar_delta_link
      const isDelta = !!(deltaLink && deltaLink.trim() !== '')
      let currentUrl: string

      if (isDelta) {
        currentUrl = deltaLink
        console.log(`[CAL-SYNC] DELTA für ${profile.email}`)
      } else {
        currentUrl = `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}&$select=id,subject,bodyPreview,start,end,isAllDay,location,organizer,responseStatus,isCancelled,onlineMeeting,importance,categories&$top=100`
        console.log(`[CAL-SYNC] INITIAL ${syncDays}d Vergangenheit + 1J Zukunft für ${profile.email}`)
      }

      // ── Bestehende Events laden (für Deduplikation) ──
      const { data: existingEvents } = await supabase
        .from('calendar_events')
        .select('id, outlook_id')
        .eq('created_by', profile.id)

      const existingMap = new Map<string, string>()
      for (const e of (existingEvents || [])) {
        existingMap.set(e.outlook_id, e.id)
      }

      // ── Graph API abrufen ──
      const response = await fetch(currentUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',   // alle Zeiten in UTC normalisieren
        }
      })

      if (!response.ok) {
        const errText = await response.text()
        if (response.status === 410 || errText.includes('syncStateNotFound')) {
          await supabase.from('profiles').update({ calendar_delta_link: '' }).eq('id', profile.id)
          results.push({ email: profile.email, error: '[ERROR] Delta-Token abgelaufen – bitte Kalender zurücksetzen' })
          continue
        }
        results.push({ email: profile.email, error: `[ERROR] MS Graph ${response.status}: ${errText.substring(0, 200)}` })
        continue
      }

      const data = await response.json()
      const events = data.value || []
      const newDeltaLink = data['@odata.deltaLink'] || null
      const nextLink = data['@odata.nextLink'] || null

      console.log(`[CAL-SYNC] ${events.length} events, deltaLink=${!!newDeltaLink}, nextLink=${!!nextLink}`)

      const toInsert: any[] = []
      const toUpdate: any[] = []

      for (const event of events) {
        // Gelöschte Events: hard delete (Kalender ≠ Mail)
        if (event['@removed']) {
          const existingId = existingMap.get(event.id)
          if (existingId) {
            await supabase.from('calendar_events').delete().eq('id', existingId)
          }
          continue
        }

        // Zeitangaben (Graph liefert UTC wenn Prefer-Header gesetzt)
        const startTime = event.start?.dateTime
          ? event.start.dateTime + 'Z'
          : event.start?.date ? event.start.date + 'T00:00:00Z' : null

        const endTime = event.end?.dateTime
          ? event.end.dateTime + 'Z'
          : event.end?.date ? event.end.date + 'T00:00:00Z' : null

        const eventData = {
          outlook_id:        event.id,
          subject:           (event.subject || '').trim() || '(Kein Titel)',
          body_preview:      event.bodyPreview || '',
          start_time:        startTime,
          end_time:          endTime,
          is_all_day:        event.isAllDay || false,
          location:          event.location?.displayName || null,
          online_meeting_url: event.onlineMeeting?.joinUrl || null,
          organizer_name:    event.organizer?.emailAddress?.name || null,
          organizer_email:   (event.organizer?.emailAddress?.address || '').toLowerCase() || null,
          response_status:   event.responseStatus?.response || 'none',
          is_cancelled:      event.isCancelled || false,
          importance:        event.importance || 'normal',
          categories:        event.categories || [],
          created_by:        profile.id,
          updated_at:        new Date().toISOString(),
        }

        const existingId = existingMap.get(event.id)
        if (existingId) {
          toUpdate.push({ id: existingId, ...eventData })
        } else {
          toInsert.push(eventData)
        }
      }

      // ── Batch-Insert / Update ──
      let inserted = 0, updated = 0
      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from('calendar_events').insert(toInsert.slice(i, i + 50))
        inserted += Math.min(50, toInsert.length - i)
      }
      for (const { id, ...fields } of toUpdate) {
        await supabase.from('calendar_events').update(fields).eq('id', id)
        updated++
      }

      // ── Delta-Link speichern ──
      if (newDeltaLink) {
        await supabase.from('profiles').update({ calendar_delta_link: newDeltaLink }).eq('id', profile.id)
      } else if (nextLink) {
        await supabase.from('profiles').update({ calendar_delta_link: nextLink }).eq('id', profile.id)
      }

      results.push({ email: profile.email, inserted, updated, total: events.length, isDelta })

    } catch (e) {
      results.push({ email: profile.email, error: e.message })
    }
  }

  console.log('[SYNC-OUTLOOK-CALENDAR]', JSON.stringify(results))
  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
