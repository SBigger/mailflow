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

const REGELN_BETRAG = `Du liest gezielt Beträge aus einem Schweizer Steuerbeleg ab.

Du bekommst Seitenbilder EINES Belegs und die Beschreibung, welche Beträge
gesucht sind. Antworte AUSSCHLIESSLICH mit JSON:
{
  "einkommen": <Zahl oder null>,
  "vermoegen": <Zahl oder null>,
  "begruendung": "<ein Satz: wo auf der Seite der Betrag steht>"
}

Regeln:
- Du liest AB, du rechnest nicht und du schätzt nicht. Steht der gesuchte
  Betrag nicht auf den Seiten, gib null zurück.
- Schweizer Schreibweisen normalisieren: 112'480.00 → 112480.00.
- Nur die GESUCHTEN Beträge. Nach was nicht gefragt ist, bleibt null.
- Der Betrag gehört in das Feld der GEFRAGTEN Seite: Was unter «einkommen:»
  gesucht wurde, kommt ins Feld "einkommen" — auch Abzüge wie Schuldzinsen
  oder Prämien. Was unter «vermoegen:» gesucht wurde, ins Feld "vermoegen".
- Die Begriffe heissen auf dem Beleg oft anders: Schuldzinsen stehen als
  «bezahlter Zins», «belasteter Zins» oder «Sollzinsen»; der Steuerwert als
  «Saldo per 31.12.» oder «Kontostand». Lies die Zahl der passenden Spalte
  ab. Ob etwas steuerlich abziehbar ist, beurteilst du NICHT — das macht
  der Treuhänder.
- Nummern sind keine Beträge: Kunden-Nr., Rechnungs-Nr., Policen-Nr.,
  Versicherungssummen und Gebäudewerte sind NICHT gesucht.
- Bei mehreren Jahren auf dem Beleg zählt die angegebene Steuerperiode.`;

