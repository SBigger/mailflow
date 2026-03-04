import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!
  const tenantId = Deno.env.get('MICROSOFT_TENANT_ID') || 'common'
  const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI')!

  // Supabase user token aus state-Parameter lesen und weiterleiten
  const reqUrl = new URL(req.url)
  const state = reqUrl.searchParams.get('state') || ''

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read',
    response_mode: 'query',
    state: state,
  })

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  return Response.redirect(url, 302)
})
