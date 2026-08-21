import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import { resolveFormularPdfUrl } from '@/lib/steuerFormularPdf';

const CHF_COLS = new Set([
  'aktienkapital','nominalwert','reingewinn_buch','reingewinn_buch_dbs','aufr_nichtabzugsfaehig','aufr_geldwerte_leist',
  'aufr_sonstige','aufr_total','aufr_total_kt','aufr_total_dbs','abzug_beteiligungen','abzug_sonstige','abzug_total','abzug_total_kt','abzug_total_dbs',
  'verlustvortrag_abzug','verlustvortrag_abzug_dbs','steuerbarer_gewinn_kt','steuerbarer_gewinn_dbs',
  'reingewinn_ch','reingewinn_sg','reingewinn_sg_ord','reingewinn_sg_sonder',
  'einbezahltes_kapital','kap_reserven','gesetzl_gewinnres','freie_reserven',
  'gewinnvortrag','eigenkapital_total','steuerbares_kapital','kapital_ch','kapital_sg',
  'verlustvortrag_beginn','verlust_laufendes_j',
  'verlustvortrag_ende',
  'verlust_betrag_1','verlust_betrag_2','verlust_betrag_3','verlust_betrag_4',
  'verlust_betrag_5','verlust_betrag_6','verlust_betrag_7',
  'bruttoertrag_total','nettoertrag_beteiligungen','reingewinn_vor_abzug',
  'beteiligungsabzug_chf','reingewinn_nach_abzug','beteiligung_1_bw','beteiligung_1_ertrag',
  'beteiligung_2_bw','beteiligung_2_ertrag','beteiligung_3_bw','beteiligung_3_ertrag',
]);

function fmtChf(n) {
  return n.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// `typ` ist optional – Formulare ohne Typ-Angabe (SG/TG/ESTV) fallen auf die
// alte id-basierte CHF_COLS-Liste zurück.
function formatValue(id, val, typ) {
  if (val == null || val === '') return '';
  if ((typ === 'betrag' || (typ == null && CHF_COLS.has(id))) && !isNaN(parseFloat(val))) {
    return fmtChf(parseFloat(val));
  }
  // <input type="date"> liefert ISO – auf den Formularen ist dd.mm.yyyy üblich.
  if (typ === 'datum') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(val));
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return String(val);
}

// ── Berechnete Summen ────────────────────────────────────────────────────────
// Manche Formulare (ZH Form. 500) rechnen ihre Zwischensummen per eingebettetem
// PDF-JavaScript. pdf-lib führt kein PDF-JS aus, darum werden die Summen hier
// aus `formDef.computed` nachgerechnet.
//   { id, col: 'ss'|'bs', acroField, plus: [...], minus: [...],
//     manual: '<feldId>',      → manuelle Eingabe schlägt die Berechnung
//     mindestens: '<feldId>' } → Ergebnis wird nach unten begrenzt
// Einträge in plus/minus dürfen auf Feld-ids ODER auf frühere computed-ids
// zeigen (Reihenfolge der Liste ist die Auswertungsreihenfolge).
// In der Spalte 'bs' (Bundessteuer) gewinnt `<feldId>_bund`, falls gesetzt.
function runComputed(formDef, felder) {
  const ergebnisse = {};   // acroField -> Zahl
  const memo = {};         // "col:id"  -> Zahl

  const num = (id, col) => {
    const key = `${col}:${id}`;
    if (key in memo) return memo[key];
    const bundKey = `${id}_bund`;
    const quelle = col === 'bs' && felder[bundKey] != null && felder[bundKey] !== ''
      ? bundKey : id;
    return parseFloat(felder[quelle]) || 0;
  };

  for (const c of formDef.computed || []) {
    let wert = (c.plus || []).reduce((s, id) => s + num(id, c.col), 0)
             - (c.minus || []).reduce((s, id) => s + num(id, c.col), 0);

    if (c.mindestens) wert = Math.max(wert, num(c.mindestens, c.col));

    const manuell = c.manual != null ? felder[c.manual] : null;
    if (manuell != null && manuell !== '' && !isNaN(parseFloat(manuell))) {
      wert = parseFloat(manuell);
    }

    memo[`${c.col}:${c.id}`] = wert;
    ergebnisse[c.acroField] = wert;
  }
  return ergebnisse;
}

