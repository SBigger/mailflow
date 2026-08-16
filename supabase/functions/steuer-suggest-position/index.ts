/**
 * steuer-suggest-position
 *
 * Zweite Stufe der Belegerkennung für Steuerbelege natürlicher Personen.
 * Wird NUR gerufen, wenn die Regeln im Browser unter der Schwelle bleiben —
 * bei einem echten Stapel waren das rund ein Drittel der Belege.
 *
 * Der Positionskatalog kommt vom Aufrufer mit, nicht aus dieser Datei.
 * `src/forms/steuer_np_katalog.js` bleibt damit die einzige Wahrheit; hier
 * müsste sonst jede Änderung ein zweites Mal nachgezogen werden.
 *
 * Datenschutz: Der Client schickt bewusst nur einen Ausschnitt (Briefkopf und
 * erste Zeilen) und maskiert die AHV-Nummer vorher. Für die Frage «was ist
 * das» reicht das; Krankheits- und Arztbelege sind besonders schützenswerte
 * Personendaten und haben in voller Länge nichts auf einer fremden Maschine
 * verloren.
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

const REGELN = `Du ordnest einen Schweizer Steuerbeleg einer Privatperson ein.

Du bekommst einen Textausschnitt (Briefkopf und erste Zeilen, oft aus OCR und
entsprechend fehlerhaft) und den Positionskatalog der Steuererklärung.

Antworte AUSSCHLIESSLICH mit JSON in dieser Form:
{
  "belegart": "<Schlüssel oder null>",
  "positionen": ["<id aus dem Katalog>", ...],
  "relevanz": "relevant" | "unklar" | "nicht_relevant",
  "confidence": 0.0-1.0,
  "periode": <Jahr oder null>,
  "begruendung": "<ein Satz, woran du es erkennst>"
}

Regeln:
- Der Absender im Briefkopf ist das stärkste Merkmal. Wer schickt, bestimmt
  meist was es ist: Gebäudeversicherung, Krankenkasse, Vorsorgestiftung.
- Manche Belege füllen ZWEI Positionen. Ein Bank-Steuerausweis nennt Ertrag
  (Seite 2) und Bestand (Seite 4); ein Hypothekarausweis Zins (Seite 3) und
  Restschuld (Seite 4). Dann beide angeben.
- Rate NICHT. Wenn der Ausschnitt nicht reicht, gib "unklar" mit niedriger
  confidence zurück und sag im Begründungssatz, was fehlen würde. Ein falsch
  einsortierter Beleg kostet mehr als ein offener.
- Rechnungen für privaten Konsum (Möbel, Geräte, Hobby, Garten) sind NICHT
  abzugsfähig, auch wenn sie wie eine Handwerkerrechnung aussehen.
- Ob Liegenschaftsunterhalt werterhaltend oder wertvermehrend ist, steht auf
  keiner Rechnung. Ordne der Position zu, entscheide die Frage nicht.
- Handschriftliches und Papier mit dem Briefkopf des Treuhänders sind
  Arbeitspapiere, keine Beilagen.
- Kommt ein BILD mit, ist es die erste Seite des Belegs — der Textausschnitt
  dazu war für die OCR unlesbar oder leer. Lies Briefkopf, Logo und Titel aus
  dem Bild; das Layout (Einzahlungsschein, Police, Kontoauszug, Handnotiz)
  sagt oft mehr als der Text.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const text = String(body.text || "").slice(0, 4000);
    const dateiname = String(body.dateiname || "");
    const periode = body.periode ?? null;
    const katalog = String(body.katalog || "");
    const belegarten = String(body.belegarten || "");
    // Bild-Fallback: base64-JPEG der ersten Seite des Teils. Kommt nur bei
    // Belegen, an denen Regeln UND Text-KI gescheitert sind.
    const bild = typeof body.bild === "string" ? body.bild : "";
    const bildTyp = ["image/jpeg", "image/png", "image/webp", "image/gif"]
      .includes(body.bildTyp) ? body.bildTyp : "image/jpeg";

    if (!text.trim() && !bild) return ok({ error: "Kein Text übergeben" });
    if (!katalog.trim()) return ok({ error: "Kein Katalog übergeben" });
    if (bild.length > 6_000_000) return ok({ error: "Bild zu gross" });

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return ok({ error: "ANTHROPIC_API_KEY fehlt" });

    const daten = `POSITIONSKATALOG\n${katalog}\n\nBELEGARTEN\n${belegarten}`;
    const frage = [
      periode ? `Steuerperiode der Deklaration: ${periode}` : "",
      dateiname ? `Dateiname: ${dateiname}` : "",
      "",
      text.trim() ? "TEXTAUSSCHNITT:" : "Kein lesbarer Text — nur das Bild.",
      text,
    ].filter(Boolean).join("\n");

    // Mit Bild wird die Nachricht multimodal: erst das Bild, dann die Frage.
    const inhalt = bild
      ? [
          { type: "image", source: { type: "base64", media_type: bildTyp, data: bild } },
          { type: "text", text: frage },
        ]
      : frage;

    // claude-3-5-haiku kann keine Bilder — mit Bild endet die Kette vorher.
    const modelle = bild
      ? ["claude-haiku-4-5", "claude-sonnet-4-5"]
      : ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-3-5-haiku-latest"];
    let letzterFehler = "";

    for (const model of modelle) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify({
            model,
            max_tokens: 700,
            system: [
              { type: "text", text: REGELN },
              // Der Katalog ist bei jedem Beleg identisch — zwischenspeichern,
              // sonst zahlt man ihn fuer jeden einzelnen Beleg neu.
              { type: "text", text: daten, cache_control: { type: "ephemeral" } },
            ],
            messages: [{ role: "user", content: inhalt }],
          }),
          signal: ctrl.signal,
        });

        if (!res.ok) { letzterFehler = `${model}: HTTP ${res.status}`; continue; }

        const antwort = await res.json();
        const roh = antwort?.content?.[0]?.text || "";
        const treffer = roh.match(/\{[\s\S]*\}/);
        if (!treffer) { letzterFehler = `${model}: kein JSON in der Antwort`; continue; }

        const p = JSON.parse(treffer[0]);
        return ok({
          belegart:    p.belegart || null,
          positionen:  Array.isArray(p.positionen) ? p.positionen : [],
          relevanz:    p.relevanz || "unklar",
          confidence:  Math.max(0, Math.min(1, Number(p.confidence) || 0)),
          periode:     p.periode ?? null,
          begruendung: p.begruendung || "",
          model_used:  model,
        });
      } catch (e) {
        letzterFehler = `${model}: ${e.message || e}`;
      } finally {
        clearTimeout(timer);
      }
    }

    return ok({ error: `Kein Modell hat geantwortet (${letzterFehler})` });
  } catch (e) {
    return ok({ error: e.message || String(e) });
  }
});
