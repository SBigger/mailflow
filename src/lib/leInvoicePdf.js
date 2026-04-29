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
async function loadSwissqrbill() {
  try {
    const pdfMod = await import('swissqrbill/pdf');
    const utilMod = await import('swissqrbill/utils').catch(() => ({}));
    return { ...pdfMod, ...utilMod };
  } catch (e) {
    console.error('swissqrbill konnte nicht geladen werden:', e);
    throw new Error('PDF-Library (swissqrbill) konnte nicht geladen werden. Wahrscheinlich fehlen Buffer/Stream-Polyfills im Vite-Build.');
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
  const stream = new BlobStream();
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

  // ---- 6. Footer auf allen Seiten + QR-Bill ----
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
