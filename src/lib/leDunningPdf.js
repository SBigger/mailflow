// Leistungserfassung · Mahnungs-PDF
// =====================================================================
// Generiert eine PDF-Mahnung mit QR-Bill (für Hauptforderung + Gebühr + Zins).
// Wiederverwendet Patterns & Helpers aus leBrandingHelpers.js.

import { supabase } from '@/api/supabaseClient';
import { buildQrReference } from './leInvoicePdf';
import {
  ARTIS_GREEN_DARK,
  ARTIS_GREEN_BORDER,
  ZEBRA_BG,
  MUTED_TEXT,
  AMPEL_ORANGE,
  AMPEL_RED,
  fmtChf,
  fmtDate,
  loadImageBuffer,
  drawHeader,
  drawAddress,
  drawFooter,
  resetText,
} from './leBrandingHelpers';

async function loadSwissqrbill() {
  try {
    const mod = await import(
      /* @vite-ignore */ 'swissqrbill/lib/browser/esm/browser/pdf.js'
    );
    const PDF = mod.PDF || mod.default?.PDF || mod;
    const blobStreamMod = await import('blob-stream');
    const BlobStream = blobStreamMod.default || blobStreamMod;
    return { PDF, BlobStream };
  } catch (e) {
    console.error('swissqrbill konnte nicht geladen werden:', e);
    throw new Error('PDF-Library nicht verfügbar: ' + (e?.message ?? e));
  }
}

const LEVEL_TITLES = {
  1: '1. Mahnung – Zahlungserinnerung',
  2: '2. Mahnung',
  3: '3. Mahnung',
};

const LEVEL_INTROS = {
  1: 'Wir stellen fest, dass die untenstehende Rechnung trotz Ablauf der Zahlungsfrist noch offen ist. Wir bitten Sie höflich, den Betrag innert der neuen Frist zu überweisen.',
  2: 'Trotz unserer 1. Mahnung ist die Rechnung weiterhin offen. Wir mahnen Sie ein zweites Mal und bitten um umgehende Begleichung.',
  3: 'Trotz mehrfacher Mahnung ist die Rechnung noch nicht beglichen. Sollte der Betrag nicht innert der gesetzten Frist eingehen, sehen wir uns gezwungen, ohne weitere Ankündigung die Betreibung einzuleiten (Art. 67 SchKG).',
};

