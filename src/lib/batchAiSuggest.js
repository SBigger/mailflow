/**
 * batchAiSuggest.js
 *
 * Helpers für die Massenablage: Datei-Text extrahieren (inkl. OCR für Bilder
 * und gescannte PDFs) und lokales Matching (Kunde, Jahr, Kategorie, Tags/Subtags).
 * Komplett unabhängig vom Einzelupload-Flow.
 *
 * Reihenfolge der Erkennung:
 *   1. UID (CHE-XXX.XXX.XXX) im Text oder Dateinamen → customers.portal_uid
 *   2. Firmenname als Substring → customers.company_name
 *   3. Jahr aus Dateinamen (oder Text)
 *   4. Kategorie anhand Keyword-Liste
 *   5. Tags/Subtags: Name aus dok_tags im Text gefunden (Subtag zieht Parent mit)
 *
 * Falls kein Kunde gefunden wird → Status "parked".
 */

import * as _pdfjsNs from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";
import { supabase } from "@/api/supabaseClient";
// pdfjs-dist 3.11 ist UMD → je nach Vite-Mode ist der Namespace `{default: {...}}` oder direkt {...}
const pdfjsLib = (_pdfjsNs && typeof _pdfjsNs.getDocument === "function") ? _pdfjsNs : (_pdfjsNs?.default || _pdfjsNs);
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

// ══════════════════════════════════════════════════════════════════════
// OCR (Tesseract.js) – lazy load, damit initialer Bundle-Size klein bleibt
// ══════════════════════════════════════════════════════════════════════

let _ocrWorker = null;
let _ocrWorkerPromise = null;

async function getOcrWorker() {
  if (_ocrWorker) return _ocrWorker;
  if (_ocrWorkerPromise) return _ocrWorkerPromise;

  _ocrWorkerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    console.info("[OCR] Lade Tesseract (deu+eng)…");
    const worker = await createWorker(["deu", "eng"], 1, {
      logger: m => {
        if (m.status === "recognizing text") return;
        console.debug("[OCR]", m.status, m.progress ? Math.round(m.progress*100)+"%" : "");
      },
    });
    console.info("[OCR] Bereit");
    _ocrWorker = worker;
    return worker;
  })();

  return _ocrWorkerPromise;
}

/** Freigabe des OCR-Workers (z. B. beim Schließen des Dialogs) */
export async function terminateOcr() {
  try {
    if (_ocrWorker) await _ocrWorker.terminate();
  } catch {}
  _ocrWorker = null;
  _ocrWorkerPromise = null;
}

async function ocrBlob(blobOrCanvas) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(blobOrCanvas);
  return (data?.text || "").trim();
}

/**
 * Rendert die ersten N PDF-Seiten zu JPEG-base64.
 * Wird an Claude Vision geschickt, wenn lokale Text-Extraktion leer ist.
 */
export async function pdfPagesToImages(file, maxPages = 2) {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    const pages = Math.min(pdf.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const data = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
      out.push(data);
    }
    return out;
  } catch (e) {
    console.warn("[BatchUpload] PDF→Image fehlgeschlagen:", e);
    return [];
  }
}

/** File → base64 (für Bilder). */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Rendert PDF-Seiten zu Canvas und OCRt sie (max. 5 Seiten für Geschwindigkeit). */
async function ocrPdfPages(pdf, maxPages = 5) {
  let text = "";
  const pages = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    try {
      const pageText = await ocrBlob(canvas);
      text += pageText + "\n";
    } catch (e) {
      console.warn("[OCR] PDF-Seite fehlgeschlagen", i, e);
    }
  }
  return text.trim();
}

// ══════════════════════════════════════════════════════════════════════
// Text-Extraktion
// ══════════════════════════════════════════════════════════════════════

/**
 * Extrahiert Text aus verschiedenen Dateitypen. Reine Browser-Operation.
 * Fallback auf OCR für Bilder und gescannte PDFs.
 * Max. 100'000 Zeichen Ergebnis.
 */
