// Leistungserfassung · PDF-Generator (mit Swiss QR-Bill)
// =====================================================================
// Generiert eine PDF-Rechnung im Browser via swissqrbill (PDFKit-basiert).
// Speichert die PDF in Supabase Storage (Bucket "invoices") und gibt die
// öffentliche URL zurück.
//
// HINWEIS: swissqrbill nutzt PDFKit + Buffer/Stream-Polyfills. Vite löst
// das automatisch wenn `vite-plugin-node-polyfills` aktiv ist – falls
// nicht, fällt der Generator in einen "QR-Bill-only-SVG"-Modus zurück.

import { supabase } from '@/api/supabaseClient';
import {
  ARTIS_GREEN_DARK,
  ARTIS_GREEN_BORDER,
  ZEBRA_BG,
  MUTED_TEXT,
  fmtChf,
  fmtDate,
  loadImageBuffer,
  drawHeader,
  drawAddress,
  drawTableHeader,
  drawTotalsBox,
  drawFooter,
  resetText,
} from './leBrandingHelpers';

// Lazy-Import damit der Bundle-Hit nur passiert, wenn wirklich PDF gebaut wird.
// swissqrbill v3: wir importieren direkt das Browser-Bundle (eine JS-Datei mit
// allen Dependencies inkl. PDFKit + fontkit gebundelt) – damit Vite/Rollup nicht
// versucht, fontkit's `fs.readFileSync` aufzulösen.
async function loadSwissqrbill() {
  try {
    const mod = await import('@swissqrbill-pdf');
    const PDF = mod.PDF || mod.default?.PDF || mod;
    if (typeof PDF !== 'function') {
      throw new Error('PDF-Klasse nicht gefunden in swissqrbill-Browser-Bundle (keys: ' + Object.keys(mod).join(', ') + ')');
    }
    const blobStreamMod = await import('blob-stream');
    const BlobStream = blobStreamMod.default || blobStreamMod;
    return { PDF, BlobStream };
  } catch (e) {
    console.error('swissqrbill konnte nicht geladen werden:', e);
    throw new Error('PDF-Library konnte nicht geladen werden: ' + (e?.message ?? e));
  }
}

// QR-Referenz nach Mod-10 ergänzen (vereinfacht – swissqrbill validiert sowieso)
function addMod10CheckDigit(numeric) {
  const table = [0,9,4,6,8,2,7,1,3,5];
  let carry = 0;
  for (const ch of numeric.replace(/\D/g, '')) {
    carry = table[(carry + parseInt(ch, 10)) % 10];
  }
  const checkDigit = (10 - carry) % 10;
  return numeric.replace(/\D/g, '') + checkDigit;
}

// Erzeugt eine plausible 27-stellige QR-Referenz aus customer + invoice no
export function buildQrReference(customerId, invoiceNo) {
  const cust = String(customerId || '').replace(/\D/g, '').slice(0, 8).padStart(8, '0');
  const inv = String(invoiceNo || '').replace(/\D/g, '').slice(0, 18).padStart(18, '0');
  const base26 = (cust + inv).slice(0, 26);
  return addMod10CheckDigit(base26);
}

/**
 * Hauptfunktion: PDF-Rechnung generieren + in Supabase-Storage hochladen
 * @param {Object} args
 * @param {Object} args.invoice  – le_invoice-Row inkl. lines, customer, project
 * @param {Object} args.company  – le_company_settings-Row
 * @returns {Promise<{ url: string, path: string }>}
 */
