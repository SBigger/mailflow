import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const url = new URL(req.url);
  const code = url.searchParams.get('code')
  if (!code) return new Response('Missing code', { status: 400 })

  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!
  const tenantId = Deno.env.get('MICROSOFT_TENANT_ID') || 'common'
  const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI')!

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    }
  )
  const tokens = await tokenRes.json()
  if (!tokenRes.ok) return new Response(JSON.stringify({ error: tokens.error_description }), { status: 400, headers: corsHeaders })

  // User-Infos von Microsoft holen
  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const me = await meRes.json()

  // Auth-Token aus Query-Parameter (vom Frontend mitgeschickt)
  const supabaseToken = url.searchParams.get('state') || req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!supabaseToken) return new Response('Missing auth state', { status: 400 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user: authUser } } = await supabase.auth.getUser(supabaseToken)
  if (!authUser) return new Response('Unauthorized', { status: 401 })

  await supabase.from('profiles').update({
    microsoft_access_token: tokens.access_token,
    microsoft_refresh_token: tokens.refresh_token,
    microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000),
    outlook_email: me.mail || me.userPrincipalName,
    microsoft_delta_link: ''
  }).eq('id', authUser.id)

  // Zurück zur App
  const appUrl = Deno.env.get('APP_URL') || 'https://mailflow.vercel.app'
  return Response.redirect(`${appUrl}/Settings?outlook=connected`, 302)
})
