// KI-Auslesung des Blutdruck-Displays aus einem Foto.
// Unterstützt Gemini, OpenAI und Anthropic Claude – je nachdem,
// welcher API-Schlüssel in der .env hinterlegt ist.

const PROMPT = `Du liest das Display eines Blutdruckmessgeräts (z.B. Omron).
Gib AUSSCHLIESSLICH ein JSON-Objekt zurück – keine Erklärung, kein Markdown.

Felder:
- "systolic":  oberer Blutdruck (die GROSSE Zahl ganz oben, Label "SYS", Einheit mmHg). Ganzzahl.
- "diastolic": unterer Blutdruck (mittlere Zahl, Label "DIA", Einheit mmHg). Ganzzahl.
- "pulse":     Puls (untere Zahl, Label "PULSE", Einheit /min). Ganzzahl.
- "arrhythmia": true, wenn das Symbol für unregelmässigen Herzschlag / Herzrhythmusstörung
                angezeigt wird, sonst false.
                Lage des Symbols bei diesem Omron-Gerät: RECHTS NEBEN der DIA-Zahl
                (unterer Blutdruck), etwas HÖHER versetzt – es sieht aus wie ZWEI leicht
                gegeneinander verschobene kleine Herzchen. Nur dann true setzen.
- "date":      falls auf dem Display ein Datum sichtbar ist, im Format "YYYY-MM-DD", sonst null.

Wichtig:
- Das Foto kann gedreht (90/180/270°) sein – lies es trotzdem korrekt.
- Es gilt IMMER: systolic > diastolic.
- Wenn ein Wert nicht sicher lesbar ist, setze ihn auf null statt zu raten.`;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function normalize(obj, provider) {
  let systolic = num(obj.systolic);
  let diastolic = num(obj.diastolic);
  // Plausibilität: systolisch muss grösser sein als diastolisch.
  if (systolic !== null && diastolic !== null && systolic < diastolic) {
    [systolic, diastolic] = [diastolic, systolic];
  }
  return {
    systolic,
    diastolic,
    pulse: num(obj.pulse),
    arrhythmia: obj.arrhythmia === true || obj.arrhythmia === 'true' || obj.arrhythmia === 1,
    date: typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(obj.date) ? obj.date.slice(0, 10) : null,
    ai_provider: provider,
  };
}

function extractJson(text) {
  if (!text) throw new Error('Leere KI-Antwort');
  // JSON ggf. aus Markdown-Codeblock oder Fliesstext herausschneiden.
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Kein JSON in KI-Antwort gefunden: ' + text.slice(0, 200));
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callGemini(base64, mime) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  return normalize(extractJson(text), 'gemini');
}

async function callOpenAI(base64, mime) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return normalize(extractJson(data?.choices?.[0]?.message?.content || ''), 'openai');
}

async function callAnthropic(base64, mime) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.content?.map((c) => c.text).join('') || '';
  return normalize(extractJson(text), 'anthropic');
}

const PROVIDERS = {
  gemini: { fn: callGemini, key: 'GEMINI_API_KEY' },
  openai: { fn: callOpenAI, key: 'OPENAI_API_KEY' },
  anthropic: { fn: callAnthropic, key: 'ANTHROPIC_API_KEY' },
};

export function aiConfigured() {
  return Object.values(PROVIDERS).some((p) => process.env[p.key]);
}

// Liest Werte aus einem Bild-Buffer. Probiert die konfigurierten Anbieter
// in sinnvoller Reihenfolge durch (auto: Gemini -> OpenAI -> Anthropic).
export async function analyzeImage(buffer, mime) {
  const base64 = buffer.toString('base64');
  const pref = (process.env.AI_PROVIDER || 'auto').toLowerCase();
  const order = pref === 'auto' ? ['gemini', 'openai', 'anthropic'] : [pref];

  const errors = [];
  for (const name of order) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    if (!process.env[provider.key]) {
      errors.push(`${name}: kein API-Schlüssel`);
      continue;
    }
    try {
      return await provider.fn(base64, mime);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error('KI-Auslesung fehlgeschlagen. ' + errors.join(' | '));
}
