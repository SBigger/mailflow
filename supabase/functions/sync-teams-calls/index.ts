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

// ── Graph: callRecords mit Filter (Expand pro Einzel-Record) ────
// Graph erlaubt $expand NICHT auf der Listen-Route, daher 2-Schritt:
//   1) Liste mit $filter holen
//   2) Pro Record Detail mit $expand=sessions($expand=segments) nachladen
async function fetchCallRecordsList(token: string, sinceISO: string): Promise<any[]> {
  const all: any[] = [];
  const filter = `startDateTime ge ${sinceISO}`;
  let url = `https://graph.microsoft.com/v1.0/communications/callRecords?$filter=${encodeURIComponent(filter)}`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Graph callRecords list failed: ${res.status} ${txt}`);
    }
    const json = await res.json();
    if (Array.isArray(json.value)) all.push(...json.value);
    url = json['@odata.nextLink'] || '';
  }
  return all;
}

async function fetchCallRecordDetail(token: string, id: string): Promise<any | null> {
  const url = `https://graph.microsoft.com/v1.0/communications/callRecords/${id}?$expand=sessions($expand=segments)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // Einzelner Fehler soll nicht den ganzen Sync killen
    console.warn(`detail fetch failed for ${id}: ${res.status}`);
    return null;
  }
  return res.json();
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

// ── Pending-Notes → call_records verknüpfen ─────────────────────
function buildMergedNote(existing: string | null | undefined, pending: { note_title: string | null; note_text: string | null }): string {
  const parts: string[] = [];
  if (pending.note_title && pending.note_title.trim()) parts.push(`▸ ${pending.note_title.trim()}`);
  if (pending.note_text  && pending.note_text.trim())  parts.push(pending.note_text.trim());
  const pendingText = parts.join("\n");
  const existingText = (existing || "").trim();
  if (!existingText) return pendingText;
  if (!pendingText)  return existingText;
  return `${existingText}\n\n— Vorab-Notiz —\n${pendingText}`;
}

