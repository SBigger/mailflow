/**
 * gv-stt — Proxy für Suisse Notes Speech-to-Text (GV-Protokoll-App)
 *
 * Schweizerdeutsch-Transkription MIT Sprecher-Trennung (Diarization).
 * Ersetzt den früheren ElevenLabs-Weg, dessen Mundart-Erkennung schwach war.
 *
 * Der SUISSE_NOTES_API_KEY liegt SERVERSEITIG (Supabase-Secret), weil Suisse
 * Notes keine Browser-Aufrufe erlaubt (CORS) und der Key nicht in den Client darf.
 *
 * Zwei Modi (der Client wählt über den Content-Type):
 *   - multipart POST (Feld "file" [+ "language"])  → Upload zu /api/v1/transcribe,
 *                                                     Antwort enthält { id, status }
 *   - JSON POST { "id": "<transcription_id>" }      → Status/Ergebnis von
 *                                                     /api/v1/transcriptions/{id}
 *
 * Secret setzen:
 *   supabase secrets set SUISSE_NOTES_API_KEY=sk_live_… --project-ref <ref>
 * Deploy:
 *   supabase functions deploy gv-stt --project-ref <ref>
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SN_BASE = "https://app.suisse-notes.ch/api/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonResp = (b: object, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResp({ error: "Nur POST" }, 405);

  const KEY = Deno.env.get("SUISSE_NOTES_API_KEY");
  if (!KEY) return jsonResp({ error: "SUISSE_NOTES_API_KEY nicht gesetzt (Supabase-Secret fehlt)" }, 500);

  const contentType = req.headers.get("content-type") || "";

  try {
    // ─── Status/Ergebnis abrufen (JSON-Body { id }) ─────────────────────
    if (contentType.includes("application/json")) {
      let body: { id?: string };
      try {
        body = await req.json();
      } catch {
        return jsonResp({ error: "Ungültiger JSON-Body" }, 400);
      }
      const id = body.id;
      if (!id) return jsonResp({ error: "Feld 'id' fehlt" }, 400);

      const r = await fetch(`${SN_BASE}/transcriptions/${encodeURIComponent(id)}`, {
        headers: { "Authorization": `Bearer ${KEY}` },
      });
      const txt = await r.text();
      return new Response(txt, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── Audio hochladen (multipart, Feld "file") ───────────────────────
    // Body wird ohne Zwischenpufferung durchgestreamt (inkl. Content-Type mit
    // Multipart-Boundary), nur der Authorization-Header kommt dazu.
    const r = await fetch(`${SN_BASE}/transcribe`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KEY}`,
        "content-type": contentType || "multipart/form-data",
      },
      body: req.body,
      duplex: "half",
    } as RequestInit);
    const txt = await r.text();
    return new Response(txt, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return jsonResp({ error: "Proxy-Fehler: " + String((e as Error)?.message || e) }, 502);
  }
});
