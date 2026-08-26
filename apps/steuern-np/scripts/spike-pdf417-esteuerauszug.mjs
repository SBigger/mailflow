#!/usr/bin/env node
/**
 * Spike: PDF417-Barcodes aus einem eSteuerauszug lesen (Backlog V11).
 *
 * Frage, die dieser Spike beantworten soll:
 *   Können wir mit zxing-wasm die PDF417-Barcodes eines eSteuerauszugs
 *   auslesen und den Structured Append über mehrere Seiten korrekt
 *   zusammensetzen — ohne Java und ohne zweite Laufzeit?
 *
 * Warum das zählt: Der eSteuerauszug deckt das Wertschriftenverzeichnis ab,
 * den aufwendigsten Teil jeder nP-Deklaration. Kommt er als Barcode statt als
 * XML, ist der Decoder der Unterschied zwischen "strukturiert eingelesen" und
 * "mit OCR geraten".
 *
 * Ablauf:
 *   1. PDF-Seiten mit pdfjs zu Bitmaps rendern (hohe DPI, Barcodes sind dicht)
 *   2. Je Seite alle PDF417-Symbole suchen
 *   3. Structured-Append-Metadaten auswerten und Segmente in der richtigen
 *      Reihenfolge zusammensetzen
 *   4. Ergebnis dekomprimieren (der Standard komprimiert die Nutzdaten) und
 *      als XML ausgeben
 *
 * Aufruf:
 *   node scripts/spike-pdf417-esteuerauszug.mjs <pfad-zum-pdf> [--dpi 300]
 *
 * Abhängigkeiten (bewusst NICHT in package.json — das ist ein Spike):
 *   npm i --no-save zxing-wasm pdfjs-dist canvas
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const pdfPfad = args.find(a => !a.startsWith("--"));
const dpi = Number(args[args.indexOf("--dpi") + 1]) || 300;

if (!pdfPfad) {
  console.error("Aufruf: node scripts/spike-pdf417-esteuerauszug.mjs <pfad-zum-pdf> [--dpi 300]");
  process.exit(2);
}
if (!fs.existsSync(pdfPfad)) {
  console.error(`Datei nicht gefunden: ${pdfPfad}`);
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────
// Abhängigkeiten laden — mit klarer Meldung statt Stacktrace
// ──────────────────────────────────────────────────────────────
let readBarcodes, getDocument, createCanvas;
try {
  ({ readBarcodes } = await import("zxing-wasm/reader"));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  getDocument = pdfjs.getDocument;
  ({ createCanvas } = await import("canvas"));
} catch (e) {
  console.error(
    "Abhängigkeiten fehlen. Bitte einmalig installieren:\n" +
    "  npm i --no-save zxing-wasm pdfjs-dist canvas\n\n" +
    `Ursprünglicher Fehler: ${e.message}`
  );
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────
// 1+2. Seiten rendern und Barcodes lesen
// ──────────────────────────────────────────────────────────────
const daten = new Uint8Array(fs.readFileSync(pdfPfad));
const pdf = await getDocument({ data: daten, useSystemFonts: true }).promise;

console.log(`PDF: ${path.basename(pdfPfad)} — ${pdf.numPages} Seite(n), Rendering mit ${dpi} DPI\n`);

const segmente = [];

for (let seite = 1; seite <= pdf.numPages; seite++) {
  const page = await pdf.getPage(seite);
  // pdfjs rechnet in 72 DPI; scale = dpi/72
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");

  await page.render({ canvasContext: ctx, viewport }).promise;

  const bild = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const treffer = await readBarcodes(
    { data: new Uint8Array(bild.data), width: bild.width, height: bild.height },
    { formats: ["PDF417"], tryHarder: true, maxNumberOfSymbols: 32 }
  );

  console.log(`  Seite ${seite}: ${treffer.length} PDF417-Symbol(e)`);

  for (const t of treffer) {
    // Structured Append: ohne diese Metadaten können wir mehrseitige
    // Auszüge nicht korrekt zusammensetzen — genau das ist die offene Frage.
    const sa = t.structuredAppend ?? null;
    segmente.push({
      seite,
      index: sa?.index ?? null,
      anzahl: sa?.count ?? null,
      id: sa?.id ?? null,
      bytes: t.bytes ? Uint8Array.from(t.bytes) : new TextEncoder().encode(t.text || ""),
    });
    if (sa) {
      console.log(`    → Segment ${sa.index + 1}/${sa.count} (id: ${sa.id ?? "—"})`);
    } else {
      console.log(`    → Einzelsymbol ohne Structured-Append-Metadaten`);
    }
  }
}

if (!segmente.length) {
  console.error("\nKeine PDF417-Symbole gefunden.");
  console.error("Mögliche Ursachen: DPI zu tief (--dpi 400 versuchen), " +
                "Barcodes als Vektor statt Bild, oder der Auszug enthält gar keine.");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
// 3. Segmente ordnen
// ──────────────────────────────────────────────────────────────
const hatSA = segmente.every(s => s.index != null && s.anzahl != null);

let geordnet;
if (hatSA) {
  const erwartet = segmente[0].anzahl;
  geordnet = [...segmente].sort((a, b) => a.index - b.index);

  const gefundeneIndizes = new Set(geordnet.map(s => s.index));
  const fehlend = [];
  for (let i = 0; i < erwartet; i++) if (!gefundeneIndizes.has(i)) fehlend.push(i + 1);

  if (fehlend.length) {
    console.error(`\nUnvollständig: Segment(e) ${fehlend.join(", ")} von ${erwartet} fehlen.`);
    console.error("Ohne alle Segmente ist der Datenstrom nicht rekonstruierbar.");
    process.exit(1);
  }
  console.log(`\nStructured Append vollständig: ${erwartet} Segment(e).`);
} else {
  // Rückfall: Reihenfolge nach Seite und Fundreihenfolge. Das ist eine
  // ANNAHME und kann bei mehrspaltigen Layouts falsch sein.
  console.warn("\n⚠️  Keine Structured-Append-Metadaten — Reihenfolge wird aus der " +
               "Seitenfolge abgeleitet. Ergebnis mit Vorsicht behandeln.");
  geordnet = segmente;
}

const roh = Buffer.concat(geordnet.map(s => Buffer.from(s.bytes)));
console.log(`Zusammengesetzt: ${roh.length} Byte roh.`);

// ──────────────────────────────────────────────────────────────
// 4. Dekomprimieren und ausgeben
// ──────────────────────────────────────────────────────────────
function versucheEntpacken(buf) {
  const kandidaten = [
    ["gzip",    () => zlib.gunzipSync(buf)],
    ["deflate", () => zlib.inflateSync(buf)],
    ["raw",     () => zlib.inflateRawSync(buf)],
    ["keine",   () => buf],
  ];
  for (const [name, fn] of kandidaten) {
    try {
      const out = fn();
      const txt = out.toString("utf8");
      if (txt.includes("<")) return { methode: name, text: txt };
    } catch { /* nächster Kandidat */ }
  }
  return null;
}

