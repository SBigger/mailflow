/**
 * ocrClient.ts — Anbindung an den OCR-Container (Tesseract + poppler + catdoc).
 *
 * Stand 03.09.2026: Rogers Container liegt jetzt im Repo unter
 * docker_files/ocr (Commit ae4211b1 auf master). Der Vertrag unten ist gegen
 * dessen app.py abgeglichen: Pfad /ocr, Feld file, Antwort {"text": "..."}.
 * Zwei Dinge weichen ab und sind hier beruecksichtigt: er prueft den Header
 * X-Shared-Secret (nicht X-OCR-Token), und er meldet Fehler mit HTTP 200 und
 * dem Text "[OCR Fehler beim Verarbeiten der Datei: ...]".
 *
 * Der Container laeuft auf dem Server neben der Instanz (Roger, 01.09.2026).
 * Er ist NICHT Teil dieses Repositories und auf smartis.me nicht vorhanden.
 * Deshalb ist hier alles ueber Umgebungsvariablen geschaltet:
 *
 *   OCR_URL         voller Endpunkt, z. B. https://ocr.sm-artis.ch/extract
 *                   NICHT gesetzt -> OCR wird uebersprungen, alles andere
 *                   laeuft unveraendert weiter (Stand smartis.me).
 *   OCR_TOKEN       gemeinsames Geheimnis. Geht als X-Shared-Secret mit,
 *                   zusaetzlich als X-OCR-Token, damit beide Varianten passen.
 *   OCR_TIMEOUT_MS  Abbruch nach dieser Zeit, Vorgabe 120000.
 *   OCR_LANGS       Tesseract-Sprachen, Vorgabe "deu+eng".
 *
 * ── Vertrag mit dem Container ────────────────────────────────────────────
 * Anfrage:  POST <OCR_URL>            bei Roger: https://ocr.sm-artis.ch/ocr
 *           Header  X-Shared-Secret: <OCR_TOKEN>  (nur wenn gesetzt)
 *                   X-OCR-Token:     <OCR_TOKEN>  (dito, fuer den Fall dass
 *                                    ein Endpunkt den anderen Namen erwartet)
 *           Body    multipart/form-data
 *                     file      die Datei, mit Dateinamen
 *                     lang      z. B. "deu+eng"
 *                     filename  derselbe Name nochmal als Feld, weil manche
 *                               Flask-Endpunkte ihn dort erwarten
 * Antwort:  200 mit einem der drei Formate, alle werden akzeptiert:
 *             {"text": "..."}            bevorzugt
 *             {"ok": true, "text": "..."}
 *             reiner Text im Body
 *           Alles andere gilt als Fehlschlag und wird protokolliert, ohne
 *           die Indexierung abzubrechen: lieber kein Volltext als ein
 *           kaputter Upload.
 *
 * Der Endpunkt darf sich anders verhalten, dann ist HIER die einzige Stelle,
 * die angepasst werden muss.
 */

const MAX_CHARS = 100_000;

export function ocrConfigured(): boolean {
  return !!Deno.env.get("OCR_URL");
}

/** Dateitypen, die der Container behandeln kann und wir lokal nicht schaffen. */
export function needsOcr(filename: string, mimeType: string, extractedText: string): boolean {
  const name = (filename || "").toLowerCase();
  const mime = mimeType || "";

  // Bilder: lokal gibt es dafuer ueberhaupt keine Extraktion.
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(name)) return true;

  // Altformate: .doc und .rtf koennen wir weder im Browser noch hier lesen.
  if (/\.(doc|rtf)$/.test(name)) return true;

  // PDF ohne brauchbare Textebene = Scan. Die Schwelle ist bewusst tief:
  // manche Scans tragen eine Kopfzeile oder eine Seitenzahl als echten Text.
  if (name.endsWith(".pdf") || mime === "application/pdf") {
    return (extractedText || "").trim().length < 50;
  }

  return false;
}

/**
 * Schickt die Datei an den Container und gibt den erkannten Text zurueck.
 * Gibt "" zurueck, wenn OCR nicht konfiguriert ist oder etwas schiefgeht --
 * der Aufrufer soll deswegen nie scheitern.
 */
export async function ocrExtract(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const url = Deno.env.get("OCR_URL");
  if (!url) return "";

  const token   = Deno.env.get("OCR_TOKEN") || "";
  const langs   = Deno.env.get("OCR_LANGS") || "deu+eng";
  const timeout = Number(Deno.env.get("OCR_TIMEOUT_MS") || "120000");

  const safeName = filename || "dokument";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "application/octet-stream" }), safeName);
  form.append("filename", safeName);
  form.append("lang", langs);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const headers: Record<string, string> = {};
    if (token) {
      // Rogers app.py prueft X-Shared-Secret. Der zweite Name kostet nichts
      // und haelt die Anbindung offen, falls der Endpunkt wechselt.
      headers["X-Shared-Secret"] = token;
      headers["X-OCR-Token"] = token;
    }

    const resp = await fetch(url, { method: "POST", headers, body: form, signal: ctrl.signal });

    if (!resp.ok) {
      console.error(`[ocr] ${safeName}: HTTP ${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 400));
      return "";
    }

    const raw = await resp.text();
    let text = parseOcrResponse(raw);

    // Der Container antwortet auch im Fehlerfall mit HTTP 200 und schreibt die
    // Meldung ins Textfeld. Ungefiltert landet sie als Volltext im Suchindex.
    if (/^\[OCR[- ]?Fehler/i.test(text.trim())) {
      console.error(`[ocr] ${safeName}: Container meldet ${text.trim().slice(0, 300)}`);
      text = "";
    }
    console.info(`[ocr] ${safeName}: ${text.length} Zeichen erkannt`);
    return text.slice(0, MAX_CHARS);
  } catch (e) {
    const grund = (e as Error)?.name === "AbortError"
      ? `Zeitgrenze ${timeout} ms erreicht`
      : String((e as Error)?.message || e);
    console.error(`[ocr] ${safeName}: fehlgeschlagen -- ${grund}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Nimmt JSON mit text-Feld oder reinen Text entgegen. */
function parseOcrResponse(raw: string): string {
  const body = (raw || "").trim();
  if (!body) return "";
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const j = JSON.parse(body);
      if (typeof j?.text === "string") return j.text;
      if (typeof j?.content === "string") return j.content;
      if (typeof j?.result === "string") return j.result;
      if (j?.ok === false) {
        console.error("[ocr] Container meldet Fehler:", String(j?.error || j?.fehler || "").slice(0, 300));
        return "";
      }
      return "";
    } catch {
      // kein gueltiges JSON -- dann eben als Text behandeln
      return body;
    }
  }
  return body;
}
