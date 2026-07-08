// ══════════════════════════════════════════════════════════════════════
// Edge Function: chartis-teams-send
// Zweck:  Sendet eine Nachricht des eingeloggten Mitarbeiters in einen
//         Teams-Chat (Graph POST /chats/{id}/messages) mit dessen
//         delegiertem Token. Schreibt die gesendete Nachricht direkt in
//         teams_chat_messages (sofortiges Feedback, Sync holt Rest).
// Auth:   Bearer-JWT des Mitarbeiters. Scope ChatMessage.Send nötig.
// Env:    MICROSOFT_CLIENT_ID/SECRET/TENANT_ID, SUPABASE_URL, SERVICE_KEY
// ══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLIENT_ID     = Deno.env.get('MICROSOFT_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;
const TENANT_ID     = Deno.env.get('MICROSOFT_TENANT_ID');
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function ensureAccessToken(supabase: any, profile: any): Promise<string | null> {
  let accessToken: string | null = profile.microsoft_access_token || null;
  const expiry = profile.microsoft_token_expiry || 0;
  if (accessToken && Date.now() < expiry - 60_000) return accessToken;
  const refreshToken = profile.microsoft_refresh_token;
  if (!refreshToken) return null;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const tokens = await res.json();
  accessToken = tokens.access_token;
  await supabase.from('profiles').update({
    microsoft_access_token: tokens.access_token,
    microsoft_refresh_token: tokens.refresh_token || refreshToken,
    microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000),
  }).eq('id', profile.id);
  return accessToken;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Eingeloggten Mitarbeiter aus dem JWT bestimmen
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { chat_id, text } = await req.json();
    if (!chat_id || !text || !String(text).trim()) return json({ error: 'chat_id und text erforderlich' }, 400);

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, microsoft_access_token, microsoft_refresh_token, microsoft_token_expiry')
      .eq('id', user.id).maybeSingle();
    if (!profile) return json({ error: 'Kein Mitarbeiter-Profil' }, 403);

    const token = await ensureAccessToken(supabase, profile);
    if (!token) return json({ error: 'Microsoft nicht verbunden (bitte neu verbinden)' }, 400);

    // In Teams-Chat senden
    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat_id)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { contentType: 'text', content: String(text) } }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: `Graph ${res.status}`, details: t.slice(0, 400) }, 502);
    }
    const msg = await res.json();

    // Gesendete Nachricht sofort persistieren (Sync würde sie sonst erst später holen)
    await supabase.from('teams_chat_messages').upsert({
      owner_id: profile.id,
      chat_id,
      msg_id: msg.id,
      from_name: msg.from?.user?.displayName || 'Du',
      from_aad_id: msg.from?.user?.id || null,
      is_mine: true,
      body_html: null,
      body_text: String(text),
      created_at: msg.createdDateTime || new Date().toISOString(),
    }, { onConflict: 'owner_id,chat_id,msg_id' });

    return json({ success: true, msg_id: msg.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
