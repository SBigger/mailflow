/**
 * fibu-kassenbeleg-ocr
 * ====================
 * Liest einen Kassenbeleg / eine Quittung per Vision-LLM aus – auch
 * HANDSCHRIFTLICH. Gibt strukturierte Felder für die Kassenbuch-Erfassung
 * zurück: { datum, betrag, beschreibung, typ }.
 *
 * Request:  POST { image: <base64 ohne data:-Präfix>, mimeType?: string }
 * Response: { ok, datum, betrag, beschreibung, typ, modell } | { ok:false, fehler }
 *
 * Deployment:  npx supabase functions deploy fibu-kassenbeleg-ocr
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROMPT = `Du liest Schweizer Kassenbelege, Quittungen und Kassenzettel – auch HANDSCHRIFTLICHE.
Extrahiere aus dem Bild:
- datum: Belegdatum als YYYY-MM-DD (wenn unklar: leer)
- betrag: der Gesamtbetrag als Zahl mit Punkt (z.B. 24.50), ohne Währung
- beschreibung: kurz, was gekauft/eingenommen wurde (max 60 Zeichen)
- typ: "ausgabe" bei Einkauf/Quittung/Spesen, "einnahme" bei einer Bareinnahme
Antworte AUSSCHLIESSLICH mit reinem JSON ohne Markdown:
{"datum":"YYYY-MM-DD","betrag":0.00,"beschreibung":"...","typ":"ausgabe"}`;

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
            model: 'gpt-4.1-mini', max_tokens: 600,
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
            model: 'claude-haiku-4-5', max_tokens: 600,
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
    if (!parsed) return json({ ok: false, fehler: 'Beleg konnte nicht gelesen werden' });

    const betrag = parseFloat(String(parsed.betrag).replace(/[^\d.]/g, '')) || 0;
    return json({
      ok: true, modell,
      datum:        /^\d{4}-\d{2}-\d{2}$/.test(parsed.datum) ? parsed.datum : null,
      betrag,
      beschreibung: String(parsed.beschreibung || '').slice(0, 80),
      typ:          parsed.typ === 'einnahme' ? 'einnahme' : 'ausgabe',
    });
  } catch (e) {
    return json({ ok: false, fehler: String(e?.message ?? e) }, 500);
  }
});
