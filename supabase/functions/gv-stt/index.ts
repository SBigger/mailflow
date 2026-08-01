/**
 * gv-stt — Speech-to-Text-Proxy für die GV-Protokoll-App
 *
 * Hält die API-Keys SERVERSEITIG, damit die App keine Keys im Client braucht.
 *
 * ZWEI ANBIETER, umschaltbar über den Header `x-stt-provider`:
 *
 *   "elevenlabs" (Standard)  → ElevenLabs scribe_v2
 *       Synchron: multipart rein, fertiges Transkript raus. Der Client baut den
 *       Body komplett selbst (model_id, diarize, num_speakers, keyterms) — wir
 *       streamen ihn nur durch und hängen den Key an.
 *
 *   "suisse"                 → Suisse Notes
 *       Asynchron: multipart → /api/v1/transcribe liefert { id }, danach
 *       JSON { id } → /api/v1/transcriptions/{id} pollen.
 *
 * Warum ElevenLabs der Standard ist (A/B-Test 01.08.2026, dieselben 10 Min.
 * einer echten Sitzung, 3 Sprecher, Schweizerdeutsch):
 *   ElevenLabs 1661 Wörter / 19 s · Suisse Notes 1605 Wörter / 110 s
 *   ElevenLabs trifft Schweizer Namen ("Reto" statt "Rektor") und Redewendungen
 *   ("an einem Strick ziehen") deutlich besser und behält die Mundartfärbung,
 *   während Suisse Notes durchgehend zu Hochdeutsch normalisiert.
 *   Suisse Notes bleibt als Umschalter drin, um das nachprüfen zu können.
 *
 * Secrets setzen:
 *   supabase secrets set ELEVENLABS_API_KEY=sk_…     --project-ref <ref>
 *   supabase secrets set SUISSE_NOTES_API_KEY=sk_…   --project-ref <ref>
 * Deploy:
 *   supabase functions deploy gv-stt --project-ref <ref>
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SN_BASE = "https://app.suisse-notes.ch/api/v1";
const EL_URL = "https://api.elevenlabs.io/v1/speech-to-text";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-stt-provider",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonResp = (b: object, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const passThrough = (txt: string, status: number) =>
  new Response(txt, { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResp({ error: "Nur POST" }, 405);

  const provider = (req.headers.get("x-stt-provider") || "elevenlabs").toLowerCase();
  const contentType = req.headers.get("content-type") || "";

  try {
    // ─── Suisse Notes ───────────────────────────────────────────────────
    if (provider === "suisse") {
      const KEY = Deno.env.get("SUISSE_NOTES_API_KEY");
      if (!KEY) return jsonResp({ error: "SUISSE_NOTES_API_KEY nicht gesetzt (Supabase-Secret fehlt)" }, 500);

      // Status/Ergebnis abrufen (JSON-Body { id })
      if (contentType.includes("application/json")) {
        let body: { id?: string };
        try {
          body = await req.json();
        } catch {
          return jsonResp({ error: "Ungültiger JSON-Body" }, 400);
        }
        if (!body.id) return jsonResp({ error: "Feld 'id' fehlt" }, 400);
        const r = await fetch(`${SN_BASE}/transcriptions/${encodeURIComponent(body.id)}`, {
          headers: { "Authorization": `Bearer ${KEY}` },
        });
        return passThrough(await r.text(), r.status);
      }

      // Audio hochladen (multipart, Feld "file")
      const r = await fetch(`${SN_BASE}/transcribe`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${KEY}`, "content-type": contentType || "multipart/form-data" },
        body: req.body,
        duplex: "half",
      } as RequestInit);
      return passThrough(await r.text(), r.status);
    }

    // ─── ElevenLabs (Standard) ──────────────────────────────────────────
    const KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!KEY) return jsonResp({ error: "ELEVENLABS_API_KEY nicht gesetzt (Supabase-Secret fehlt)" }, 500);
    if (contentType.includes("application/json"))
      return jsonResp({ error: "ElevenLabs antwortet synchron – es gibt nichts zu pollen." }, 400);

    // Body ohne Zwischenpufferung durchstreamen (inkl. Multipart-Boundary),
    // nur der Key kommt dazu.
    const r = await fetch(EL_URL, {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": contentType || "multipart/form-data" },
      body: req.body,
      duplex: "half",
    } as RequestInit);
    return passThrough(await r.text(), r.status);
  } catch (e) {
    return jsonResp({ error: "Proxy-Fehler: " + String((e as Error)?.message || e) }, 502);
  }
});
