/**
 * xlsxPreview.worker.js — parst Excel-Dateien für die Vorschau ABSEITS des
 * Haupt-Threads, damit die App beim Öffnen großer/komplexer Dateien (z. B. XLSM
 * mit vielen Zeilen) nicht mehr einfriert.
 *
 * Gelesen wird mit ExcelJS, weil SheetJS Community keine Zellformate liefert.
 * Herausgereicht wird darum nicht nur der Text, sondern auch, wie die Zelle in
 * Excel aussieht: fett, kursiv, unterstrichen, Schriftgrösse und -farbe,
 * Hintergrund, Ausrichtung, Umbruch und Rahmen. Dazu Spaltenbreiten,
 * Zeilenhöhen und verbundene Zellen.
 *
 * Zahlen und Daten werden mit dem Zahlenformat der Zelle formatiert (SSF aus
 * SheetJS), damit 1234.5 als 1'234.50 und ein Datum als 30.06.2026 ankommt --
 * so, wie es in Excel steht.
 *
 * Geht ExcelJS für eine Datei nicht (kaputtes oder exotisches Format), faellt
 * der Worker auf den alten SheetJS-Weg zurück: dann gibt es Text ohne Format,
 * aber immer noch eine Vorschau.
 *
 * Gelesen werden hoechstens 1000 Zeilen und 60 Spalten.
 */
// Statisch importiert, nicht per await import(): dynamische Importe wuerden den
// Worker in mehrere Dateien aufteilen, und Vite baut Worker als IIFE ohne
// Code-Splitting.
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { SSF, read, utils } from "xlsx";

const MAX_ROWS = 1000;
const MAX_COLS = 60;

// Excel-Breite (Zeichen) und -Hoehe (Punkt) in Pixel.
const colPx = (w) => Math.round((w || 8.43) * 7 + 5);
const rowPx = (h) => (h ? Math.round(h * 96 / 72) : null);