export async function generateInvoicePdf({ invoice, company }) {
  if (!invoice) throw new Error('invoice fehlt');
  if (!company) throw new Error('Firmen-Settings fehlen – bitte unter Stammdaten anlegen.');

  const { PDF, BlobStream } = await loadSwissqrbill();
  // BlobStream ist eine Factory-Funktion (kein Constructor): `blobStream()` not `new`

  // Logo vorab laden (parallel, blockiert nur wenn URL gesetzt)
  const logoBuf = await loadImageBuffer(company.logo_url);

  // QR-Daten zusammenbauen
  const useQrIban = !!company.qr_iban;
  const reference = invoice.qr_reference || (useQrIban
    ? buildQrReference(invoice.customer_id, invoice.invoice_no)
    : undefined);

  const customer = invoice.customer || {};
  const project = invoice.project || {};
  const qrData = {
    currency: 'CHF',
    amount: Number(invoice.total || 0),
    reference,
    message: `Rechnung ${invoice.invoice_no || ''}`.trim(),
    creditor: {
      name: company.company_name || 'Artis Treuhand GmbH',
      account: useQrIban ? company.qr_iban : company.iban,
      address: company.street || '',
      buildingNumber: company.building_number || '',
      zip: company.zip || '',
      city: company.city || '',
      country: company.country || 'CH',
    },
    debtor: customer?.company_name ? {
      name: customer.company_name,
      address: customer.street || '',
      buildingNumber: customer.building_number || '',
      zip: customer.zip || '',
      city: customer.city || '',
      country: customer.country || 'CH',
    } : undefined,
  };

  // PDF erzeugen – bufferPages: true → Footer kann nachträglich auf alle Seiten
  const stream = BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4', bufferPages: true });

  // ---- 1. Branding-Header (Logo links, Adresse rechts, grüne Linie) ----
  drawHeader(pdf, company, logoBuf);

  // ---- 2. Empfänger-Adressfeld (CH-Sichtfenster) ----
  drawAddress(pdf, customer, 50, 130);

  // ---- 3. Rechnungs-Header-Block ----
  const headerY = 220;
  pdf.font('Helvetica-Bold').fontSize(18).fillColor(ARTIS_GREEN_DARK)
     .text('Rechnung', 50, headerY);
  resetText(pdf);

  // Rechnungsnummer rechts
  pdf.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
     .text(`Nr. ${invoice.invoice_no || '(Entwurf)'}`, 350, headerY + 4, {
       width: 195, align: 'right',
     });
  pdf.font('Helvetica');

  // Meta-Block in zwei Spalten
  const metaY = headerY + 36;
  const labelStyle = { width: 90 };
  const valueStyle = { width: 130 };

  pdf.fontSize(9).fillColor(MUTED_TEXT);
  pdf.text('Datum', 50, metaY, labelStyle);
  pdf.text('Fälligkeit', 50, metaY + 14, labelStyle);
  if (invoice.period_from || invoice.period_to) {
    pdf.text('Leistungszeitraum', 50, metaY + 28, labelStyle);
  }

  pdf.fillColor('#000000').font('Helvetica');
  pdf.text(fmtDate(invoice.issue_date), 140, metaY, valueStyle);
  pdf.text(fmtDate(invoice.due_date), 140, metaY + 14, valueStyle);
  if (invoice.period_from || invoice.period_to) {
    pdf.text(
      `${fmtDate(invoice.period_from)} – ${fmtDate(invoice.period_to)}`,
      140, metaY + 28, valueStyle
    );
  }

  // Rechte Spalte: Kundennr / Projekt / Sachbearbeiter
  const rightCol = 320;
  let rightY = metaY;
  pdf.fontSize(9).fillColor(MUTED_TEXT);
  if (customer.customer_no || customer.id) {
    pdf.text('Kundennr.', rightCol, rightY, labelStyle);
    pdf.fillColor('#000000');
    pdf.text(String(customer.customer_no || customer.id || ''), rightCol + 90, rightY, valueStyle);
    pdf.fillColor(MUTED_TEXT);
    rightY += 14;
  }
  if (project.name || invoice.project_name) {
    pdf.text('Projekt', rightCol, rightY, labelStyle);
    pdf.fillColor('#000000');
    pdf.text(project.name || invoice.project_name || '', rightCol + 90, rightY, valueStyle);
    pdf.fillColor(MUTED_TEXT);
    rightY += 14;
  }
  if (invoice.responsible || invoice.handler_name) {
    pdf.text('Sachbearbeiter', rightCol, rightY, labelStyle);
    pdf.fillColor('#000000');
    pdf.text(invoice.responsible || invoice.handler_name || '', rightCol + 90, rightY, valueStyle);
    rightY += 14;
  }
  resetText(pdf);

  // ---- 4. Positions-Tabelle ----
  const cols = { no: 50, desc: 80, hours: 360, rate: 415, amount: 475 };
  let y = Math.max(metaY + 60, rightY + 25);
  y = drawTableHeader(pdf, y, cols);

  pdf.font('Helvetica').fontSize(10).fillColor('#000000');
  const lines = invoice.lines || [];
  const descWidth = cols.hours - cols.desc - 10;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Höhe der Beschreibung berechnen, damit Zebra & Page-Break passen
    const descText = line.description || '';
    const descH = pdf.heightOfString(descText, { width: descWidth }) || 14;
    const rowH = Math.max(descH + 8, 22);

    // Zebra-Background
    if (i % 2 === 0) {
      pdf.fillColor(ZEBRA_BG).rect(50, y - 2, 495, rowH).fill();
      resetText(pdf);
    }

    pdf.font('Helvetica').fontSize(10).fillColor('#000000');
    pdf.text(String(i + 1), cols.no, y + 2, { width: 24 });
    pdf.text(descText, cols.desc, y + 2, { width: descWidth });
    pdf.text(fmtChf(line.hours), cols.hours, y + 2, { width: 50, align: 'right' });
    pdf.text(fmtChf(line.rate), cols.rate, y + 2, { width: 55, align: 'right' });
    pdf.text(fmtChf(line.amount), cols.amount, y + 2, { width: 70, align: 'right' });

    y += rowH;

    // Page-Break (lasse Platz für Total-Box + Footer)
    if (y > 680 && i < lines.length - 1) {
      pdf.addPage();
      y = 60;
      y = drawTableHeader(pdf, y, cols);
    }
  }

  // ---- 5. Total-Block rechts unten ----
  y += 12;
  // Falls knapp: neue Seite
  if (y > 660) {
    pdf.addPage();
    y = 60;
  }

  // Rabatt berechnen
  const discount = (Number(invoice.subtotal || 0) * (Number(invoice.discount_pct || 0) / 100))
    + Number(invoice.discount_amount || 0);

  drawTotalsBox(pdf, {
    subtotal: invoice.subtotal,
    discount,
    vat_pct: invoice.vat_pct ?? 8.1,
    vat_amount: invoice.vat_amount,
    total: invoice.total,
  }, y);

  // ---- Notes ----
  if (invoice.notes) {
    let notesY = y;
    pdf.font('Helvetica').fontSize(9).fillColor('#444444')
       .text(invoice.notes, 50, notesY, { width: 250 });
    resetText(pdf);
  }

  // ---- 6. Beiblatt mit Detail-Buchungen (wenn time_entries vorhanden) ----
  if (Array.isArray(invoice.time_entries) && invoice.time_entries.length > 0) {
    drawBeiblatt(pdf, invoice, customer, company);
  }

  // ---- 7. Footer auf allen Seiten + QR-Bill ----
  drawFooter(pdf, company);
  pdf.addQRBill();
  pdf.end();

  // Blob abwarten
  const blob = await new Promise((resolve) => {
    stream.on('finish', () => resolve(stream.toBlob('application/pdf')));
  });

  // Upload zu Supabase Storage
  const path = `invoices/${invoice.id}.pdf`;
  const upload = await supabase.storage.from('invoices').upload(path, blob, {
    upsert: true, contentType: 'application/pdf',
  });
  if (upload.error) {
    // Bucket fehlt evtl. – erst mal Blob zurückgeben (Download client-seitig)
    console.error('Upload fehlgeschlagen, fallback auf Browser-Download:', upload.error);
    return { blob, url: null, path: null };
  }
  const { data: pub } = supabase.storage.from('invoices').getPublicUrl(path);
  return { url: pub.publicUrl, path, blob };
}

