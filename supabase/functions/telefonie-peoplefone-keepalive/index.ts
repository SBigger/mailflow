// ══════════════════════════════════════════════════════════════════════
// telefonie-peoplefone-keepalive -- haelt die peoplefone-Subscription am Leben
//
// PROBLEM (belegt 2026-07-25/26): Die Call-Management-Subscription stirbt
// nach kurzer Zeit leise weg. Beobachtet: am 25.07. um 15:15 registriert,
// um 15:54 lieferte sie noch einen kompletten Anruf (setup -> early ->
// terminated, owner 163879) -- danach kam NIE wieder ein Request, nicht
// mal die laut Spec periodischen keepAlive-Pings. Beim naechsten echten
// Anruf am 26.07. kam nichts mehr an.
// Der Tod ist NICHT beobachtbar: peoplefone loescht die Subscription, sobald
// EIN Zustellversuch fehlschlaegt (Spec: "if not [200] the subscription will
// be removed") -- ein fehlgeschlagener Versuch erreicht uns per Definition
// nie, also steht in unseren Logs auch kein Fehler.
//
// ⚠️ 26.07.: die Spec verspricht "gleiche callbackUrl -> gleiche ID zurueck,
// kein Effekt". In der Praxis kam bei ZWEI Laeufen im Abstand von 7 Minuten
// JEDES MAL eine NEUE ID zurueck -- die "kein Effekt"-Zusage stimmt fuer
// unseren Account offenbar nicht (oder die Subscription stirbt schneller
// als 5 Minuten). Ein simples "alle 5 Min neu registrieren" wuerde also
// nicht no-op bleiben, sondern Dutzende Subscriptions pro Stunde anhaeufen
// -> Risiko: peoplefone liefert irgendwann jedes Ereignis mehrfach.
//
// LOESUNG: eigene Buchhaltung statt der (nicht verlaesslichen) Zusage aus
// der Spec vertrauen. Tabelle public.telefonie_subscription merkt sich die
// zuletzt bekannte ID. Jeder Lauf: neue Subscription anlegen, NEUE ID
// speichern, dann die VORHERIGE ID explizit per DELETE entfernen (falls
// unterschiedlich). So existiert zu jedem Zeitpunkt maximal eine zusaetzliche
// (auslaufende) Subscription, nie ein unbegrenztes Anhaeufen.
//
// Aufruf per Supabase Cron (pg_cron + pg_net), alle 5 Minuten.
// Deploy: supabase functions deploy telefonie-peoplefone-keepalive
// ══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Numerische peoplefone-User-ID (NICHT der SIP-Benutzername!) -- siehe
// ausfuehrliche Begruendung im Kommentar von telefonie-peoplefone-webhook.
const OWNER_USER_ID = "163879"; // "Bigger", vPBX-Benutzer, interne Nr. 20
const PROVIDER = "peoplefone";
const BASE = "https://call-api.peoplefone.com/customer/call-management/v1";

serve(async () => {
  const apiKey = Deno.env.get("PEOPLEFONE_API_KEY");
  const webhookSecret = Deno.env.get("PEOPLEFONE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !webhookSecret || !supabaseUrl || !serviceKey) {
    console.error("keepalive: Secrets fehlen");
    return new Response(JSON.stringify({ error: "secrets missing" }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // Zuletzt bekannte ID nachschlagen (fuer den Aufraeum-Schritt am Ende).
  const { data: existing } = await supabase
    .from("telefonie_subscription")
    .select("subscription_id")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const previousId = existing?.subscription_id ?? null;

  // Neue Subscription anlegen (bzw. laut Spec ggf. die bestehende bestaetigen
  // -- verlaesslich ist das laut Beobachtung von heute aber nicht, siehe oben).
  const callbackUrl =
    `${supabaseUrl}/functions/v1/telefonie-peoplefone-webhook?secret=${encodeURIComponent(webhookSecret)}`;
  let newId: string | null = null;
  let subscribeResult: unknown;
  try {
    const res = await fetch(`${BASE}/subscription`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ owner: { identifier: OWNER_USER_ID, type: "user" }, callbackUrl }),
    });
    const text = await res.text();
    subscribeResult = { status: res.status, body: text.slice(0, 300) };
    if (res.ok) {
      try { newId = JSON.parse(text)?.id ?? null; } catch { /* ignore */ }
    }
  } catch (e) {
    subscribeResult = { error: String(e) };
  }

  // Neue ID sofort sichern, BEVOR die alte geloescht wird -- sonst koennten
  // wir bei einem Absturz dazwischen ganz ohne gespeicherte ID dastehen.
  if (newId) {
    await supabase.from("telefonie_subscription").upsert({
      provider: PROVIDER,
      subscription_id: newId,
      updated_at: new Date().toISOString(),
    });
  }

  // Alte Subscription aufraeumen, falls es tatsaechlich eine neue ID gab.
  // ⚠️ Bewusst "Best Effort": peoplefone antwortet auf das DELETE oft mit
  // 419 "Too Many Attempts" -- selbst bei einem voellig natuerlichen,
  // unforcierten 5-Minuten-Cron-Lauf (live beobachtet 2026-07-26, auch mit
  // 1.5s Pause). Die Drosselung greift offenbar gezielt bei aufeinander-
  // folgenden Subscription-Aenderungen desselben Owners, nicht nur bei
  // allgemeiner API-Last -- laengere Pausen halfen nicht zuverlaessig.
  // Schlaegt das Loeschen fehl, bleibt genau diese eine alte Subscription
  // dauerhaft verwaist (der naechste Lauf versucht nur noch die DANN
  // aktuelle zu loeschen, nicht diese) -- peoplefones eigenes natuerliches
  // Absterben raeumt sie im Zweifel selbst auf. Tolerierbar (hoechstens
  // zeitweise doppelt zugestellte Ereignisse, kein Totalausfall) und kein
  // Grund, den ganzen Lauf als Fehler zu werten.
  let deleteResult: unknown = null;
  if (newId && previousId && previousId !== newId) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${BASE}/subscription/${previousId}`, { method: "DELETE", headers: auth });
      deleteResult = { id: previousId, status: res.status };
    } catch (e) {
      deleteResult = { id: previousId, error: String(e) };
    }
  }

  const summary = { previousId, newId, subscribeResult, deleteResult };
  console.log("keepalive:", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