// Excel rechnet Daten ab dem 30.12.1899; ExcelJS liefert UTC-Daten.
const toSerial = (d) => (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000;

// ARGB aus ExcelJS ("FFDDEBF7") in CSS. Theme-Farben lassen sich ohne die
// Theme-Datei nicht aufloesen -- die werden bewusst ausgelassen.
function cssColor(c) {
  if (!c || typeof c.argb !== "string" || c.argb.length !== 8) return null;
  const a = parseInt(c.argb.slice(0, 2), 16);
  const rgb = "#" + c.argb.slice(2);
  return a === 255 ? rgb : `rgba(${parseInt(rgb.slice(1,3),16)},${parseInt(rgb.slice(3,5),16)},${parseInt(rgb.slice(5,7),16)},${(a/255).toFixed(2)})`;
}

const BORDER_WIDTH = { hair: 1, thin: 1, medium: 2, thick: 3, double: 3 };
function cssBorder(b) {
  if (!b || !b.style) return null;
  const w = BORDER_WIDTH[b.style] || 1;
  const style = b.style === "double" ? "double" : /dash/.test(b.style) ? "dashed" : /dot/.test(b.style) ? "dotted" : "solid";
  return `${w}px ${style} ${cssColor(b.color) || "#b0b0b0"}`;
}

// ── Zahlenformate ────────────────────────────────────────────────────────
// SheetJS (SSF) ist strenger als Excel und wirft bei Formaten, die Excel klaglos
// anzeigt. Zwei Faelle treffen uns bei echten Treuhand-Dateien staendig:
//   "#,###,##0"  aus der JR-Plus-Vorlage  -> "unsupported format"
//   "#'##0.00"   Schweizer Schreibweise   -> falsch als "1443'220.91"
// Darum wird das Format vorher auf die Form gebracht, die SSF versteht, und der
// Tausendertrenner danach auf den Schweizer Hochkomma gesetzt -- so, wie Excel
// es auf einem Schweizer Rechner anzeigt.

// Ein Lauf aus Platzhaltern und Trennern, z.B. "#,###,##0" oder "#,##0,".
// Nachgestellte Trenner bedeuten Skalierung durch 1000 und bleiben erhalten.
function fixGroupRun(run) {
  const m = /^([#0][#0,']*[#0]|[#0])([,']*)$/.exec(run);
  if (!m) return run;
  const core = m[1], trail = m[2].replace(/'/g, ",");
  if (!/[,']/.test(core)) return core + trail;
  const digits = core.replace(/[^#0]/g, "");
  const zeros = /0+$/.exec(digits);
  return "#,##" + "0".repeat(zeros ? zeros[0].length : 1) + trail;
}

// Gibt das bereinigte Format zurueck und ob darin gruppiert wird.
function normalizeNumFmt(fmt) {
  let grouped = false;
  // Text in Anfuehrungszeichen bleibt unangetastet.
  const out = fmt.split(/("(?:[^"]*)")/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/[#0][#0,']*/g, (run) => {
      const fixed = fixGroupRun(run);
      if (/[,']/.test(run.slice(0, run.replace(/[,']+$/, "").length))) grouped = true;
      return fixed;
    });
  }).join("");
  return { fmt: out, grouped };
}

const CH_GROUP = "'";   // Schweizer Tausendertrenner, so zeigt Excel de-CH an

function formatNumber(v, fmt) {
  const { fmt: norm, grouped } = normalizeNumFmt(fmt);
  try {
    const out = SSF.format(norm, v);
    return grouped ? out.replace(/,/g, CH_GROUP) : out;
  } catch {
    // Letzte Rettung: Nachkommastellen aus dem Format lesen und selber setzen.
    const dec = /\.(0+)/.exec(norm);
    const d = dec ? dec[1].length : 0;
    const s = new Intl.NumberFormat("de-CH", {
      minimumFractionDigits: d, maximumFractionDigits: d,
      useGrouping: grouped,
    }).format(v);
    return /%/.test(norm) ? s + "%" : s;
  }
}

// Datumsformate: SSF kennt "dd/mm/yyyy", wirft aber bei der hierzulande
// ueblichen Punktschreibweise "dd.mm.yyyy" und bei Laenderpraefixen wie
// "[$-807]". Darum in dieser Reihenfolge versuchen und am Ende die Punkte
// wieder einsetzen. Gibt null zurueck, wenn nichts davon greift.
function formatDate(serial, fmt) {
  const plain = fmt.replace(/\[\$-[^\]]*\]/g, "").replace(/;@\s*$/, "");
  for (const [f, back] of [[fmt, false], [plain, false], [plain.replace(/\./g, "/"), true]]) {
    if (!f) continue;
    try {
      const out = SSF.format(f, serial);
      if (typeof out === "string" && out.length) return back ? out.replace(/\//g, ".") : out;
    } catch { /* naechster Versuch */ }
  }
  return null;
}

// Sichtbarer Text einer Zelle -- mit dem Zahlenformat der Zelle.
function cellText(cell) {
  let v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(r => r.text).join("");
    if (v.text !== undefined) return String(v.text);          // Hyperlink
    if (v.formula !== undefined || v.sharedFormula !== undefined) v = v.result;
    if (v && v.error) return String(v.error);
  }
  if (v === null || v === undefined) return "";
  const fmt = cell.numFmt;
  if (v instanceof Date) {
    if (fmt) {
      const d = formatDate(toSerial(v), fmt);
      if (d !== null) return d;
    }
    // Ohne brauchbares Format: Uhrzeit nur zeigen, wenn es eine gibt.
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return hasTime
      ? v.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })
      : v.toLocaleDateString("de-CH", { timeZone: "UTC" });
  }
  if (typeof v === "number") {
    if (fmt) return formatNumber(v, fmt);
    // Ohne Format zeigt Excel "Standard": keine Fliesskomma-Reste wie
    // 2825841.9699999997 anzeigen, sondern die Zahl so, wie sie gemeint ist.
    return String(Number(v.toPrecision(15)));
  }
  if (typeof v === "boolean") return v ? "WAHR" : "FALSCH";
  return String(v);
}

// Stile werden entdoppelt: die Zelle traegt nur den Index in styles[].
function styleIndexer() {
  const map = new Map();
  const list = [];
  return {
    list,
    add(st) {
      const keys = Object.keys(st);
      if (!keys.length) return -1;
      const k = JSON.stringify(st);
      if (map.has(k)) return map.get(k);
      const i = list.push(st) - 1;
      map.set(k, i);
      return i;
    },
  };
}

