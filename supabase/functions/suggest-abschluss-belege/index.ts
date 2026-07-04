/**
 * suggest-abschluss-belege
 *
 * LLM-Rerank für die KI-Belegzuweisung der Abschlussdokumentation.
 * Bekommt Bilanz-Positionen (Konto + Saldo) und eine Liste von Dokument-
 * Kandidaten (Name + Inhalts-Snippet) und ordnet jeder Position den am besten
 * passenden Beleg zu (oder null). Nur Text, keine Vision.
 *
 * Nutzt dieselben Keys/Provider wie suggest-document-fields
 * (OPENAI_API_KEY → GEMINI_API_KEY → ANTHROPIC_API_KEY), steuerbar via
 * body.provider = "openai" | "gemini" | "claude" | "auto" (default).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ok = (body: object) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PositionIn {
  kontonummer: string;
  kontoname?: string;
  position?: string;
  saldo?: number;
}
interface DocIn {
  id: string;
  name?: string;
  filename?: string;
  category?: string;
  year?: number;
  snippet?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const positions: PositionIn[] = Array.isArray(body.positions) ? body.positions.slice(0, 60) : [];
    const documents: DocIn[]      = Array.isArray(body.documents) ? body.documents.slice(0, 80) : [];
    if (!positions.length || !documents.length) {
      return ok({ assignments: [], error: "positions oder documents fehlen" });
    }

    const rulesPrompt = `Du bist Revisions-Assistent für Schweizer Jahresabschlüsse (KMU-Kontenrahmen).
Aufgabe: Ordne jeder Bilanz-Position den am besten passenden BELEG aus der Dokumentliste zu (oder null, wenn keiner passt).

Ein guter Beleg belegt den Saldo der Position. Typische Zuordnungen:
- Flüssige Mittel → Bank-/Kontoauszug, Saldobestätigung, Kassenbuch
- Wertschriften → Depotauszug
- Forderungen aus L+L → Debitoren-/OP-Liste
- Warenvorräte → Inventar / Lagerliste / Bestandesaufnahme
- Sachanlagen → Anlagespiegel / Anlageverzeichnis
- Darlehen/Hypothek → Kredit-/Darlehensvertrag, Saldobestätigung Bank
- Rückstellungen → Rückstellungsspiegel / Berechnung
- Eigenkapital → Handelsregister, Statuten, GV-Protokoll

WICHTIG:
- Wenn der SALDO-Betrag der Position im Dokument-Snippet vorkommt, ist das ein sehr starkes Signal (hohe Konfidenz).
- Ordne NUR zu, wenn du einigermassen sicher bist. Im Zweifel doc_id = null.
- Jedes Dokument darf höchstens einer Position zugeordnet werden (das beste Match gewinnt).

Antworte AUSSCHLIESSLICH als JSON:
{"assignments":[{"kontonummer":"<string>","doc_id":"<id aus der Liste oder null>","confidence":<0.0-1.0>,"reason":"<kurz, deutsch>"}]}`;

    const posText = positions.map(p =>
      `- Konto ${p.kontonummer} "${p.kontoname || ""}" | Position: ${p.position || ""} | Saldo: ${p.saldo ?? ""}`
    ).join("\n");
    const docText = documents.map(d =>
      `[${d.id}] "${d.name || d.filename || ""}" (${d.category || "?"}, ${d.year ?? "?"}): ${(d.snippet || "").slice(0, 500).replace(/\s+/g, " ")}`
    ).join("\n");
    const userText = `POSITIONEN:\n${posText}\n\nDOKUMENTE (id in eckigen Klammern):\n${docText}`;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey    = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    const openaiKey    = Deno.env.get("OPENAI_API_KEY");
    if (!anthropicKey && !geminiKey && !openaiKey) {
      return ok({ assignments: [], error: "Kein OPENAI_API_KEY/GEMINI_API_KEY/ANTHROPIC_API_KEY konfiguriert" });
    }
    const providerPref: string = body.provider || "auto";

    const validIds = new Set(documents.map(d => d.id));
    const normalize = (parsed: any, modelUsed: string) => {
      const arr = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
      const assignments = arr
        .map((a: any) => ({
          kontonummer: String(a.kontonummer ?? "").trim(),
          doc_id: a.doc_id && validIds.has(String(a.doc_id)) ? String(a.doc_id) : null,
          confidence: typeof a.confidence === "number" ? a.confidence : 0,
          reason: typeof a.reason === "string" ? a.reason.slice(0, 200) : "",
        }))
        .filter((a: any) => a.kontonummer && a.doc_id);
      return { assignments, model_used: modelUsed };
    };

    // ── OpenAI ──────────────────────────────────────────────────────────────
    if (openaiKey && (providerPref === "openai" || providerPref === "auto")) {
      try {
        const model = body.openai_model || "gpt-4.1-mini";
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 40000);
        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: rulesPrompt }, { role: "user", content: userText }],
              response_format: { type: "json_object" },
              temperature: 0.1,
              max_tokens: 4000,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(timer); }
        const raw = await res.text();
        if (res.ok) {
          const txt = JSON.parse(raw)?.choices?.[0]?.message?.content || "";
          try { return ok(normalize(JSON.parse(txt), model)); }
          catch (e) { console.warn("[belege] OpenAI JSON-Parse:", e, txt.slice(0, 200)); }
        } else console.warn(`[belege] OpenAI HTTP ${res.status}: ${raw.slice(0, 300)}`);
      } catch (e: any) {
        console.warn("[belege] OpenAI-Exception:", e?.name === "AbortError" ? "Timeout 40s" : (e?.message || String(e)));
      }
    }

    // ── Gemini ──────────────────────────────────────────────────────────────
    if (geminiKey && (providerPref === "gemini" || providerPref === "auto")) {
      try {
        const model = body.gemini_model || "gemini-2.5-flash";
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 40000);
        let res: Response;
        try {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: rulesPrompt }] },
                contents: [{ role: "user", parts: [{ text: userText }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 4000 },
              }),
              signal: ctrl.signal,
            }
          );
        } finally { clearTimeout(timer); }
        const raw = await res.text();
        if (res.ok) {
          const txt = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const m = txt.match(/\{[\s\S]*\}/);
          if (m) { try { return ok(normalize(JSON.parse(m[0]), model)); } catch (e) { console.warn("[belege] Gemini JSON:", e); } }
        } else console.warn(`[belege] Gemini HTTP ${res.status}: ${raw.slice(0, 300)}`);
      } catch (e: any) {
        console.warn("[belege] Gemini-Exception:", e?.name === "AbortError" ? "Timeout 40s" : (e?.message || String(e)));
      }
    }

    // ── Claude ──────────────────────────────────────────────────────────────
    if (anthropicKey && (providerPref === "claude" || providerPref === "auto")) {
      const models = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-3-5-haiku-latest"];
      let lastError = "";
      for (const model of models) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 50000);
          let res: Response;
          try {
            res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model,
                max_tokens: 4000,
                system: rulesPrompt,
                messages: [{ role: "user", content: userText }],
              }),
              signal: ctrl.signal,
            });
          } finally { clearTimeout(timer); }
          const raw = await res.text();
          if (!res.ok) { lastError = `HTTP ${res.status} (${model})`; if (res.status === 404 || res.status === 400) continue; return ok({ assignments: [], error: `Claude: ${raw.slice(0, 200)}` }); }
          const txt = JSON.parse(raw)?.content?.[0]?.text || "";
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) { lastError = `Keine JSON-Antwort (${model})`; continue; }
          return ok(normalize(JSON.parse(m[0]), model));
        } catch (e: any) {
          lastError = `Exception (${model}): ${e?.message || String(e)}`;
        }
      }
      return ok({ assignments: [], error: `Kein Modell funktionierte: ${lastError}` });
    }

    return ok({ assignments: [], error: `Kein Provider verfügbar (pref: ${providerPref})` });
  } catch (error: any) {
    console.error("[suggest-abschluss-belege]", error);
    return ok({ assignments: [], error: "Unerwarteter Fehler: " + (error?.message || String(error)) });
  }
});
