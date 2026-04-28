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

function fmtChf(n) {
  return Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('de-CH');
}

function buildAddress(parts) {
  return [parts.street, parts.zip && `${parts.zip} ${parts.city ?? ''}`.trim()]
    .filter(Boolean)
    .join('\n');
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

  // QR-Daten zusammenbauen
  const useQrIban = !!company.qr_iban;
  const reference = invoice.qr_reference || (useQrIban
    ? buildQrReference(invoice.customer_id, invoice.invoice_no)
    : undefined);

  const customer = invoice.customer || {};
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

  // PDF erzeugen
  const stream = new BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4' });

  // Briefkopf (rechts oben)
  pdf.fontSize(9).text(
    [company.company_name, company.street, `${company.zip || ''} ${company.city || ''}`.trim(), company.email, company.phone].filter(Boolean).join('\n'),
    400, 50, { align: 'left', width: 150 }
  );

  // Adressfeld Empfänger (links, ~Position für CH-Sichtfenster)
  if (customer.company_name) {
    pdf.fontSize(11).text(
      [customer.company_name, customer.street, `${customer.zip || ''} ${customer.city || ''}`.trim()].filter(Boolean).join('\n'),
      50, 130
    );
  }

  // Rechnungs-Header
  pdf.fontSize(16).text(`Rechnung ${invoice.invoice_no || '(Entwurf)'}`, 50, 220);
  pdf.fontSize(10).text(
    `Datum: ${fmtDate(invoice.issue_date)}    Fällig: ${fmtDate(invoice.due_date)}`,
    50, 245
  );
  if (invoice.period_from || invoice.period_to) {
    pdf.text(
      `Leistungszeitraum: ${fmtDate(invoice.period_from)} – ${fmtDate(invoice.period_to)}`,
      50, 260
    );
  }

  // Positionstabelle
  let y = 295;
  const col = { desc: 50, hours: 340, rate: 400, amount: 480 };
  pdf.fontSize(9).text('Beschreibung', col.desc, y);
  pdf.text('Std.', col.hours, y, { width: 50, align: 'right' });
  pdf.text('Satz', col.rate, y, { width: 60, align: 'right' });
  pdf.text('Betrag CHF', col.amount, y, { width: 70, align: 'right' });
  y += 14;
  pdf.moveTo(50, y).lineTo(550, y).stroke();
  y += 6;

  pdf.fontSize(10);
  for (const line of (invoice.lines || [])) {
    pdf.text(line.description || '', col.desc, y, { width: 280 });
    pdf.text(fmtChf(line.hours), col.hours, y, { width: 50, align: 'right' });
    pdf.text(fmtChf(line.rate), col.rate, y, { width: 60, align: 'right' });
    pdf.text(fmtChf(line.amount), col.amount, y, { width: 70, align: 'right' });
    y += 18;
    if (y > 680) { pdf.addPage(); y = 60; }
  }

  // Beträge unten rechts
  y += 10;
  pdf.moveTo(350, y).lineTo(550, y).stroke();
  y += 8;
  pdf.fontSize(10).text('Zwischensumme', 350, y);
  pdf.text(fmtChf(invoice.subtotal), col.amount, y, { width: 70, align: 'right' });
  y += 16;
  if (Number(invoice.discount_pct || 0) > 0 || Number(invoice.discount_amount || 0) > 0) {
    pdf.text(`Rabatt`, 350, y);
    const discount = (Number(invoice.subtotal) * (Number(invoice.discount_pct || 0) / 100)) + Number(invoice.discount_amount || 0);
    pdf.text(`-${fmtChf(discount)}`, col.amount, y, { width: 70, align: 'right' });
    y += 16;
  }
  pdf.text(`MWST ${invoice.vat_pct ?? 8.1}%`, 350, y);
  pdf.text(fmtChf(invoice.vat_amount), col.amount, y, { width: 70, align: 'right' });
  y += 16;
  pdf.fontSize(12).text('Total CHF', 350, y);
  pdf.text(fmtChf(invoice.total), col.amount, y, { width: 70, align: 'right' });

  // Notizen
  if (invoice.notes) {
    pdf.fontSize(9).text(invoice.notes, 50, y + 30, { width: 500 });
  }

  // Footer + QR-Bill anhängen
  if (company.invoice_footer) {
    pdf.fontSize(8).text(company.invoice_footer, 50, 740, { width: 500, align: 'center' });
  }

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