const entpackt = versucheEntpacken(roh);
if (!entpackt) {
  const ausgabe = `${pdfPfad}.barcode.bin`;
  fs.writeFileSync(ausgabe, roh);
  console.error(`\nInhalt liess sich nicht als XML entpacken. Rohdaten: ${ausgabe}`);
  console.error("Nächster Schritt: Kompressionsverfahren gegen die technische " +
                "Wegleitung zu eCH-0196 abgleichen.");
  process.exit(1);
}

console.log(`Entpackt mit: ${entpackt.methode}`);

const ausgabe = `${pdfPfad}.esteuerauszug.xml`;
fs.writeFileSync(ausgabe, entpackt.text, "utf8");
console.log(`XML geschrieben: ${ausgabe} (${entpackt.text.length} Zeichen)`);

// Kurzbefund, damit man ohne Editor sieht, ob es plausibel ist
const wurzel = entpackt.text.match(/<([A-Za-z0-9:_]+)[\s>]/)?.[1] ?? "?";
const zaehle = (tag) => (entpackt.text.match(new RegExp(`<[^>]*${tag}[\\s>]`, "gi")) || []).length;
console.log("\nKurzbefund:");
console.log(`  Wurzelelement : ${wurzel}`);
console.log(`  security      : ${zaehle("security")}`);
console.log(`  bankAccount   : ${zaehle("bankAccount")}`);
console.log("\nNächster Schritt: Dieses XML gegen src/lib/steuer/ech0196.js " +
            "(FELD_KANDIDATEN) prüfen und die Tabelle korrigieren.");
