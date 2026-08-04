/**
 * steuer-suggest-position
 *
 * LLM-Fallback für die Belegtriage im Steuermodul nP.
 * Wird NUR aufgerufen, wenn die Regel-Triage unter 0.85 Confidence bleibt
 * (src/lib/steuer/triage.js).
 *
 * ⚠️ DATENSCHUTZ — bewusst abweichend von suggest-document-fields
 *
 * Steuerdaten unterliegen dem Steuergeheimnis, zusätzlich zum revDSG. Diese
 * Function nutzt deshalb AUSSCHLIESSLICH Infomaniak AI Tools (CH-Cloud,
 * OpenAI-kompatibel) und hat KEINEN Fallback auf OpenAI, Gemini oder
 * Anthropic. Ist Infomaniak nicht erreichbar, fällt der Client auf die
 * Regel-Einschätzung zurück — er schickt die Daten nicht ins Ausland.
 *
 * Vor dem Prompt werden AHV-Nummern und IBANs pseudonymisiert. Die
 * Klartextwerte kommen aus der Datenbank, nicht aus der LLM-Antwort.
 *
 * Konzept: docs/recherche-und-architektur.md §10
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

/** Belegarten-Schlüssel — muss mit src/lib/steuer/belegarten.js übereinstimmen. */
const BELEGARTEN = [
  "lohnausweis", "esteuerauszug", "kontoauszug", "schuldzins", "saeule3a",
  "pk_einkauf", "krankenkasse", "krankheitskosten", "behinderung",
  "weiterbildung", "berufsauslagen", "kinderbetreuung", "spende", "alimente",
  "rente", "liegenschaft", "beteiligung", "veranlagung_vorjahr",
];

/**
 * Ersetzt AHV-Nummern und IBANs durch Platzhalter.
 * Die KI braucht sie nicht, um eine Belegart zu erkennen.
 */
function pseudonymisieren(text: string): string {
  return text
    // AHV-Nummer: 756.XXXX.XXXX.XX (auch ohne Trennzeichen)
    .replace(/756[.\s-]?\d{4}[.\s-]?\d{4}[.\s-]?\d{2}/g, "«AHV-NR»")
    // IBAN CH/LI
    .replace(/\b(CH|LI)\s?\d{2}[\s\d]{15,25}\b/gi, "«IBAN»");
}

