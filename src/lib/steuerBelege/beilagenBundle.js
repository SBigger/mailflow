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
import { KATALOG_NACH_ID, VERZEICHNIS_NACH_ID, sortiereNachKatalog }
  from '../../forms/steuer_np_katalog.js';

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
  return p && !['arbeitspapiere', 'aussortiert'].includes(p.verzeichnis);
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

    // Nach dem INHALT entscheiden, nicht nach dem Namen: Ein Beleg heisst
    // «13.pdf · Seiten 1–2», die daraus gebaute Datei erbt diesen Namen und
    // endet damit nicht auf .pdf — pdf-lib versuchte sie als JPEG zu lesen
    // und warf «SOI not found in JPEG». Die ersten Bytes sind eindeutig.
    const istPdfDatei = bytes[0] === 0x25 && bytes[1] === 0x50
                     && bytes[2] === 0x44 && bytes[3] === 0x46;      // %PDF
    const istPngDatei = bytes[0] === 0x89 && bytes[1] === 0x50;      // PNG
    if (istPdfDatei) {
      const quelle = await PDFDocument.load(bytes, { ignoreEncryption: true });
      // Ein PDF kann mehrere Belege enthalten – dann steht in vonSeite/bisSeite,
      // welcher Teil zu DIESEM Beleg gehoert. Ohne das laege der ganze
      // 38-seitige Umbauordner bei jeder einzelnen Rechnung im Buendel.
      const alle = quelle.getPageIndices();
      const indizes = (beleg.vonSeite && beleg.bisSeite)
        ? alle.slice(beleg.vonSeite - 1, beleg.bisSeite)
        : alle;
      const seiten = await doc.copyPages(quelle, indizes);
      seiten.forEach(s => doc.addPage(s));
    } else {
      const bild = istPngDatei
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
  //
  // Zweistufig, weil sich beides gegenseitig bedingt: die Seitenzahl einer
  // Beilage steht erst fest, wenn klar ist, wie viele Deckblattseiten davor
  // liegen — und wie viele das sind, zeigt erst der Umbruch. Darum werden die
  // Zeilen zuerst gesammelt und umgebrochen (das haengt nur an ihrer Anzahl
  // und Hoehe, nicht an den Zahlen darin) und erst danach gezeichnet.
  //
  // Vorher war das Deckblatt fest einseitig: die Zeichenfunktion gab bei
  // Seitenende `false` zurueck und zeichnete nichts, den Rueckgabewert wertete
  // aber niemand aus. Bei einem Mandanten mit 51 Beilagen standen 22 im
  // Verzeichnis, der Rest fiel kommentarlos weg — ausgerechnet in dem
  // Dokument, das dem Steueramt als Index dient.

  // Die Standardschriften von pdf-lib können nur WinAnsi. Ein einziges «≥»
  // aus der Position «Qualifizierte Beteiligung (≥10%)» liess bisher das
  // ganze Bündel scheitern — mit einer Ausnahme tief in der Schriftbibliothek
  // und ohne brauchbare Meldung. Darum: Sonderzeichen vor dem Zeichnen auf
  // darstellbare Entsprechungen bringen, Unbekanntes fällt weg.
  const sichererText = (roh) => String(roh ?? '')
    .replace(/[≥]/g, '>=').replace(/[≤]/g, '<=')
    .replace(/[–—]/g, '-').replace(/[«»]/g, '"')
    .replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'")
    .replace(/[…]/g, '...').replace(/[·•]/g, '-')
    .replace(/[≠]/g, '!=').replace(/[±]/g, '+/-')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-ÿ]/g, '');

  const zeilen = [];
  const merke = (text, o = {}) => zeilen.push({ text, luft: 15, ...o });

  merke('Beilagenverzeichnis', { gross: true, luft: 22 });
  if (kopf.mandant)    merke(kopf.mandant, { luft: 13 });
  if (kopf.steuerjahr) merke(`Steuerperiode ${kopf.steuerjahr}`, { luft: 13 });
  merke(`${beilagen.length} Beilagen · erstellt ${kopf.erstelltAm || heute()}`,
        { grau: true, luft: 24 });

  let letztesVerz = null;
  for (const b of beilagen) {
    const p = KATALOG_NACH_ID[b.position];
    if (p.verzeichnis !== letztesVerz) {
      // Ein Gruppenkopf allein am Seitenfuss ist eine Ueberschrift ohne
      // Inhalt: er haelt den ersten Eintrag (zwei Zeilen) bei sich.
      merke(VERZEICHNIS_NACH_ID[p.verzeichnis]?.label || p.verzeichnis,
            { luft: 14, vorLuft: 6, zusammen: 2 });
      letztesVerz = p.verzeichnis;
    }
    // Die Seitenzahl bleibt roh — erst der Umbruch weiss, was davorkommt.
    merke(null, { rohSeite: startSeiten.get(b.id ?? b.name), label: p.label,
                  einzug: 12, luft: 12, zusammen: 1 });
    merke(b.name, { einzug: 52, grau: true, luft: 13 });
  }

  if (nichtBeigelegt.length) {
    merke('Gesichtet, nicht beigelegt', { luft: 14, vorLuft: 10 });
    for (const b of nichtBeigelegt) {
      const p = KATALOG_NACH_ID[b.position];
      merke(`${b.name} — ${p.label}`, { einzug: 12, grau: true, luft: 12 });
    }
  }

  // Umbruch. Folgeseiten bekommen eine Fortsetzungszeile, damit ein
  // mehrseitiges Verzeichnis auch als eines erkennbar ist.
  const deckZeilen = [];
  {
    let aktuell = null, y = 0;
    const neueSeite = () => {
      aktuell = [];
      deckZeilen.push(aktuell);
      y = A4[1] - RAND;
      if (deckZeilen.length > 1) {
        aktuell.push({ text: 'Beilagenverzeichnis (Fortsetzung)', gross: true, y });
        y -= 22;
      }
    };
    neueSeite();
    zeilen.forEach((z, i) => {
      // Zeilen, die zusammengehoeren, brauchen gemeinsam Platz. Sonst reisst
      // der Umbruch die Positionszeile vom Dateinamen darunter, und der Name
      // steht verwaist unter der Fortsetzungszeile der Folgeseite.
      const reserve = zeilen.slice(i + 1, i + 1 + (z.zusammen || 0))
        .reduce((summe, n) => summe + (n.vorLuft || 0) + n.luft, 0);
      if (y - (z.vorLuft || 0) - reserve < RAND + 20) neueSeite();
      y -= (z.vorLuft || 0);
      aktuell.push({ ...z, y });
      y -= z.luft;
    });
  }

  const decks = deckZeilen.map((_, i) => doc.insertPage(i, A4));

  deckZeilen.forEach((seitenZeilen, i) => {
    for (const z of seitenZeilen) {
      // Jetzt steht die Verschiebung fest: alle Deckblattseiten liegen davor.
      const text = z.rohSeite != null
        ? `${String(z.rohSeite + deckZeilen.length).padStart(3, ' ')}   ${z.label}`
        : z.text;
      decks[i].drawText(sichererText(text), {
        x: RAND + (z.einzug || 0), y: z.y,
        size: z.gross ? 13 : 9,
        font: z.gross ? fett : normal,
        color: z.grau ? rgb(0.45, 0.45, 0.45) : rgb(0.1, 0.1, 0.1),
      });
    }
  });

  return doc.save();
}

function heute() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
