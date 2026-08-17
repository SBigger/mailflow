// ===========================================================================
// telefonie-connector-lookup
//
// Lookup-Endpunkt für den peoplefone CONNECTOR (vPBX-Zusatzmodul) UND für das
// lokale MicroSIP-Hook-Skript (microsip-notify.ps1) auf dem Mitarbeiter-PC.
// Beide rufen dieselbe URL bei einem Anruf-Ereignis auf und übergeben die
// Anrufernummer (+ optional "status": "ringing"|"answered"|"ended", Default
// "ringing"); wir liefern zurück, wer das ist (für das Connector-Popup) UND
// feuern zusätzlich ein Realtime-Broadcast-Event, damit smartis live reagiert
// (gleicher Kanal, den das Frontend schon über den "Test-Anruf"-Knopf nutzt:
// Channel "telefonie-calls", Event "incoming_call"). Das Frontend
// (TelephonyContext.jsx) unterscheidet anhand von "status": ringing zeigt
// den Dossier-Screen-Pop, answered promoviert zum aktiven Anruf, ended löst
// automatisch das Wrap-up/Leistungs-Panel aus.
//
// ⚠️ NICHT DEPLOYT / NICHT GEGEN ECHTEN VERKEHR GETESTET.
// Die exakten Feldnamen des CONNECTOR-Requests sind best-effort (siehe
// _shared/telefonie.ts). Vor Go-Live: einmal mit echtem Testanruf auslösen,
// `console.log(rawBody)` in den Supabase-Function-Logs ansehen, ggf.
// pickPhoneNumber()/pickCalleeNumber() anpassen.
//
// Auth: Header `X-Connector-Secret` muss mit Secret CONNECTOR_SHARED_SECRET
// übereinstimmen (im Peoplefone-Portal bei der Lookup-URL als Header/Token
// hinterlegen; Wert selbst frei wählen und als Supabase-Secret setzen).
// Deploy: supabase functions deploy telefonie-connector-lookup --no-verify-jwt
// ===========================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pickPhoneNumber, pickCalleeNumber, matchCustomerBySuffix,
  broadcastRealtime, normalizePhone, phoneSuffix,
} from "../_shared/telefonie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-connector-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("CONNECTOR_SHARED_SECRET");
  const gotSecret = req.headers.get("X-Connector-Secret") || req.headers.get("x-connector-secret");
  if (!secret || gotSecret !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await req.json();
  } catch {
    // manche Systeme senden Query-Params statt JSON-Body — Fallback
    const url = new URL(req.url);
    for (const [k, v] of url.searchParams) rawBody[k] = v;
  }
  console.log("telefonie-connector-lookup rawBody:", JSON.stringify(rawBody));

  const callerNumber = pickPhoneNumber(rawBody);
  const calleeNumber = pickCalleeNumber(rawBody);
  const statusRaw = typeof rawBody.status === "string" ? rawBody.status.toLowerCase() : "";
  const callStatus = (["ringing", "answered", "ended"].includes(statusRaw) ? statusRaw : "ringing") as
    "ringing" | "answered" | "ended";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let match: Awaited<ReturnType<typeof matchCustomerBySuffix>> = null;
  try {
    match = await matchCustomerBySuffix(supabase, callerNumber);
  } catch (e) {
    console.error("customer lookup failed:", e);
  }

  // Ziel-Mitarbeiter bestimmen (best effort): profiles.phone gegen die
  // angerufene Nummer matchen. Kein Treffer → Broadcast geht an ALLE gerade
  // in smartis angemeldeten Mitarbeiter (passend für eine geteilte
  // Rufgruppen-Hauptnummer, z. B. "Sekretariat").
  let targetUserId: string | null = null;
  try {
    if (calleeNumber) {
      const calleeSuf = phoneSuffix(normalizePhone(calleeNumber));
      const { data: staff } = await supabase.from("profiles").select("id, phone");
      const hit = (staff || []).find(
        (p: any) => p.phone && phoneSuffix(normalizePhone(p.phone)) === calleeSuf,
      );
      if (hit) targetUserId = hit.id;
    }
  } catch (e) {
    console.error("employee match failed:", e);
  }

  // Realtime-Signal an smartis — dasselbe Format wie der Test-Anruf-Knopf.
  const callPayload = {
    id: "connector-" + Date.now(),
    dir: "in",
    status: callStatus,
    peerNumber: callerNumber,
    peerName: match?.contactName || null,
    customer: match ? { id: match.customerId, company_name: match.label } : null,
    viaNumber: calleeNumber || null,
  };
  const bc = await broadcastRealtime(supabaseUrl, serviceKey, "telefonie-calls", "incoming_call", {
    targetUserId,
    call: callPayload,
  });
  if (!bc.ok) console.error("broadcast failed:", bc.status, bc.body);

  // Antwort für den CONNECTOR selbst (Popup/CRM-Link seiner eigenen Oberfläche).
  const appUrl = `${Deno.env.get('APP_URL')!}`
  return json({
    ok: true,
    name: match?.contactName || match?.label || null,
    company: match?.label || null,
    link: match ? `${appUrl}/Kunden?customer=${match.customerId}` : null,
  });
});
