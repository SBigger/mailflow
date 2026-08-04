/**
 * Text- und OCR-Extraktion für Steuerbelege.
 *
 * Übernommen aus MailFlow (src/lib/batchAiSuggest.js) und auf die
 * Belegtypen zugeschnitten, die in einem nP-Dossier vorkommen:
 * PDF, Bild, Text, XML. Tabellen- und Office-Formate sind bewusst
 * nicht dabei — ein Lohnausweis kommt nicht als PPTX.
 *
 * Bewährte Eigenschaften, die 1:1 übernommen wurden:
 *   - Tesseract wird lazy geladen, damit das Startbundle klein bleibt
 *   - PDFs mit weniger als 50 Zeichen Textlayer gelten als gescannt → OCR
 *   - der Worker wird wiederverwendet und explizit freigegeben
 */

import * as _pdfjsNs from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";

// pdfjs-dist ist je nach Vite-Mode UMD oder ESM
const pdfjsLib = (_pdfjsNs && typeof _pdfjsNs.getDocument === "function")
  ? _pdfjsNs
  : (_pdfjsNs?.default || _pdfjsNs);
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

// ══════════════════════════════════════════════════════════════════════
// OCR (Tesseract.js) — lazy
// ══════════════════════════════════════════════════════════════════════

let _ocrWorker = null;
let _ocrWorkerPromise = null;

async function getOcrWorker() {
  if (_ocrWorker) return _ocrWorker;
  if (_ocrWorkerPromise) return _ocrWorkerPromise;

  _ocrWorkerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    console.info("[OCR] Lade Tesseract (deu+eng+fra)…");
    // fra dazu: Belege aus der Westschweiz kommen bei Zuzügern regelmässig vor
    const worker = await createWorker(["deu", "eng", "fra"], 1, {
      logger: m => {
        if (m.status === "recognizing text") return;
        console.debug("[OCR]", m.status, m.progress ? Math.round(m.progress * 100) + "%" : "");
      },
    });
    _ocrWorker = worker;
    return worker;
  })();

  return _ocrWorkerPromise;
}

/** OCR-Worker freigeben (z.B. beim Verlassen der Triage-Seite). */
export async function terminateOcr() {
  try { if (_ocrWorker) await _ocrWorker.terminate(); } catch { /* egal */ }
  _ocrWorker = null;
  _ocrWorkerPromise = null;
}

async function ocrBlob(blobOrCanvas) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(blobOrCanvas);
  return (data?.text || "").trim();
}

/** Rendert PDF-Seiten und lässt OCR darüber laufen. */
async function ocrPdfPages(pdf, maxPages = 5) {
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    // 2× Skalierung: Belege sind oft klein gedruckt, 1× verliert Beträge
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    text += (await ocrBlob(canvas)) + "\n";
  }
  return text.trim();
}

// ══════════════════════════════════════════════════════════════════════
// Extraktion
// ══════════════════════════════════════════════════════════════════════

/**
 * Liest einen Beleg ein und bestimmt dabei gleich die Parse-Methode.
 *
 * Die Parse-Methode ist für die Triage wichtiger als der Text selbst:
 * Ein strukturiert gelesener Beleg braucht keine KI-Klassifikation mehr.
 *
 * @returns {Promise<{text: string, xml: string|null, parseMethode: string}>}
 */
export async function extractBeleg(file, { onStage } = {}) {
  const leer = { text: "", xml: null, parseMethode: "ocr" };
  if (!file) return leer;

  const name = (file.name || "").toLowerCase();
  const type = file.type || "";
  const report = (s, i) => { try { onStage?.(s, i); } catch { /* egal */ } };

  try {
    // ─── XML: eSteuerauszug oder andere strukturierte Quelle ────────
    if (type === "text/xml" || type === "application/xml" || name.endsWith(".xml")) {
      const xml = await file.text();
      return { text: xml.slice(0, 100000), xml, parseMethode: "ech0196" };
    }

    // ─── PDF ────────────────────────────────────────────────────────
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

      let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      text = text.trim();

      // Wenig Text → gescannt → OCR
      if (text.length < 50) {
        report("ocr", "Gescanntes PDF → OCR läuft…");
        try {
          const ocrText = await ocrPdfPages(pdf, 5);
          if (ocrText.length > text.length) text = ocrText;
          report("ocr-done", `OCR fertig (${text.length} Zeichen)`);
          return { text: text.slice(0, 100000), xml: null, parseMethode: "ocr" };
        } catch (e) {
          report("ocr-error", e.message || String(e));
          return { text: text.slice(0, 100000), xml: null, parseMethode: "ocr" };
        }
      }
      return { text: text.slice(0, 100000), xml: null, parseMethode: "pdf_text" };
    }

    // ─── Bilder ─────────────────────────────────────────────────────
    if (type.startsWith("image/") || /\.(png|jpg|jpeg|webp|bmp|tiff?)$/i.test(name)) {
      report("ocr", "Bild → OCR läuft…");
      try {
        const text = await ocrBlob(file);
        report("ocr-done", `OCR fertig (${text.length} Zeichen)`);
        return { text: text.slice(0, 100000), xml: null, parseMethode: "ocr" };
      } catch (e) {
        report("ocr-error", e.message || String(e));
        return leer;
      }
    }

    // ─── Text ───────────────────────────────────────────────────────
    if (type.startsWith("text/") || name.endsWith(".txt")) {
      return { text: (await file.text()).slice(0, 100000), xml: null, parseMethode: "pdf_text" };
    }

    return leer;
  } catch (e) {
    console.warn("[Beleg] Extraktion fehlgeschlagen für", file.name, e);
    return leer;
  }
}

/**
 * SHA-256 über den Dateiinhalt — Grundlage der Duplikatserkennung.
 * Bewusst über den Inhalt, nicht über den Dateinamen: derselbe Lohnausweis
 * heisst beim Kunden anders als im Portal.
 */
export async function dateiHash(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Schweizer UID aus Text, OCR-tolerant.
 * Übernommen aus MailFlow — die Trennzeichenklasse enthält bewusst das Komma,
 * weil OCR aus "." regelmässig "," macht (CHE-116.303,292).
 */
export function findUidInText(text) {
  if (!text) return null;
  const m = text.match(/CHE[.\-\s]*\d{3}[.,\s\-]*\d{3}[.,\s\-]*\d{3}/i);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9]/g, "");
  if (digits.length !== 9) return null;
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

/**
 * AHV-Nummer (756.XXXX.XXXX.XX) aus Text, OCR-tolerant.
 * Wird für die Personenzuordnung gebraucht — und danach sofort gehasht.
 */
export function findAhvInText(text) {
  if (!text) return null;
  const m = text.match(/756[.,\s-]*\d{4}[.,\s-]*\d{4}[.,\s-]*\d{2}/);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9]/g, "");
  if (digits.length !== 13) return null;
  return `${digits.slice(0, 3)}.${digits.slice(3, 7)}.${digits.slice(7, 11)}.${digits.slice(11)}`;
}
