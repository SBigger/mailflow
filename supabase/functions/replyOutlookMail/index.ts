import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Deine bestehende Token-Refresh Logik (exakt übernommen)
async function getAccessToken(supabase: any, authUser: any, profile: any): Promise<string | null> {
  let accessToken = profile.microsoft_access_token
  const tokenExpiry = profile.microsoft_token_expiry || 0
  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = profile.microsoft_refresh_token
    if (!refreshToken) return null
    const tokenRes = await fetch(
        `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Authentifizierung prüfen
  const authHeader = req.headers.get('Authorization')!
  if (!authHeader) return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user: authUser } } = await supabase.auth.getUser(token)
  if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  // 2. Request-Body auslesen
  const body = await req.json()
  const { mail_id, reply_text, tag, reminder } = body
  if (!mail_id || !reply_text) {
    return new Response(JSON.stringify({ error: 'mail_id and reply_text required' }), { status: 400, headers: corsHeaders })
  }

  // Mail laden (nur eigene Mails)
  const { data: mailItem } = await supabase.from('mail_items')
    .select('outlook_id, sender_email, subject, tags')
    .eq('id', mail_id).eq('created_by', authUser.id).single()
  if (!mailItem) {
    return new Response(JSON.stringify({ error: 'Mail not found' }), { status: 404, headers: corsHeaders })
  }

  // 3. Microsoft Profil laden & Token holen
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile) return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders })

  const accessToken = await getAccessToken(supabase, authUser, profile)
  if (!accessToken) return new Response(JSON.stringify({ error: 'Nicht mit Outlook verbunden' }), { status: 400, headers: corsHeaders })

  // 4. Antwort über Microsoft Graph senden
  let res: Response
  if (mailItem.outlook_id) {
    // Echte Antwort auf die Original-Mail (Thread bleibt erhalten, landet im Gesendet-Ordner)
    res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${mailItem.outlook_id}/reply`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: reply_text })
    })
  } else {
    // Fallback ohne outlook_id: neue Mail an den Absender
    if (!mailItem.sender_email) {
      return new Response(JSON.stringify({ error: 'Mail hat keine Absender-Adresse' }), { status: 400, headers: corsHeaders })
    }
    res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: mailItem.subject?.startsWith('Re:') ? mailItem.subject : `Re: ${mailItem.subject || ''}`,
          body: { contentType: 'HTML', content: reply_text },
          toRecipients: [{ emailAddress: { address: mailItem.sender_email } }]
        },
        saveToSentItems: 'true'
      })
    })
  }

  // Microsoft Graph gibt bei Erfolg einen 202 (Accepted) Statuscode ohne Body zurück
  if (!res.ok) {
    const err = await res.text()
    console.error(`[SEND_MAIL] Graph error ${res.status}: ${err}`)
    return new Response(JSON.stringify({ error: `Outlook-Versand fehlgeschlagen: ${res.status}` }), { status: 500, headers: corsHeaders })
  }

  // 5. Tag/Reminder auf der Mail speichern, falls mitgegeben
  const updates: Record<string, unknown> = {}
  if (tag) updates.tags = [...new Set([...(mailItem.tags || []), tag])]
  if (reminder) updates.reminder_date = reminder
  if (Object.keys(updates).length > 0) {
    await supabase.from('mail_items').update(updates).eq('id', mail_id).eq('created_by', authUser.id)
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})