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

/**
 * Kennzahlen eines Belegs: Rechnungs-, Kunden- und Policennummern sowie
 * Beträge. Sie sind das, was zwei Belege desselben Absenders unterscheidet.
 *
 * Warum das nötig wurde: Ein Stapel Quartalsrechnungen der Stadtwerke für
 * dieselbe Liegenschaft teilt Briefkopf, Adresse, Tarifzeilen und Floskeln —
 * gemessen 0.80 bis 0.87 Wortübereinstimmung. Ohne diese Prüfung erklärte die
 * Doppelerkennung drei echte Rechnungen zu Kopien und warf sie aus dem Bündel.
 */
export function kennzahlen(text) {
  const menge = new Set();
  for (const m of String(text || '').matchAll(/\b\d[\d'’.,\s-]{2,}\d\b/g)) {
    const ziffern = m[0].replace(/\D/g, '');
    // Vierstellig aufwärts: Nummern und Beträge. Kürzeres sind Mengen,
    // Tarife und Datumsteile — die wiederholen sich auf jedem Formular.
    if (ziffern.length >= 4 && ziffern.length <= 16) menge.add(ziffern);
  }
  return menge;
}

/** Anteil gemeinsamer Kennzahlen (0–1). */
export function kennzahlDeckung(a, b) {
  if (!a.size || !b.size) return 1;      // keine Aussage möglich
  let gleich = 0;
  for (const x of a) if (b.has(x)) gleich++;
  return gleich / Math.max(a.size, b.size);
}

// Zwei Scans DESSELBEN Papiers teilen auch ihre Zahlen; OCR-Rauschen
// verändert einzelne, aber nicht die Mehrheit. Liegt die Deckung darunter,
// sind es verschiedene Belege — egal wie ähnlich der Fliesstext ist.
export const KENNZAHL_MINDEST = 0.5;

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

  const kzNeu = kennzahlen(neuer.text);

  let bester = null;
  for (const alt of vorhandene) {
    if (!alt.text || alt.doppelVon) continue;      // Doppel nicht als Original nehmen
    const score = aehnlichkeit(mengeNeu, wortmenge(alt.text));
    if (score < DOPPEL_SCHWELLE) continue;
    // Gegenprobe an den Kennzahlen: gleiche Vorlage, andere Nummern und
    // Beträge = zwei Rechnungen, keine Kopie.
    const deckung = kennzahlDeckung(kzNeu, kennzahlen(alt.text));
    if (deckung < KENNZAHL_MINDEST) continue;
    if (!bester || score > bester.score) {
      bester = { doppelVon: alt.id, name: alt.name, score: Number(score.toFixed(2)) };
    }
  }
  return bester;
}
