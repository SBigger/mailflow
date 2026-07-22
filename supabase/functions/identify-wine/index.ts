/**
 * identify-wine
 * =============
 * Erkennt einen Wein anhand eines Etikett-Fotos per Vision-LLM.
 * Gibt strukturierte Felder zurück: { name, winzer, jahrgang, rebsorte, region, land }.
 *
 * Request:  POST { image: <base64 ohne data:-Präfix>, mimeType?: string }
 * Response: { ok, name, winzer, jahrgang, rebsorte, region, land, modell } | { ok:false, fehler }
 *
 * Deployment:  npx supabase functions deploy identify-wine
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROMPT = `Du erkennst Weine anhand eines Fotos des Flaschenetiketts.
Extrahiere aus dem Bild:
- name: Name des Weins/der Cuvée (ohne Winzer, ohne Jahrgang)
- winzer: Produzent / Weingut / Kellerei
- jahrgang: Jahrgang als Zahl (z.B. 2019), wenn nicht erkennbar: null
- rebsorte: Rebsorte(n), z.B. "Pinot Noir" oder "Cabernet Sauvignon, Merlot" (wenn nicht erkennbar: leer)
- region: Anbauregion / Appellation, z.B. "Bordeaux" oder "Wallis" (wenn nicht erkennbar: leer)
- land: Herkunftsland, z.B. "Frankreich", "Schweiz", "Italien"
Wenn das Bild kein Weinetikett zeigt oder nichts lesbar ist, setze alle Felder auf leer/null.
Antworte AUSSCHLIESSLICH mit reinem JSON ohne Markdown:
{"name":"...","winzer":"...","jahrgang":2019,"rebsorte":"...","region":"...","land":"..."}`;

function extractJson(text: string) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
    const image: string = typeof body.image === 'string' ? body.image.replace(/^data:[^,]+,/, '') : '';
    const mime: string  = body.mimeType || 'image/jpeg';
    if (!image) return json({ ok: false, fehler: 'Kein Bild übermittelt' }, 400);

    const geminiKey    = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
    const openaiKey    = Deno.env.get('OPENAI_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!geminiKey && !openaiKey && !anthropicKey) {
      return json({ ok: false, fehler: 'Kein KI-Schlüssel konfiguriert' }, 500);
    }

    let raw = '', modell = '';

    // ── Gemini (schnell) ──
    if (!raw && geminiKey) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [
              { inline_data: { mime_type: mime, data: image } },
              { text: PROMPT },
            ] }] }) });
        if (r.ok) {
          const d = await r.json();
          raw = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          modell = 'gemini-2.5-flash';
        }
      } catch (_) { /* fallback */ }
    }

    // ── OpenAI ──
    if (!raw && openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4.1-mini', max_tokens: 400,
            messages: [{ role: 'user', content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
            ] }],
          }),
        });
        if (r.ok) {
          const d = await r.json();
          raw = d?.choices?.[0]?.message?.content ?? '';
          modell = 'gpt-4.1-mini';
        }
      } catch (_) { /* fallback */ }
    }

    // ── Claude ──
    if (!raw && anthropicKey) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5', max_tokens: 400,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
              { type: 'text', text: PROMPT },
            ] }],
          }),
        });
        if (r.ok) {
          const d = await r.json();
          raw = d?.content?.[0]?.text ?? '';
          modell = 'claude-haiku-4-5';
        }
      } catch (_) { /* fallback */ }
    }

    const parsed = extractJson(raw);
    if (!parsed) return json({ ok: false, fehler: 'Etikett konnte nicht gelesen werden' });

    const jahrgangNum = parseInt(String(parsed.jahrgang), 10);
    return json({
      ok: true, modell,
      name:     String(parsed.name || '').slice(0, 120),
      winzer:   String(parsed.winzer || '').slice(0, 120),
      jahrgang: Number.isFinite(jahrgangNum) && jahrgangNum > 1800 && jahrgangNum < 2100 ? jahrgangNum : null,
      rebsorte: String(parsed.rebsorte || '').slice(0, 160),
      region:   String(parsed.region || '').slice(0, 120),
      land:     String(parsed.land || '').slice(0, 80),
    });
  } catch (e) {
    return json({ ok: false, fehler: String(e?.message ?? e) }, 500);
  }
});
