// Ergänzungen zur bestehenden Belegpipeline für Steuerbelege.
//
// Text und OCR kommen bewusst aus `batchAiSuggest.js` – dieselbe Pipeline, die
// die Fibu-Belegerkennung schon seit Monaten benutzt (digitale PDFs über pdfjs,
// Scans über Tesseract). Eine zweite Textextraktion daneben wäre eine zweite
// Baustelle mit denselben Fallstricken.
//
// Hier steht nur, was für Steuerbelege zusätzlich gebraucht wird. Bewusst ohne
// Re-Export aus batchAiSuggest.js: das zöge dessen Vite-Alias `@/api` mit und
// machte diese Datei ausserhalb des Browsers unbrauchbar. Wer Text braucht,
// importiert `extractDocumentText` direkt von dort.

/**
 * SHA-256 über den Dateiinhalt – Grundlage der Duplikatserkennung.
 * Bewusst über den Inhalt und nicht über den Dateinamen: derselbe Lohnausweis
 * heisst beim Mandanten anders als im Scan-Postfach, und im Stapel liegt er
 * regelmässig doppelt.
 */
export async function dateiHash(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * AHV-Nummer (756.XXXX.XXXX.XX) aus Text, OCR-tolerant.
 * Die Trennzeichenklasse enthält bewusst das Komma – OCR macht aus «.»
 * regelmässig ein «,». Gleiche Begründung wie bei der UID-Erkennung.
 *
 * Gebraucht für die Personenzuordnung bei gemeinsamer Veranlagung: Auf dem
 * Lohnausweis steht die AHVN13 der versicherten Person, und darüber lässt sich
 * ein Beleg sicher dem richtigen Ehegatten zuweisen – sicherer als über den
 * Namen, der auf Scans oft schlecht lesbar ist.
 */
export function findAhvInText(text) {
  if (!text) return null;
  const m = text.match(/756[.,\s-]*\d{4}[.,\s-]*\d{4}[.,\s-]*\d{2}/);
  if (!m) return null;
  const ziffern = m[0].replace(/[^0-9]/g, '');
  if (ziffern.length !== 13) return null;
  return `${ziffern.slice(0, 3)}.${ziffern.slice(3, 7)}.${ziffern.slice(7, 11)}.${ziffern.slice(11)}`;
}