export async function extractDocumentText(file, { onStage } = {}) {
  if (!file) return "";
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";
  const report = (s, i) => { try { onStage?.(s, i); } catch {} };
  try {
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

      // Wenn das PDF keinen/kaum Text hat → wahrscheinlich gescannt → OCR
      if (text.length < 50) {
        console.info("[BatchUpload] PDF enthält wenig Text → OCR-Fallback", file.name);
        report("ocr", "Gescanntes PDF → OCR läuft…");
        try {
          const ocrText = await ocrPdfPages(pdf, 5);
          if (ocrText.length > text.length) text = ocrText;
          report("ocr-done", `OCR fertig (${text.length} Zeichen)`);
        } catch (e) {
          console.error("[OCR] PDF fehlgeschlagen:", e);
          report("ocr-error", e.message || String(e));
        }
      }
      return text.slice(0, 100000);
    }

    // ─── Excel / CSV ────────────────────────────────────────────────
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      const { read, utils } = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb  = read(new Uint8Array(buf), { type: "array" });
      let text  = "";
      for (const sheetName of wb.SheetNames) {
        const ws   = wb.Sheets[sheetName];
        const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
        text += rows.map(r => r.join(" ")).join("\n") + "\n";
      }
      return text.trim().slice(0, 100000);
    }

    // ─── DOCX ───────────────────────────────────────────────────────
    if (name.endsWith(".docx")) {
      const { default: JSZip } = await import("jszip");
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const xml = await zip.file("word/document.xml")?.async("text") || "";
      return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100000);
    }

    // ─── Plain Text ─────────────────────────────────────────────────
    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      return (await file.text()).slice(0, 100000);
    }

    // ─── Bilder → OCR ───────────────────────────────────────────────
    if (type.startsWith("image/") || /\.(png|jpg|jpeg|webp|bmp|tiff?)$/i.test(name)) {
      console.info("[BatchUpload] Bild → OCR", file.name);
      report("ocr", "Bild → OCR läuft…");
      try {
        const text = await ocrBlob(file);
        report("ocr-done", `OCR fertig (${text.length} Zeichen)`);
        return text.slice(0, 100000);
      } catch (e) {
        console.error("[OCR] Bild fehlgeschlagen:", e);
        report("ocr-error", e.message || String(e));
        return "";
      }
    }

    return "";
  } catch (e) {
    console.warn("[BatchUpload] Textextraktion fehlgeschlagen für", file.name, e);
    return "";
  }
}

// ══════════════════════════════════════════════════════════════════════
// String-Helpers
// ══════════════════════════════════════════════════════════════════════

export function normalizeText(s) {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findUidInText(text) {
  if (!text) return null;
  const m = text.match(/CHE[-\s]*\d{3}[.\s-]*\d{3}[.\s-]*\d{3}/i);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9]/g, "");
  if (digits.length !== 9) return null;
  return `CHE-${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}`;
}

// ══════════════════════════════════════════════════════════════════════
// Matching: Kunde
// ══════════════════════════════════════════════════════════════════════

/**
 * Sucht den Kunden in Text + Dateiname.
 * Reihenfolge: UID → Email → Firmenname (mit/ohne Rechtsform) →
 *              Kontaktperson → Strasse+Ort → PLZ+Firmenteil.
 *
 * Gibt pro Kunde einen Score, am Ende gewinnt der beste. Jeder Match ergibt
 * zusätzlich Punkte (UID=100, Firmenname=30+, Email=40, Strasse+Ort=25, …).
 */
