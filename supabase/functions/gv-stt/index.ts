/**
 * gv-stt — Proxy für ElevenLabs Speech-to-Text (GV-Protokoll-App)
 *
 * Hält den ElevenLabs-Key SERVERSEITIG (Supabase-Secret ELEVENLABS_API_KEY),
 * damit die öffentliche GV-App (smartis.me/gv-protokoll/) keinen Key im
 * Client braucht. Der Request-Body (multipart mit Audiodatei) wird ohne
 * Zwischenpufferung an ElevenLabs durchgestreamt.
 *
 * Secret setzen:
 *   supabase secrets set ELEVENLABS_API_KEY=sk_… --project-ref <ref>
 * Deploy:
 *   supabase functions deploy gv-stt --project-ref <ref>
 *
 * Hinweis: Sehr lange Einzel-Uploads (z.B. 2h am Stück) können an das
 * Wall-Clock-Limit der Edge Function stossen. Die laufende Zwischen-
 * Transkription der App mildert das ab; für Produktiv ggf. Timeout prüfen.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

  console.log("Function will start::")

  const KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!KEY) return jsonResp({ error: "ELEVENLABS_API_KEY nicht gesetzt (Supabase-Secret fehlt)" }, 500);

  try {
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": KEY,
        "content-type": req.headers.get("content-type") || "multipart/form-data",
      },
      body: req.body,
      duplex: "half",
    });
    const txt = await r.text();
    return new Response(txt, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return jsonResp({ error: "Proxy-Fehler: " + String((e as Error)?.message || e) }, 502);
  }
});
