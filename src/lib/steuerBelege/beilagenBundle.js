// Erzeugt aus den sortierten Belegen ein einziges PDF in der Reihenfolge der
// Steuererklärung, mit Beilagenverzeichnis als Deckblatt.
//
// Damit zahlt sich das Sortieren aus: heraus kommt der Stapel, den man dem
// Steueramt beilegt, und das Verzeichnis dazu.
//
// Was NICHT ins Bündel kommt: Arbeitspapiere (Seite 0) und Aussortiertes.
// Beides steht aber auf dem Deckblatt, damit nichts unbemerkt verschwindet –
// wer den Stapel später prüft, sieht, dass es gesehen und bewusst nicht
// beigelegt wurde.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { KATALOG_NACH_ID, sortiereNachKatalog } from '../../forms/steuer_np_katalog.js';

const A4 = [595.28, 841.89];
const RAND = 56;

/** Belege in Erklärungsreihenfolge, ohne die ohne Position. */
export function bundelReihenfolge(belege) {
  return sortiereNachKatalog(
    belege.filter(b => b.position && KATALOG_NACH_ID[b.position]),
    b => b.position,
  );
}

function istBeilage(beleg) {
  const p = KATALOG_NACH_ID[beleg.position];
  return p && p.seite >= 1 && p.seite <= 4;
}

/**
 * @param {Array} belege  { name, position, datei (File), ... }
 * @param {object} kopf   { mandant, steuerjahr, erstelltAm }
 * @returns {Promise<Uint8Array>}
 */
export async function baueBeilagenBundle(belege, kopf = {}) {
  const sortiert = bundelReihenfolge(belege);
  const beilagen = sortiert.filter(istBeilage);
  const nichtBeigelegt = sortiert.filter(b => !istBeilage(b));

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett   = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Deckblatt: Beilagenverzeichnis ──────────────────────────────────────
  // Die Seitenzahlen werden erst gefüllt, wenn die Belege drin sind – darum
  // hier nur merken, wo welcher Beleg anfängt.
  const startSeiten = new Map();

  const anhaengen = async (beleg) => {
    const datei = beleg.datei;
    if (!datei) return 0;
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const vorher = doc.getPageCount();

    if (/\.pdf$/i.test(datei.name)) {
      const quelle = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const seiten = await doc.copyPages(quelle, quelle.getPageIndices());
      seiten.forEach(s => doc.addPage(s));
    } else {
      const bild = /\.png$/i.test(datei.name)
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const seite = doc.addPage(A4);
      const skala = Math.min((A4[0] - 2 * RAND) / bild.width, (A4[1] - 2 * RAND) / bild.height, 1);
      seite.drawImage(bild, {
        x: (A4[0] - bild.width * skala) / 2,
        y: (A4[1] - bild.height * skala) / 2,
        width: bild.width * skala, height: bild.height * skala,
      });
    }
    return doc.getPageCount() - vorher;
  };

  // Platzhalter fürs Deckblatt – wird ganz am Schluss nach vorne geschoben
  for (const b of beilagen) {
    startSeiten.set(b.id ?? b.name, doc.getPageCount() + 1);
    await anhaengen(b);
  }

  // ── Deckblatt bauen und nach vorne stellen ──────────────────────────────
  const deck = doc.insertPage(0, A4);
  let y = A4[1] - RAND;

  const zeile = (text, { gross = false, grau = false, einzug = 0, luft = 15 } = {}) => {
    if (y < RAND + 40) return false;                 // Deckblatt bleibt einseitig
    deck.drawText(String(text), {
      x: RAND + einzug, y,
      size: gross ? 13 : 9,
      font: gross ? fett : normal,
      color: grau ? rgb(0.45, 0.45, 0.45) : rgb(0.1, 0.1, 0.1),
    });
    y -= luft;
    return true;
  };

  zeile('Beilagenverzeichnis', { gross: true, luft: 22 });
  if (kopf.mandant)    zeile(kopf.mandant, { luft: 13 });
  if (kopf.steuerjahr) zeile(`Steuerperiode ${kopf.steuerjahr}`, { luft: 13 });
  zeile(`${beilagen.length} Beilagen · erstellt ${kopf.erstelltAm || heute()}`,
        { grau: true, luft: 24 });

  let letzteSeite = null;
  for (const b of beilagen) {
    const p = KATALOG_NACH_ID[b.position];
    if (p.seite !== letzteSeite) {
      y -= 6;
      zeile(`Seite ${p.seite} · ${gruppenName(p.seite)}`, { gross: false, luft: 14 });
      letzteSeite = p.seite;
    }
    // +1, weil das Deckblatt erst nach dem Zaehlen vorne eingeschoben wurde
    const ab = startSeiten.get(b.id ?? b.name) + 1;
    zeile(`${String(ab).padStart(3, ' ')}   ${p.label}`, { einzug: 12, luft: 12 });
    zeile(b.name, { einzug: 52, grau: true, luft: 13 });
  }

  if (nichtBeigelegt.length) {
    y -= 10;
    zeile('Gesichtet, nicht beigelegt', { luft: 14 });
    for (const b of nichtBeigelegt) {
      const p = KATALOG_NACH_ID[b.position];
      zeile(`${b.name} — ${p.label}`, { einzug: 12, grau: true, luft: 12 });
    }
  }

  return doc.save();
}

function gruppenName(seite) {
  return { 1: 'Allgemein', 2: 'Einkünfte', 3: 'Abzüge', 4: 'Vermögen' }[seite] || '';
}

function heute() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
