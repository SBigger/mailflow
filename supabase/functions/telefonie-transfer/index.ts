// ===========================================================================
// telefonie-transfer -- Verbinden (Blind-Transfer) ueber die peoplefone-API
//
// Sascha-Wunsch 2026-07-26 ("echte Telefonie-Funktionalitaet"), Stufe 1 des
// Transfer-Bauplans (Recherche gleichentags, OpenAPI-Spezifikationen im
// Original gelesen -- siehe Projektgedaechtnis):
//   POST call-api.peoplefone.com/customer/call-management/v1/call/blind-transfer
//   { owner: { type: "user", identifier }, callId, destination: { type: "number", identifier } }
//   -> 202 Accepted. NUR Blind (peoplefone kann programmatisch kein Attended
//   und kein Zurueckholen -- Stufe 2 baut das Rueckholen ueber vPBX-Gruppen-
//   Overflow nach, siehe Plan).
//
// Zwei Aktionen (POST-Body { action: ... }):
//   { action: "targets" }
//     -> Liste der vPBX-Benutzer aus der Configuration API (Name, interne
//        Nebenstelle) -- live von der Anlage, keine Datenpflege in smartis.
//        STANDARD-Linien (hosted == null, z.B. vFax) werden ausgefiltert.
//   { action: "transfer", callId, destination }
//     -> Blind-Transfer des laufenden Anrufs. callId darf mit dem Broadcast-
//        Prefix "peoplefone-" ankommen (wird gestrippt). destination ist die
//        Zielnummer (Nebenstelle oder volle Nummer -- was die Anlage nimmt,
//        klaert der Live-Test; wir reichen durch, was die UI schickt).
//
// Auth: verify_jwt laesst auch den anon-Key durch -- deshalb zusaetzlich
// pruefen, dass ein ANGEMELDETER Benutzer ruft (JWT-Payload role ==
// "authenticated"). Die grosse Kanal-/Befehls-Autorisierung kommt mit dem
// Security-Paket; bis dahin ist das die Mindesthuerde.
//
// owner ist fest Sascha (163879) -- Einzelplatz-Stand wie ueberall in der
// Telefonie; wird mit dem Mitarbeiter-Rollout pro Benutzer aufgeloest.
// Deploy: supabase functions deploy telefonie-transfer
// ===========================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_USER_ID = "163879"; // "Bigger", vPBX-Benutzer, interne Nr. 20
const CALL_BASE = "https://call-api.peoplefone.com/customer/call-management/v1";
const CONFIG_BASE = "https://configuration-api.peoplefone.com/customer/voip/v1";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" },
  });

function isAuthenticatedUser(req: Request): boolean {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "authenticated";
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (!isAuthenticatedUser(req)) return json({ error: "nur fuer angemeldete Benutzer" }, 403);

  const apiKey = Deno.env.get("PEOPLEFONE_API_KEY");
  if (!apiKey) return json({ error: "PEOPLEFONE_API_KEY fehlt" }, 500);
  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  // peoplefone gibt Schluessel pro Bereich aus: unser Call-Management-Schluessel
  // darf die Configuration API NICHT lesen (403, 2026-07-29 verifiziert).
  // Reihenfolge: Supabase-Secret -> in den Einstellungen hinterlegter Schluessel
  // (integration_secrets, via Edge Function telefonie-zugang) -> alter Schluessel.
  // Der letzte Schritt laesst hoechstens "targets" scheitern, nie das Verbinden.
  async function holeKonfigSchluessel(): Promise<string> {
    const ausSecret = Deno.env.get("PEOPLEFONE_CONFIG_API_KEY");
    if (ausSecret) return ausSecret;
    try {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      const { data } = await admin
        .from("integration_secrets").select("value")
        .eq("name", "peoplefone_config_api_key").maybeSingle();
      if (typeof data?.value === "string" && data.value.length > 0) return data.value;
    } catch { /* egal -- dann eben der Rueckfall */ }
    return apiKey;
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* leer */ }

  if (body.action === "targets") {
    const configKey = await holeKonfigSchluessel();
    const configAuth = { Authorization: `Bearer ${configKey}`, "Content-Type": "application/json" };
    const res = await fetch(`${CONFIG_BASE}/users`, { headers: configAuth });
    if (!res.ok) {
      return json({
        error: "peoplefone users nicht lesbar",
        status: res.status,
        hinweis: res.status === 403
          ? "Schluessel hat keine Berechtigung fuer die Configuration API"
          : undefined,
      }, 502);
    }
    const data = await res.json();
    const users = Array.isArray(data) ? data : (data?.items ?? data?.users ?? []);
    // Nur echte vPBX-Benutzer (hosted gesetzt); eigene Nebenstelle rausfiltern
    // macht die UI (die kennt den Kontext besser).
    const targets = (users as Record<string, unknown>[])
      .filter((u) => u && u.hosted)
      .map((u) => ({
        peoplefoneId: String(u.identifier ?? ""),
        name: String(u.name ?? ""),
        internalNumber: String((u.hosted as Record<string, unknown>)?.internalNumber ?? ""),
      }))
      .filter((t) => t.internalNumber);
    return json({ targets });
  }

  if (body.action === "transfer") {
    const rawCallId = String(body.callId ?? "");
    const callId = rawCallId.replace(/^peoplefone-/, "");
    const destination = String(body.destination ?? "").replace(/[^\d+*#]/g, "");
    if (!callId || !destination) return json({ error: "callId und destination noetig" }, 400);
    const res = await fetch(`${CALL_BASE}/call/blind-transfer`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        owner: { type: "user", identifier: OWNER_USER_ID },
        callId,
        destination: { type: "number", identifier: destination },
      }),
    });
    const text = await res.text();
    console.log("blind-transfer:", res.status, "dest:", destination.slice(-3).padStart(destination.length, "…"));
    if (!res.ok) return json({ error: "Transfer abgelehnt", status: res.status, body: text.slice(0, 300) }, 502);
    return json({ ok: true });
  }

  return json({ error: "unbekannte action" }, 400);
});
