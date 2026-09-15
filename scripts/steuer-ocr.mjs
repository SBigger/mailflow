#!/usr/bin/env node
/**
 * OCR für gescannte Belege — die zweite Hälfte des Erfassungs-Agenten.
 *
 * `steuer-erfassung.mjs` liest nur die eingebettete Textebene. Ein Bündel aus
 * dem Belegsortierungs-Modul besteht aber typischerweise aus einem generierten
 * Deckblatt und lauter Scans; ohne OCR bleiben 75 von 76 Seiten ungelesen.
 * Dieses Skript liest sie, und zwar hier, ohne Browser.
 *
 *   node scripts/steuer-ocr.mjs --datei beilagen.pdf --json seiten.json
 *   node scripts/steuer-erfassung.mjs --ordner . --ocr seiten.json --jahr 2025
 *
 * OCR ist teuer (rund 7 Sekunden je Seite), darum ein eigener Schritt mit
 * eigener Ausgabedatei: einmal lesen, danach beliebig oft auswerten.
 *
 * ── Was hier gelernt wurde ────────────────────────────────────────────────
 *
 * Drei Dinge, an denen ein naiver Anlauf scheitert und die deshalb im Code
 * ausdrücklich behandelt werden:
 *
 * 1. pdfjs liefert Bilddaten in drei verschiedenen Formaten. Gescannte Belege
 *    sind oft 1 Bit pro Pixel — wer die Bits als RGB-Bytes liest, bekommt
 *    Rauschen, und Tesseract meldet dafür brav eine leere Seite statt eines
 *    Fehlers. Ein stiller Totalausfall.
 * 2. Scanner legen A4 gern quer ab und lassen das PDF die Seite drehen. Steht
 *    der Text im Bild auf der Seite, liest Tesseract nichts. Die Drehung wird
 *    darum gemessen, nicht angenommen.
 * 3. tesseract.js schickt das Bild über einen Worker-Kanal. Ein 24-Bit-A4-Scan
 *    in 300 dpi sprengt dort die Structured-Clone-Grenze und stirbt mit
 *    «Too many properties to enumerate». Übergeben wird deshalb 8-Bit-Grau.
 *
 * Die Sprachdaten kommen aus `@tesseract.js-data/deu` und damit von der
 * npm-Registry, nicht von einem CDN — in abgeschotteten Umgebungen ist der
 * CDN-Weg regelmässig gesperrt.
 *
 * ⚠ Die Ausgabe enthält den erkannten Volltext der Belege, also auch
 *   AHV-Nummern, Kontonummern und Diagnosen. Arbeitsmaterial, wie der
 *   Papierstapel selbst — nicht ins Repository, nicht in einen Chat.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const logAlt = console.log;
console.log = () => {};
let pdfjs;
try {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
} finally {
  console.log = logAlt;
}
const SCHRIFTEN = join(
  dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), '..', '..', 'standard_fonts/');

// ── Bilddaten ─────────────────────────────────────────────────────────────

const GRAYSCALE_1BPP = 1, RGBA_32BPP = 3;

/**
 * Graustufenwert 0..255 eines Pixels, unabhängig vom Quellformat.
 * Siehe Punkt 1 im Kopfkommentar — das Format wechselt von Seite zu Seite.
 */
