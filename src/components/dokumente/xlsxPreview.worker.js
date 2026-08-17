/**
 * xlsxPreview.worker.js — parst Excel-Dateien für die Schnell-Vorschau ABSEITS des
 * Haupt-Threads, damit die App beim Öffnen großer/komplexer Dateien (z. B. XLSM mit
 * vielen Zeilen) nicht mehr einfriert. Liest bewusst nur die ersten 1000 Zeilen
 * (sheetRows) und beschneidet die Ausgabe auf 60 Spalten.
 */
import { read, utils } from "xlsx";

const MAX_ROWS = 1000;
const MAX_COLS = 60;

self.onmessage = (e) => {
  const { buf } = e.data || {};
  try {
    // sheetRows begrenzt das Parsen schon beim Einlesen -> viel schneller + weniger Speicher.
    const wb = read(new Uint8Array(buf), { type: "array", cellDates: true, sheetRows: MAX_ROWS });
    const sheets = wb.SheetNames.map((nm) => {
      const ws = wb.Sheets[nm];
      const rows = utils
        .sheet_to_json(ws, { header: 1, raw: false, defval: "" })
        .slice(0, MAX_ROWS)
        .map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : r));
      return { name: nm, rows };
    });
    self.postMessage({ ok: true, sheets });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || "Excel konnte nicht gelesen werden" });
  }
};
