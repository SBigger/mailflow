// Debitoren · QR-Rechnungs-PDF (Swiss QR-Bill) mit 3 Vorlagen
// =====================================================================
// Generiert eine Ausgangsrechnung als PDF mit swissqrbill-Zahlteil,
// lädt sie in Storage (Bucket "invoices") und gibt die URL zurück.
// Vorlagen: 'klassisch' | 'modern' | 'kompakt' (Kopf-Layout variiert).
import { supabase } from '@/api/supabaseClient';
import { isQrIban, normIban } from './pain001';
import {
  ARTIS_GREEN, ARTIS_GREEN_DARK, ARTIS_GREEN_LIGHT_BG, ZEBRA_BG, MUTED_TEXT,
  fmtChf, fmtDate, loadImageBuffer, resetText,
} from '@/lib/leBrandingHelpers';

async function loadSwissqrbill() {
  const mod = await import('@swissqrbill-pdf');
  const PDF = mod.PDF || mod.default?.PDF || mod;
  if (typeof PDF !== 'function') throw new Error('swissqrbill PDF-Klasse nicht gefunden');
  const bs = await import('blob-stream');
  return { PDF, BlobStream: bs.default || bs };
}

const splitAddr = (adresse) => {
  const s = String(adresse || '').trim();
  const m = s.match(/^(.*?)(\s+\d+\s*[a-zA-Z]?)$/);
  return m ? { street: m[1].trim(), nr: m[2].trim() } : { street: s, nr: '' };
};

// ── Kopf-Layouts ──────────────────────────────────────────────────
function drawHead(pdf, vorlage, mandant, logoBuf) {
  const left = 50, right = 545;
  const absLines = String(mandant.rechnung_absender || '').split('\n').filter(Boolean);
  const fallback = [mandant.name, mandant.adresse, [mandant.plz, mandant.ort].filter(Boolean).join(' ')].filter(Boolean);
  const lines = absLines.length ? absLines : fallback;

  if (vorlage === 'modern') {
    pdf.fillColor(ARTIS_GREEN_DARK).rect(0, 0, 595, 90).fill();
    if (logoBuf) { try { pdf.image(logoBuf, left, 22, { fit: [150, 46] }); } catch {} }
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
       .text(mandant.name || '', logoBuf ? 220 : left, 28, { width: 320 });
    pdf.font('Helvetica').fontSize(8.5).fillColor('#e8f0e8')
       .text(lines.slice(1).join(' · '), logoBuf ? 220 : left, 52, { width: 320 });
    resetText(pdf);
    return 120;
  }

  if (vorlage === 'kompakt') {
    if (logoBuf) { try { pdf.image(logoBuf, left, 36, { fit: [110, 34] }); } catch {} }
    pdf.font('Helvetica-Bold').fontSize(11).fillColor(ARTIS_GREEN_DARK)
       .text(mandant.name || '', logoBuf ? 170 : left, 40, { width: 375, align: 'right' });
    pdf.font('Helvetica').fontSize(7.5).fillColor(MUTED_TEXT)
       .text(lines.slice(1).join(' · '), left, 56, { width: right - left, align: 'right' });
    resetText(pdf);
    pdf.lineWidth(1).strokeColor(ARTIS_GREEN).moveTo(left, 74).lineTo(right, 74).stroke();
    pdf.lineWidth(1).strokeColor('#000000');
    return 92;
  }

  // klassisch
  if (logoBuf) { try { pdf.image(logoBuf, left, 40, { fit: [160, 50] }); } catch {} }
  else { pdf.fillColor(ARTIS_GREEN_DARK).font('Helvetica-Bold').fontSize(15).text(mandant.name || '', left, 48); resetText(pdf); }
  pdf.font('Helvetica').fontSize(9).fillColor('#333333')
     .text(lines.join('\n'), 320, 42, { width: 225, align: 'right' });
  resetText(pdf);
  pdf.lineWidth(1.5).strokeColor(ARTIS_GREEN).moveTo(left, 100).lineTo(right, 100).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
  return 124;
}

