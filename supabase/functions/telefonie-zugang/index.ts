// ===========================================================================
// telefonie-zugang -- Zugangsdaten der Telefonanlage aus den Einstellungen
// pflegen, ohne sie je wieder herauszugeben.
//
// Sascha-Wunsch 2026-07-29: "brauchst du peoplefone nicht auch fuers login,
// das muesste doch in die einstellungen". Stimmt -- aber der Schluessel darf
// dabei NICHT in system_settings landen: die Tabelle ist fuer jeden Admin
// lesbar, und ein Configuration-API-Schluessel kann die ganze Anlage umbauen.
//
// Darum: Ablage in integration_secrets (RLS an, keine Policy -> nur
// service_role), und diese Funktion als einziger Weg hinein.
//
// Aktionen (POST-Body { action: ... }):
//   { action: "status" }
//     -> [{ name, gesetzt, endetAuf, aktualisiertAm }] -- NIE der Wert selbst.
//   { action: "set", name, value }
//     -> speichert/ersetzt. name muss aus ERLAUBTE_NAMEN stammen.
//   { action: "delete", name }
//     -> entfernt den Eintrag (Rueckfall auf das Supabase-Secret).
//
// Auth: nur angemeldete Benutzer mit profiles.role = 'admin'. Die Rolle wird
// serverseitig mit service_role nachgeschlagen -- nicht aus dem JWT geglaubt.
//
// Deploy: supabase functions deploy telefonie-zugang
// ===========================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Bewusst eine feste Liste: sonst koennte ueber diese Funktion jedes beliebige
// Geheimnis ueberschrieben werden, sobald ein Admin-Konto kompromittiert ist.
const ERLAUBTE_NAMEN: Record<string, string> = {
  peoplefone_config_api_key: "peoplefone – Konfigurations-Bereich (Nebenstellen lesen)",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    },
  });

function benutzerAusToken(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (payload?.role !== "authenticated") return null;
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const benutzerId = benutzerAusToken(req);
  if (!benutzerId) return json({ error: "nur fuer angemeldete Benutzer" }, 403);

  // Rolle serverseitig pruefen -- das JWT sagt nichts ueber unsere Rollen aus.
  const { data: profil } = await supabase
    .from("profiles").select("role").eq("id", benutzerId).maybeSingle();
  if (profil?.role !== "admin") return json({ error: "nur fuer Administratoren" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* leer */ }

  if (body.action === "status") {
    const { data, error } = await supabase
      .from("integration_secrets").select("name, value, updated_at");
    if (error) return json({ error: error.message }, 500);

    const vorhanden = new Map((data ?? []).map((r) => [r.name, r]));
    const eintraege = Object.entries(ERLAUBTE_NAMEN).map(([name, beschreibung]) => {
      const r = vorhanden.get(name);
      const wert = typeof r?.value === "string" ? r.value : "";
      return {
        name,
        beschreibung,
        gesetzt: wert.length > 0,
        // Nur die letzten vier Zeichen -- genug zum Wiedererkennen, zu wenig
        // zum Missbrauchen.
        endetAuf: wert.length > 4 ? wert.slice(-4) : null,
        aktualisiertAm: r?.updated_at ?? null,
      };
    });
    return json({ eintraege });
  }

  if (body.action === "set") {
    const name = String(body.name ?? "");
    const value = String(body.value ?? "").trim();
    if (!(name in ERLAUBTE_NAMEN)) return json({ error: "unbekannter Eintrag" }, 400);
    if (value.length < 8) return json({ error: "Wert sieht nicht nach einem Schluessel aus" }, 400);

    const { error } = await supabase.from("integration_secrets").upsert({
      name, value, updated_at: new Date().toISOString(), updated_by: benutzerId,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, gespeichert: name });
  }

  if (body.action === "delete") {
    const name = String(body.name ?? "");
    if (!(name in ERLAUBTE_NAMEN)) return json({ error: "unbekannter Eintrag" }, 400);
    const { error } = await supabase.from("integration_secrets").delete().eq("name", name);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, geloescht: name });
  }

  return json({ error: "unbekannte Aktion" }, 400);
});
