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
// ⚠️⚠️ owner.identifier = NUMERISCHE peoplefone-User-ID, NICHT der
// SIP-Benutzername! (Root Cause des Totalausfalls 2026-07-22..25.)
// Die Doku sagt woertlich "identifier: user_id"; das Schema kennt `user`
// UND `sipUsername` als ZWEI VERSCHIEDENE Entity-Typen. Wir hatten die
// Subscription monatelang auf "90746408026" (SIP-Benutzername) registriert:
// der Endpoint akzeptiert das mit HTTP 201 und schickt sogar EINEN initialen
// Status-Snapshot, bindet aber nie an einen echten Benutzer -> danach kommt
// NIE ein Call-Event. Genau unser Symptom, und extrem irrefuehrend.
// Per Config API bewiesen (GET configuration-api.peoplefone.com/customer/
// voip/v1/users [+ /{id} fuers Detail], Scope "Configuration"):
//   identifier 163879 = "Bigger", hosted.internalNumber "20",
//   lineSettings.lines[].sipUserName "90746408026"   <- DAS ist der Benutzer
//   identifier 8608/8609/8610 = vFax/smartis phone/Operator Connect,
//   alle mit hosted == null  ->  STANDARD-Linien, fuer Call Management laut
//   Doku NICHT nutzbar (nur vPBX/HOSTED-Benutzer).
// Aktive Subscription seit 2026-07-25: db14dfe1-c0c9-47b6-8fd0-26cf7cdbeb20
//
// ⚠️ Beim Neu-Registrieren: laut Spec liefert ein POST /subscription mit einer
// BEREITS benutzten callbackUrl nur die bestehende ID zurueck und aendert
// nichts. Eine kaputte Subscription MUSS also zuerst per DELETE /subscription/
// {id} weg, sonst repariert das erneute Registrieren gar nichts (genau darauf
// bin ich am 2026-07-25 zuerst reingefallen).
//
// Ziel-Mitarbeiter: aktuell nur EINE Subscription (Sascha), darum bewusst
// KEIN Matching-Aufwand -- targetUserId bleibt null (Broadcast an alle
// verbundenen Clients, identisch zum alten Rufgruppen-Fallback). Sobald
// weitere Mitarbeitende eigene Subscriptions bekommen: rawBody.owner.identifier
// (die numerische User-ID, s.o.) gegen eine neue Zuordnung mappen -- NICHT
// gegen profiles.phone (andere Nummernwelt).
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
// { owner: { identifier: "163879", type: "user" },   // numerische User-ID, s.o.!
//   callbackUrl: "<SUPABASE_URL>/functions/v1/telefonie-peoplefone-webhook?secret=<PEOPLEFONE_WEBHOOK_SECRET>" }
// (Seit 2026-07-26 macht das die Function telefonie-peoplefone-keepalive
// ohnehin alle 5 Min automatisch per pg_cron -- manuell nur noch noetig,
// falls auch der Cron/die Keepalive-Function selbst tot sein sollte.)
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

// Telefonnummern in Logs maskieren (Review 2026-07-26: personenbezogene
// Daten). 7+ zusammenhaengende Ziffern = praktisch sicher eine Rufnummer;
// die hexadezimalen callIds (kurze Ziffernlaeufe) bleiben lesbar, damit die
// Logs als Debug-Werkzeug taugen (haben heute 3x den Tag gerettet).
function maskNumbers(s: string): string {
  return s.replace(/\d{7,}/g, (m) => "…" + m.slice(-3));
}

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
  // Fail-closed (Review 2026-07-26): fehlt das Secret in der Umgebung
  // (Fehlkonfiguration), NICHT alles offen durchwinken, sondern hart
  // ablehnen -- lieber verlieren wir Zustellungen (peoplefone raeumt die
  // Subscription dann weg), als dass die oeffentlich erreichbare Function
  // beliebige gefaelschte Anruf-Events akzeptiert.
  if (!secret) {
    console.error("PEOPLEFONE_WEBHOOK_SECRET fehlt -- Webhook verweigert alle Anfragen");
    return json({ error: "misconfigured" }, 500);
  }
  if (url.searchParams.get("secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await req.json();
  } catch {
    return json({ ok: true }); // leerer/fehlender Body -- trotzdem 200, sonst faellt die Subscription weg
  }
  console.log("telefonie-peoplefone-webhook rawBody:", maskNumbers(JSON.stringify(rawBody)));

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

  // ── Gezieltes Routing (Rollout-Vorbereitung 2026-07-26) ──────────────────
  // owner.identifier ist die numerische peoplefone-User-ID. Ueber die im
  // Einstellungen-Tab "Telefonie" gepflegte Zuordnung finden wir das smartis-
  // Profil und adressieren die Karte gezielt -- bisher ging jeder Anruf an
  // ALLE verbundenen Clients (targetUserId: null), was mit mehreren
  // Mitarbeitenden nicht mehr geht.
  // Bewusst mit Fallback null: ist niemand zugeordnet (oder die Spalte noch
  // leer), verhaelt sich alles exakt wie bisher -- lieber eine Karte zu viel
  // als ein verpasster Anruf.
  const ownerId = (rawBody.owner as Record<string, unknown> | undefined)?.identifier;
  let targetUserId: string | null = null;
  if (ownerId) {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .eq("peoplefone_user_id", String(ownerId))
        .maybeSingle();
      targetUserId = prof?.id ?? null;
    } catch (e) {
      console.error("Profil-Zuordnung fehlgeschlagen:", e);
    }
  }
  if (!targetUserId) console.log("kein Profil fuer owner", String(ownerId ?? ""), "-- Karte geht an alle");

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

    // Dossier-Kurzfassung (offene Pendenzen + letzte Dokumente) direkt in den
    // Broadcast packen (Sascha-Entscheid 2026-07-26): die Electron-Karte hat
    // keinen eigenen Login (anon-Key, RLS verlangt authenticated) und soll
    // die Kundendaten trotzdem OHNE offenen Browser zeigen -- also liefert
    // der Webhook sie serverseitig (service_role) gleich mit. Nur fuer
    // ringing/answered -- bei ended blendet die Karte ohnehin gleich aus.
    let dossier: { pendenzen: unknown[]; docs: unknown[] } | null = null;
    if (match && callStatus !== "ended") {
      try {
        const [t, d] = await Promise.all([
          supabase.from("tasks").select("id,title,due_date").eq("customer_id", match.customerId)
            .eq("completed", false).order("due_date", { ascending: true }).limit(3),
          supabase.from("dokumente").select("id,name,filename,updated_at").eq("customer_id", match.customerId)
            .order("updated_at", { ascending: false }).limit(3),
        ]);
        dossier = { pendenzen: t.data ?? [], docs: d.data ?? [] };
      } catch (e) {
        console.error("dossier lookup failed:", e);
      }
    }

    const callPayload = {
      id: "peoplefone-" + (entry.callId || Date.now()),
      dir: entry.direction === "outgoing" ? "out" : "in",
      status: callStatus,
      peerNumber: remoteParty,
      peerName: match?.contactName || null,
      customer: match ? { id: match.customerId, company_name: match.label } : null,
      dossier,
      viaNumber: null,
    };
    const bc = await broadcastRealtime(supabaseUrl, serviceKey, "telefonie-calls", "incoming_call", {
      targetUserId,
      call: callPayload,
    });
    if (!bc.ok) console.error("broadcast failed:", bc.status, bc.body);
  }

  return json({ ok: true });
});