function pixelLeser(img) {
  const { data, width, kind } = img;
  if (kind === GRAYSCALE_1BPP) {
    const stride = (width + 7) >> 3;          // Zeilen sind byteweise ausgerichtet
    return (x, y) => ((data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0;
  }
  const pro = kind === RGBA_32BPP ? 4 : 3;
  return (x, y) => {
    const s = (y * width + x) * pro;
    return (data[s] * 299 + data[s + 1] * 587 + data[s + 2] * 114) / 1000;
  };
}

/**
 * 8-Bit-Graustufen-BMP, optional verkleinert und gedreht.
 * Zum Format siehe Punkt 3 im Kopfkommentar.
 */
export function alsBmp(img, teiler = 1, drehung = 0) {
  const { width: w, height: h } = img;
  const pixel = pixelLeser(img);
  const quer = drehung === 90 || drehung === 270;
  const bw = Math.floor((quer ? h : w) / teiler);
  const bh = Math.floor((quer ? w : h) / teiler);
  const pad = (4 - (bw % 4)) % 4;
  const groesse = (bw + pad) * bh;
  const KOPF = 54 + 256 * 4;

  const buf = Buffer.alloc(KOPF + groesse);
  buf.write('BM', 0);
  buf.writeUInt32LE(KOPF + groesse, 2);
  buf.writeUInt32LE(KOPF, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(bw, 18);
  buf.writeInt32LE(-bh, 22);                  // negativ = erste Zeile oben
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(8, 28);
  buf.writeUInt32LE(groesse, 34);
  buf.writeUInt32LE(256, 46);
  for (let i = 0; i < 256; i++) buf.writeUInt32LE(i | (i << 8) | (i << 16), 54 + i * 4);

  let z = KOPF;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      // Mittel über den Block statt ein herausgegriffenes Pixel: dünne
      // Ziffernstriche überleben das Verkleinern sonst nicht.
      let summe = 0, n = 0;
      for (let dy = 0; dy < teiler; dy++) {
        for (let dx = 0; dx < teiler; dx++) {
          const zx = x * teiler + dx, zy = y * teiler + dy;
          let qx, qy;
          if (drehung === 90)       { qx = zy;         qy = h - 1 - zx; }
          else if (drehung === 270) { qx = w - 1 - zy; qy = zx; }
          else if (drehung === 180) { qx = w - 1 - zx; qy = h - 1 - zy; }
          else                      { qx = zx;         qy = zy; }
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          summe += pixel(qx, qy); n++;
        }
      }
      buf[z++] = n ? Math.round(summe / n) : 255;
    }
    z += pad;
  }
  return buf;
}

/** Das (erste) Bild einer Seite, oder null bei einer Textseite. */
export async function seitenBild(pdf, nr) {
  const seite = await pdf.getPage(nr);
  const ol = await seite.getOperatorList();
  const OPS = pdfjs.OPS;
  const i = ol.fnArray.findIndex(f => f === OPS.paintImageXObject || f === OPS.paintJpegXObject);
  if (i < 0) return null;
  const name = ol.argsArray[i][0];
  return new Promise(fertig => seite.objs.get(name, fertig));
}

// ── OCR ───────────────────────────────────────────────────────────────────

const NUR_TEXT = { text: true, blocks: false, hocr: false, tsv: false,
                   box: false, unlv: false, osd: false };

async function lies(worker, bmp) {
  const { data } = await worker.recognize(bmp, {}, NUR_TEXT);
  return { text: (data.text || '').trim(), vertrauen: Math.round(data.confidence || 0) };
}

/**
 * Welche Drehung liest sich am besten?
 *
 * Gemessen statt geraten (Punkt 2 im Kopfkommentar). Die Probe läuft auf einem
 * stark verkleinerten Bild — für den Vergleich reicht das, und vier volle
 * Durchgänge je Seite wären nicht bezahlbar.
 */
async function findeDrehung(worker, img) {
  let beste = { drehung: 0, vertrauen: -1 };
  for (const drehung of [0, 90, 180, 270]) {
    const { vertrauen } = await lies(worker, alsBmp(img, 4, drehung));
    if (vertrauen > beste.vertrauen) beste = { drehung, vertrauen };
  }
  return beste;
}

// ── Aufruf ────────────────────────────────────────────────────────────────

function argument(name, standard = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

async function hauptlauf() {
  const datei = argument('datei');
  const jsonZiel = argument('json');
  const teiler = Number(argument('teiler', 2));
  const sprache = argument('sprache', 'deu');
  // Unter diesem Wert wird die Drehung neu gemessen: ein Stapel kann gemischt
  // eingescannt sein, und eine einmal gefundene Drehung gilt nicht ewig.
  const SCHWACH = 35;

  if (!datei || !jsonZiel) {
    console.error(`Aufruf: node scripts/steuer-ocr.mjs --datei <pdf> --json <ausgabe.json>

  --datei    PDF mit gescannten Seiten
  --json     Ausgabedatei mit dem erkannten Text je Seite
  --teiler   Verkleinerung vor der Erkennung   (Vorgabe: 2 = halbe Auflösung)
  --sprache  Tesseract-Sprachpaket             (Vorgabe: deu)`);
    process.exit(1);
  }

  const langPath = resolve(
    dirname(require.resolve('@tesseract.js-data/deu/package.json')), '..', '..',
    '@tesseract.js-data', sprache, '4.0.0');

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(datei)), isEvalSupported: false,
    standardFontDataUrl: SCHRIFTEN,
  }).promise;

  const worker = await createWorker(sprache, 1, {
    langPath, gzip: true, cachePath: '/tmp', logger: () => {},
  });

  console.log(`OCR  ${datei}`);
  console.log(`${pdf.numPages} Seiten · Sprache ${sprache} · Teiler ${teiler}\n`);

  const seiten = [];
  let drehung = null;
  const begonnen = Date.now();

  for (let nr = 1; nr <= pdf.numPages; nr++) {
    const img = await seitenBild(pdf, nr);
    if (!img) {
      seiten.push({ nr, text: '', vertrauen: null, drehung: null, bild: false });
      console.log(`  ${String(nr).padStart(3)}  kein Bild — übersprungen`);
      continue;
    }

    if (drehung === null) {
      const gemessen = await findeDrehung(worker, img);
      drehung = gemessen.drehung;
      console.log(`  Drehung gemessen: ${drehung}°\n`);
    }

    let { text, vertrauen } = await lies(worker, alsBmp(img, teiler, drehung));
    // Schwaches Ergebnis: vielleicht liegt diese Seite anders herum.
    if (vertrauen < SCHWACH) {
      const neu = await findeDrehung(worker, img);
      if (neu.drehung !== drehung && neu.vertrauen > vertrauen) {
        drehung = neu.drehung;
        ({ text, vertrauen } = await lies(worker, alsBmp(img, teiler, drehung)));
        console.log(`  ${String(nr).padStart(3)}  Drehung neu gemessen: ${drehung}°`);
      }
    }

    seiten.push({ nr, text, vertrauen, drehung, bild: true });
    console.log(`  ${String(nr).padStart(3)}  ${String(vertrauen).padStart(3)}%  ` +
                `${text.length} Zeichen  ${text.slice(0, 46).replace(/\s+/g, ' ')}`);
  }

  await worker.terminate();
  writeFileSync(jsonZiel, JSON.stringify({ datei, teiler, sprache, seiten }, null, 2), 'utf-8');

  const gelesen = seiten.filter(s => s.text);
  const schwach = gelesen.filter(s => s.vertrauen < 60);
  const dauer = Math.round((Date.now() - begonnen) / 1000);

  console.log(`\n${gelesen.length} von ${pdf.numPages} Seiten gelesen · ${dauer}s`);
  if (schwach.length) {
    console.log(`⚠ ${schwach.length} Seiten unter 60% Vertrauen — Zahlen dort nachprüfen:`);
    console.log(`  Seiten ${schwach.map(s => s.nr).join(', ')}`);
  }
  console.log(`\nGeschrieben: ${jsonZiel}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await hauptlauf();
}
