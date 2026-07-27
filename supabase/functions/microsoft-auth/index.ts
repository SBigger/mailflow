
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
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    console.error("No JSON body provided or invalid format");
  }
  const {state, forceConsent, mail } = body;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    // ⚠️ Calendars.ReadWrite (statt nur .Read) seit 2026-07-27: nötig, damit
    // smartis Besprechungstermine als echte Outlook-Einladungen anlegen kann
    // (Modul "Besprechungen"). ReadWrite schliesst Read ein.
    // REIHENFOLGE BEIM AUSROLLEN: zuerst muss die Berechtigung in Azure
    // eingetragen UND Administrator-Zustimmung erteilt sein — sonst scheitert
    // der Zustimmungsdialog. Danach diese Function ausrollen. Bestehende
    // Anmeldungen behalten ihre alten Rechte, bis sich die Person EINMAL neu
    // verbindet (gleiche Lehre wie bei der Einführung von Calendars.Read).
    scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All Calendars.ReadWrite Chat.Read ChatMessage.Send',
    response_mode: 'query',
    state: state || '',
    ...(mail ? { login_hint: mail } : {}),
    ...(forceConsent ? { prompt: 'consent' } : {}),
  })

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  return new Response(url, {
    headers: { ...corsHeaders, 'Content-Type': 'application/text' }
  });
})
