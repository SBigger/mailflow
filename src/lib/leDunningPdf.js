// Leistungserfassung · Mahnungs-PDF
// =====================================================================
// Generiert eine PDF-Mahnung mit QR-Bill (für Hauptforderung + Gebühr + Zins).
// Wiederverwendet Patterns aus leInvoicePdf.js.

import { supabase } from '@/api/supabaseClient';
import { buildQrReference } from './leInvoicePdf';

async function loadSwissqrbill() {
  try {
    const pdfMod = await import('swissqrbill/pdf');
    return pdfMod;
  } catch (e) {
    console.error('swissqrbill konnte nicht geladen werden:', e);
    throw new Error('PDF-Library nicht verfügbar.');
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

const LEVEL_TITLES = {
  1: '1. Mahnung – Zahlungserinnerung',
  2: '2. Mahnung',
  3: '3. Mahnung mit Betreibungsandrohung',
};

const LEVEL_INTROS = {
  1: 'Wir stellen fest, dass die untenstehende Rechnung trotz Ablauf der Zahlungsfrist noch offen ist. Wir bitten Sie höflich, den Betrag innert der neuen Frist zu überweisen.',
  2: 'Trotz unserer 1. Mahnung ist die Rechnung weiterhin offen. Wir mahnen Sie ein zweites Mal und bitten um umgehende Begleichung.',
  3: 'Trotz mehrfacher Mahnung ist die Rechnung noch nicht beglichen. Sollte der Betrag nicht innert der gesetzten Frist eingehen, sehen wir uns gezwungen, ohne weitere Ankündigung die Betreibung einzuleiten (Art. 67 SchKG).',
};

export async function generateDunningPdf({ dunning, invoice, customer, company }) {
  if (!dunning || !invoice || !company) throw new Error('dunning/invoice/company fehlt');

  const { PDF, BlobStream } = await loadSwissqrbill();

  const useQrIban = !!company.qr_iban;
  const reference = useQrIban
    ? buildQrReference(invoice.customer_id, dunning.dunning_no || invoice.invoice_no)
    : undefined;

  const totalAmount = Number(dunning.total_amount || 0);

  const qrData = {
    currency: 'CHF',
    amount: totalAmount,
    reference,
    message: `Mahnung ${dunning.dunning_no || ''} zu Rechnung ${invoice.invoice_no || ''}`.trim(),
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

  const stream = new BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4' });

  // Briefkopf
  pdf.fontSize(9).text(
    [company.company_name, company.street, `${company.zip || ''} ${company.city || ''}`.trim(), company.email, company.phone].filter(Boolean).join('\n'),
    400, 50, { align: 'left', width: 150 }
  );

  // Adresse
  if (customer?.company_name) {
    pdf.fontSize(11).text(
      [customer.company_name, customer.street, `${customer.zip || ''} ${customer.city || ''}`.trim()].filter(Boolean).join('\n'),
      50, 130
    );
  }

  // Mahn-Header
  const title = LEVEL_TITLES[dunning.level] || `${dunning.level}. Mahnung`;
  pdf.fontSize(16).fillColor(dunning.level === 3 ? '#8a2d2d' : '#3d4a3d')
    .text(title, 50, 220);
  pdf.fontSize(10).fillColor('#000')
    .text(`Mahnung-Nr: ${dunning.dunning_no || '(Entwurf)'}    Datum: ${fmtDate(dunning.dunning_date)}`, 50, 245);
  if (dunning.new_due_date) {
    pdf.text(`Neue Zahlungsfrist: ${fmtDate(dunning.new_due_date)}`, 50, 260);
  }

  // Intro-Text
  let y = 285;
  pdf.fontSize(10).text(LEVEL_INTROS[dunning.level] || '', 50, y, { width: 500 });
  y += 80;

  // Rechnungs-Referenz
  pdf.fontSize(11).fillColor('#3d4a3d').text('Offene Rechnung', 50, y);
  y += 18;
  pdf.fontSize(10).fillColor('#000');
  const lines = [
    [`Rechnungs-Nr.:`, invoice.invoice_no || '—'],
    [`Rechnungsdatum:`, fmtDate(invoice.issue_date)],
    [`Ursprüngliche Fälligkeit:`, fmtDate(invoice.due_date)],
    [`Hauptforderung:`, `CHF ${fmtChf(invoice.total)}`],
  ];
  for (const [k, v] of lines) {
    pdf.text(k, 50, y);
    pdf.text(v, 200, y);
    y += 16;
  }

  // Gebühr + Zins
  y += 10;
  pdf.fontSize(11).fillColor('#3d4a3d').text('Mahnungs-Aufstellung', 50, y);
  y += 18;
  pdf.fontSize(10).fillColor('#000');
  const breakdown = [
    [`Hauptforderung`, fmtChf(dunning.outstanding_amount)],
    [`Mahngebühr`, fmtChf(dunning.fee)],
    [`Verzugszins (${dunning.interest_rate_pct || 5}% p.a. ab ${fmtDate(dunning.interest_from)})`, fmtChf(dunning.interest_amount)],
  ];
  for (const [k, v] of breakdown) {
    pdf.text(k, 50, y);
    pdf.text(`CHF ${v}`, 400, y, { width: 100, align: 'right' });
    y += 16;
  }
  pdf.moveTo(380, y).lineTo(500, y).stroke();
  y += 6;
  pdf.fontSize(12).fillColor('#3d4a3d')
    .text('Total Mahnbetrag', 50, y);
  pdf.text(`CHF ${fmtChf(dunning.total_amount)}`, 380, y, { width: 120, align: 'right' });

  // Notes / Outro
  y += 35;
  pdf.fontSize(10).fillColor('#000');
  if (dunning.is_betreibungsandrohung) {
    pdf.fillColor('#8a2d2d').text(
      'Wir machen Sie ausdrücklich darauf aufmerksam, dass nach Ablauf der gesetzten Frist ohne weitere Ankündigung die Betreibung beim zuständigen Betreibungsamt eingeleitet wird.',
      50, y, { width: 500 }
    );
    pdf.fillColor('#000');
    y += 50;
  }
  if (dunning.notes) {
    pdf.fontSize(9).text(dunning.notes, 50, y, { width: 500 });
  }

  if (company.invoice_footer) {
    pdf.fontSize(8).fillColor('#666').text(company.invoice_footer, 50, 740, { width: 500, align: 'center' });
  }

  pdf.addQRBill();
  pdf.end();

  const blob = await new Promise((resolve) => {
    stream.on('finish', () => resolve(stream.toBlob('application/pdf')));
  });

  const path = `invoices/dunnings/${dunning.id}.pdf`;
  const upload = await supabase.storage.from('invoices').upload(path, blob, {
    upsert: true, contentType: 'application/pdf',
  });
  if (upload.error) {
    console.warn('Upload Mahn-PDF fehlgeschlagen, fallback Browser-Download:', upload.error);
    return { blob, url: null, path: null };
  }
  const { data: pub } = supabase.storage.from('invoices').getPublicUrl(path);
  return { url: pub.publicUrl, path, blob };
}
