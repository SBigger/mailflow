
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!
  const tenantId = Deno.env.get('MICROSOFT_TENANT_ID') || 'common'
  const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI')!

  // Supabase user token aus state-Parameter lesen und weiterleiten
  let body = {state: ''};
  try {
    body = await req.json();
  } catch (e) {
    console.error("No JSON body provided or invalid format");
  }
  const state = body.state || ''

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All',
    response_mode: 'query',
    state: state,
  })

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  return new Response(url, {
    headers: { ...corsHeaders, 'Content-Type': 'application/text' }
  });
})