// ── Code 39 (Strichcode Seite 1, ZH) ─────────────────────────────────────────
// Im Original entsteht der Code aus der Schrift „3of9Barcode" via PDF-JS. Da
// beides beim Flatten wegfällt, wird er hier vektoriell gezeichnet.
// Muster je Zeichen: 9 Elemente (Balken/Lücke im Wechsel, beginnend mit Balken),
// 1 = breit, 0 = schmal. Danach eine schmale Trennlücke.
const CODE39 = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
  'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
  'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
  'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
  'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
  'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010',
  '*': '010010100',   // Start/Stop – nicht mit 'P' (001010010) verwechseln
};

function drawCode39(page, text, cfg) {
  const narrow = cfg.narrow ?? 0.675;
  const wide   = narrow * 3;
  const gap    = narrow;
  const daten  = `*${String(text).toUpperCase()}*`;

  let x = cfg.x;
  for (const zeichen of daten) {
    const muster = CODE39[zeichen];
    if (!muster) continue;                       // nicht kodierbare Zeichen überspringen
    for (let i = 0; i < muster.length; i++) {
      const breite = muster[i] === '1' ? wide : narrow;
      if (i % 2 === 0) {                          // gerade Position = Balken
        page.drawRectangle({ x, y: cfg.y, width: breite, height: cfg.h, color: rgb(0, 0, 0) });
      }
      x += breite;
    }
    x += gap;
  }
  return x - cfg.x;                               // gezeichnete Gesamtbreite
}

function drawAlignedText(page, text, pos, font, halfW) {
  const groesse = pos.groesse ?? 9;
  const align = pos.align ?? 'left';
  let x = pos.x;
  if (align === 'center' || align === 'right') {
    const w = font.widthOfTextAtSize(text, groesse);
    if (align === 'center') x = pos.x - w / 2;
    if (align === 'right')  x = pos.x - w;
  }
  page.drawText(text, { x, y: pos.y, size: groesse, font, color: rgb(0, 0, 0), maxWidth: Math.max(60, halfW - x - 5) });
}

function resolveStaticOverlayText(ov, felder) {
  if (ov.text != null) return String(ov.text);
  if (ov.fromField) return felder[ov.fromField] != null ? String(felder[ov.fromField]) : '';
  if (Array.isArray(ov.fromFields)) {
    const sep = ov.sep ?? ' ';
    const parts = ov.fromFields.map(id => felder[id]).filter(v => v != null && v !== '');
    return parts.join(sep);
  }
  if (Array.isArray(ov.sumOf)) {
    const sum = ov.sumOf.reduce((s, id) => s + (parseFloat(felder[id]) || 0), 0);
    if (sum === 0) return '';
    return sum.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return '';
}

// ── Booklet-Splitter: A3-Booklet → 4 echte A4-Seiten mit Text-Overlay ──────
// formDef.bookletLayout = [{ srcPage, half: 'left'|'right' }, ...]  (Reihenfolge = Form-Seite 1..N)
// Felder verwenden { formSeite: 1..N, x, y, groesse } in A4-lokalen Koordinaten (0..595, 0..842)
async function buildSplitFilledPdf(formDef, felder, srcBytes) {
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const font   = await outDoc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < formDef.bookletLayout.length; i++) {
    const { srcPage, half } = formDef.bookletLayout[i];
    const formSeite = i + 1;
    const srcPg = srcDoc.getPage(srcPage);
    const { width: srcW, height: srcH } = srcPg.getSize();
    const halfW = srcW / 2;

    // Hälfte aus Quell-Seite ausschneiden
    const bbox = half === 'left'
      ? { left: 0,     bottom: 0, right: halfW, top: srcH }
      : { left: halfW, bottom: 0, right: srcW,  top: srcH };
    const embedded = await outDoc.embedPage(srcPg, bbox);

    // Neue A4-Seite mit dieser Hälfte
    const newPage = outDoc.addPage([halfW, srcH]);
    newPage.drawPage(embedded, { x: 0, y: 0, width: halfW, height: srcH });

    // Felder dieser Form-Seite einzeichnen (inkl. alsoAt: Mehrfach-Positionen)
    for (const section of formDef.sections) {
      for (const feld of section.felder) {
        if (!feld.overlay || feld.overlay.formSeite !== formSeite) continue;
        if (feld.overlay.skipRender) continue;
        const val = felder[feld.id];
        if (val == null || val === '' || val === false) continue;
        const text = feld.typ === 'checkbox' ? (val ? 'X' : '') : formatValue(feld.id, val);
        if (!text) continue;
        const { x, y, groesse = 9, align, alsoAt = [] } = feld.overlay;
        const positions = [{ x, y, groesse, align }, ...alsoAt.map(a => ({ groesse, align, ...a }))];
        for (const pos of positions) {
          drawAlignedText(newPage, text, pos, font, halfW);
        }
      }
    }

    // Statische Overlays (z.B. zentrierte Adresse, fixe Beilagen-Hakerl, Summen)
    if (Array.isArray(formDef.staticOverlays)) {
      for (const ov of formDef.staticOverlays) {
        if (ov.formSeite !== formSeite) continue;
        if (ov.whenField && !felder[ov.whenField]) continue;
        const text = resolveStaticOverlayText(ov, felder);
        if (!text) continue;
        drawAlignedText(newPage, text, ov, font, halfW);
      }
    }
  }

  return outDoc.save();
}

