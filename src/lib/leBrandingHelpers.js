// Branding-Helpers für PDF-Dokumente (Rechnung & Mahnung)
// =====================================================================
// Gemeinsame Funktionen für Schweizer Treuhand-Look:
//  - Logo laden (HTTP fetch -> ArrayBuffer für PDFKit.image)
//  - Header-Block (Logo links, Adresse rechts)
//  - Adressfeld-Block für Sichtfenster-Couvert
//  - Total-Box rechts unten
//  - Footer mit Seitenzahl
// =====================================================================

export const ARTIS_GREEN = '#7a9b7f';
export const ARTIS_GREEN_DARK = '#2d5a2d';
export const ARTIS_GREEN_LIGHT_BG = '#f5faf5';
export const ARTIS_GREEN_BORDER = '#bfd3bf';
export const ZEBRA_BG = '#fafbf9';
export const FOOTER_LINE = '#d9dfd9';
export const MUTED_TEXT = '#999999';
export const AMPEL_ORANGE = '#c87f1f';
export const AMPEL_RED = '#a02828';

// PDFKit text() pollutes the cursor; this helper resets fillColor to black after use
export function resetText(pdf) {
  pdf.fillColor('#000000');
}

export function fmtChf(n) {
  return Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}

/** Lädt ein Bild von einer URL und liefert einen ArrayBuffer (für PDFKit.image). */
export async function loadImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Zeichnet den Branding-Header oben auf der ersten Seite.
 *  - Links: Logo (max 80pt breit, 50pt hoch) ODER Firmenname (14pt fett)
 *  - Rechts: Adressblock (rechtsbündig, 9pt)
 *  - Unten: dünne grüne Trennlinie
 *
 * @param {Object} pdf      - swissqrbill PDF (PDFKit-Doc)
 * @param {Object} company  - le_company_settings-Row
 * @param {ArrayBuffer|null} logoBuf - vorab geladenes Logo (oder null)
 */
export function drawHeader(pdf, company, logoBuf = null) {
  const left = 50;
  const right = 545;
  const top = 40;

  // Linke Hälfte
  if (logoBuf) {
    try {
      pdf.image(logoBuf, left, top, { fit: [80, 50] });
    } catch (e) {
      // Bild-Format evtl. SVG/WebP – PDFKit unterstützt nur JPEG/PNG
      pdf.fillColor(ARTIS_GREEN_DARK).fontSize(14).font('Helvetica-Bold')
         .text(company.company_name || '', left, top + 10);
      resetText(pdf);
    }
  } else {
    pdf.fillColor(ARTIS_GREEN_DARK).fontSize(14).font('Helvetica-Bold')
       .text(company.company_name || '', left, top + 10);
    resetText(pdf);
  }

  // Rechte Hälfte – Adressblock rechtsbündig
  const addressLines = [];
  const streetLine = [company.street, company.building_number].filter(Boolean).join(' ').trim();
  if (streetLine) addressLines.push(streetLine);
  const cityLine = [company.zip, company.city].filter(Boolean).join(' ').trim();
  if (cityLine) addressLines.push(cityLine);
  if (company.country && company.country !== 'CH') addressLines.push(company.country);
  if (company.vat_no) addressLines.push(`MWST: ${company.vat_no}`);
  if (company.uid) addressLines.push(`UID: ${company.uid}`);
  if (company.email) addressLines.push(company.email);
  if (company.phone) addressLines.push(company.phone);
  if (company.website) addressLines.push(company.website);

  pdf.font('Helvetica').fontSize(9).fillColor('#333333')
     .text(addressLines.join('\n'), right - 200, top, { width: 200, align: 'right' });
  resetText(pdf);

  // Trennlinie in Artis-Grün
  const lineY = top + 65;
  pdf.lineWidth(1.5).strokeColor(ARTIS_GREEN)
     .moveTo(left, lineY).lineTo(right, lineY).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
}

/**
 * Empfänger-Adressfeld für CH-Sichtfenster-Couvert.
 * Position: x=50, y=130 (Standard für DIN lang Couvert C5/6).
 * Über dem Block ein kleines "An:"-Label.
 */
export function drawAddress(pdf, recipient, x = 50, y = 130) {
  if (!recipient || !recipient.company_name) return;

  pdf.font('Helvetica').fontSize(8).fillColor(MUTED_TEXT)
     .text('An:', x, y - 12);
  resetText(pdf);

  const lines = [];
  if (recipient.company_name) lines.push(recipient.company_name);
  const street = [recipient.street, recipient.building_number].filter(Boolean).join(' ').trim();
  if (street) lines.push(street);
  const cityLine = [recipient.zip, recipient.city].filter(Boolean).join(' ').trim();
  if (cityLine) lines.push(cityLine);
  if (recipient.country && recipient.country !== 'CH') lines.push(recipient.country);

  pdf.font('Helvetica').fontSize(11).fillColor('#000000')
     .text(lines.join('\n'), x, y, { width: 240 });
}