const SYSTEM_PROMPT = `Du bist Klassifikations-Assistent für Steuerbelege natürlicher Personen in der Schweiz.

Aufgabe: Bestimme, um welche Belegart es sich handelt, ob der Beleg für die Steuererklärung relevant ist, und lies die darin genannten Beträge AB.

Erlaubte Werte für belegart:
${BELEGARTEN.join(", ")}
Wenn nichts davon passt: leer lassen.

Erlaubte Werte für relevanz: relevant, nicht_relevant, unklar

REGELN — bitte streng einhalten:
- Beträge werden ABGELESEN, nicht berechnet. Rechne nichts nach und leite nichts her.
- Ein Betrag darf nur zurückgegeben werden, wenn er wörtlich im Belegtext steht.
- Im Zweifel "unklar" statt zu raten. Ein falsch aussortierter Beleg kostet den Steuerpflichtigen bares Geld.
- Werbung, private Einkaufsquittungen und Korrespondenz ohne Zahlenbezug sind "nicht_relevant".
- Passt die Periode im Beleg nicht zur angefragten Steuerperiode, setze relevanz auf "unklar" und nenne das in der begruendung.
- Personendaten wie AHV-Nummer oder IBAN sind durch Platzhalter ersetzt. Das ist beabsichtigt — frage nicht danach.

Antworte AUSSCHLIESSLICH als JSON:
{
  "belegart": "<Schlüssel oder leer>",
  "relevanz": "<relevant|nicht_relevant|unklar>",
  "grund": "<kurzer Schlüssel wie 'werbung', 'falsche_periode', '' >",
  "periode": <4-stelliges Jahr oder null>,
  "positionen": [
    { "bezeichnung": "<was der Betrag ist>", "wert_num": <Zahl>, "beleg_zitat": "<Textstelle, in der der Betrag steht>" }
  ],
  "confidence": <0.0-1.0>,
  "begruendung": "<kurze Erklärung auf Deutsch>"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const rohText: string = (body.text || "").slice(0, 20000);
    const dateiname: string = body.dateiname || "";
    const periode: number | null = body.periode ?? null;

    if (!rohText && !dateiname) {
      return ok({ error: "text und dateiname fehlen" });
    }

    const apiKey  = Deno.env.get("INFOMANIAK_API_KEY");
    const baseUrl = Deno.env.get("INFOMANIAK_BASE_URL")
                 || "https://api.infomaniak.com/1/ai/openai/v1";
    const model   = body.model || Deno.env.get("INFOMANIAK_MODEL") || "mixtral";

    if (!apiKey) {
      // Bewusst kein Ausweichen auf einen anderen Anbieter: Steuerdaten
      // verlassen die Schweiz nicht, auch nicht bei Konfigurationsfehlern.
      return ok({
        error: "INFOMANIAK_API_KEY nicht konfiguriert — kein Fallback für Steuerdaten vorgesehen",
      });
    }

    const text = pseudonymisieren(rohText);
    const userText = [
      `Dateiname: ${dateiname}`,
      periode ? `Angefragte Steuerperiode: ${periode}` : "",
      "",
      `Belegtext (max. 20'000 Zeichen):`,
      text || "(kein Text extrahiert)",
    ].join("\n");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userText },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    if (!res.ok) {
      console.warn(`[steuer-suggest] Infomaniak HTTP ${res.status}: ${raw.slice(0, 300)}`);
      return ok({ error: `KI-Backend HTTP ${res.status}` });
    }

    let parsed: any;
    try {
      const data = JSON.parse(raw);
      parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch (e) {
      console.warn("[steuer-suggest] JSON-Parse fehlgeschlagen:", e);
      return ok({ error: "Antwort des KI-Backends war kein gültiges JSON" });
    }

    // ─── Normalisieren und plausibilisieren ────────────────────────
    const belegart = BELEGARTEN.includes(parsed.belegart) ? parsed.belegart : "";
    const relevanz = ["relevant", "nicht_relevant", "unklar"].includes(parsed.relevanz)
      ? parsed.relevanz : "unklar";

    // Plausi im CODE, nicht im Prompt: Ein Betrag zählt nur, wenn er
    // tatsächlich im Belegtext vorkommt. Die KI kann behaupten, was sie will.
    const nurZiffern = (s: string) => String(s).replace(/[^0-9]/g, "");
    const textZiffern = nurZiffern(rohText);

    const positionen = (Array.isArray(parsed.positionen) ? parsed.positionen : [])
      .map((p: any) => {
        const wert = typeof p.wert_num === "number" ? p.wert_num : Number(p.wert_num);
        if (!Number.isFinite(wert)) return null;
        // Der Betrag muss als Ziffernfolge im Originaltext auftauchen
        const gefunden = textZiffern.includes(nurZiffern(wert.toFixed(2)))
                      || textZiffern.includes(nurZiffern(String(Math.round(wert))));
        return {
          bezeichnung: String(p.bezeichnung || "").slice(0, 200),
          wert_num: wert,
          beleg_zitat: String(p.beleg_zitat || "").slice(0, 300),
          im_belegtext: gefunden,
        };
      })
      .filter(Boolean)
      // Beträge, die nicht im Belegtext stehen, werden verworfen statt übernommen
      .filter((p: any) => p.im_belegtext);

    const verworfen = (Array.isArray(parsed.positionen) ? parsed.positionen.length : 0)
                    - positionen.length;

    let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    if (verworfen > 0) confidence = Math.min(confidence, 0.6);

    return ok({
      belegart,
      relevanz,
      grund: String(parsed.grund || "").slice(0, 40),
      periode: Number.isInteger(parsed.periode) ? parsed.periode : null,
      positionen,
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
      begruendung: String(parsed.begruendung || "").slice(0, 500),
      verworfene_positionen: verworfen,
      model_used: model,
    });
  } catch (e: any) {
    console.error("[steuer-suggest] Fehler:", e);
    return ok({ error: e?.message || String(e) });
  }
});
