import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

function formatValue(id, val) {
  if (val == null || val === '') return '';
  if (CHF_COLS.has(id) && !isNaN(parseFloat(val))) {
    return parseFloat(val).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return String(val);
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

// ── AcroForm-Felder befüllen (TG, ESTV) ──────────────────────────────────────
async function fillAcroformBytes(formDef, felder, srcBytes) {
  const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form   = pdfDoc.getForm();

  for (const section of formDef.sections) {
    for (const feld of section.felder) {
      if (!feld.acroField) continue;
      const val = felder[feld.id];
      if (val == null || val === '') continue;
      try {
        if (feld.typ === 'checkbox') {
          const cb = form.getCheckBox(feld.acroField);
          if (val) cb.check(); else cb.uncheck();
        } else {
          form.getTextField(feld.acroField).setText(formatValue(feld.id, val));
        }
      } catch {}
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
        form.getTextField(hook.acroField).setText(text);
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
export async function fetchPdfBytes(pdfUrl) {
  const resp = await fetch(pdfUrl, { mode: 'cors' });
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
  const resp = await fetch(pdfUrl, { mode: 'cors' });
  const pdfBytes = await resp.arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  return form.getFields().map(f => ({ name: f.getName(), typ: f.constructor.name }));
}