export async function generateDunningPdf({ dunning, invoice, customer, company }) {
  if (!dunning || !invoice || !company) throw new Error('dunning/invoice/company fehlt');

  const { PDF, BlobStream } = await loadSwissqrbill();

  const logoBuf = await loadImageBuffer(company.logo_url);

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

  const stream = BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4', bufferPages: true });

  // ---- 1. Branding-Header ----
  drawHeader(pdf, company, logoBuf);

  // ---- 2. Empfänger-Adresse ----
  drawAddress(pdf, customer || {}, 50, 130);

  // ---- 3. Mahn-Header ----
  const headerY = 220;
  const title = LEVEL_TITLES[dunning.level] || `${dunning.level}. Mahnung`;
  const isLevel3 = Number(dunning.level) === 3;

  pdf.font('Helvetica-Bold').fontSize(18).fillColor(isLevel3 ? AMPEL_RED : ARTIS_GREEN_DARK)
     .text(title, 50, headerY);

  // BETREIBUNGSANDROHUNG bei Stufe 3
  let titleBottom = headerY + 24;
  if (isLevel3) {
    pdf.font('Helvetica-Bold').fontSize(12).fillColor(AMPEL_RED)
       .text('BETREIBUNGSANDROHUNG', 50, titleBottom);
    titleBottom += 18;
  }
  resetText(pdf);
  pdf.font('Helvetica');

  // Mahn-Nr rechts
  pdf.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
     .text(`Nr. ${dunning.dunning_no || '(Entwurf)'}`, 350, headerY + 4, {
       width: 195, align: 'right',
     });
  pdf.font('Helvetica');

  // Meta-Block
  const metaY = titleBottom + 8;
  pdf.fontSize(9).fillColor(MUTED_TEXT);
  pdf.text('Datum', 50, metaY, { width: 90 });
  if (dunning.new_due_date) {
    pdf.text('Neue Zahlungsfrist', 50, metaY + 14, { width: 90 });
  }
  pdf.fillColor('#000000');
  pdf.text(fmtDate(dunning.dunning_date), 140, metaY, { width: 130 });
  if (dunning.new_due_date) {
    pdf.text(fmtDate(dunning.new_due_date), 140, metaY + 14, { width: 130 });
  }
  resetText(pdf);

  // ---- 4. Intro-Text ----
  let y = metaY + 50;
  pdf.font('Helvetica').fontSize(10).fillColor('#000000')
     .text(LEVEL_INTROS[dunning.level] || '', 50, y, { width: 495 });
  y += 70;

  // ---- 5. Rechnungs-Referenz ----
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(ARTIS_GREEN_DARK)
     .text('Offene Rechnung', 50, y);
  y += 18;
  pdf.font('Helvetica').fontSize(10).fillColor('#000000');
  const refLines = [
    [`Rechnungs-Nr.`, invoice.invoice_no || '—'],
    [`Rechnungsdatum`, fmtDate(invoice.issue_date)],
    [`Ursprüngliche Fälligkeit`, fmtDate(invoice.due_date)],
    [`Hauptforderung`, `CHF ${fmtChf(invoice.total)}`],
  ];
  for (const [k, v] of refLines) {
    pdf.fillColor(MUTED_TEXT).text(k, 50, y, { width: 150 });
    pdf.fillColor('#000000').text(v, 200, y, { width: 200 });
    y += 16;
  }
  resetText(pdf);

  // ---- 6. Aufstellung mit Ampel-Farben ----
  y += 16;
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(ARTIS_GREEN_DARK)
     .text('Mahnungs-Aufstellung', 50, y);
  y += 20;
  pdf.font('Helvetica').fontSize(10);

  const breakdown = [
    { label: 'Hauptforderung', value: dunning.outstanding_amount, color: '#000000' },
    { label: 'Mahngebühr', value: dunning.fee, color: AMPEL_ORANGE },
    {
      label: `Verzugszins (${dunning.interest_rate_pct || 5}% p.a. ab ${fmtDate(dunning.interest_from)})`,
      value: dunning.interest_amount,
      color: AMPEL_RED,
    },
  ];

  // Zebra-Tabelle
  const tableLeft = 50;
  const tableRight = 545;
  const labelW = 350;
  for (let i = 0; i < breakdown.length; i++) {
    const item = breakdown[i];
    if (i % 2 === 0) {
      pdf.fillColor(ZEBRA_BG).rect(tableLeft, y - 2, tableRight - tableLeft, 18).fill();
      resetText(pdf);
    }
    pdf.fillColor(item.color).font('Helvetica').fontSize(10)
       .text(item.label, tableLeft + 8, y + 2, { width: labelW });
    pdf.text(`CHF ${fmtChf(item.value)}`, tableRight - 110, y + 2, { width: 100, align: 'right' });
    y += 18;
  }
  resetText(pdf);

  // Total-Mahnbetrag – bei Stufe 3 in roter Box
  y += 6;
  const totalBoxX = 320;
  const totalBoxW = 225;
  const totalBoxH = 30;

  if (isLevel3) {
    pdf.fillColor('#fdecec').rect(totalBoxX, y, totalBoxW, totalBoxH).fill();
    pdf.lineWidth(1).strokeColor(AMPEL_RED)
       .rect(totalBoxX, y, totalBoxW, totalBoxH).stroke();
  } else {
    pdf.fillColor(ZEBRA_BG).rect(totalBoxX, y, totalBoxW, totalBoxH).fill();
    pdf.lineWidth(0.5).strokeColor(ARTIS_GREEN_BORDER)
       .rect(totalBoxX, y, totalBoxW, totalBoxH).stroke();
  }
  pdf.lineWidth(1).strokeColor('#000000');
  resetText(pdf);

  pdf.font('Helvetica-Bold').fontSize(13).fillColor(isLevel3 ? AMPEL_RED : ARTIS_GREEN_DARK);
  pdf.text('Total Mahnbetrag', totalBoxX + 10, y + 9, { width: 130 });
  pdf.text(`CHF ${fmtChf(dunning.total_amount)}`, totalBoxX + totalBoxW - 110, y + 9, {
    width: 100, align: 'right',
  });
  resetText(pdf);
  pdf.font('Helvetica');
  y += totalBoxH + 18;

  // ---- 7. Outro / Notes ----
  if (isLevel3 || dunning.is_betreibungsandrohung) {
    pdf.font('Helvetica').fontSize(10).fillColor(AMPEL_RED).text(
      'Wir machen Sie ausdrücklich darauf aufmerksam, dass nach Ablauf der gesetzten Frist ohne weitere Ankündigung die Betreibung beim zuständigen Betreibungsamt eingeleitet wird.',
      50, y, { width: 495 }
    );
    resetText(pdf);
    y += 50;
  }
  if (dunning.notes) {
    pdf.font('Helvetica').fontSize(9).fillColor('#444444')
       .text(dunning.notes, 50, y, { width: 495 });
    resetText(pdf);
  }

  // ---- 8. Footer + QR-Bill ----
  drawFooter(pdf, company);
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
