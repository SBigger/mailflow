#!/usr/bin/env node
/**
 * Holt die Tesseract-Laufzeitdateien nach public/tesseract/.
 *
 * Diese Dateien liegen nicht im Git: rund 31 MB Binaerdaten, die sich aus
 * den npm-Paketen jederzeit wiederherstellen lassen. Ohne sie faellt OCR
 * aus — die App wuerde sonst versuchen, sie aus dem Netz zu laden, und
 * genau das soll sie nicht.
 *
 * Aufruf:  node scripts/ocr-daten-holen.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ZIEL = path.join(process.cwd(), "public", "tesseract");
const SPRACHEN = ["deu", "eng", "fra"];

fs.mkdirSync(path.join(ZIEL, "lang"), { recursive: true });

// Worker und Kern stammen aus den bereits installierten Paketen
const kopien = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
];
for (const [von, nach] of kopien) {
  if (!fs.existsSync(von)) {
    console.error(`Fehlt: ${von} — bitte zuerst npm install ausfuehren.`);
    process.exit(1);
  }
  fs.copyFileSync(von, path.join(ZIEL, nach));
  console.log("kopiert:", nach);
}

// Sprachdaten kommen als npm-Pakete
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tessdata-"));
for (const l of SPRACHEN) {
  const ziel = path.join(ZIEL, "lang", `${l}.traineddata.gz`);
  if (fs.existsSync(ziel)) { console.log("vorhanden:", l); continue; }
  console.log("hole:", l);
  execSync(`npm pack @tesseract.js-data/${l}`, { cwd: tmp, stdio: "pipe" });
  const tgz = fs.readdirSync(tmp).find(f => f.includes(l) && f.endsWith(".tgz"));
  execSync(`tar xzf ${tgz}`, { cwd: tmp, stdio: "pipe" });
  fs.copyFileSync(path.join(tmp, "package", "4.0.0", `${l}.traineddata.gz`), ziel);
  fs.rmSync(path.join(tmp, "package"), { recursive: true, force: true });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("\nOCR-Daten bereit in public/tesseract/");
