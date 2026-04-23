// ══════════════════════════════════════════════════════════════════════
// Edge Function: sync-teams-calls
// Zweck:         Holt Teams-/Teams-Phone-Anrufe aus Microsoft Graph
//                (/communications/callRecords) und schreibt sie in
//                die Tabelle `call_records`, dedupliziert per graph_call_id
//                und matched die Nummern gegen customers.phone.
// Trigger:       manuell (POST) oder per Supabase Cron (z.B. alle 15 Min.)
// Auth Mode:     Client Credentials Grant (Application Permission)
//                → KEINE User-Session nötig.
// Permissions:   CallRecords.Read.All (Application) + Admin Consent
// Env:           MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
//                SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// ══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Konfiguration ───────────────────────────────────────────────
const TENANT_ID     = Deno.env.get('MS_GRAPH_TENANT_ID')!;
const CLIENT_ID     = Deno.env.get('MS_GRAPH_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Wie viele Stunden rückwärts syncen, wenn noch keine Records existieren.
const INITIAL_HOURS_BACK = 24 * 7; // 7 Tage beim ersten Lauf
// Puffer, damit wir keine Records verpassen, die noch nicht fertig geschrieben waren
const OVERLAP_MINUTES    = 5;

// ── Microsoft Graph Token (Client Credentials) ──────────────────
async function getGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph token request failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json.access_token;
}

// ── Helpers ─────────────────────────────────────────────────────
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  // 00 Präfix → +
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  // CH Inland (0xx xxx xx xx) → +41
  if (digits.startsWith('0') && !digits.startsWith('+')) return '+41' + digits.slice(1);
  return digits.startsWith('+') ? digits : '+' + digits;
}

// Für fuzzy matching: die letzten 9 Ziffern (schweizer Nummern sind 9 stellig ohne Präfix)
function phoneSuffix(norm: string | null): string | null {
  if (!norm) return null;
  const d = norm.replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : null;
}

function pickNumber(identity: any): string | null {
  if (!identity) return null;
  // Teams-Phone PSTN: identity.phone.id = "+41712223344"
  if (identity.phone?.id) return identity.phone.id;
  // Externer Nutzer: identity.user?.id (UPN / AAD ID, keine Nummer)
  return null;
}

function pickName(identity: any): string | null {
  if (!identity) return null;
  return identity.user?.displayName || identity.phone?.displayName || identity.guest?.displayName || null;
}