/**
 * @param {Object} a
 * @param {Object} a.beleg       fibu_debitoren_belege (mit zahlungsreferenz, betrag_*)
 * @param {Array}  a.positionen  fibu_debitoren_positionen
 * @param {Object} a.kunde       fibu_kunden
 * @param {Object} a.mandant     fibu_mandanten (rechnung_* Felder)
 * @param {Object} a.zahlstelle  fibu_zahlstellen (qr_iban/iban)
 * @returns {Promise<{url:string|null, path:string|null, blob:Blob}>}
 */
export async function generateDebitorenPdf({ beleg, positionen = [], kunde = {}, mandant = {}, zahlstelle = {} }) {
  const { PDF, BlobStream } = await loadSwissqrbill();
  const vorlage = mandant.rechnung_vorlage || 'klassisch';
  const logoBuf = await loadImageBuffer(mandant.rechnung_logo_url).catch(() => null);

  const account = normIban(zahlstelle.qr_iban || zahlstelle.iban || '');
  const useQrRef = isQrIban(account) && /^[0-9]{27}$/.test(String(beleg.zahlungsreferenz || ''));
  const mAddr = splitAddr(mandant.adresse);

  const qrData = {
    currency: beleg.waehrung || 'CHF',
    amount: Number(beleg.betrag_brutto || 0),
    reference: useQrRef ? beleg.zahlungsreferenz : undefined,
    message: `Rechnung ${beleg.beleg_nr || ''}`.trim(),
    creditor: {
      name: mandant.name || 'Firma',
      account: account || 'CH0000000000000000000',
      address: mAddr.street, buildingNumber: mAddr.nr,
      zip: mandant.plz || '', city: mandant.ort || '', country: 'CH',
    },
    debtor: (kunde?.name && kunde?.ort) ? {
      name: kunde.name,
      address: splitAddr(kunde.adresse).street, buildingNumber: splitAddr(kunde.adresse).nr,
      zip: kunde.plz || '', city: kunde.ort || '', country: kunde.land || 'CH',
    } : undefined,
  };

  const stream = BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4', bufferPages: true });

  const compact = vorlage === 'kompakt';
  const fs = compact ? { title: 15, meta: 8.5, row: 8.5, head: 8 } : { title: 18, meta: 9, row: 9.5, head: 8.5 };
  let y = drawHead(pdf, vorlage, mandant, logoBuf);

  // Empfänger-Adresse (Kunde)
  pdf.font('Helvetica').fontSize(8).fillColor(MUTED_TEXT).text('Rechnung an', 50, y);
  resetText(pdf);
  pdf.font('Helvetica').fontSize(10).fillColor('#000000')
     .text([kunde.name, kunde.adresse, [kunde.plz, kunde.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n'), 50, y + 12, { width: 250 });

  // Titel + Meta (rechts)
  pdf.font('Helvetica-Bold').fontSize(fs.title).fillColor(ARTIS_GREEN_DARK).text('Rechnung', 320, y, { width: 225, align: 'right' });
  resetText(pdf);
  pdf.font('Helvetica').fontSize(fs.meta).fillColor('#333333');
  const meta = [
    ['Nr.', beleg.beleg_nr || ''],
    ['Datum', fmtDate(beleg.belegdatum)],
    ['Fällig', fmtDate(beleg.faelligkeit)],
    kunde.nr ? ['Kunden-Nr.', kunde.nr] : null,
  ].filter(Boolean);
  let my = y + fs.title + 8;
  for (const [k, v] of meta) {
    pdf.fillColor(MUTED_TEXT).text(k, 360, my, { width: 80, align: 'right' });
    pdf.fillColor('#000000').text(String(v), 445, my, { width: 100, align: 'right' });
    my += 13;
  }
  resetText(pdf);

  if (beleg.titel) {
    y = Math.max(y + 70, my) + 6;
    pdf.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(beleg.titel, 50, y, { width: 495 });
    resetText(pdf);
    y += 22;
  } else {
    y = Math.max(y + 70, my) + 10;
  }

  // ── Positions-Tabelle ──
  const C = { pos: 50, bez: 78, menge: 330, eh: 380, preis: 430, betrag: 495 };
  const headerH = 18;
  pdf.fillColor(ARTIS_GREEN_LIGHT_BG).rect(50, y, 495, headerH).fill();
  pdf.font('Helvetica-Bold').fontSize(fs.head).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Pos', C.pos + 4, y + 5); pdf.text('Bezeichnung', C.bez, y + 5);
  pdf.text('Menge', C.menge, y + 5, { width: 44, align: 'right' });
  pdf.text('Einh.', C.eh, y + 5, { width: 44, align: 'right' });
  pdf.text('Preis', C.preis, y + 5, { width: 58, align: 'right' });
  pdf.text('Betrag', C.betrag, y + 5, { width: 50, align: 'right' });
  resetText(pdf);
  y += headerH + 2;

  pdf.font('Helvetica').fontSize(fs.row).fillColor('#000000');
  positionen.forEach((p, i) => {
    const bezH = pdf.heightOfString(p.bezeichnung || '', { width: C.menge - C.bez - 8 }) || 12;
    const rowH = Math.max(bezH + 6, compact ? 16 : 20);
    if (i % 2 === 0) { pdf.fillColor(ZEBRA_BG).rect(50, y - 1, 495, rowH).fill(); resetText(pdf); }
    pdf.font('Helvetica').fontSize(fs.row).fillColor('#000000');
    pdf.text(String(i + 1), C.pos + 4, y + 2, { width: 22 });
    pdf.text(p.bezeichnung || '', C.bez, y + 2, { width: C.menge - C.bez - 8 });
    pdf.text(fmtChf(p.menge), C.menge, y + 2, { width: 44, align: 'right' });
    pdf.text(p.einheit || '', C.eh, y + 2, { width: 44, align: 'right' });
    pdf.text(fmtChf(p.einzelpreis), C.preis, y + 2, { width: 58, align: 'right' });
    pdf.text(fmtChf(p.betrag_brutto), C.betrag, y + 2, { width: 50, align: 'right' });
    y += rowH;
    if (y > 640 && i < positionen.length - 1) { pdf.addPage(); y = 60; }
  });

  // ── Totals ──
  y += 10;
  if (y > 660) { pdf.addPage(); y = 60; }
  const totLine = (label, val, bold) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11.5 : 10).fillColor(bold ? ARTIS_GREEN_DARK : '#333333');
    pdf.text(label, 330, y, { width: 110, align: 'right' });
    pdf.fillColor(bold ? ARTIS_GREEN_DARK : '#000000').text('CHF ' + fmtChf(val), 445, y, { width: 100, align: 'right' });
    resetText(pdf); y += bold ? 18 : 14;
  };
  pdf.lineWidth(0.5).strokeColor('#dddddd').moveTo(330, y - 2).lineTo(545, y - 2).stroke();
  pdf.lineWidth(1).strokeColor('#000000');
  totLine('Netto', beleg.betrag_netto);
  totLine('MWST', beleg.betrag_mwst);
  totLine('Total', beleg.betrag_brutto, true);

  // ── Fusszeile ──
  if (mandant.rechnung_fusszeile) {
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED_TEXT)
       .text(mandant.rechnung_fusszeile, 50, 690, { width: 495, align: 'center' });
    resetText(pdf);
  }

  pdf.addQRBill();
  pdf.end();

  const blob = await new Promise((resolve) => {
    stream.on('finish', () => resolve(stream.toBlob('application/pdf')));
  });

  const path = `debitoren/${beleg.id}.pdf`;
  const up = await supabase.storage.from('invoices').upload(path, blob, { upsert: true, contentType: 'application/pdf' });
  if (up.error) { console.error('PDF-Upload fehlgeschlagen:', up.error); return { url: null, path: null, blob }; }
  const { data: pub } = supabase.storage.from('invoices').getPublicUrl(path);
  return { url: pub?.publicUrl ?? null, path, blob };
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