/**
 * Zeichnet einen Tabellen-Header für die Positions-Tabelle.
 * Liefert die neue Y-Koordinate zurück (unter dem Header).
 */
export function drawTableHeader(pdf, y, cols) {
  const left = 50;
  const right = 545;
  const headerH = 18;

  pdf.fillColor(ARTIS_GREEN_LIGHT_BG)
     .rect(left, y, right - left, headerH).fill();
  resetText(pdf);

  pdf.font('Helvetica-Bold').fontSize(9).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Nr.',  cols.no,     y + 5, { width: 24,  align: 'left' });
  pdf.text('Beschreibung', cols.desc, y + 5, { width: cols.hours - cols.desc - 5 });
  pdf.text('Std.', cols.hours,  y + 5, { width: 50,  align: 'right' });
  pdf.text('Satz', cols.rate,   y + 5, { width: 60,  align: 'right' });
  pdf.text('Betrag CHF', cols.amount, y + 5, { width: 70, align: 'right' });
  resetText(pdf);
  pdf.font('Helvetica');

  // Untere Linie
  pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
     .moveTo(left, y + headerH).lineTo(right, y + headerH).stroke();
  pdf.lineWidth(1).strokeColor('#000000');

  return y + headerH + 4;
}

/**
 * Zeichnet die Total-Box rechts unten.
 * Returns die neue Y-Koordinate unter der Box.
 *
 * @param {Object} pdf
 * @param {Object} totals - { subtotal, discount, vat_pct, vat_amount, total }
 * @param {number} y - Start-Y
 */
export function drawTotalsBox(pdf, totals, y) {
  const boxX = 320;
  const boxW = 225;       // bis 545
  const right = 545;
  const labelX = boxX + 10;
  const valueRight = right - 10;
  const valueWidth = 100;
  const padding = 8;

  // Wie viele Zeilen?
  const rows = [];
  rows.push(['Zwischensumme', fmtChf(totals.subtotal)]);
  if (Number(totals.discount || 0) > 0) {
    rows.push(['Rabatt', `-${fmtChf(totals.discount)}`]);
  }
  rows.push([`MWST ${Number(totals.vat_pct ?? 8.1)}%`, fmtChf(totals.vat_amount)]);

  const rowH = 16;
  const totalRowH = 22;
  const boxH = padding + rows.length * rowH + totalRowH + padding;

  // Box-Hintergrund + Border
  pdf.fillColor(ZEBRA_BG).rect(boxX, y, boxW, boxH).fill();
  pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
     .rect(boxX, y, boxW, boxH).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
  resetText(pdf);

  let cy = y + padding;
  pdf.font('Helvetica').fontSize(10).fillColor('#333333');
  for (const [k, v] of rows) {
    pdf.text(k, labelX, cy, { width: 120 });
    pdf.text(v, valueRight - valueWidth, cy, { width: valueWidth, align: 'right' });
    cy += rowH;
  }
  // Trennlinie vor Total
  pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
     .moveTo(boxX + 5, cy + 1).lineTo(boxX + boxW - 5, cy + 1).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
  cy += 5;

  // Total
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Total CHF', labelX, cy, { width: 120 });
  pdf.text(fmtChf(totals.total), valueRight - valueWidth, cy, { width: valueWidth, align: 'right' });
  resetText(pdf);
  pdf.font('Helvetica');

  return y + boxH;
}

/**
 * Footer auf jeder Seite ergänzen. PDFKit erlaubt das nachträglich via
 * pdf.bufferedPageRange() + pdf.switchToPage(i).
 *
 * Wichtig: Vor pdf.end() aufrufen, NACH dem ganzen Content.
 * Das umgeht das Problem, dass swissqrbill die QR-Bill auf eine eigene Seite legen kann.
 */
export function drawFooter(pdf, company) {
  if (!pdf.bufferedPageRange) return; // Defensive: nicht alle PDFKit-Builds haben das
  const range = pdf.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    pdf.switchToPage(range.start + i);
    const pageNo = i + 1;
    const y = 800;
    const left = 50;
    const right = 545;

    // Linie
    pdf.lineWidth(0.5).strokeColor(FOOTER_LINE)
       .moveTo(left, y).lineTo(right, y).stroke();
    pdf.lineWidth(1).strokeColor('#000000');

    // Footer-Text (zentriert) + Seitenzahl (rechts)
    pdf.font('Helvetica').fontSize(8).fillColor('#666666');
    if (company?.invoice_footer) {
      pdf.text(company.invoice_footer, left, y + 6, { width: right - left, align: 'center' });
    }
    pdf.text(`Seite ${pageNo} von ${total}`, right - 100, y + 6, { width: 100, align: 'right' });
    resetText(pdf);
  }
}
