/**
 * Beilagenbündel: das Verzeichnis muss ALLE Beilagen nennen — und zwar mit
 * der Seitenzahl, auf der sie wirklich liegen.
 *
 * Das Deckblatt ist der Index, den das Steueramt liest. Solange es einseitig
 * war, fiel alles weg, was nicht auf eine A4-Seite passte, ohne jeden Hinweis:
 * bei einem echten Mandanten mit 51 Beilagen standen 22 drin, die Beilagen ab
 * Bündelseite 35 hatten überhaupt keinen Eintrag mehr.
 *
 *   node --test tests/steuern/*.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

import { baueBeilagenBundle } from '../../src/lib/steuerBelege/beilagenBundle.js';

const require = createRequire(import.meta.url);
const logAlt = console.log;
console.log = () => {};
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
console.log = logAlt;
const SCHRIFTEN = join(
  dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), '..', '..', 'standard_fonts/');

/** Einseitiges PDF mit etwas Text — steht für einen eingescannten Beleg. */
async function belegPdf(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(text, { x: 50, y: 780, size: 11, font });
  return doc.save();
}

/**
 * Minimales File-Ersatzobjekt. baueBeilagenBundle braucht von der Datei nur
 * `name` und `arrayBuffer()` — kein Grund, im Test einen Browser zu bauen.
 */
function alsDatei(name, bytes) {
  return { name, arrayBuffer: async () => bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

/**
 * Seiten des Bündels als Liste ihrer Textzeilen.
 *
 * Die Zeilen werden über die Koordinaten rekonstruiert, nicht aus den
 * Textstücken zusammengeklebt: pdfjs zerlegt eine einzelne gezeichnete Zeile
 * in beliebig viele Stücke («4», « », «Unselbständige …»), und wer die Stücke
 * naiv paarweise liest, findet gar keine Einträge — und prüft dann fröhlich
 * nichts. Gruppiert wird nach y, sortiert nach x.
 */
async function seitenZeilen(bytes) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: SCHRIFTEN,
  }).promise;
  const seiten = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const inhalt = await (await pdf.getPage(i)).getTextContent();
    const nachY = new Map();
    for (const it of inhalt.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      if (!nachY.has(y)) nachY.set(y, []);
      nachY.get(y).push(it);
    }
    seiten.push([...nachY.entries()]
      .sort((a, b) => b[0] - a[0])                       // oben zuerst
      .map(([, stuecke]) => stuecke
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(x => x.str).join('').trim())
      .filter(Boolean));
  }
  await pdf.destroy();
  return seiten;
}

/** N Beilagen über mehrere Verzeichnisse verteilt. */
async function baueBelege(n) {
  const positionen = ['lohn_haupt', 'wertschriften', 'saeule_3a',
                      'versicherungspraemien', 'liegenschaft_ertrag'];
  const belege = [];
  for (let i = 0; i < n; i++) {
    belege.push({
      id: `b${i}`,
      name: `beleg_${String(i + 1).padStart(2, '0')}.pdf`,
      position: positionen[i % positionen.length],
      datei: alsDatei(`beleg_${i + 1}.pdf`, await belegPdf(`Beleg Nummer ${i + 1}`)),
    });
  }
  return belege;
}

/** Wie viele Seiten vorne sind Deckblatt. */
const deckblattSeiten = seiten =>
  seiten.filter(s => s.some(t => t.startsWith('Beilagenverzeichnis'))).length;

/**
 * Die Einträge des Verzeichnisses als {seite, name}.
 *
 * Je Eintrag zwei Zeilen: «4 Positionsname», darunter der Dateiname. Die
 * Bedingung an die Folgezeile ist nicht Zierde: die Kopfzeile «51 Beilagen ·
 * erstellt …» beginnt ebenfalls mit einer Zahl und wäre sonst ein Eintrag,
 * der auf Seite 51 zeigt. (Gilt für diese Testbelege, die alle .pdf heissen.)
 */
function eintraege(seiten, deck) {
  const zeilen = seiten.slice(0, deck).flat();
  const gefunden = [];
  for (let i = 0; i < zeilen.length - 1; i++) {
    const m = zeilen[i].match(/^(\d+)\s+\S/);
    if (m && /\.pdf$/i.test(zeilen[i + 1])) {
      gefunden.push({ seite: Number(m[1]), name: zeilen[i + 1].trim() });
    }
  }
  return gefunden;
}

test('nennt bei 51 Beilagen auch alle 51 im Verzeichnis', async () => {
  const belege = await baueBelege(51);
  const seiten = await seitenZeilen(await baueBeilagenBundle(belege, {
    mandant: 'Dominik Muster', steuerjahr: 2025, erstelltAm: '19.08.2026',
  }));
  const deck = deckblattSeiten(seiten);

  assert.ok(deck >= 2, `Verzeichnis muss mehrseitig sein, war ${deck}`);
  assert.ok(seiten[0].some(t => t.includes('51 Beilagen')));
  assert.ok(seiten[1].some(t => t.includes('Fortsetzung')),
            'Folgeseite muss als Fortsetzung erkennbar sein');

  // Das war der Bug: jede einzelne Beilage muss im Verzeichnis auftauchen.
  const genannt = new Set(eintraege(seiten, deck).map(e => e.name));
  for (const b of belege) {
    assert.ok(genannt.has(b.name), `fehlt im Verzeichnis: ${b.name}`);
  }
  assert.equal(genannt.size, 51);
});