export function matchCustomer(text, filename, customers) {
  if (!customers?.length) return null;
  const haystack = (text || "") + "\n" + (filename || "");
  const nHay = normalizeText(haystack);

  // ─── 1. UID-Treffer – bleibt ein Short-Circuit ─────────────────────
  const uid = findUidInText(haystack);
  if (uid) {
    const byUid = customers.find(c => {
      const cUid = (c.portal_uid || "").trim().toUpperCase().replace(/\s/g, "");
      return cUid === uid;
    });
    if (byUid) {
      return {
        customer_id: byUid.id,
        customer_name: byUid.company_name,
        confidence: 0.98,
        reason: `UID ${uid} gefunden`,
        method: "uid",
      };
    }
  }

  // ─── 2. Multi-Signal-Scoring ──────────────────────────────────────
  const scored = [];
  for (const c of customers) {
    const signals = [];
    let score = 0;

    // Firmenname (voll)
    const nFull = normalizeText(c.company_name || "");
    if (nFull.length >= 4 && nHay.includes(nFull)) {
      score += 50 + nFull.length;
      signals.push(`Firmenname "${c.company_name}"`);
    } else {
      // Firmenname ohne Rechtsform
      const nCore = nFull.replace(/\b(ag|gmbh|sa|sarl|ltd|inc|kg|ohg|kollektivgesellschaft|einzelfirma|verein|stiftung)\b/g, "").trim();
      if (nCore.length >= 4 && nHay.includes(nCore)) {
        score += 30 + nCore.length;
        signals.push(`Firmenname "${c.company_name}"`);
      }
    }

    // Email exakter Match
    const email = (c.email || "").toLowerCase().trim();
    if (email && email.length >= 5 && (text || "").toLowerCase().includes(email)) {
      score += 40;
      signals.push(`E-Mail ${email}`);
    }

    // Email-Domain
    if (email.includes("@")) {
      const domain = email.split("@")[1];
      if (domain && domain.length >= 5 && (text || "").toLowerCase().includes(domain)) {
        score += 10;
      }
    }

    // Strasse + Ort zusammen
    const nStrasse = normalizeText(c.strasse || "");
    const nOrt     = normalizeText(c.ort || "");
    const nPlz     = (c.plz || "").trim();
    const hasStrasse = nStrasse.length >= 5 && nHay.includes(nStrasse);
    const hasOrt     = nOrt.length >= 3 && nHay.includes(nOrt);
    const hasPlz     = nPlz.length >= 4 && (text || "").includes(nPlz);
    if (hasStrasse && (hasOrt || hasPlz)) {
      score += 35;
      signals.push(`Adresse ${c.strasse}, ${c.plz || ""} ${c.ort || ""}`.trim());
    } else if (hasStrasse) {
      score += 15;
      signals.push(`Strasse ${c.strasse}`);
    } else if (hasOrt && hasPlz) {
      score += 12;
      signals.push(`${c.plz} ${c.ort}`);
    }

    // Telefon
    const phone = (c.phone || "").replace(/[^\d]/g, "");
    if (phone.length >= 7) {
      const rawText = (text || "").replace(/[^\d]/g, "");
      if (rawText.includes(phone)) {
        score += 20;
        signals.push(`Tel ${c.phone}`);
      }
    }

    // Kontaktpersonen (aus JSON-Feld contact_persons)
    const contacts = Array.isArray(c.contact_persons) ? c.contact_persons : [];
    for (const cp of contacts) {
      const pVorname  = normalizeText(cp?.vorname || cp?.first_name || "");
      const pNachname = normalizeText(cp?.nachname || cp?.last_name || "");
      if (pNachname.length >= 4 && nHay.includes(pNachname)) {
        score += pVorname && nHay.includes(pVorname) ? 25 : 12;
        signals.push(`Kontakt ${cp.vorname || ""} ${cp.nachname || cp.last_name || ""}`.trim());
        break;
      }
    }

    if (score > 0) scored.push({ customer: c, score, signals });
  }

  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runner = scored[1];

  // Mindest-Score, damit kein Rauschen durchrutscht
  if (best.score < 20) return null;

  // Deutlicher Abstand zum Zweiten → hoher Confidence
  const margin = runner ? best.score / runner.score : 10;
  const confidence = best.score >= 80 ? 0.92
                    : best.score >= 50 ? 0.85
                    : best.score >= 30 ? 0.75
                    : 0.65;

  const method = margin >= 1.4 ? "multi-signal" : "multi-signal-ambiguous";
  const reason = best.signals.slice(0, 2).join(" + ");

  return {
    customer_id: best.customer.id,
    customer_name: best.customer.company_name,
    confidence: margin < 1.2 ? Math.max(0.55, confidence - 0.15) : confidence,
    reason: `${reason} → ${best.customer.company_name}`,
    method,
  };
}

