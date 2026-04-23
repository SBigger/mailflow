/**
 * suggest-document-fields
 *
 * Claude-Fallback für die Massenablage. Bekommt extrahierten Text + alle
 * Kunden + alle Tags und gibt strukturierte Vorschläge zurück.
 *
 * Wird nur aufgerufen, wenn lokales Matching unsicher ist (< 0.85 Confidence).
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

interface CustomerIn {
  id: string;
  company_name?: string;
  portal_uid?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  email?: string;
}

interface TagIn {
  id: string;
  name: string;
  parent_id?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const filename: string = body.filename || "";
    const text:     string = (body.text || "").slice(0, 20000);
    const images:   string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
    const pdfB64:   string = typeof body.pdf === "string" ? body.pdf : "";
    const customers: CustomerIn[] = body.customers || [];
    const tags:      TagIn[]      = body.tags || [];

    if (!text && !filename && images.length === 0 && !pdfB64) {
      return ok({ error: "text, filename, pdf und images fehlen" });
    }

    // ─── System-Prompt: schlank, ohne Kunden-/Tag-Liste ──────────────────
    // Früher haben wir die volle Kundenliste (~10k Tokens) bei jedem Call mitgeschickt.
    // Jetzt: die LLM macht nur OCR + Klassifikation, das Kunden-/Tag-Matching passiert
    // lokal auf dem Client (matchCustomer/matchTags in batchAiSuggest.js) — 20–40× schneller.
    const rulesPrompt = `Du bist OCR- und Klassifikations-Assistent für die Artis Treuhand Dokumenten-Ablage.

Aufgabe: Lies das Dokument und gib strukturierte Infos zurück. Du kennst die Kundenliste NICHT — schreibe einfach auf, welcher Firmenname / UID / Betreff im Dokument steht. Das Matching zur Datenbank passiert später.

Regeln:
- extracted_text: transkribiere so viel wie möglich Zeile für Zeile (Überschriften, Beträge, Datumsangaben, Adressen, Tabellenzeilen). Ziel: das Dokument muss über Volltextsuche findbar sein.
- customer_name_hint: Firmen- oder Personenname des Kunden, auf den sich das Dokument bezieht (Empfänger, Betroffener, Briefkopf). Als String, wie er im Dokument steht.
- customer_uid_hint: Schweizer UHR-Nummer CHE-XXX.XXX.XXX falls sichtbar, sonst leer.
- tag_name_hint: Dokumenttyp in 1–3 Wörtern (z.B. "Kontoauszug", "Rechnung", "Lohnausweis", "Mahnung", "Bilanz", "Steuererklärung").
- category: Hauptkategorie. Priorität bei Überschneidung: rechnungswesen → steuern → mwst → personal → revision → rechtsberatung → korrespondenz.
- year: Dokument-Jahr (4-stellig) falls klar erkennbar.

Antworte AUSSCHLIESSLICH als JSON in diesem Format (extracted_text ZUERST, damit der Text zuverlässig entsteht bevor klassifiziert wird):
{
  "extracted_text": "<Volltext, max. 5000 Zeichen>",
  "customer_name_hint": "<string oder leer>",
  "customer_uid_hint": "<CHE-XXX.XXX.XXX oder leer>",
  "tag_name_hint": "<string oder leer>",
  "category": "<rechnungswesen|steuern|mwst|personal|revision|rechtsberatung|korrespondenz|>",
  "year": <zahl oder null>,
  "confidence": <0.0-1.0>,
  "reason": "<kurze Erklärung deutsch>"
}`;

    // dataPrompt bleibt leer (Kunden-/Tag-Liste wird nicht mehr mitgesendet).
    // Feld steht drin, damit wir die Provider-Pfade unten nicht anfassen müssen.
    const dataPrompt = "";

    const hasVisual = pdfB64 || images.length > 0;
    const userText = `Dateiname: ${filename}

${hasVisual
  ? "Das Dokument ist als PDF/Bild beigefügt — lies den Inhalt bitte daraus und transkribiere ALLES sichtbare Text-Material ins Feld extracted_text (mindestens Überschriften, Beträge, Datumsangaben, Adressen, Tabellenzeilen)."
  : `Extrahierter Text (max. 20'000 Zeichen):\n${text || "(kein Text extrahiert)"}`}`;

    // Claude-Message-Content: PDF oder Bilder zuerst (Vision), dann Text
    const userContent: any[] = [];
    if (pdfB64) {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfB64 },
      });
    }
    for (const b64 of images) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b64 },
      });
    }
    userContent.push({ type: "text", text: userText });

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey    = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    const openaiKey    = Deno.env.get("OPENAI_API_KEY");
    if (!anthropicKey && !geminiKey && !openaiKey) {
      return ok({ error: "Weder OPENAI_API_KEY, GEMINI_API_KEY noch ANTHROPIC_API_KEY konfiguriert" });
    }

    // Reihenfolge steuerbar via body.provider = "openai" | "gemini" | "claude" | "auto" (default)
    const providerPref: string = body.provider || "auto";

    const normalizeResponse = (parsed: any, modelUsed: string) => ({
      // Neu: die LLM liefert nur Text-Hints, das Matching auf UUIDs passiert lokal im Client.
      customer_name_hint: typeof parsed.customer_name_hint === "string" ? parsed.customer_name_hint.slice(0, 200) : "",
      customer_uid_hint:  typeof parsed.customer_uid_hint  === "string" ? parsed.customer_uid_hint.slice(0, 20)  : "",
      tag_name_hint:      typeof parsed.tag_name_hint      === "string" ? parsed.tag_name_hint.slice(0, 80)      : "",
      // Legacy-Felder für Rückwärtskompatibilität (immer leer, da LLM die Liste nicht mehr kennt):
      customer_id: null,
      tag_ids:     [] as string[],
      category:    parsed.category || "",
      year:        parsed.year || null,
      confidence:  typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reason:      parsed.reason || "",
      extracted_text: typeof parsed.extracted_text === "string" ? parsed.extracted_text.slice(0, 5000) : "",
      model_used:  modelUsed,
    });

    // ─── OpenAI-Pfad (schnell bei PDFs via Chat Completions, nativer PDF-Support) ──
    const tryOpenAI = openaiKey && (providerPref === "openai" || providerPref === "auto");
    if (tryOpenAI) {
      try {
        const openaiModel = body.openai_model || "gpt-4.1-mini";
        const userPartsOai: any[] = [];
        if (pdfB64) {
          userPartsOai.push({
            type: "file",
            file: { filename: filename || "document.pdf", file_data: `data:application/pdf;base64,${pdfB64}` },
          });
        }
        for (const b64 of images) {
          userPartsOai.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
        }
        userPartsOai.push({ type: "text", text: userText });

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        let oaRes: Response;
        try {
          oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: openaiModel,
              messages: [
                { role: "system", content: rulesPrompt + "\n\n" + dataPrompt },
                { role: "user",   content: userPartsOai },
              ],
              response_format: { type: "json_object" },
              temperature: 0.1,
              max_tokens: 3500,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(timer); }

        const oaRaw = await oaRes.text();
        if (oaRes.ok) {
          const oaData = JSON.parse(oaRaw);
          const oaText = oaData?.choices?.[0]?.message?.content || "";
          try {
            const parsed = JSON.parse(oaText);
            return ok(normalizeResponse(parsed, openaiModel));
          } catch (e) {
            console.warn("[suggest] OpenAI JSON-Parse fehlgeschlagen:", e, oaText.slice(0, 200));
          }
        } else {
          console.warn(`[suggest] OpenAI HTTP ${oaRes.status}: ${oaRaw.slice(0, 300)}`);
        }
      } catch (e: any) {
        const msg = e?.name === "AbortError" ? "OpenAI-Timeout nach 30s" : (e?.message || String(e));
        console.warn("[suggest] OpenAI-Exception, Fallback:", msg);
      }
    }

    // ─── Gemini-Pfad (priorisiert, weil deutlich schneller) ──────────────
    const tryGemini = geminiKey && (providerPref === "gemini" || providerPref === "auto");
    if (tryGemini) {
      try {
        const geminiModel = body.gemini_model || "gemini-2.5-flash";
        const geminiParts: any[] = [];
        if (pdfB64) {
          geminiParts.push({ inline_data: { mime_type: "application/pdf", data: pdfB64 } });
        }
        for (const b64 of images) {
          geminiParts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
        }
        geminiParts.push({ text: userText });

        const geminiBody = {
          system_instruction: { parts: [{ text: rulesPrompt + "\n\n" + dataPrompt }] },
          contents: [{ role: "user", parts: geminiParts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens: 3500,
          },
        };

        // 30s Timeout — sonst hängt der Call bei Netzproblemen oder großen PDFs ewig
        const geminiCtrl = new AbortController();
        const geminiTimer = setTimeout(() => geminiCtrl.abort(), 30000);
        let gRes: Response;
        try {
          gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(geminiBody),
              signal: geminiCtrl.signal,
            }
          );
        } finally {
          clearTimeout(geminiTimer);
        }
        const gRaw = await gRes.text();
        if (gRes.ok) {
          const gData = JSON.parse(gRaw);
          const gText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const gMatch = gText.match(/\{[\s\S]*\}/);
          if (gMatch) {
            try {
              const parsed = JSON.parse(gMatch[0]);
              return ok(normalizeResponse(parsed, geminiModel));
            } catch (e) {
              console.warn("[suggest] Gemini JSON-Parse fehlgeschlagen:", e, gText.slice(0, 200));
            }
          } else {
            console.warn("[suggest] Gemini keine JSON-Antwort:", gText.slice(0, 200));
          }
        } else {
          console.warn(`[suggest] Gemini HTTP ${gRes.status}: ${gRaw.slice(0, 300)}`);
        }
      } catch (e: any) {
        const msg = e?.name === "AbortError" ? "Gemini-Timeout nach 30s" : (e?.message || String(e));
        console.warn("[suggest] Gemini-Exception, fallback auf Claude:", msg);
      }
    }

    // ─── Claude-Fallback ─────────────────────────────────────────────────
    const tryClaude = anthropicKey && (providerPref === "claude" || providerPref === "auto");
    if (!tryClaude) {
      return ok({ error: `Kein Provider konnte antworten (bevorzugt: ${providerPref}). Prüfe API-Keys.` });
    }

    const modelCandidates = [
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "claude-3-5-haiku-latest",
    ];

    let lastError = "";
    const callClaude = async (model: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        return await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "pdfs-2024-09-25,prompt-caching-2024-07-31",
          },
          body: JSON.stringify({
            model,
            max_tokens: 3500,
            system: [
              { type: "text", text: rulesPrompt },
              { type: "text", text: dataPrompt, cache_control: { type: "ephemeral" } },
            ],
            messages: [{ role: "user", content: userContent }],
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    for (const model of modelCandidates) {
      try {
        let res = await callClaude(model);

        // 429 Rate-Limit → einmal warten und erneut versuchen
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("retry-after") || "15", 10);
          const waitMs = Math.min(Math.max(retryAfter, 5), 30) * 1000;
          console.warn(`[suggest] 429 für ${model}, warte ${waitMs}ms und versuche erneut`);
          await new Promise(r => setTimeout(r, waitMs));
          res = await callClaude(model);
        }

        const raw = await res.text();
        if (!res.ok) {
          lastError = `HTTP ${res.status} (${model}): ${raw.slice(0, 200)}`;
          if (res.status === 404 || res.status === 400) continue;
          if (res.status === 429) continue; // Rate-Limit bei mehreren Modellen ist gleich → nächstes probieren bringt nichts, aber wir loggen
          return ok({ error: `Claude API: ${lastError}` });
        }

        const data = JSON.parse(raw);
        const textOut = data.content?.[0]?.text || "";

        // JSON aus Antwort extrahieren (Claude darf Markdown-Fence drumrum packen)
        const m = textOut.match(/\{[\s\S]*\}/);
        if (!m) {
          lastError = `Keine JSON-Antwort von ${model}`;
          continue;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(m[0]);
        } catch (e) {
          lastError = `JSON-Parse-Fehler: ${(e as Error).message}`;
          continue;
        }

        return ok(normalizeResponse(parsed, model));
      } catch (e: any) {
        lastError = `Exception (${model}): ${e?.message || String(e)}`;
      }
    }

    return ok({ error: `Kein Modell funktionierte: ${lastError}` });

  } catch (error: any) {
    console.error("[suggest-document-fields]", error);
    return ok({ error: "Unerwarteter Fehler: " + (error?.message || String(error)) });
  }
});