// ---- Beiblatt-Renderer ----------------------------------------------------
// Listet alle einzelnen Time-Entries einer Rechnung gruppiert nach Leistungsart
// (Service-Type) auf. Kulant-Einträge werden separat markiert mit
// durchgestrichenem Betrag und "(kulant)"-Hinweis.
function drawBeiblatt(pdf, invoice, customer, company) {
  pdf.addPage();
  let y = 50;

  // Header
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(ARTIS_GREEN_DARK)
     .text(`Beilage zur Rechnung ${invoice.invoice_no || '(Entwurf)'} vom ${fmtDate(invoice.issue_date)}`, 50, y);
  resetText(pdf);
  y += 22;

  pdf.font('Helvetica').fontSize(10).fillColor(MUTED_TEXT);
  if (customer?.company_name) {
    pdf.text(`${customer.company_name}${customer.city ? ' – ' + customer.city : ''}`, 50, y);
    y += 14;
  }
  if (invoice.period_from || invoice.period_to) {
    pdf.text(`Rechnungsperiode: ${fmtDate(invoice.period_from)} – ${fmtDate(invoice.period_to)}`, 50, y);
    y += 14;
  }
  resetText(pdf);
  y += 8;

  // Tabellen-Header
  const cols = { date: 50, ma: 100, desc: 135, qty: 360, unit: 395, rate: 425, amount: 480 };
  drawBeiblattHeader(pdf, y, cols);
  y += 18;

  // Gruppieren nach service_type (Name)
  const entries = invoice.time_entries || [];
  const groups = new Map();
  for (const e of entries) {
    const key = e.service_type?.id || 'unbekannt';
    if (!groups.has(key)) {
      groups.set(key, {
        name: e.service_type?.name || 'Sonstiges',
        entries: [],
        billableSum: 0,
        kulantSum: 0,
      });
    }
    const g = groups.get(key);
    g.entries.push(e);
    const wert = Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0);
    if (e.status === 'kulant_abgerechnet' || e.status === 'kulant') {
      g.kulantSum += wert;
    } else {
      g.billableSum += wert;
    }
  }

  let totalHonorar = 0;
  let totalKulant = 0;

  for (const [, g] of groups) {
    // Einträge der Gruppe nach Datum
    const sorted = g.entries.slice().sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
    for (const e of sorted) {
      // Page-Break: lasse Platz für Subtotal + Total-Block
      if (y > 720) {
        pdf.addPage();
        y = 50;
        drawBeiblattHeader(pdf, y, cols);
        y += 18;
      }
      const isKulant = e.status === 'kulant_abgerechnet' || e.status === 'kulant';
      const wert = Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0);

      pdf.font('Helvetica').fontSize(9).fillColor(isKulant ? '#4d2995' : '#000000');
      pdf.text(fmtDate(e.entry_date), cols.date, y, { width: cols.ma - cols.date - 2 });
      pdf.text(e.employee?.short_code || '', cols.ma, y, { width: cols.desc - cols.ma - 2 });

      const descText = (e.description || '') + (isKulant ? ' (kulant)' : '');
      const descH = pdf.heightOfString(descText, { width: cols.qty - cols.desc - 5 });
      pdf.text(descText, cols.desc, y, { width: cols.qty - cols.desc - 5 });

      pdf.text(fmtChf(e.hours_internal), cols.qty, y, { width: cols.unit - cols.qty - 2, align: 'right' });
      pdf.text('STD', cols.unit, y, { width: cols.rate - cols.unit - 2, align: 'right' });
      pdf.text(fmtChf(e.rate_snapshot), cols.rate, y, { width: cols.amount - cols.rate - 2, align: 'right' });

      pdf.fillColor(isKulant ? '#4d2995' : '#000000');
      pdf.text(fmtChf(wert), cols.amount, y, { width: 65, align: 'right' });
      // Strike-through bei kulant
      if (isKulant) {
        const tw = 65;
        pdf.lineWidth(0.5).strokeColor('#4d2995')
           .moveTo(cols.amount, y + 5).lineTo(cols.amount + tw, y + 5).stroke();
        pdf.lineWidth(1).strokeColor('#000000');
      }

      y += Math.max(descH + 2, 12);
    }

    // Subtotal pro Service-Typ
    if (y > 730) { pdf.addPage(); y = 50; }
    pdf.lineWidth(0.4).strokeColor('#cccccc')
       .moveTo(cols.desc, y).lineTo(545, y).stroke();
    pdf.lineWidth(1).strokeColor('#000000');
    y += 3;

    pdf.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
    pdf.text(g.name, cols.desc, y, { width: cols.amount - cols.desc - 5 });
    pdf.text(fmtChf(g.billableSum), cols.amount, y, { width: 65, align: 'right' });
    if (g.kulantSum > 0) {
      pdf.font('Helvetica').fontSize(8).fillColor('#4d2995');
      pdf.text(`+ kulant CHF ${fmtChf(g.kulantSum)} (nicht verrechnet)`, cols.desc, y + 11, { width: 300 });
    }
    resetText(pdf);
    y += g.kulantSum > 0 ? 22 : 14;

    totalHonorar += g.billableSum;
    totalKulant  += g.kulantSum;
  }

  // ---- Total-Block am Ende ----
  if (y > 700) { pdf.addPage(); y = 50; }
  y += 8;
  pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
     .moveTo(50, y).lineTo(545, y).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
  y += 6;

  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#333333');
  pdf.text('Total Honorar', cols.desc, y, { width: cols.amount - cols.desc - 5 });
  pdf.text(fmtChf(totalHonorar), cols.amount, y, { width: 65, align: 'right' });
  y += 14;

  // Rabatt
  const discount = (Number(invoice.subtotal || 0) * (Number(invoice.discount_pct || 0) / 100))
    + Number(invoice.discount_amount || 0);
  if (discount > 0) {
    pdf.font('Helvetica').fontSize(10).fillColor('#000000');
    pdf.text('Rabatt', cols.desc, y, { width: cols.amount - cols.desc - 5 });
    pdf.text(`-${fmtChf(discount)}`, cols.amount, y, { width: 65, align: 'right' });
    y += 14;
  }

  // Total ohne MWST
  pdf.font('Helvetica-Bold').fontSize(10).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Total ohne Mehrwertsteuer', cols.desc, y, { width: cols.amount - cols.desc - 5 });
  pdf.text(fmtChf(invoice.subtotal), cols.amount, y, { width: 65, align: 'right' });
  resetText(pdf);
  y += 14;

  // Kulant-Hinweis
  if (totalKulant > 0) {
    y += 6;
    pdf.font('Helvetica-Oblique').fontSize(9).fillColor('#4d2995');
    pdf.text(
      `Hinweis: Zusätzlich wurden CHF ${fmtChf(totalKulant)} kulant erbracht und nicht verrechnet.`,
      50, y, { width: 495 }
    );
    resetText(pdf);
  }
}

function drawBeiblattHeader(pdf, y, cols) {
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Datum', cols.date, y);
  pdf.text('MA', cols.ma, y);
  pdf.text('Bezeichnung', cols.desc, y);
  pdf.text('Anz.', cols.qty, y, { width: cols.unit - cols.qty - 2, align: 'right' });
  pdf.text('Eht.', cols.unit, y, { width: cols.rate - cols.unit - 2, align: 'right' });
  pdf.text('Ansatz', cols.rate, y, { width: cols.amount - cols.rate - 2, align: 'right' });
  pdf.text('CHF', cols.amount, y, { width: 65, align: 'right' });
  resetText(pdf);
  pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
     .moveTo(50, y + 12).lineTo(545, y + 12).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
}

// Hilfs-Download – im Browser sichtbar machen
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
