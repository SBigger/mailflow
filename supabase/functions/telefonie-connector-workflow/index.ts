// ===========================================================================
// telefonie-connector-workflow
//
// Empfängt die "Workflow"-POSTs des peoplefone CONNECTOR bei Anrufende
// (Call-Log/CDR-artige Events: wer, wann, wie lange, welche Richtung) und
// schreibt sie in die bestehende Tabelle `call_records` — dieselbe Tabelle,
// die TelefonDashboard/Chartis/das neue Telefonie-Cockpit schon anzeigen.
// Kein neues Schema nötig; die Herkunft steckt in `raw._source` (die
// Tabelle hat noch keine eigene `source`-Spalte — siehe Migrations-Notiz
// unten, falls das später sauberer getrennt werden soll).
//
// ⚠️ NICHT DEPLOYT / NICHT GEGEN ECHTEN VERKEHR GETESTET.
// Feldnamen des CONNECTOR-Workflow-Payloads sind best-effort — beim ersten
// echten Anruf `rawBody` in den Function-Logs ansehen und ggf. anpassen.
//
// Auth: gleiches X-Connector-Secret wie telefonie-connector-lookup.
// Deploy: supabase functions deploy telefonie-connector-workflow --no-verify-jwt
//
// TODO (spätere Migration, additiv): call_records um `source text` (z.B.
// 'teams' | 'connector'), `status text` (ringing/connected/ended) und
// `livekit_room text` erweitern, sobald ein DB-Zugang steht — dann kann
// dieser Code auf echte Spalten statt raw._source umgestellt werden.
// ===========================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickPhoneNumber, pickCalleeNumber, matchCustomerBySuffix, normalizePhone } from "../_shared/telefonie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-connector-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function pickString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}
function pickNumberField(body: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = body?.[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("CONNECTOR_SHARED_SECRET");
  const gotSecret = req.headers.get("X-Connector-Secret") || req.headers.get("x-connector-secret");
  if (!secret || gotSecret !== secret) return json({ error: "unauthorized" }, 401);

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  console.log("telefonie-connector-workflow rawBody:", JSON.stringify(rawBody));

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const callerNumber = pickPhoneNumber(rawBody);
  const calleeNumber = pickCalleeNumber(rawBody);
  const directionRaw = pickString(rawBody, ["direction", "callDirection"]);
  const direction = directionRaw
    ? (/in|inbound/i.test(directionRaw) ? "incoming" : /out|outbound/i.test(directionRaw) ? "outgoing" : "unknown")
    : "unknown";
  const durationSeconds = pickNumberField(rawBody, ["duration", "durationSeconds", "billsec", "talkTime"]) ?? 0;
  const startTime = pickString(rawBody, ["startTime", "start", "startedAt"]);
  const endTime = pickString(rawBody, ["endTime", "end", "endedAt"]);
  const externalId = pickString(rawBody, ["id", "callId", "eventId"]) || `${callerNumber || "unknown"}-${Date.now()}`;

  // Nummer→Kunde: bei eingehend über den Anrufer, bei ausgehend über die
  // gewählte Nummer (gleiche Logik wie im Lookup/Teams-Sync).
  const lookupNumber = direction === "outgoing" ? calleeNumber : callerNumber;
  let match: Awaited<ReturnType<typeof matchCustomerBySuffix>> = null;
  try {
    match = await matchCustomerBySuffix(supabase, lookupNumber);
  } catch (e) {
    console.error("customer lookup failed:", e);
  }

  const row = {
    graph_call_id: "connector-" + externalId, // Präfix vermeidet Kollision mit Teams-Graph-IDs
    customer_id: match?.customerId || null,
    direction,
    call_type: "pstnCall",
    caller_number: normalizePhone(callerNumber) || callerNumber,
    callee_number: normalizePhone(calleeNumber) || calleeNumber,
    caller_name: match?.contactName || null,
    callee_name: null,
    artis_user_id: null,
    artis_user_name: null,
    start_time: startTime || new Date().toISOString(),
    end_time: endTime || null,
    duration_seconds: durationSeconds,
    raw: { ...rawBody, _source: "peoplefone-connector" },
  };

  const { error } = await supabase
    .from("call_records")
    .upsert(row, { onConflict: "graph_call_id", ignoreDuplicates: false });

  if (error) {
    console.error("call_records upsert failed:", error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  return json({ ok: true });
});