test('jede Verzeichniszeile zeigt auf die Seite, wo der Beleg wirklich liegt', async () => {
  // Der heikle Teil am mehrseitigen Deckblatt: die Beilagen verschieben sich
  // um die Anzahl Deckblattseiten, nicht mehr um genau eine. Geprüft wird
  // darum nicht die Zahl an sich, sondern ob an der genannten Stelle auch
  // der genannte Beleg steht.
  const belege = await baueBelege(51);
  const seiten = await seitenZeilen(await baueBeilagenBundle(belege, {
    mandant: 'M', steuerjahr: 2025,
  }));
  const deck = deckblattSeiten(seiten);

  assert.equal(seiten.length, deck + 51, 'Deckblatt plus je eine Seite pro Beilage');

  const gefunden = eintraege(seiten, deck);
  // Ohne diese Zeile prüft die Schleife im Zweifel nichts und meldet Erfolg.
  assert.equal(gefunden.length, 51, 'der Parser muss alle Einträge finden');

  for (const e of gefunden) {
    // beleg_07.pdf enthält «Beleg Nummer 7»
    const nummer = Number(e.name.match(/\d+/)[0]);
    const seite = seiten[e.seite - 1];
    assert.ok(seite, `Verzeichnis nennt Seite ${e.seite}, die es nicht gibt`);
    assert.ok(seite.some(t => t.trim() === `Beleg Nummer ${nummer}`),
              `Verzeichnis schickt ${e.name} auf Seite ${e.seite}, dort steht: ${seite.join(' ')}`);
  }
});

test('bleibt bei wenigen Beilagen einseitig', async () => {
  // Der Normalfall darf durch den Umbruch nicht teurer werden.
  const belege = await baueBelege(5);
  const seiten = await seitenZeilen(await baueBeilagenBundle(belege, {
    mandant: 'M', steuerjahr: 2025,
  }));

  assert.equal(deckblattSeiten(seiten), 1);
  assert.ok(!seiten.some(s => s.some(t => t.includes('Fortsetzung'))));
  assert.equal(seiten.length, 1 + 5);
  const gefunden = eintraege(seiten, 1);
  assert.equal(gefunden.length, 5, 'der Parser muss alle Einträge finden');
  for (const e of gefunden) {
    const nummer = Number(e.name.match(/\d+/)[0]);
    assert.ok(seiten[e.seite - 1].some(t => t.trim() === `Beleg Nummer ${nummer}`));
  }
});

test('ein «≥» im Positionsnamen bringt das Bündel nicht zu Fall', async () => {
  // Die Standardschriften von pdf-lib können nur WinAnsi. Ein «≥» aus
  // «Qualifizierte Beteiligung (≥10%)» warf eine Ausnahme tief in der
  // Schriftbibliothek und liess das ganze Bündel scheitern. Der Schutz sitzt
  // im Zeichenpfad des Deckblatts — und genau der wurde für den Umbruch neu
  // geschrieben, muss hier also erneut nachgewiesen werden.
  const belege = [{
    id: 'q1', name: 'beteiligung.pdf', position: 'beteiligung_qualifiziert',
    datei: alsDatei('beteiligung.pdf', await belegPdf('Beleg Nummer 1')),
  }];

  const seiten = await seitenZeilen(await baueBeilagenBundle(belege, {
    mandant: 'Muster «Söhne» AG', steuerjahr: 2025, erstelltAm: '19.08.2026',
  }));

  const verzeichnis = seiten[0].join(' ');
  assert.ok(verzeichnis.includes('>=10%'), 'das ≥ muss ersetzt sein, nicht verschluckt');
  assert.ok(!verzeichnis.includes('≥'));
  assert.ok(verzeichnis.includes('"Söhne"'), 'auch « » werden ersetzt');
  assert.equal(seiten.length, 2);
});

test('erkennt ein PDF am Inhalt, nicht an der Dateiendung', async () => {
  // Ein getrennter Beleg heisst «13.pdf · Seiten 1–2»; die daraus gebaute
  // Datei erbt den Namen und endet nicht auf .pdf. pdf-lib versuchte sie dann
  // als JPEG zu lesen und warf «SOI not found in JPEG». Die ersten Bytes sind
  // eindeutig — %PDF.
  const belege = [{
    id: 'x1', name: '13.pdf · Seiten 1–2', position: 'lohn_haupt',
    datei: alsDatei('13.pdf · Seiten 1–2', await belegPdf('Beleg Nummer 1')),
  }];

  const seiten = await seitenZeilen(await baueBeilagenBundle(belege, {
    mandant: 'M', steuerjahr: 2025,
  }));

  // Als PDF eingelesen: genau eine Beilagenseite mit dem Text darauf.
  assert.equal(seiten.length, 2, 'Deckblatt plus die eine Beilage');
  assert.ok(seiten[1].some(t => t.trim() === 'Beleg Nummer 1'),
            'der Beleg muss als PDF-Seite drin sein, nicht als Bild');
});
