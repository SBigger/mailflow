// ══════════════════════════════════════════════════════════════════════
// Edge Function: sync-teams-chats
// Zweck:   Holt die Teams-CHATS (nicht die Benachrichtigungs-Mails!) jedes
//          Mitarbeiters über sein delegiertes MS-Token (/me/chats + messages)
//          und schreibt sie nach teams_chats / teams_chat_messages.
// Auth:    Delegiert (pro-User refresh_token in profiles.microsoft_*),
//          gleiches Muster wie sync-outlook-mails.
// Scope:   Chat.Read (delegiert) — Mitarbeiter müssen sich neu verbinden.
// Trigger: manuell (POST mit Authorization) oder Cron (X-Cron-Secret).
// Env:     MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), CRON_SECRET
// ══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLIENT_ID     = Deno.env.get('MICROSOFT_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;
const TENANT_ID     = Deno.env.get('MICROSOFT_TENANT_ID') || 'common';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Wie viele Chats pro Mitarbeiter, und wie viele Nachrichten pro Chat.
const MAX_CHATS = 40;
const MAX_MSGS_PER_CHAT = 25;

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// Frischen Access-Token pro Mitarbeiter (refresh, wenn abgelaufen).
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
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) { console.warn(`token refresh failed for ${profile.email}: ${res.status}`); return null; }
  const tokens = await res.json();
  accessToken = tokens.access_token;
  await supabase.from('profiles').update({
    microsoft_access_token: tokens.access_token,
    microsoft_refresh_token: tokens.refresh_token || refreshToken,
    microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000),
  }).eq('id', profile.id);
  return accessToken;
}

async function graphGet(url: string, token: string): Promise<any | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { console.warn(`graph GET ${url} -> ${res.status}`); return null; }
  return res.json();
}

// Einen Mitarbeiter synchronisieren. Gibt {chats, messages} zurück.
async function syncOne(supabase: any, profile: any): Promise<{ chats: number; messages: number; error?: string }> {
  const token = await ensureAccessToken(supabase, profile);
  if (!token) return { chats: 0, messages: 0, error: 'no token' };

  // Eigene AAD-Id (für is_mine) — best effort.
  const meRes = await graphGet('https://graph.microsoft.com/v1.0/me?$select=id', token);
  const myAadId: string | null = meRes?.id || null;

  const chatsRes = await graphGet(
    `https://graph.microsoft.com/v1.0/me/chats?$top=${MAX_CHATS}&$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc`,
    token,
  );
  // Fallback ohne $orderby (manche Tenants lehnen es ab)
  const chats: any[] = chatsRes?.value
    || (await graphGet(`https://graph.microsoft.com/v1.0/me/chats?$top=${MAX_CHATS}&$expand=members,lastMessagePreview`, token))?.value
    || [];
  if (!chats.length) return { chats: 0, messages: 0 };

  const chatRows: any[] = [];
  const msgRows: any[] = [];

  for (const c of chats) {
    const members: string[] = Array.isArray(c.members)
      ? c.members.map((m: any) => m.displayName).filter(Boolean) : [];
    const preview = c.lastMessagePreview?.body?.content || '';
    chatRows.push({
      owner_id: profile.id,
      chat_id: c.id,
      topic: c.topic || null,
      chat_type: c.chatType || null,
      member_names: members,
      last_message_at: c.lastMessagePreview?.createdDateTime || null,
      last_message_preview: stripHtml(preview).slice(0, 200) || null,
      synced_at: new Date().toISOString(),
    });

    const msgsRes = await graphGet(
      `https://graph.microsoft.com/v1.0/me/chats/${c.id}/messages?$top=${MAX_MSGS_PER_CHAT}`,
      token,
    );
    const msgs: any[] = msgsRes?.value || [];
    for (const m of msgs) {
      // System-/Event-Nachrichten (Beitritt, Umbenennung etc.) überspringen
      if (m.messageType && m.messageType !== 'message') continue;
      const html = m.body?.contentType === 'html' ? (m.body?.content || '') : '';
      const raw = m.body?.content || '';
      const fromId = m.from?.user?.id || null;
      msgRows.push({
        owner_id: profile.id,
        chat_id: c.id,
        msg_id: m.id,
        from_name: m.from?.user?.displayName || null,
        from_aad_id: fromId,
        is_mine: !!(myAadId && fromId && fromId === myAadId),
        body_html: html || null,
        body_text: (m.body?.contentType === 'html' ? stripHtml(raw) : raw).slice(0, 8000) || null,
        created_at: m.createdDateTime || null,
      });
    }
  }

  let chatsUp = 0, msgsUp = 0;
  if (chatRows.length) {
    const { error } = await supabase.from('teams_chats').upsert(chatRows, { onConflict: 'owner_id,chat_id' });
    if (error) return { chats: 0, messages: 0, error: `chats upsert: ${error.message}` };
    chatsUp = chatRows.length;
  }
  if (msgRows.length) {
    const { error } = await supabase.from('teams_chat_messages').upsert(msgRows, { onConflict: 'owner_id,chat_id,msg_id' });
    if (error) return { chats: chatsUp, messages: 0, error: `msgs upsert: ${error.message}` };
    msgsUp = msgRows.length;
  }
  return { chats: chatsUp, messages: msgsUp };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const isCron = !!cronSecret && req.headers.get('X-Cron-Secret') === cronSecret;
  if (!isCron && !req.headers.get('Authorization')) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, microsoft_access_token, microsoft_refresh_token, microsoft_token_expiry')
      .not('microsoft_refresh_token', 'is', null);

    const results: any[] = [];
    for (const p of profiles || []) {
      try { results.push({ email: p.email, ...(await syncOne(supabase, p)) }); }
      catch (e) { results.push({ email: p.email, chats: 0, messages: 0, error: String((e as Error)?.message || e) }); }
    }

    return new Response(JSON.stringify({
      ok: true,
      users: results.length,
      chats: results.reduce((a, r) => a + (r.chats || 0), 0),
      messages: results.reduce((a, r) => a + (r.messages || 0), 0),
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sync-teams-chats error', e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
