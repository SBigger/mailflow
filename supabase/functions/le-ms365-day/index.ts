// Leistungserfassung · MS365-Tagesvorschläge
// =================================================================
// Liefert für einen gegebenen Tag des aktuellen Users:
//   - Kalender-Termine (Outlook Calendar)
//   - gesendete Mails  (Outlook Sent Items)
// inkl. Kunden-Matching anhand der Empfänger/Teilnehmer-Domain.
//
// READ-ONLY gegenüber Microsoft Graph. Token-Refresh nutzt das gleiche
// Pattern wie sync-outlook-mails (separate Function – nicht angefasst).
//
// Endpoint:  POST /functions/v1/le-ms365-day
//   body: { date: 'YYYY-MM-DD' }
//   response: { calendar: [...], sent: [...] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProfileRow {
  id: string
  email: string
  microsoft_refresh_token: string | null
  microsoft_access_token: string | null
  microsoft_token_expiry: number | null
}

async function getAccessToken(supabase: any, profile: ProfileRow): Promise<string | null> {
  let accessToken = profile.microsoft_access_token
  const tokenExpiry = profile.microsoft_token_expiry || 0
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken

  const refreshToken = profile.microsoft_refresh_token
  if (!refreshToken) return null

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
        client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Calendars.Read'
      })
    }
  )
  if (!tokenRes.ok) {
    console.error('Token refresh failed', await tokenRes.text())
    return null
  }
  const tokens = await tokenRes.json()
  await supabase.from('profiles').update({
    microsoft_access_token: tokens.access_token,
    microsoft_refresh_token: tokens.refresh_token || refreshToken,
    microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
  }).eq('id', profile.id)
  return tokens.access_token
}

function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at < 0) return null
  return email.slice(at + 1).toLowerCase().trim()
}

