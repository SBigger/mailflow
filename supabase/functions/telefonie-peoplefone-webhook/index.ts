// ===========================================================================
// telefonie-peoplefone-webhook
//
// Empfaengt peoplefones "Call Management API" Notify-Events (registriert via
// POST call-api.peoplefone.com/customer/call-management/v1/subscription,
// callbackUrl = diese Function) und bringt sie auf dieselbe Leitung wie
// bisher: Broadcast auf Channel "telefonie-calls", Event "incoming_call",
// Status ringing|answered|ended -- das Frontend (TelephonyContext.jsx)
// bleibt dadurch unveraendert.
//
// Ersetzt den bisherigen lokalen MicroSIP-ini-Hook-Mechanismus (fragil, siehe
// Vorfall 2026-07-22: Einstellungen wurden nur beim MicroSIP-Start gelesen)
// durch einen offiziellen, server-seitigen Weg direkt von peoplefone.
//
// Payload-Form GEGEN DIE ECHTE OpenAPI-Spezifikation verifiziert (nicht nur
// Doku-Zusammenfassung) -- geladen von api.peoplefone.com/services/api-doc/
// api/CallManagementV1.yml + template/v202504-template.yml, Stand 2026-07-22:
//   { action: "notify"|"keepAlive",
//     owner: { identifier, type:"user", name?, internalNumber? },
//     availability?: "unknown"|"available"|"busy"|"unavailable",
//     calls?: [{ callId, state: "setup"|"early"|"confirmed"|"terminated",
//                 direction: "incoming"|"outgoing",
//                 remoteParty: { identifier, type:"number", ... } }] }
// state-Mapping: setup/early (Vorstufen vor Verbindung) -> ringing,
// confirmed -> answered, terminated -> ended.
//
// Ziel-Mitarbeiter: aktuell nur EINE Subscription (Sascha), darum bewusst
// KEIN Matching-Aufwand -- targetUserId bleibt null (Broadcast an alle
// verbundenen Clients, identisch zum alten Rufgruppen-Fallback). Sobald
// weitere Mitarbeitende eigene Subscriptions bekommen: rawBody.owner.identifier
// (peoplefones interner User-Identifier, bei Sascha = SIP-Benutzername) gegen
// eine neue Zuordnung mappen -- NICHT gegen profiles.phone (andere Nummernwelt).
//
// Auth: eigener Query-Param ?secret=... (peoplefone signiert Webhook-Aufrufe
// nicht) -- muss beim Registrieren der Subscription mit in die callbackUrl.
// Deploy: supabase functions deploy telefonie-peoplefone-webhook --no-verify-jwt
//
// ⚠️ BETRIEBS-HINWEIS (Vorfall 2026-07-25): peoplefones Call-Management-API
// LOESCHT die Subscription automatisch und sofort, sobald dieser Webhook
// EIN EINZIGES MAL nicht mit HTTP 200 antwortet -- auch bei einem simplen
// "keepAlive"-Ping (siehe OpenAPI-Spec CallManagementV1.yml, /subscription:
// "if not [200], the subscription will be removed"). Am 2026-07-25 stand
// die App >24h komplett still (kein Anruf kam mehr an), weil genau das
// passiert war -- im Supabase-Dashboard (Functions -> diese Function ->
// Overview) zeigte "Total Invocations" ueber den ganzen Zeitraum 0.
// Symptom-Check: Dashboard-Invocations = 0 trotz echter Testanrufe ->
// Subscription ist weg, nicht der Code.
// Fix: POST an https://call-api.peoplefone.com/customer/call-management/v1/subscription
// mit Header "Authorization: Bearer <PEOPLEFONE_API_KEY>" und Body
// { owner: { identifier: "90746408026", type: "user" },
//   callbackUrl: "<SUPABASE_URL>/functions/v1/telefonie-peoplefone-webhook?secret=<PEOPLEFONE_WEBHOOK_SECRET>" }
// -- am einfachsten per kurzlebiger Wegwerf-Edge-Function (liest beide
// Secrets serverseitig via Deno.env.get, keine Werte muessen im Chat
// landen), deployt OHNE --no-verify-jwt (Aufruf dann mit
// "Authorization: Bearer <SUPABASE_ANON_KEY>"), nach Erfolg sofort wieder
// `supabase functions delete` -- keine dauerhaft unauthentifizierte
// Wartungs-Route stehen lassen.
// ===========================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchCustomerBySuffix, broadcastRealtime } from "../_shared/telefonie.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function pickState(state: unknown): "ringing" | "answered" | "ended" | null {
  const raw = String(state || "").toLowerCase();
  if (raw === "confirmed") return "answered";
  if (raw === "terminated") return "ended";
  if (raw === "setup" || raw === "early") return "ringing";
  return null;
}

function pickRemoteParty(entry: Record<string, unknown>): string {
  const rp = entry.remoteParty as Record<string, unknown> | undefined;
  if (rp && typeof rp === "object" && typeof rp.identifier === "string") return rp.identifier;
  return "";
}

serve(async (req) => {
  const url = new URL(req.url);
  const secret = Deno.env.get("PEOPLEFONE_WEBHOOK_SECRET");
  if (secret && url.searchParams.get("secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await req.json();
  } catch {
    return json({ ok: true }); // leerer/fehlender Body -- trotzdem 200, sonst faellt die Subscription weg
  }
  console.log("telefonie-peoplefone-webhook rawBody:", JSON.stringify(rawBody));

  if (rawBody.action === "keepAlive") {
    return json({ ok: true });
  }

  const calls = Array.isArray(rawBody.calls) ? (rawBody.calls as Record<string, unknown>[]) : [];
  if (!calls.length) {
    return json({ ok: true }); // reine Verfuegbarkeits-Meldung ohne aktiven Anruf
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  for (const entry of calls) {
    const callStatus = pickState(entry.state);
    if (!callStatus) {
      console.log("unmapped call state, skipping:", JSON.stringify(entry));
      continue;
    }
    const remoteParty = pickRemoteParty(entry);

    let match: Awaited<ReturnType<typeof matchCustomerBySuffix>> = null;
    try {
      match = await matchCustomerBySuffix(supabase, remoteParty);
    } catch (e) {
      console.error("customer lookup failed:", e);
    }

    const callPayload = {
      id: "peoplefone-" + (entry.callId || Date.now()),
      dir: entry.direction === "outgoing" ? "out" : "in",
      status: callStatus,
      peerNumber: remoteParty,
      peerName: match?.contactName || null,
      customer: match ? { id: match.customerId, company_name: match.label } : null,
      viaNumber: null,
    };
    const bc = await broadcastRealtime(supabaseUrl, serviceKey, "telefonie-calls", "incoming_call", {
      targetUserId: null,
      call: callPayload,
    });
    if (!bc.ok) console.error("broadcast failed:", bc.status, bc.body);
  }

  return json({ ok: true });
});
