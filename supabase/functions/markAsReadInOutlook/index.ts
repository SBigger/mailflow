import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
          scope: 'offline_access Mail.ReadWrite User.Read'
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')!
  const token = authHeader.replace('Bearer ', '')
  const { data: { user: authUser } } = await supabase.auth.getUser(token)
  if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  const body = await req.json()
  const { mail_id } = body
  if (!mail_id) return new Response(JSON.stringify({ error: 'mail_id required' }), { status: 400, headers: corsHeaders })

  // Get the mail's outlook_id and update is_read in DB
  const { data: mail } = await supabase.from('mail_items').select('outlook_id, is_read').eq('id', mail_id).eq('created_by', authUser.id).single()
  if (!mail?.outlook_id) {
    // No outlook_id, just update locally
    await supabase.from('mail_items').update({ is_read: true }).eq('id', mail_id)
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Update DB
  await supabase.from('mail_items').update({ is_read: true }).eq('id', mail_id)

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
  if (!profile) return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders })

  const accessToken = await getAccessToken(supabase, authUser, profile)
  if (!accessToken) {
    // Token missing but DB already updated - partial success
    return new Response(JSON.stringify({ success: true, warning: 'Outlook not connected' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Mark as read in Outlook
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true })
  })

  if (!res.ok && res.status !== 404) {
    const err = await res.text()
    console.error(`[MARK_READ] Graph error: ${err}`)
    // DB already updated, don't fail
  }

  return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
