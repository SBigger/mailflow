// Doppelt eingescannte Belege erkennen.
//
// Der Datei-Hash fängt nur byte-identische Dateien. Zweimal eingescannt heisst
// aber: zwei VERSCHIEDENE Scans desselben Papiers — andere Pixel, anderer
// Hash, und die OCR liest jedes Mal leicht anders. Verglichen wird deshalb der
// erkannte Text: zwei Scans desselben Belegs teilen fast alle Wörter, zwei
// verschiedene Belege nicht — auch wenn beide vom selben Absender kommen.
//
// Gefundene Doppel werden NICHT gelöscht, sondern nach «Nicht benötigt»
// gelegt, mit Verweis auf das Original. Sie erscheinen auf dem Deckblatt des
// Bündels unter «Gesichtet, nicht beigelegt» — nichts verschwindet still.

/** Text zu einer Wortmenge einebnen — OCR-Rauschen fällt dabei weitgehend raus. */
export function wortmenge(text) {
  const flach = String(text || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ');
  const menge = new Set();
  for (const w of flach.split(/\s+/)) {
    // Kurze Wörter sind OCR-Schrott und Füllwörter; Zahlen bleiben drin,
    // weil Beträge und Rechnungsnummern die stärksten Merkmale sind.
    if (w.length >= 4 || /^\d{2,}$/.test(w)) menge.add(w);
  }
  return menge;
}

/** Jaccard-Ähnlichkeit zweier Wortmengen (0–1). */
export function aehnlichkeit(a, b) {
  if (!a?.size || !b?.size) return 0;
  let schnitt = 0;
  const [klein, gross] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of klein) if (gross.has(w)) schnitt++;
  return schnitt / (a.size + b.size - schnitt);
}

// Ab hier gilt ein Paar als Doppel. Bewusst hoch angesetzt: zwei
// verschiedene Rechnungen desselben Absenders teilen Briefkopf und
// Floskeln und erreichen damit typischerweise 0.4–0.6 — zwei Scans
// desselben Papiers liegen über 0.8.
export const DOPPEL_SCHWELLE = 0.78;

/**
 * Prüft einen neuen Beleg gegen die vorhandenen.
 *
 * @param {{text:string, belegart?:string, betrag?:number}} neuer
 * @param {Array<{id:string, name:string, text?:string, belegart?:string, betrag?:number, doppelVon?:string}>} vorhandene
 * @returns {{doppelVon:string, name:string, score:number}|null}
 */
export function findeDoppel(neuer, vorhandene) {
  const mengeNeu = wortmenge(neuer.text);
  if (mengeNeu.size < 12) return null;   // zu wenig Text für eine Aussage

  let bester = null;
  for (const alt of vorhandene) {
    if (!alt.text || alt.doppelVon) continue;      // Doppel nicht als Original nehmen
    const score = aehnlichkeit(mengeNeu, wortmenge(alt.text));
    if (score >= DOPPEL_SCHWELLE && (!bester || score > bester.score)) {
      bester = { doppelVon: alt.id, name: alt.name, score: Number(score.toFixed(2)) };
    }
  }
  return bester;
}