/**
 * Scored alle Kunden (ohne Schwellwert) und liefert die Top-N.
 * Wird benutzt, um die Liste für Claude drastisch zu verkleinern (Rate-Limit!).
 */
export function scoreCustomers(text, filename, customers) {
  if (!customers?.length) return [];
  const haystack = (text || "") + "\n" + (filename || "");
  const nHay = normalizeText(haystack);
  const rawLower = (text || "").toLowerCase() + "\n" + (filename || "").toLowerCase();

  const scored = [];
  for (const c of customers) {
    let score = 0;
    const nFull = normalizeText(c.company_name || "");
    if (nFull.length >= 4 && nHay.includes(nFull)) score += 50 + nFull.length;
    else {
      const nCore = nFull.replace(/\b(ag|gmbh|sa|sarl|ltd|inc|kg|ohg|verein|stiftung)\b/g, "").trim();
      if (nCore.length >= 4 && nHay.includes(nCore)) score += 30 + nCore.length;
      else if (nFull.length >= 5) {
        // Teilstring: erstes Wort des Firmennamens
        const firstWord = nFull.split(/\s+/)[0];
        if (firstWord.length >= 5 && nHay.includes(firstWord)) score += 10;
      }
    }
    const email = (c.email || "").toLowerCase().trim();
    if (email.length >= 5 && rawLower.includes(email)) score += 40;
    else if (email.includes("@")) {
      const domain = email.split("@")[1];
      if (domain && domain.length >= 5 && rawLower.includes(domain)) score += 10;
    }
    const nStrasse = normalizeText(c.strasse || "");
    const nOrt     = normalizeText(c.ort || "");
    if (nStrasse.length >= 5 && nHay.includes(nStrasse)) score += 15;
    if (nOrt.length >= 3 && nHay.includes(nOrt))         score += 8;
    const nPlz = (c.plz || "").trim();
    if (nPlz.length >= 4 && (text || "").includes(nPlz)) score += 6;

    const contacts = Array.isArray(c.contact_persons) ? c.contact_persons : [];
    for (const cp of contacts) {
      const pNach = normalizeText(cp?.nachname || cp?.last_name || "");
      if (pNach.length >= 4 && nHay.includes(pNach)) { score += 12; break; }
    }
    if (score > 0) scored.push({ customer: c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ══════════════════════════════════════════════════════════════════════
// Matching: Jahr
// ══════════════════════════════════════════════════════════════════════

export function matchYear(filename, text) {
  const nameMatch = (filename || "").match(/\b(20\d{2})\b/);
  if (nameMatch) return { year: parseInt(nameMatch[1]), source: "filename" };
  const textMatch = (text || "").slice(0, 5000).match(/\b(20\d{2})\b/);
  if (textMatch) return { year: parseInt(textMatch[1]), source: "text" };
  return { year: new Date().getFullYear(), source: "fallback" };
}

// ══════════════════════════════════════════════════════════════════════
// Matching: Kategorie (7 feste Kategorien)
// ══════════════════════════════════════════════════════════════════════

// Reihenfolge = Priorität (erster Treffer gewinnt, Object-Keys in Insertion-Order).
// User-Vorgabe: Rechnungswesen → Steuern → MWST → Personal → Revision → Recht → Korrespondenz.
const CATEGORY_KEYWORDS = {
  rechnungswesen: [
    "bilanz", "erfolgsrechnung", "jahresabschluss", "buchhaltung",
    "kontoauszug", "konto-auszug", "hauptbuch", "kreditorenbuchhaltung",
    "debitorenbuchhaltung", "zwischenabschluss",
  ],
  steuern: [
    "steuererklaerung", "steuererklärung", "steuerveranlagung", "steueramt",
    "schlussrechnung steuer", "veranlagungsverfuegung", "kantonssteuer", "staatssteuer",
    "direkte bundessteuer", "quellensteuer",
  ],
  mwst: [
    "mwst-abrechnung", "mwst abrechnung", "mehrwertsteuer", "mehrwert-steuer",
    "formular 0550", "effektive methode", "saldosteuersatz", "mwst nr", "ust-id",
  ],
  personal: [
    "lohnabrechnung", "lohnjournal", "lohnausweis", "arbeitsvertrag",
    "ahv-abrechnung", "bvg", "unfallversicherung", "quellensteuer lohn",
    "anstellung", "kuendigung", "kündigung", "sozialversicherung",
  ],
  revision: [
    "revisionsbericht", "revisionsstelle", "pruefungsbericht", "prüfungsbericht",
    "eingeschraenkte revision", "eingeschränkte revision", "ordentliche revision",
  ],
  rechtsberatung: [
    "vollmacht", "kaufvertrag", "mietvertrag", "gesellschaftsvertrag",
    "rechtsberatung", "mahnung", "betreibung", "statuten",
  ],
  korrespondenz: [
    "sehr geehrte", "mit freundlichen gruessen", "mit freundlichen grüssen",
    "sehr geehrter",
  ],
};

export function matchCategory(text, filename) {
  const haystack = normalizeText((filename || "") + " " + (text || "").slice(0, 5000));
  if (!haystack) return null;

  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of kws) {
      const nkw = normalizeText(kw);
      if (nkw && haystack.includes(nkw)) {
        return { category: cat, matched: kw, confidence: 0.75 };
      }
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// Matching: Tags + Subtags (WICHTIG: Subtags zählen oft mehr als Parents)
// ══════════════════════════════════════════════════════════════════════

/**
 * Findet passende Tags/Subtags im Text.
 * Wenn ein Subtag (parent_id gesetzt) matcht, wird automatisch der Parent
 * mit vorgeschlagen – sonst ergäbe die Subtag-Zuordnung keinen Sinn.
 *
 * @param {string} text
 * @param {string} filename
 * @param {Array}  allTags    — komplette dok_tags-Tabelle {id, name, parent_id}
 * @returns {{tag_ids: string[], matched: Array<{id, name, isSubtag}>}}
 */
export function matchTags(text, filename, allTags) {
  if (!allTags?.length) return { tag_ids: [], matched: [] };

  const haystack = normalizeText((filename || "") + " " + (text || "").slice(0, 10000));
  if (!haystack) return { tag_ids: [], matched: [] };

  const byId = new Map(allTags.map(t => [t.id, t]));
  const found = [];

  for (const tag of allTags) {
    const rawName = tag?.name || "";
    if (rawName.length < 3) continue;  // zu kurz → zu viele False-Positives
    const nName = normalizeText(rawName);
    if (!nName) continue;

    // Wortgrenze prüfen, damit "fib" nicht in "filibuster" matcht
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(nName)}([^a-z0-9]|$)`);
    if (re.test(haystack)) {
      found.push({
        tag,
        score: nName.length + (tag.parent_id ? 2 : 0),  // Subtags bevorzugen
      });
    }
  }

  if (!found.length) return { tag_ids: [], matched: [] };

  // Höchster Score zuerst — es wird nur 1 Tag zugewiesen.
  // Subtags haben durch den +2-Score-Bonus Vorrang, Parent wird NICHT mitgenommen
  // (der Subtag selbst ist spezifischer und reicht).
  found.sort((a, b) => b.score - a.score);
  const top = found[0];
  void byId;

  return {
    tag_ids: [top.tag.id],
    matched: [{ id: top.tag.id, name: top.tag.name, isSubtag: !!top.tag.parent_id }],
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ══════════════════════════════════════════════════════════════════════
// Orchestrator
// ══════════════════════════════════════════════════════════════════════

/**
 * Analysiert eine einzelne Datei → gibt Vorschläge für alle Felder.
 *
 * @param {File}   file
 * @param {Object} context
 * @param {Array}  context.customers
 * @param {Array}  context.allTags    — dok_tags-Liste
 */
/**
 * Claude-Fallback über Supabase Edge Function.
 * Wird aufgerufen, wenn lokales Matching keinen Kunden sicher erkennen konnte.
 */
async function claudeSuggest({ filename, text, images, pdf }) {
  try {
    console.info(`[BatchUpload] → KI: ${filename} | text=${(text||"").length} pdf=${pdf ? "ja" : "nein"} images=${images?.length || 0}`);

    // 70s Hard-Timeout — sonst hängt die UI ewig, wenn die Edge Function stehen bleibt
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 70000);
    let data, error;
    try {
      const r = await supabase.functions.invoke("suggest-document-fields", {
        body: {
          // "auto" = OpenAI → Gemini → Claude Kette (damit Batches nicht an einem Anbieter-Ausfall sterben)
          provider: "auto",
          filename,
          text: (text || "").slice(0, 12000),
          images: Array.isArray(images) ? images.slice(0, 2) : [],
          pdf: pdf || "",
          // Kunden-/Tag-Liste wird NICHT mehr gesendet — das spart ~10k Tokens pro Call.
          // Die LLM liefert nur noch Text-Hints, das Matching zur Datenbank passiert lokal.
        },
        signal: ctrl.signal,
      });
      data = r.data; error = r.error;
    } catch (e) {
      if (e?.name === "AbortError") {
        return { error: "KI-Timeout nach 70s — Datei wurde geparkt" };
      }
      return { error: e?.message || String(e) };
    } finally {
      clearTimeout(timer);
    }
    if (error) {
      console.warn("[BatchUpload] Claude-Fallback Fehler:", error);
      return { error: error.message || String(error) };
    }
    if (data?.error) {
      console.warn("[BatchUpload] Claude-Fallback:", data.error);
      return { error: data.error };
    }
    return data;
  } catch (e) {
    console.warn("[BatchUpload] Claude-Fallback Exception:", e);
    return { error: e.message || String(e) };
  }
}

export async function analyzeFile(file, { customers = [], allTags = [], useClaude = true, onStage } = {}) {
  const filename = file.name || "";
  const report = (stage, info) => { try { onStage?.(stage, info); } catch {} };

  report("extract", "Text wird extrahiert…");
  let contentText = await extractDocumentText(file, { onStage: report });
  report("extracted", `${contentText.length} Zeichen extrahiert`);

  const customerMatch = matchCustomer(contentText, filename, customers);
  const yearMatch     = matchYear(filename, contentText);
  const categoryMatch = matchCategory(contentText, filename);
  const tagMatch      = matchTags(contentText, filename, allTags);

  let customerId  = customerMatch?.customer_id || null;
  let tagIds      = tagMatch.tag_ids;
  let category    = categoryMatch?.category || "";
  let year        = yearMatch.year;
  let confidence  = customerMatch?.confidence || 0;
  let reason      = customerMatch?.reason || "";
  let usedClaude  = false;

  // KI nur bei gescannten PDFs / Bildern aufrufen (wenn lokal kein Text extrahiert wurde).
  // Bei PDFs mit Text-Layer reicht lokales Matching — das ist ~20× schneller.
  // Falls der lokale Matcher den Kunden nicht findet, muss der User ihn halt manuell setzen.
  const shouldAskClaude = useClaude && contentText.length < 200;

  if (shouldAskClaude) {
    // Wenn kein oder wenig Text: PDF direkt (native Claude-Dokument-Unterstützung)
    // oder Bild als Base64 an Claude Vision. Kein pdfjs-Zwischenschritt nötig.
    let images = [];
    let pdf = "";
    const isPdf   = file.type === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(filename);

    if (contentText.length < 30) {
      if (isPdf) {
        report("vision", "Sende PDF an Claude Vision…");
        try {
          pdf = await fileToBase64(file);
        } catch (e) {
          console.warn("[BatchUpload] PDF→base64 fehlgeschlagen, Fallback auf pdfjs:", e);
          pdf = "";
          images = await pdfPagesToImages(file, 2);
        }
      } else if (isImage) {
        report("vision", "Sende Bild an Claude Vision…");
        try {
          images = [await fileToBase64(file)];
        } catch (e) { console.warn("[BatchUpload] fileToBase64 fehlgeschlagen:", e); }
      }
    }

    report("claude", (pdf || images.length)
      ? `KI-Vision analysiert…`
      : "KI analysiert Text…");
    const claude = await claudeSuggest({ filename, text: contentText, images, pdf });
    if (claude?.error) {
      report("claude-error", claude.error);
    }
    if (claude && !claude.error) {
      usedClaude = true;
      const modelUsed = claude.model_used || "KI";
      // Vision-OCR: wenn die KI den Inhalt aus dem Bild gelesen hat, diesen Text übernehmen.
      // WICHTIG: VOR dem Rematching, damit matchCustomer auf dem vollen OCR-Text läuft.
      if (claude.extracted_text && claude.extracted_text.length > contentText.length) {
        contentText = claude.extracted_text;
      }
      // ─── Lokales Re-Matching mit den KI-Hints ──────────────────────────
      // Die LLM liefert nur Firmenname/UID/Tag als Strings — Match auf UUIDs passiert hier.
      const hintHaystack = [contentText, claude.customer_name_hint, claude.customer_uid_hint]
        .filter(Boolean).join("\n");
      const rematchedCustomer = matchCustomer(hintHaystack, filename, customers);
      if (!customerId && rematchedCustomer) {
        customerId = rematchedCustomer.customer_id;
        confidence = rematchedCustomer.confidence;
        reason = `${modelUsed}: ${rematchedCustomer.reason}`;
      }
      if (tagIds.length === 0) {
        const tagHaystack = [contentText, claude.tag_name_hint].filter(Boolean).join("\n");
        const rematchedTags = matchTags(tagHaystack, filename, allTags);
        if (rematchedTags.tag_ids.length) tagIds = rematchedTags.tag_ids;
      }
      if (!category && claude.category) category = claude.category;
      if (claude.year && !filename.match(/\b20\d{2}\b/)) year = claude.year;
      console.info(`[BatchUpload] ← ${modelUsed}: ${filename} | hint="${claude.customer_name_hint || ""}" → customer=${customerId ? "ja" : "nein"} extracted=${(claude.extracted_text || "").length}`);
      report("claude-done", `${modelUsed} · ${claude.reason || "OK"}`);
    }
  }

  const status = customerId ? "ready" : "parked";

  return {
    contentText,
    suggestions: {
      customer_id: customerId,
      year,
      category,
      tag_ids: tagIds,
    },
    hints: {
      customer: reason || null,
      year:     yearMatch.source,
      category: categoryMatch?.matched || null,
      tags:     tagMatch.matched,
      claude:   usedClaude,
    },
    confidence,
    status,
    reason: reason || "Kein Kunde im Text erkannt — bitte manuell zuweisen",
  };
}
