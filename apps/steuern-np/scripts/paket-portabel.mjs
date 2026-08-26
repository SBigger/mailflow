#!/usr/bin/env node
/**
 * Baut die portable Fassung: gebaute Oberflaeche plus lokaler Server.
 *
 * Ergebnis liegt in portabel/ und laesst sich als ZIP weitergeben. Auf dem
 * Zielrechner braucht es Node.js, aber kein npm install.
 *
 * Englisch wird aus den OCR-Daten entfernt: 11 MB fuer einen Fall, der bei
 * Schweizer Steuerbelegen kaum vorkommt. Die Electron-Fassung behaelt es.
 *
 * Aufruf:  npm run paket:portabel
 */
import fs from "node:fs";
import path from "node:path";

const WURZEL = process.cwd();
const ZIEL = path.join(WURZEL, "portabel");
const DIST = path.join(WURZEL, "dist");
const VORLAGE = path.join(WURZEL, "portabel-vorlage");

if (!fs.existsSync(DIST)) {
  console.error("dist/ fehlt — bitte zuerst npm run build ausfuehren.");
  process.exit(1);
}

fs.rmSync(ZIEL, { recursive: true, force: true });
fs.mkdirSync(ZIEL, { recursive: true });

fs.cpSync(DIST, path.join(ZIEL, "app"), { recursive: true });
for (const datei of fs.readdirSync(VORLAGE)) {
  fs.copyFileSync(path.join(VORLAGE, datei), path.join(ZIEL, datei));
}

const englisch = path.join(ZIEL, "app", "tesseract", "lang", "eng.traineddata.gz");
if (fs.existsSync(englisch)) fs.rmSync(englisch);

const groesse = (p) => {
  let s = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const voll = path.join(p, e.name);
    s += e.isDirectory() ? groesse(voll) : fs.statSync(voll).size;
  }
  return s;
};

console.log(`portabel/ bereit — ${Math.round(groesse(ZIEL) / 1024 / 1024)} MB`);
console.log("Zum Verteilen:  cd portabel && zip -r ../SteuernNP-portabel.zip .");
