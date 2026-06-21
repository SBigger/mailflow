/**
 * gv-llm — Proxy für Claude (Anthropic Messages API) für die GV-Protokoll-App
 *
 * Hält den Anthropic-Key SERVERSEITIG (Supabase-Secret ANTHROPIC_API_KEY).
 * Die App schickt denselben JSON-Body wie an /v1/messages (model, system,
 * messages, max_tokens, output_config…); der Key wird hier ergänzt.
 *
 * Secret setzen:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-… --project-ref <ref>
 * Deploy:
 *   supabase functions deploy gv-llm --project-ref <ref>
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

  const KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!KEY) return jsonResp({ error: "ANTHROPIC_API_KEY nicht gesetzt (Supabase-Secret fehlt)" }, 500);

  try {
    const body = await req.text();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    const txt = await r.text();
    return new Response(txt, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return jsonResp({ error: "Proxy-Fehler: " + String((e as Error)?.message || e) }, 502);
  }
});