function matchCustomerByDomains(domains: string[], domainToCustomer: Map<string, { id: string; company_name: string }>) {
  for (const d of domains) {
    if (!d) continue
    const m = domainToCustomer.get(d)
    if (m) return m
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Auth: nur eingeloggte User
  let userId: string | null = null
  try {
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) throw new Error('no user')
    userId = user.id
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Body
  let date: string
  try {
    const body = await req.json()
    date = body?.date
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date')
  } catch {
    return new Response(JSON.stringify({ error: "Body { date: 'YYYY-MM-DD' } erwartet" }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Profil + Tokens
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, microsoft_refresh_token, microsoft_access_token, microsoft_token_expiry')
    .eq('id', userId!)
    .single()

  if (!profile || !profile.microsoft_refresh_token) {
    return new Response(JSON.stringify({
      calendar: [], sent: [], notConnected: true,
      hint: 'Microsoft-Konto ist nicht verbunden. Verbinde im Posteingang mit MS365.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const accessToken = await getAccessToken(supabase, profile)
  if (!accessToken) {
    // 200 zurückgeben mit Hinweis, damit Frontend die Ursache anzeigen kann
    return new Response(JSON.stringify({
      calendar: [], sent: [], notConnected: true,
      hint: 'MS365-Token-Refresh fehlgeschlagen. Bitte im Posteingang Outlook trennen und neu verbinden, damit der Calendar-Scope freigegeben wird.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Tagesgrenzen (User-Local approximated als UTC – Graph akzeptiert beides; Genauigkeit reicht für Vorschläge)
  const startIso = `${date}T00:00:00`
  const endIso = `${date}T23:59:59`

  // Customers-Map (für Domain-Matching) – le_*-Bereich nutzt customers.id
  const { data: customersRaw } = await supabase
    .from('customers')
    .select('id, company_name, email')
  const domainToCustomer = new Map<string, { id: string; company_name: string }>()
  for (const c of (customersRaw || [])) {
    const d = extractDomain(c.email)
    if (d) domainToCustomer.set(d, { id: c.id, company_name: c.company_name })
  }

  // le_project (für direkte Auto-Auswahl, falls 1 Projekt pro Kunde)
  const { data: projects } = await supabase
    .from('le_project')
    .select('id, name, customer_id, status')
    .eq('status', 'offen')
  const projectsByCustomer = new Map<string, { id: string; name: string }[]>()
  for (const p of (projects || [])) {
    if (!p.customer_id) continue
    if (!projectsByCustomer.has(p.customer_id)) projectsByCustomer.set(p.customer_id, [])
    projectsByCustomer.get(p.customer_id)!.push({ id: p.id, name: p.name })
  }

  // Calendar
  let calendar: any[] = []
  let calendarError: string | null = null
  try {
    const calRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$select=id,subject,bodyPreview,start,end,attendees,organizer,isCancelled,isAllDay,location&$orderby=start/dateTime&$top=50`,
      { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="Europe/Zurich"' } }
    )
    if (calRes.ok) {
      const data = await calRes.json()
      calendar = (data.value || [])
        .filter((e: any) => !e.isCancelled)
        .map((e: any) => {
          const domains = [
            ...(e.attendees || []).map((a: any) => extractDomain(a.emailAddress?.address)),
            extractDomain(e.organizer?.emailAddress?.address),
          ].filter(Boolean) as string[]
          // Externe Domains zuerst (eigene Domain rausfiltern)
          const ownDomain = extractDomain(profile.email)
          const externalDomains = domains.filter(d => d !== ownDomain)
          const customer = matchCustomerByDomains(externalDomains, domainToCustomer)
          const projectsForCustomer = customer ? (projectsByCustomer.get(customer.id) || []) : []
          return {
            type: 'calendar',
            id: e.id,
            subject: e.subject,
            preview: e.bodyPreview,
            start: e.start?.dateTime,
            end: e.end?.dateTime,
            isAllDay: e.isAllDay,
            location: e.location?.displayName,
            attendees: (e.attendees || []).map((a: any) => ({ name: a.emailAddress?.name, email: a.emailAddress?.address })),
            organizer: e.organizer?.emailAddress?.address,
            customer,
            suggestedProjects: projectsForCustomer.slice(0, 3),
          }
        })
    } else {
      const txt = await calRes.text()
      console.error('Calendar fetch failed', calRes.status, txt)
      try {
        const j = JSON.parse(txt)
        calendarError = j?.error?.message || `HTTP ${calRes.status}`
      } catch {
        calendarError = `HTTP ${calRes.status}`
      }
    }
  } catch (e) {
    console.error('Calendar error', e)
    calendarError = String((e as any)?.message ?? e)
  }

  // Sent Items
  let sent: any[] = []
  let sentError: string | null = null
  try {
    const sentRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$filter=sentDateTime+ge+${startIso}Z+and+sentDateTime+le+${endIso}Z&$select=id,subject,bodyPreview,sentDateTime,toRecipients,ccRecipients&$top=50&$orderby=sentDateTime+desc`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (sentRes.ok) {
      const data = await sentRes.json()
      sent = (data.value || []).map((m: any) => {
        const domains = [
          ...(m.toRecipients || []).map((r: any) => extractDomain(r.emailAddress?.address)),
          ...(m.ccRecipients || []).map((r: any) => extractDomain(r.emailAddress?.address)),
        ].filter(Boolean) as string[]
        const ownDomain = extractDomain(profile.email)
        const externalDomains = domains.filter(d => d !== ownDomain)
        const customer = matchCustomerByDomains(externalDomains, domainToCustomer)
        const projectsForCustomer = customer ? (projectsByCustomer.get(customer.id) || []) : []
        return {
          type: 'sent',
          id: m.id,
          subject: m.subject,
          preview: m.bodyPreview,
          sentDateTime: m.sentDateTime,
          to: (m.toRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
          cc: (m.ccRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
          customer,
          suggestedProjects: projectsForCustomer.slice(0, 3),
        }
      })
    } else {
      const txt = await sentRes.text()
      console.error('Sent fetch failed', sentRes.status, txt)
      try {
        const j = JSON.parse(txt)
        sentError = j?.error?.message || `HTTP ${sentRes.status}`
      } catch {
        sentError = `HTTP ${sentRes.status}`
      }
    }
  } catch (e) {
    console.error('Sent error', e)
    sentError = String((e as any)?.message ?? e)
  }

  return new Response(JSON.stringify({ calendar, sent, calendarError, sentError }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
