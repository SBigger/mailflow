import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

async function getAccessToken(supabase: any, authUser: any, profile: any): Promise<string | null> {
  let accessToken = profile.microsoft_access_token
  const tokenExpiry = profile.microsoft_token_expiry || 0

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = profile.microsoft_refresh_token
    if (!refreshToken) return null

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
            scope: 'offline_access Mail.ReadWrite Mail.Send User.Read'
          })
        }
    )
    if (!tokenRes.ok) return null

    const tokens = await tokenRes.json()
    accessToken = tokens.access_token

    await supabase.from('profiles').update({
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
    }).eq('id', authUser.id)
  }

  return accessToken
}

Deno.serve(async (req) => {

  // CORS Preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )


  // 1. Authentifizierung prüfen
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: jsonHeaders })
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user: authUser } } = await supabase.auth.getUser(token);
  if (!authUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  let body: any
  try {
    body = await req.json()
    console.log("body", JSON.stringify(body));
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
  }

  const { to_email, subject, reply_text, content_type } = body
  if (!to_email || !subject || !reply_text) {
    return new Response(
        JSON.stringify({ error: 'to_email, subject and reply_text required' }),
        { status: 400, headers: jsonHeaders }
    )
  }

  // 3. Microsoft Profil laden & Token holen
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: jsonHeaders })
  }

  console.log("profile", JSON.stringify(profile));

  const accessToken = await getAccessToken(supabase, authUser, profile)
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'Nicht mit Outlook verbunden' }), { status: 400, headers: jsonHeaders })
  }

  // 4. E-Mail über Microsoft Graph senden
  const microsoftGraphUrl = 'https://graph.microsoft.com/v1.0/me/sendMail'

  // Empfänger flexibel: einzelne Adresse oder Array
  const recipients = (Array.isArray(to_email) ? to_email : [to_email]).map((addr: string) => ({
    emailAddress: { address: addr }
  }))

  const emailPayload = {
    message: {
      subject: subject,
      body: {
        contentType: content_type === 'Text' ? 'Text' : 'HTML',
        content: reply_text
      },
      toRecipients: recipients
    },
    saveToSentItems: true
  }

  const res = await fetch(microsoftGraphUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  })

  // Microsoft Graph gibt bei Erfolg 202 (Accepted) ohne Body zurück
  if (!res.ok) {
    const err = await res.text()
    console.error(`[SEND_MAIL] Graph error ${res.status}: ${err}`)
    return new Response(
        JSON.stringify({ error: `Outlook-Versand fehlgeschlagen: ${res.status}`, details: err }),
        { status: 500, headers: jsonHeaders }
    )
  }

  return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders })
})
