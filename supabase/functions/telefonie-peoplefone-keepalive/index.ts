// ══════════════════════════════════════════════════════════════════════
// telefonie-peoplefone-keepalive -- haelt die peoplefone-Subscription am Leben
//
// PROBLEM (belegt 2026-07-25/26): Die Call-Management-Subscription stirbt
// nach kurzer Zeit leise weg. Der Tod ist NICHT beobachtbar: peoplefone
// loescht sie, sobald EIN Zustellversuch nicht mit HTTP 200 beantwortet
// wird (Spec: "if not [200] the subscription will be removed") -- ein
// fehlgeschlagener Versuch erreicht unsere Logs per Definition nie. Es
// gibt auch KEINEN GET-Endpoint, um den Subscription-Status abzufragen.
// Darum: alle 5 Minuten stumpf neu registrieren (Cron siehe
// supabase/cron/telefonie-keepalive-cron.sql).
//
// ⚠️ Die Spec verspricht "gleiche callbackUrl -> gleiche ID zurueck, kein
// Effekt" -- stimmt fuer unseren Account nachweislich nicht (26.07.: jeder
// Lauf lieferte eine NEUE ID). Ohne Aufraeumen haeufen sich also
// Subscriptions an, und JEDE stellt zu -> Ereignisse kaemen mehrfach.
//
// DESIGN (Umbau 2026-07-26 nach externem Review): fruher merkte sich eine
// Ein-Zeilen-Tabelle nur die NEUESTE ID -- schlug deren Loeschung fehl
// (peoplefone antwortet haeufig 419 "Too Many Attempts", undokumentiert),
// war die ID beim naechsten Lauf vergessen und die Subscription dauerhaft
// verwaist. Verwaiste sterben NICHT von selbst: sie zeigen ja auf denselben
// funktionierenden Webhook und stellen erfolgreich zu.
// Jetzt: public.telefonie_subscriptions, EINE Zeile PRO jemals erzeugter
// Subscription. Geloescht gilt erst nach Bestaetigung durch peoplefone
// (2xx oder 404 = schon weg) -> cleaned_up_at. Jeder Lauf raeumt ALLE noch
// unbestaetigten alten IDs auf (max. MAX_CLEANUPS_PER_RUN, Rest beim
// naechsten Lauf) -- ein 419 verschiebt das Loeschen also nur, statt die
// ID zu verlieren.
//
// Kein Lock gegen parallele Laeufe: Cron alle 5 Min, ein Lauf dauert
// Sekunden -- Ueberschneidung praktisch ausgeschlossen, und selbst dann
// entstuende nur eine zusaetzliche getrackte (aufraeumbare) Subscription.
//
// Deploy: supabase functions deploy telefonie-peoplefone-keepalive
// (MIT JWT-Pruefung -- der Cron ruft mit anon-Key-Bearer auf.)
// ══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Numerische peoplefone-User-ID (NICHT der SIP-Benutzername!) -- siehe
// ausfuehrliche Begruendung im Kommentar von telefonie-peoplefone-webhook.
const OWNER_USER_ID = "163879"; // "Bigger", vPBX-Benutzer, interne Nr. 20
const PROVIDER = "peoplefone";
const BASE = "https://call-api.peoplefone.com/customer/call-management/v1";
const MAX_CLEANUPS_PER_RUN = 5; // Drosselungs-Schutz: Rest beim naechsten Lauf
const DELETE_SPACING_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // Ein Loeschversuch inkl. Buchhaltung. 2xx/404 = bestaetigt weg.
  // Beim 419 den Retry-After-Header mitloggen -- peoplefone dokumentiert
  // seine Drosselung nirgends, vielleicht verraet der Header das Fenster.
  const cleanups: unknown[] = [];
  async function tryCleanup(id: string) {
    try {
      const res = await fetch(`${BASE}/subscription/${id}`, { method: "DELETE", headers: auth });
      const confirmed = res.ok || res.status === 404;
      const retryAfter = res.headers.get("retry-after");
      cleanups.push({ id, status: res.status, confirmed, ...(retryAfter ? { retryAfter } : {}) });
      if (confirmed) {
        const { error } = await supabase
          .from("telefonie_subscriptions")
          .update({ cleaned_up_at: new Date().toISOString() })
          .eq("subscription_id", id);
        if (error) console.error("keepalive: cleaned_up_at setzen fehlgeschlagen:", id, error.message);
      }
    } catch (e) {
      cleanups.push({ id, error: String(e) });
    }
  }

  // 1) ZUERST aufraeumen, DANN neu registrieren (Umstellung 2026-07-26,
  // zweiter Anlauf): in der alten Reihenfolge (POST, 3s spaeter DELETE) lief
  // JEDES Loeschen in die 419-Drosselung -- die greift offenbar bei dicht
  // aufeinanderfolgenden Subscription-Aenderungen desselben Owners. Am
  // LAUF-ANFANG liegt der letzte Schreibzugriff dagegen ~5 Minuten zurueck
  // (voriger Cron-Lauf) -- beste Karten fuer den ersten DELETE.
  // ⚠️ Die JUENGSTE noch aktive Subscription wird hier bewusst VERSCHONT:
  // sie ist unser aktuell einziger funktionierender Empfangsweg -- erst
  // loeschen, wenn die Nachfolgerin erfolgreich angelegt ist (Schritt 3),
  // sonst risse ein fehlgeschlagener POST eine Empfangsluecke bis zum
  // naechsten Lauf.
  const { data: stale, error: readError } = await supabase
    .from("telefonie_subscriptions")
    .select("subscription_id")
    .is("cleaned_up_at", null)
    .order("created_at", { ascending: true });
  if (readError) console.error("keepalive: Lesen alter IDs fehlgeschlagen:", readError.message);
  const staleIds = (stale ?? []).map((r) => r.subscription_id as string);
  const previousActive = staleIds.pop() ?? null; // juengste = aktuell aktive
  for (const [i, id] of staleIds.slice(0, MAX_CLEANUPS_PER_RUN).entries()) {
    if (i > 0) await sleep(DELETE_SPACING_MS);
    await tryCleanup(id);
  }

  // 2) Neue Subscription anlegen.
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

  // 3) Neue ID SOFORT als eigene Zeile sichern -- ein Absturz danach kostet
  // so nie das Wissen ueber eine erzeugte Subscription. Schlaegt das Sichern
  // fehl, ist genau DAS der Fall, den dieses Design verhindern soll --
  // deshalb laut loggen und als Fehler im Ergebnis ausweisen.
  let trackError: string | null = null;
  if (newId) {
    const { error } = await supabase.from("telefonie_subscriptions").upsert(
      { subscription_id: newId, provider: PROVIDER },
      { onConflict: "subscription_id", ignoreDuplicates: true },
    );
    if (error) {
      trackError = error.message;
      console.error("keepalive: NEUE ID KONNTE NICHT GESPEICHERT WERDEN:", newId, error.message);
    }
  }

  // 4) Die bisher aktive Vorgaengerin jetzt loeschen -- die Nachfolgerin
  // steht (sofern der POST klappte). Faellt der Versuch in die Drosselung
  // (419), holt Schritt 1 des NAECHSTEN Laufs sie mit besserem Timing nach.
  if (previousActive && newId && previousActive !== newId) {
    await sleep(DELETE_SPACING_MS);
    await tryCleanup(previousActive);
  }

  const summary = { newId, subscribeResult, trackError, cleanups };
  console.log("keepalive:", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    status: newId && !trackError ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