function styleOf(cell) {
  const st = {};
  const f = cell.font;
  if (f) {
    if (f.bold)      st.b = 1;
    if (f.italic)    st.i = 1;
    if (f.underline) st.u = 1;
    if (f.strike)    st.s = 1;
    if (f.size && f.size !== 11) st.sz = f.size;
    if (f.name && !/^calibri$/i.test(f.name)) st.ff = f.name;
    const c = cssColor(f.color);
    if (c && c !== "#000000") st.c = c;
  }
  if (cell.fill && cell.fill.type === "pattern" && cell.fill.pattern !== "none") {
    const bg = cssColor(cell.fill.fgColor);
    if (bg && bg !== "#FFFFFF") st.bg = bg;
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal && a.horizontal !== "general") st.ha = a.horizontal;
    if (a.vertical && a.vertical !== "bottom") st.va = a.vertical;
    if (a.wrapText) st.wrap = 1;
    if (a.indent) st.ind = a.indent;
  }
  const bd = cell.border;
  if (bd) {
    const t = cssBorder(bd.top), r = cssBorder(bd.right), b = cssBorder(bd.bottom), l = cssBorder(bd.left);
    if (t) st.bt = t;
    if (r) st.br = r;
    if (b) st.bb = b;
    if (l) st.bl = l;
  }
  // Zahlen stehen in Excel rechts, Text links -- wenn nichts anderes gesetzt ist.
  if (!st.ha) {
    const v = cell.value;
    const num = typeof v === "number" || v instanceof Date ||
      (v && typeof v === "object" && typeof v.result === "number");
    if (num) st.ha = "right";
  }
  return st;
}

// "A1:C3" -> {top, left, bottom, right}
function parseRange(ref) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  const col = (s) => s.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  return { left: col(m[1]), top: +m[2], right: col(m[3]), bottom: +m[4] };
}

async function parseWithExcelJS(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const sheets = wb.worksheets.map((ws) => {
    const idx = styleIndexer();

    // Verbundene Zellen: Master traegt colspan/rowspan, die verdeckten fallen weg.
    const spans = new Map();      // "r:c" -> {cs, rs}
    const covered = new Set();    // "r:c"
    const merges = ws.model?.merges || [];
    for (const ref of merges) {
      const r = parseRange(ref);
      if (!r) continue;
      spans.set(`${r.top}:${r.left}`, { cs: r.right - r.left + 1, rs: r.bottom - r.top + 1 });
      for (let rr = r.top; rr <= r.bottom; rr++) {
        for (let cc = r.left; cc <= r.right; cc++) {
          if (rr !== r.top || cc !== r.left) covered.add(`${rr}:${cc}`);
        }
      }
    }

    const lastCol = Math.min(ws.columnCount || 0, MAX_COLS);
    const lastRow = Math.min(ws.rowCount || 0, MAX_ROWS);

    const cols = [];
    for (let c = 1; c <= lastCol; c++) {
      const col = ws.getColumn(c);
      cols.push({ px: col?.hidden ? 0 : colPx(col?.width) });
    }

    const rows = [];
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= lastCol; c++) {
        if (covered.has(`${r}:${c}`)) { cells.push(null); continue; }
        const cell = row.getCell(c);
        const sp = spans.get(`${r}:${c}`);
        const entry = { t: cellText(cell), s: idx.add(styleOf(cell)) };
        if (sp) { entry.cs = sp.cs; entry.rs = sp.rs; }
        cells.push(entry);
      }
      rows.push({ px: row?.hidden ? 0 : rowPx(row?.height), cells });
    }

    // Fixierte Bereiche, damit Kopfzeilen beim Scrollen stehen bleiben.
    const view = (ws.views || [])[0];
    const freeze = view && view.state === "frozen"
      ? { x: view.xSplit || 0, y: view.ySplit || 0 }
      : null;

    return { name: ws.name, cols, rows, styles: idx.list, freeze, formatted: true };
  });

  return sheets.filter(s => s.rows.length);
}

async function parseWithSheetJS(buf) {
  const wb = read(new Uint8Array(buf), { type: "array", cellDates: true, sheetRows: MAX_ROWS });
  return wb.SheetNames.map((nm) => {
    const plain = utils
      .sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: "" })
      .slice(0, MAX_ROWS)
      .map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : []));
    return {
      name: nm,
      cols: [],
      styles: [],
      freeze: null,
      formatted: false,
      rows: plain.map((r) => ({ px: null, cells: r.map((v) => ({ t: String(v ?? ""), s: -1 })) })),
    };
  });
}

self.onmessage = async (e) => {
  const { buf } = e.data || {};
  try {
    let sheets;
    try {
      sheets = await parseWithExcelJS(buf);
    } catch (styleErr) {
      // Lieber eine Vorschau ohne Format als gar keine.
      console.warn("ExcelJS fehlgeschlagen, Fallback auf SheetJS:", styleErr?.message);
      sheets = await parseWithSheetJS(buf);
    }
    if (!sheets.length) sheets = await parseWithSheetJS(buf);
    self.postMessage({ ok: true, sheets });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || "Excel konnte nicht gelesen werden" });
  }
};
