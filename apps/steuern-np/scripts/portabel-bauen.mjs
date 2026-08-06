#!/usr/bin/env node
/**
 * Baut die portable Variante: gebaute Oberflaeche plus winziger lokaler
 * Server, ohne Fremdpakete und ohne Installation.
 *
 * Zweck: eine Fassung, die sich ohne "npm install" auf dem Zielrechner
 * starten laesst — nur Node.js muss dort vorhanden sein. Fuer echte
 * Mandate ist die Electron-Fassung gedacht, weil nur sie die Daten als
 * Datei fuehrt statt im Browserspeicher.
 *
 * Aufruf:  npm run paket:portabel
 */
import fs from "node:fs";
import path from "node:path";

const WURZEL   = process.cwd();
const DIST     = path.join(WURZEL, "dist");
const VORLAGE  = path.join(WURZEL, "portabel-vorlage");
const ZIEL     = path.join(WURZEL, "portabel");

if (!fs.existsSync(DIST)) {
  console.error("dist/ fehlt — bitte zuerst npm run build ausfuehren.");
  process.exit(1);
}

fs.rmSync(ZIEL, { recursive: true, force: true });
fs.mkdirSync(ZIEL, { recursive: true });

fs.cpSync(DIST, path.join(ZIEL, "app"), { recursive: true });

// Englisch faellt weg: 11 MB fuer einen Fall, der bei Schweizer
// Steuerbelegen kaum vorkommt. Deutsch und Franzoesisch bleiben.
const eng = path.join(ZIEL, "app", "tesseract", "lang", "eng.traineddata.gz");
if (fs.existsSync(eng)) fs.rmSync(eng);

for (const datei of fs.readdirSync(VORLAGE)) {
  fs.copyFileSync(path.join(VORLAGE, datei), path.join(ZIEL, datei));
}
fs.chmodSync(path.join(ZIEL, "START.command"), 0o755);

const groesse = (d) => {
  let s = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    s += e.isDirectory() ? groesse(p) : fs.statSync(p).size;
  }
  return s;
};
console.log(`portabel/ bereit — ${(groesse(ZIEL) / 1024 / 1024).toFixed(0)} MB`);
console.log("Zum Verteilen:  cd portabel && zip -r ../SteuernNP-portabel.zip .");
