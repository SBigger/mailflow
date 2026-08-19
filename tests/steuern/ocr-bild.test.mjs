/**
 * Bildaufbereitung für die OCR.
 *
 * Beide hier geprüften Punkte sind schon einmal still gescheitert — und still
 * ist das Problem: liefert man Tesseract Rauschen oder ein um 90° gedrehtes
 * Blatt, meldet es keinen Fehler, sondern eine leere Seite. Das sieht im
 * Durchlauf aus wie «Beleg ohne Inhalt» und nicht wie «falsch dekodiert».
 *
 *   node --test tests/steuern/*.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alsBmp } from '../../scripts/steuer-ocr.mjs';

// ── Hilfen ────────────────────────────────────────────────────────────────

/** Liest ein 8-Bit-Graustufen-BMP zurück, wie es alsBmp schreibt. */
function lesBmp(buf) {
  assert.equal(buf.toString('latin1', 0, 2), 'BM');
  const start = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const h = Math.abs(buf.readInt32LE(22));
  assert.equal(buf.readUInt16LE(28), 8, 'muss 8 Bit pro Pixel sein');
  const pad = (4 - (w % 4)) % 4;
  const pixel = (x, y) => buf[start + y * (w + pad) + x];
  return { w, h, pixel };
}

/** 1-Bit-Bild wie pdfjs es für Schwarzweiss-Scans liefert (Bit gesetzt = weiss). */
function bild1bpp(w, h, gesetzt) {
  const stride = (w + 7) >> 3;
  const data = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gesetzt(x, y)) data[y * stride + (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
  return { width: w, height: h, kind: 1, data };
}

/** RGB-Bild, wie pdfjs es für Farbscans liefert. */
function bildRgb(w, h, farbe) {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = farbe(x, y);
      const s = (y * w + x) * 3;
      data[s] = r; data[s + 1] = g; data[s + 2] = b;
    }
  }
  return { width: w, height: h, kind: 2, data };
}

// ── 1 Bit pro Pixel ───────────────────────────────────────────────────────

test('dekodiert 1-Bit-Bilder, statt die Bits als Bytes zu lesen', () => {
  // Linke Hälfte gesetzt (weiss), rechte Hälfte schwarz.
  const img = bild1bpp(16, 4, x => x < 8);
  const { w, h, pixel } = lesBmp(alsBmp(img));

  assert.equal(w, 16);
  assert.equal(h, 4);
  assert.equal(pixel(0, 0), 255, 'gesetztes Bit muss weiss sein');
  assert.equal(pixel(7, 0), 255);
  assert.equal(pixel(8, 0), 0, 'nicht gesetztes Bit muss schwarz sein');
  assert.equal(pixel(15, 3), 0);
});

test('beachtet bei 1-Bit-Bildern die byteweise Zeilenausrichtung', () => {
  // 12 Pixel Breite belegen 2 Bytes je Zeile, also 4 Bits Verschnitt. Wer
  // stur weiterzählt, verschiebt jede Zeile um 4 Pixel — das Bild «schert».
  const img = bild1bpp(12, 3, (x, y) => y === 1 && x === 0);
  const { pixel } = lesBmp(alsBmp(img));

  assert.equal(pixel(0, 1), 255, 'das eine gesetzte Pixel gehört in Zeile 1');
  assert.equal(pixel(0, 0), 0);
  assert.equal(pixel(0, 2), 0);
  assert.equal(pixel(4, 1), 0, 'nicht um den Verschnitt verschoben');
});

// ── Farbe ─────────────────────────────────────────────────────────────────

test('wandelt RGB nach Grau, ohne die Kanäle zu vertauschen', () => {
  // Reines Rot ist deutlich dunkler als reines Grün — vertauscht man die
  // Kanäle, fällt das bei einem Graubild sonst nirgends auf.
  const img = bildRgb(2, 1, x => (x === 0 ? [255, 0, 0] : [0, 255, 0]));
  const { pixel } = lesBmp(alsBmp(img));

  assert.equal(pixel(0, 0), 76, 'Rot: 0.299 × 255');
  assert.equal(pixel(1, 0), 150, 'Grün: 0.587 × 255');
});

// ── Drehung ───────────────────────────────────────────────────────────────

test('dreht um 270 Grad und tauscht dabei Breite und Höhe', () => {
  // Scanner legen A4 quer ab; ohne Drehung steht der Text auf der Seite und
  // Tesseract liefert wortlos nichts. Markiert wird die Ecke links oben.
  const img = bild1bpp(4, 2, (x, y) => x === 0 && y === 0);
  const { w, h, pixel } = lesBmp(alsBmp(img, 1, 270));

  assert.equal(w, 2, 'aus 4×2 wird 2×4');
  assert.equal(h, 4);
  // 270° im Uhrzeigersinn = 90° gegen den Uhrzeigersinn: die Quellecke links
  // oben landet links unten.
  assert.equal(pixel(0, 3), 255);
  assert.equal(pixel(0, 0), 0);
  assert.equal(pixel(1, 3), 0);
});

test('dreht um 90 Grad in die andere Richtung', () => {
  const img = bild1bpp(4, 2, (x, y) => x === 0 && y === 0);
  const { w, h, pixel } = lesBmp(alsBmp(img, 1, 90));

  assert.equal(w, 2);
  assert.equal(h, 4);
  // 90° im Uhrzeigersinn: dieselbe Quellecke landet rechts oben — die
  // Gegenprobe zu 270°, damit sich die beiden nicht unbemerkt vertauschen.
  assert.equal(pixel(1, 0), 255);
  assert.equal(pixel(0, 3), 0);
});

test('lässt das Bild bei 0 Grad in Ruhe', () => {
  const img = bild1bpp(4, 2, (x, y) => x === 0 && y === 0);
  const { w, h, pixel } = lesBmp(alsBmp(img, 1, 0));

  assert.equal(w, 4);
  assert.equal(h, 2);
  assert.equal(pixel(0, 0), 255);
  assert.equal(pixel(3, 1), 0);
});

// ── Verkleinern ───────────────────────────────────────────────────────────

test('mittelt beim Verkleinern, statt Pixel herauszugreifen', () => {
  // Ein Block aus drei weissen und einem schwarzen Pixel muss ein helles Grau
  // ergeben. Wer stattdessen ein Pixel greift, verliert dünne Ziffernstriche
  // ganz — und aus einem Betrag wird stillschweigend ein anderer.
  const img = bild1bpp(2, 2, (x, y) => !(x === 1 && y === 1));
  const { w, h, pixel } = lesBmp(alsBmp(img, 2));

  assert.equal(w, 1);
  assert.equal(h, 1);
  assert.equal(pixel(0, 0), 191, '(255 + 255 + 255 + 0) / 4');
});