const REGELN_WAHL = `Du triffst EINE Entscheidung über einen Schweizer Steuerbeleg.

Die Belegart ist bereits erkannt. Offen ist nur, zu WELCHER der genannten
Positionen der Beleg gehört. Du bekommst das Unterscheidungskriterium, einen
Textausschnitt (oft OCR, fehlerhaft) und allenfalls ein Seitenbild.

Antworte AUSSCHLIESSLICH mit JSON:
{
  "position": "<id aus der Kandidatenliste oder null>",
  "confidence": 0.0-1.0,
  "begruendung": "<ein Satz: woran du es festmachst>"
}

Regeln:
- NUR eine id aus der Kandidatenliste — oder null, wenn der Beleg die Frage
  nicht beantwortet. Rate nicht: ein falsch einsortierter Beleg kostet mehr
  als ein offener.
- Beim Kontoauszug entscheidet das Vorzeichen: Guthaben → Wertschriften,
  Sollsaldo/Kredit → Schulden.
- Bei Renten entscheidet der Absender: Ausgleichskasse (SVA/AK) → AHV,
  Pensionskasse/Sammelstiftung → 2. Säule, Vorsorgestiftung/Bank → Säule 3.
- Bei Liegenschaftsbelegen: Mietzins/Eigenmietwert → Ertrag, amtliche
  Schätzung/Steuerwert → Objektdaten, Rechnungen → Unterhalt.
- Bei Zahlungen entscheidet der Zweck: Kapitaleinlage/Darlehen → Vermögen,
  private Rechnung → nicht zur Steuererklärung.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    // ── Modus «wahl»: erkannte Belegart, Position unter Kandidaten wählen ─
    if (body.modus === "wahl") {
      const text = String(body.text || "").slice(0, 4000);
      const kandidaten = (Array.isArray(body.kandidaten) ? body.kandidaten : [])
        .filter((k: { id?: unknown }) => k && typeof k.id === "string").slice(0, 6);
      const bilder = (Array.isArray(body.bilder) ? body.bilder : [])
        .filter((b: unknown) => typeof b === "string" && b).slice(0, 2);
      const bildTyp = ["image/jpeg", "image/png", "image/webp"].includes(body.bildTyp)
        ? body.bildTyp : "image/jpeg";

      if (kandidaten.length < 2) return ok({ error: "Zu wenige Kandidaten" });
      if (!text.trim() && !bilder.length) return ok({ error: "Weder Text noch Bild" });

      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) return ok({ error: "ANTHROPIC_API_KEY fehlt" });

      const frage = [
        body.belegart ? `Erkannte Belegart: ${body.belegart}` : "",
        body.kriterium ? `Unterscheidungskriterium: ${body.kriterium}` : "",
        body.periode ? `Steuerperiode: ${body.periode}` : "",
        body.dateiname ? `Dateiname: ${body.dateiname}` : "",
        "",
        "KANDIDATEN:",
        ...kandidaten.map((k: { id: string; label?: string }) =>
          `- ${k.id}: ${k.label || k.id}`),
        "",
        text.trim() ? "TEXTAUSSCHNITT:" : "(kein lesbarer Text — nur das Bild)",
        text,
      ].filter(Boolean).join("\n");

      const inhalt = bilder.length
        ? [
            ...bilder.map((b: string) => ({
              type: "image", source: { type: "base64", media_type: bildTyp, data: b },
            })),
            { type: "text", text: frage },
          ]
        : frage;

      let letzter = "";
      for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5"]) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model, max_tokens: 300,
              system: REGELN_WAHL,
              messages: [{ role: "user", content: inhalt }],
            }),
            signal: ctrl.signal,
          });
          if (!res.ok) { letzter = `${model}: HTTP ${res.status}`; continue; }
          const antwort = await res.json();
          const roh = antwort?.content?.[0]?.text || "";
          const treffer = roh.match(/\{[\s\S]*\}/);
          if (!treffer) { letzter = `${model}: kein JSON`; continue; }
          const p = JSON.parse(treffer[0]);
          // Nur Kandidaten-ids gelten — alles andere ist null.
          const gueltig = kandidaten.some((k: { id: string }) => k.id === p.position);
          return ok({
            position: gueltig ? p.position : null,
            confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
            begruendung: p.begruendung || "",
            model_used: model,
          });
        } catch (e) {
          letzter = `${model}: ${e.message || e}`;
        } finally {
          clearTimeout(timer);
        }
      }
      return ok({ error: `Kein Modell hat geantwortet (${letzter})` });
    }

    // ── Modus «betrag»: gezielt Beträge von Seitenbildern ablesen ────────
    if (body.modus === "betrag") {
      const bilder = (Array.isArray(body.bilder) ? body.bilder : [])
        .filter((b: unknown) => typeof b === "string" && b).slice(0, 3);
      const bildTyp = ["image/jpeg", "image/png", "image/webp"].includes(body.bildTyp)
        ? body.bildTyp : "image/jpeg";
      const eLabel = body.einkommenLabel ? String(body.einkommenLabel) : null;
      const vLabel = body.vermoegenLabel ? String(body.vermoegenLabel) : null;

      if (!bilder.length) return ok({ error: "Kein Bild übergeben" });
      if (!eLabel && !vLabel) return ok({ error: "Nichts gesucht" });
      if (bilder.reduce((s: number, b: string) => s + b.length, 0) > 12_000_000)
        return ok({ error: "Bilder zu gross" });

      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) return ok({ error: "ANTHROPIC_API_KEY fehlt" });

      const frage = [
        body.periode ? `Steuerperiode: ${body.periode}` : "",
        body.dateiname ? `Dateiname: ${body.dateiname}` : "",
        "Gesucht:",
        eLabel ? `- einkommen: ${eLabel}` : "",
        vLabel ? `- vermoegen: ${vLabel}` : "",
      ].filter(Boolean).join("\n");

      const inhalt = [
        ...bilder.map((b: string) => ({
          type: "image", source: { type: "base64", media_type: bildTyp, data: b },
        })),
        { type: "text", text: frage },
      ];

      let letzter = "";
      let leereAntwort: Record<string, unknown> | null = null;
      for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5"]) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model, max_tokens: 400,
              system: REGELN_BETRAG,
              messages: [{ role: "user", content: inhalt }],
            }),
            signal: ctrl.signal,
          });
          if (!res.ok) { letzter = `${model}: HTTP ${res.status}`; continue; }
          const antwort = await res.json();
          const roh = antwort?.content?.[0]?.text || "";
          const treffer = roh.match(/\{[\s\S]*\}/);
          if (!treffer) { letzter = `${model}: kein JSON`; continue; }
          const p = JSON.parse(treffer[0]);
          let e = typeof p.einkommen === "number" ? p.einkommen : null;
          let v = typeof p.vermoegen === "number" ? p.vermoegen : null;
          // War nur EINE Seite gefragt und die Antwort steckt im anderen
          // Feld, umhängen — gemessen: Haiku legte den gefundenen Schuldzins
          // ins Vermögensfeld, und der Client verwarf ihn.
          if (eLabel && !vLabel && e == null && v != null) { e = v; v = null; }
          if (vLabel && !eLabel && v == null && e != null) { v = e; e = null; }
          const antwortDaten = {
            einkommen: e,
            vermoegen: v,
            begruendung: p.begruendung || "",
            model_used: model,
          };
          // Gar nichts gefunden? Das nächste (stärkere) Modell versuchen —
          // Haiku verweigert gelegentlich mit fachlicher Begründung, wo
          // Sonnet die Spalte einfach abliest. Die leere Antwort bleibt
          // als Rückfalljoker stehen.
          if (e == null && v == null) { leereAntwort = antwortDaten; continue; }
          return ok(antwortDaten);
        } catch (e) {
          letzter = `${model}: ${e.message || e}`;
        } finally {
          clearTimeout(timer);
        }
      }
      if (leereAntwort) return ok(leereAntwort);
      return ok({ error: `Kein Modell hat geantwortet (${letzter})` });
    }
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