// ── Graph: callRecords mit Filter + Expand ──────────────────────
async function fetchCallRecords(token: string, sinceISO: string): Promise<any[]> {
  const all: any[] = [];
  // Max window Graph erlaubt: startDateTime ge X (bis jetzt)
  const filter = `startDateTime ge ${sinceISO}`;
  let url = `https://graph.microsoft.com/v1.0/communications/callRecords?$filter=${encodeURIComponent(filter)}&$expand=sessions($expand=segments)`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Graph callRecords failed: ${res.status} ${txt}`);
    }
    const json = await res.json();
    if (Array.isArray(json.value)) all.push(...json.value);
    url = json['@odata.nextLink'] || '';
  }
  return all;
}

// ── Record → DB-Zeile ───────────────────────────────────────────
type DbRow = {
  graph_call_id: string;
  customer_id: string | null;
  direction: string;
  call_type: string;
  caller_number: string | null;
  callee_number: string | null;
  caller_name: string | null;
  callee_name: string | null;
  artis_user_id: string | null;
  artis_user_name: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_seconds: number | null;
  raw: any;
};

function buildRow(rec: any, phoneIndex: Map<string, string>): DbRow {
  // Teilnehmer aus organizer + participants
  const organizer = rec.organizer_v2 || rec.organizer || null;
  const participants: any[] = Array.isArray(rec.participants_v2) ? rec.participants_v2
                            : Array.isArray(rec.participants)    ? rec.participants
                            : [];

  // Caller / Callee aus erstem Segment (wenn vorhanden) ableiten
  let callerIdentity: any = organizer || null;
  let calleeIdentity: any = participants.find(p => p !== organizer) || null;

  const firstSession = Array.isArray(rec.sessions) ? rec.sessions[0] : null;
  const firstSegment = firstSession && Array.isArray(firstSession.segments) ? firstSession.segments[0] : null;
  if (firstSegment) {
    if (firstSegment.caller?.identity) callerIdentity = firstSegment.caller.identity;
    if (firstSegment.callee?.identity) calleeIdentity = firstSegment.callee.identity;
  }

  const callerNumRaw = pickNumber(callerIdentity);
  const calleeNumRaw = pickNumber(calleeIdentity);
  const callerNum = normalizePhone(callerNumRaw);
  const calleeNum = normalizePhone(calleeNumRaw);

  // Artis-User: der user.* im organizer oder participants
  const artisParticipant = (callerIdentity?.user && !callerNum) ? callerIdentity
                         : (calleeIdentity?.user && !calleeNum) ? calleeIdentity
                         : null;
  const artisUserId   = artisParticipant?.user?.id || null;
  const artisUserName = artisParticipant?.user?.displayName || null;

  // Direction: wenn artis = caller → outgoing, wenn artis = callee → incoming
  let direction = 'unknown';
  if (artisParticipant) {
    if (callerIdentity?.user?.id === artisUserId) direction = 'outgoing';
    else if (calleeIdentity?.user?.id === artisUserId) direction = 'incoming';
  }

  // Customer-Match via phoneIndex (lookup via suffix)
  let customerId: string | null = null;
  const externalNum = direction === 'outgoing' ? calleeNum
                    : direction === 'incoming' ? callerNum
                    : (callerNum || calleeNum);
  const suffix = phoneSuffix(externalNum);
  if (suffix && phoneIndex.has(suffix)) customerId = phoneIndex.get(suffix)!;

  return {
    graph_call_id:    rec.id,
    customer_id:      customerId,
    direction,
    call_type:        rec.type || 'unknown',
    caller_number:    callerNum,
    callee_number:    calleeNum,
    caller_name:      pickName(callerIdentity),
    callee_name:      pickName(calleeIdentity),
    artis_user_id:    artisUserId,
    artis_user_name:  artisUserName,
    start_time:       rec.startDateTime || null,
    end_time:         rec.endDateTime || null,
    duration_seconds: (() => {
      if (!rec.startDateTime || !rec.endDateTime) return null;
      const ms = new Date(rec.endDateTime).getTime() - new Date(rec.startDateTime).getTime();
      return Math.max(0, Math.round(ms / 1000));
    })(),
    raw: rec,
  };
}

// ══════════════════════════════════════════════════════════════════
// HTTP Handler
// ══════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Akzeptiere entweder: (a) gueltiger X-Cron-Secret Header (Cronjob),
  //                      (b) oder normale Supabase-Auth via Authorization-Header (manueller Aufruf)
  // Wenn weder a noch b gesetzt sind -> 401.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const isCronCall = !!cronSecret && req.headers.get('X-Cron-Secret') === cronSecret;
  const hasAuth    = !!req.headers.get('Authorization');
  if (!isCronCall && !hasAuth) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // 1) letzten Sync-Zeitpunkt bestimmen
    const { data: latestRow } = await supabase
      .from('call_records')
      .select('start_time')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date();
    const since = latestRow?.start_time
      ? new Date(new Date(latestRow.start_time).getTime() - OVERLAP_MINUTES * 60_000)
      : new Date(now.getTime() - INITIAL_HOURS_BACK * 3600_000);
    const sinceISO = since.toISOString();

    // 2) Phone-Index aus customers aufbauen (für Match)
    const { data: customers } = await supabase
      .from('customers')
      .select('id, phone, phone_2, phone_geschaeft, phone_privat')
      .not('phone', 'is', null);

    const phoneIndex = new Map<string, string>();
    for (const c of customers || []) {
      for (const key of ['phone', 'phone_2', 'phone_geschaeft', 'phone_privat'] as const) {
        const p = (c as any)[key];
        if (!p) continue;
        const suf = phoneSuffix(normalizePhone(p));
        if (suf) phoneIndex.set(suf, c.id);
      }
    }

    // 3) Graph-Token holen
    const token = await getGraphToken();

    // 4) callRecords holen (alle Seiten)
    const records = await fetchCallRecords(token, sinceISO);

    // 5) Normalisieren + upsert
    const rows = records.map(r => buildRow(r, phoneIndex));
    let upserted = 0;
    if (rows.length) {
      const { error } = await supabase
        .from('call_records')
        .upsert(rows, { onConflict: 'graph_call_id' });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
      upserted = rows.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      since: sinceISO,
      fetched: records.length,
      upserted,
      matched: rows.filter(r => r.customer_id).length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('sync-teams-calls error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