// Entfernt Felder samt ihrer Widgets aus dem Dokument.
// Bewusst NICHT über form.removeField(): das löscht in pdf-lib 1.17 das
// Feld-Objekt, entfernt die Annotation aber nicht zuverlässig von der Seite
// (es räumt anhand der Appearance-Referenz auf). Zurück bleibt eine tote
// Referenz in /Annots, an der updateFieldAppearances() abstürzt.
function entferneFelder(pdfDoc, form, namen) {
  const widgets = new Set();
  for (const name of namen) {
    let field;
    try { field = form.getField(name); } catch { continue; }
    for (const widget of field.acroField.getWidgets()) widgets.add(widget.dict);
    try { form.acroForm.removeField(field.acroField); } catch {}
  }
  if (!widgets.size) return;

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      let dict;
      try { dict = annots.lookup(i); } catch { continue; }
      if (widgets.has(dict)) annots.remove(i);
    }
  }
}

// Setzt die Schriftgrösse eines Textfelds.
// Nicht über field.setFontSize(): im ZH-PDF steht im /DA der Fontname escaped
// (`\057Helv 9 Tf 0 g` statt `/Helv 9 Tf 0 g`). pdf-lib findet darin keinen
// Tf-Operator – setFontSize() wirft, und beim Erzeugen der Appearance fällt es
// auf „automatisch" zurück, was mehrzeilige Kästen kastenfüllend aufbläst.
// Ein sauber geschriebenes /DA behebt beides; der Fontname darin ist nur für
// Grösse/Farbe relevant, die Glyphen kommen aus dem übergebenen Font.
function setzeSchriftgroesse(field, groesse) {
  try {
    field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${groesse} Tf 0 g`));
  } catch {}
}

// Wählt eine Option in einer Ja/Nein-Gruppe (ZH Ziffer 24).
// pdf-lib erkennt die Gruppe als PDFCheckBox (das Radio-Flag fehlt im PDF) und
// bietet kein select(). Ausserdem haben die Widgets nur eine „Ein"-Darstellung
// und keine /Off-Variante – beim Flatten fände pdf-lib für die nicht gewählte
// Box keine Appearance. Darum: gewähltes Widget setzen, die übrigen entfernen.
function waehleOption(pdfDoc, form, feldName, exportWert) {
  let field;
  try { field = form.getField(feldName); } catch { return; }

  const gewaehlt = PDFName.of(exportWert);
  const zuEntfernen = new Set();
  let treffer = false;

  for (const widget of field.acroField.getWidgets()) {
    const normal = widget.getNormalAppearance();
    const passt = normal && typeof normal.has === 'function' && normal.has(gewaehlt);
    if (passt) {
      widget.dict.set(PDFName.of('AS'), gewaehlt);
      treffer = true;
    } else {
      zuEntfernen.add(widget.dict);
    }
  }
  if (!treffer) return;                       // unbekannter Exportwert – nichts anfassen

  field.acroField.dict.set(PDFName.of('V'), gewaehlt);

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      let dict;
      try { dict = annots.lookup(i); } catch { continue; }
      if (zuEntfernen.has(dict)) annots.remove(i);
    }
  }
}

// ── AcroForm-Felder befüllen (TG, ESTV, ZH) ──────────────────────────────────
async function fillAcroformBytes(formDef, felder, srcBytes) {
  const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form   = pdfDoc.getForm();

  for (const section of formDef.sections) {
    for (const feld of section.felder) {
      const val     = felder[feld.id];
      const valBund = feld.acroFieldBund ? felder[`${feld.id}_bund`] : undefined;
      const hatWert = val     != null && val     !== '';
      const hatBund = valBund != null && valBund !== '';
      // Nur die Bundesspalte erfasst? Dann trotzdem schreiben.
      if (!hatWert && !hatBund) continue;

      // Auswahlliste (Dropdown) – z.B. Gemeinde beim ZH-Formular
      if (feld.acroChoice) {
        try { form.getDropdown(feld.acroChoice).select(String(val)); } catch {}
        continue;
      }

      // Ja/Nein-Gruppe – Option wird über acroRadioWerte auf den Exportwert gemappt
      if (feld.acroRadio) {
        waehleOption(pdfDoc, form, feld.acroRadio, feld.acroRadioWerte?.[val] ?? String(val));
        continue;
      }

      if (!feld.acroField) continue;

      if (feld.typ === 'checkbox') {
        try {
          const cb = form.getCheckBox(feld.acroField);
          if (val) cb.check(); else cb.uncheck();
        } catch {}
        continue;
      }

      const text = hatWert ? formatValue(feld.id, val, feld.typ) : '';
      if (hatWert) {
        try {
          const tf = form.getTextField(feld.acroField);
          if (feld.schriftgroesse) setzeSchriftgroesse(tf, feld.schriftgroesse);
          tf.setText(text);
        } catch {}
      }

      // Zweite Spalte (Bundessteuer) mitfüllen. Ein eigener Wert in
      // `<id>_bund` schlägt die Spiegelung.
      if (feld.acroFieldBund) {
        const bundWert = hatBund ? formatValue(feld.id, valBund, feld.typ) : text;
        try { form.getTextField(feld.acroFieldBund).setText(bundWert); } catch {}
      }
    }
  }

  // Pre-Fill-Hooks (z.B. Vertreter Artis → schreibt Artis-Text in allg.vertreter.adresse, wenn Hacken gesetzt)
  // Unterstützt: { text } literal · { fromField } · { fromFields, sep } (Default-Sep '\n')
  //              { lines: [ {fromField} | {fromFields,sep} | {text} ] } für mehrzeilige Felder
  if (Array.isArray(formDef.preFillHooks)) {
    for (const hook of formDef.preFillHooks) {
      if (hook.whenField && !felder[hook.whenField]) continue;
      let text = hook.text;
      if (text == null && hook.fromField) {
        text = felder[hook.fromField] != null ? String(felder[hook.fromField]) : '';
      }
      if (text == null && Array.isArray(hook.fromFields)) {
        const sep = hook.sep ?? '\n';
        text = hook.fromFields.map(id => felder[id]).filter(v => v != null && v !== '').join(sep);
      }
      if (text == null && Array.isArray(hook.lines)) {
        const lineTexts = hook.lines.map(l => {
          if (l.text != null) return String(l.text);
          if (l.fromField) return felder[l.fromField] != null ? String(felder[l.fromField]) : '';
          if (Array.isArray(l.fromFields)) {
            const sep = l.sep ?? ' ';
            return l.fromFields.map(id => felder[id]).filter(v => v != null && v !== '').join(sep);
          }
          return '';
        }).filter(s => s !== '');
        text = lineTexts.join('\n');
      }
      if (!text) continue;
      try {
        const tf = form.getTextField(hook.acroField);
        if (hook.schriftgroesse) setzeSchriftgroesse(tf, hook.schriftgroesse);
        tf.setText(text);
      } catch {}
    }
  }

  // Bund-Spiegel: leeres Bund-Feld (.calc.1) bekommt Wert vom Kanton-Feld (.calc.0)
  if (formDef.mirrorKantonToBund) {
    for (const f of form.getFields()) {
      const name = f.getName();
      if (!name.endsWith('.calc.1')) continue;
      if (typeof f.getText !== 'function') continue;
      try {
        if ((f.getText() || '').trim()) continue;
        const ktName = name.replace(/\.calc\.1$/, '.calc.0');
        const ktVal  = form.getTextField(ktName).getText();
        if (ktVal && ktVal.trim()) f.setText(ktVal);
      } catch {}
    }
  }

  // Berechnete Summen (ersetzen das PDF-eigene JavaScript)
  const summen = runComputed(formDef, felder);
  for (const [acroField, wert] of Object.entries(summen)) {
    if (!wert) continue;                       // 0 / NaN bleibt leer wie von Hand
    try { form.getTextField(acroField).setText(fmtChf(wert)); } catch {}
  }

  // Felder, die nicht in den Ausdruck gehören, VOR dem Flatten entfernen.
  // pdf-lib zeichnet beim Flatten auch als „hidden" markierte Widgets – ohne
  // das Entfernen landeten z.B. Navigations-Buttons oder ein Strichcode mit
  // seinem Vorgabewert im PDF.
  if (formDef.dropFields?.length) {
    entferneFelder(pdfDoc, form, formDef.dropFields);
  }

  form.updateFieldAppearances(font);
  form.flatten();

  // Untere Button-Leiste (Drucken/Schliessen/Löschen/Zurück/Weiter) überdecken
  if (formDef.hideBottomButtons) {
    const h = typeof formDef.hideBottomButtons === 'number' ? formDef.hideBottomButtons : 35;
    for (const page of pdfDoc.getPages()) {
      page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: h, color: rgb(1, 1, 1) });
    }
  }

  // Gezielte Weißrechtecke (z.B. obere "Hinweis"-Buttons auf Seite 1)
  // formDef.hideRects = [{ seite: 1..N, x, y, w, h }, ...]
  if (Array.isArray(formDef.hideRects)) {
    const pages = pdfDoc.getPages();
    for (const r of formDef.hideRects) {
      const page = pages[(r.seite ?? 1) - 1];
      if (!page) continue;
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(1, 1, 1) });
    }
  }

  // Strichcode nach dem Flatten zeichnen (liegt damit zuoberst)
  if (formDef.barcode) {
    const cfg  = formDef.barcode;
    const text = typeof cfg.payload === 'function' ? cfg.payload(felder) : cfg.payload;
    const page = pdfDoc.getPages()[(cfg.seite ?? 1) - 1];
    if (text && page) {
      const breite = drawCode39(page, text, cfg);
      if (cfg.w && breite > cfg.w) {
        console.warn(`Strichcode zu breit (${breite.toFixed(1)}pt > ${cfg.w}pt) – Nutzlast "${text}"`);
      }
    }
  }

  return pdfDoc.save();
}

// ── Statisches PDF, kein Booklet ─────────────────────────────────────────────
async function fillStaticOverlayBytes(formDef, felder, srcBytes) {
  const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages  = pdfDoc.getPages();

  for (const section of formDef.sections) {
    for (const feld of section.felder) {
      if (!feld.overlay) continue;
      const val = felder[feld.id];
      if (val == null || val === '' || val === false) continue;
      const { seite, x, y, groesse = 9 } = feld.overlay;
      const page = pages[seite];
      if (!page) continue;
      const text = feld.typ === 'checkbox' ? (val ? 'X' : '') : formatValue(feld.id, val);
      if (!text) continue;
      page.drawText(text, { x, y, size: groesse, font, color: rgb(0, 0, 0), maxWidth: 200 });
    }
  }
  return pdfDoc.save();
}

// ── Öffentliche API ──────────────────────────────────────────────────────────

// Liefert Vorschau-/Print-Bytes (booklet → 4×A4, acroform → flatten, sonst overlay)
export async function fillPdfBytes(formDef, felder, srcBytes) {
  if (formDef.bookletLayout) return buildSplitFilledPdf(formDef, felder, srcBytes);
  if (formDef.typ === 'acroform') return fillAcroformBytes(formDef, felder, srcBytes);
  return fillStaticOverlayBytes(formDef, felder, srcBytes);
}

// Lädt PDF einmal, gibt Bytes zurück (für Cache in PdfViewer)
// `storage:`-Pfade werden vorher zur Signed URL des Buckets aufgelöst.
export async function fetchPdfBytes(pdfUrl) {
  const url  = await resolveFormularPdfUrl(pdfUrl);
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`PDF konnte nicht geladen werden: ${resp.statusText}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// Print/Download – verwendet exakt denselben Weg wie die Vorschau
export async function fillAndDownload(formDef, felder, kundenName, steuerjahr) {
  const srcBytes = await fetchPdfBytes(formDef.pdfUrl);
  const pdfBytes = await fillPdfBytes(formDef, felder, srcBytes);

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safeName = kundenName.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '_');
  a.href = url;
  a.download = `SE_${formDef.kanton}_${steuerjahr}_${safeName}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// Hilfsfunktion: Alle AcroForm-Feldnamen eines PDFs ausgeben (Entwickler-Tool)
export async function listPdfFields(pdfUrl) {
  const pdfBytes = await fetchPdfBytes(pdfUrl);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  return form.getFields().map(f => ({ name: f.getName(), typ: f.constructor.name }));
}