async function linkPendingNotes(supabase: any, rows: DbRow[]): Promise<number> {
  const namedRows = rows.filter(r => r.artis_user_name && r.start_time);
  if (!namedRows.length) return 0;

  // 1) Alle Mitarbeiter-Namen die in diesem Batch vorkommen
  const names = Array.from(new Set(namedRows.map(r => r.artis_user_name!))).filter(Boolean);
  if (!names.length) return 0;

  // 2) Alle unverknüpften Pending Notes für diese Mitarbeiter laden
  const { data: pendings, error: pendErr } = await supabase
    .from('call_notes_pending')
    .select('id, customer_id, phone_number, phone_suffix, artis_user_name, note_title, note_text, clicked_at')
    .is('linked_call_id', null)
    .in('artis_user_name', names);
  if (pendErr) {
    console.warn('linkPendingNotes: pending select failed', pendErr.message);
    return 0;
  }
  if (!pendings || !pendings.length) return 0;

  // 3) DB-Zeilen nachladen, um die echten call_records.id zu bekommen
  const graphIds = namedRows.map(r => r.graph_call_id);
  const { data: dbCalls } = await supabase
    .from('call_records')
    .select('id, graph_call_id, artis_user_name, caller_number, callee_number, direction, start_time, notes, customer_id')
    .in('graph_call_id', graphIds);
  if (!dbCalls || !dbCalls.length) return 0;

  const THIRTY_MIN = 30 * 60 * 1000;
  const used = new Set<string>();
  let linked = 0;

  // Pro Anruf: älteste passende Pending-Notiz nehmen (FIFO)
  for (const call of dbCalls) {
    if (!call.artis_user_name || !call.start_time) continue;
    const external = call.direction === 'outgoing' ? call.callee_number : call.caller_number;
    const suffix = phoneSuffix(external);
    if (!suffix) continue;
    const callMs = new Date(call.start_time).getTime();

    const matches = pendings
      .filter((p: any) =>
        !used.has(p.id)
        && p.artis_user_name === call.artis_user_name
        && p.phone_suffix    === suffix
        && Math.abs(new Date(p.clicked_at).getTime() - callMs) <= THIRTY_MIN,
      )
      .sort((a: any, b: any) => new Date(a.clicked_at).getTime() - new Date(b.clicked_at).getTime());

    if (!matches.length) continue;
    const p = matches[0];
    used.add(p.id);

    // Notiz in call_records.notes einmergen
    const mergedNote = buildMergedNote(call.notes, p);
    const callUpdate: any = { notes: mergedNote };
    // Falls Pending einen Kunden hatte, der Anruf aber nicht → übernehmen
    if (!call.customer_id && p.customer_id) callUpdate.customer_id = p.customer_id;

    const { error: uErr } = await supabase
      .from('call_records')
      .update(callUpdate)
      .eq('id', call.id);
    if (uErr) {
      console.warn('linkPendingNotes: call update failed', uErr.message);
      continue;
    }
    const { error: pErr } = await supabase
      .from('call_notes_pending')
      .update({ linked_call_id: call.id, linked_at: new Date().toISOString() })
      .eq('id', p.id);
    if (pErr) {
      console.warn('linkPendingNotes: pending update failed', pErr.message);
      continue;
    }
    linked++;
  }
  return linked;
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
    //    Override via ?hours_back=168 möglich (Backfill / Re-Match).
    const reqUrl = new URL(req.url);
    const hoursBackParam = reqUrl.searchParams.get('hours_back');
    const hoursBack = hoursBackParam ? Number(hoursBackParam) : NaN;

    const now = new Date();
    let since: Date;
    if (Number.isFinite(hoursBack) && hoursBack > 0) {
      since = new Date(now.getTime() - hoursBack * 3600_000);
    } else {
      const { data: latestRow } = await supabase
        .from('call_records')
        .select('start_time')
        .order('start_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      since = latestRow?.start_time
        ? new Date(new Date(latestRow.start_time).getTime() - OVERLAP_MINUTES * 60_000)
        : new Date(now.getTime() - INITIAL_HOURS_BACK * 3600_000);
    }
    const sinceISO = since.toISOString();

    // 2) Phone-Index aus customers aufbauen (für Match)
    //    Quellen: customers.phone + customers.contact_persons[].phone / .phone2
    const { data: customers, error: custErr } = await supabase
      .from('customers')
      .select('id, phone, contact_persons');
    if (custErr) throw new Error(`customers select failed: ${custErr.message}`);

    const phoneIndex = new Map<string, string>();
    const addPhone = (raw: unknown, id: string) => {
      if (typeof raw !== 'string' || !raw.trim()) return;
      const suf = phoneSuffix(normalizePhone(raw));
      if (suf && !phoneIndex.has(suf)) phoneIndex.set(suf, id);
    };
    for (const c of customers || []) {
      addPhone((c as any).phone, c.id);
      const cps = Array.isArray((c as any).contact_persons) ? (c as any).contact_persons : [];
      for (const cp of cps) {
        if (!cp || typeof cp !== 'object') continue;
        addPhone(cp.phone,  c.id);
        addPhone(cp.phone2, c.id);
      }
    }

    // 3) Graph-Token holen
    const token = await getGraphToken();

    // 4) callRecords Liste holen (alle Seiten, ohne expand)
    const listRecords = await fetchCallRecordsList(token, sinceISO);

    // 4b) Details pro Record nachladen (sessions + segments für Nummern)
    //     Parallelisiert in Batches, damit wir Graph nicht überrennen.
    const BATCH = 5;
    const records: any[] = [];
    for (let i = 0; i < listRecords.length; i += BATCH) {
      const slice = listRecords.slice(i, i + BATCH);
      const details = await Promise.all(
        slice.map(r => fetchCallRecordDetail(token, r.id).then(d => d ?? r))
      );
      records.push(...details);
    }

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

    // 6) Pending-Notes verknüpfen (Click-to-Call aus MailFlow)
    //    Regel: gleicher artis_user_name + gleiche Nummer (suffix) + ±30 Min um start_time.
    //    FIFO: älteste passende Pending-Notiz gewinnt pro Anruf.
    const linkedNotes = await linkPendingNotes(supabase, rows);

    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';
    const body: any = {
      ok: true,
      since: sinceISO,
      fetched: records.length,
      upserted,
      matched: rows.filter(r => r.customer_id).length,
      linked_pending_notes: linkedNotes,
      customer_phone_suffixes: phoneIndex.size,
    };
    if (debug) {
      body.sample_rows = rows.slice(0, 10).map(r => ({
        direction: r.direction,
        caller_number: r.caller_number,
        callee_number: r.callee_number,
        caller_name: r.caller_name,
        callee_name: r.callee_name,
        artis_user_name: r.artis_user_name,
        call_type: r.call_type,
        matched: !!r.customer_id,
      }));
      // Phone-Index Beispiel (max 10)
      body.sample_customer_suffixes = Array.from(phoneIndex.keys()).slice(0, 10);
    }
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('sync-teams-calls error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
