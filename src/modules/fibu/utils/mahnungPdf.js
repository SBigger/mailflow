// Debitoren · Mahnung-PDF (Zahlungserinnerung / 1.–3. Mahnung)
// =====================================================================
// Erzeugt einen A4-Mahnbrief zu einer überfälligen Ausgangsrechnung.
// Optional mit Swiss-QR-Zahlteil über den offenen Betrag + Mahngebühr,
// sofern die Zahlstelle eine QR-IBAN hat. Lädt das PDF in Bucket
// "invoices" und gibt {url, path, blob} zurück (wie debitorenInvoicePdf).
import { supabase } from '@/api/supabaseClient';
import { isQrIban, normIban, buildQrReference } from './pain001';
import {
  ARTIS_GREEN_DARK, ARTIS_GREEN_LIGHT_BG, MUTED_TEXT,
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

const STUFE_LABEL = { 1: 'Zahlungserinnerung', 2: '2. Mahnung', 3: '3. Mahnung (letzte)' };
const STUFE_TEXT = {
  1: 'bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die nachfolgende Rechnung noch offen ist. Vermutlich haben Sie die Zahlung übersehen – bitte begleichen Sie den Betrag bis zum unten genannten Datum.',
  2: 'trotz unserer Zahlungserinnerung ist die nachfolgende Rechnung weiterhin offen. Wir bitten Sie, den ausstehenden Betrag inkl. Mahngebühr bis zum unten genannten Datum zu begleichen.',
  3: 'leider mussten wir feststellen, dass die nachfolgende Rechnung trotz mehrfacher Mahnung noch immer nicht beglichen wurde. Wir setzen Ihnen eine letzte Frist bis zum unten genannten Datum. Nach unbenutztem Ablauf behalten wir uns rechtliche Schritte vor.',
};

export async function generateMahnungPdf({ beleg, kunde = {}, mandant = {}, zahlstelle = {}, stufe = 1, gebuehr = 0, faelligAm, upload = true }) {
  const { PDF, BlobStream } = await loadSwissqrbill();
  const logoBuf = await loadImageBuffer(mandant.rechnung_logo_url).catch(() => null);

  const offen = Math.round(((beleg.betrag_brutto || 0) - (beleg.betrag_bezahlt || 0) + (parseFloat(gebuehr) || 0)) * 100) / 100;
  const account = normIban(zahlstelle.qr_iban || zahlstelle.iban || '');
  const useQrRef = isQrIban(account) && /^[0-9]{27}$/.test(String(beleg.zahlungsreferenz || ''));
  const mAddr = splitAddr(mandant.adresse);

  const qrData = {
    currency: beleg.waehrung || 'CHF',
    amount: offen,
    reference: useQrRef ? beleg.zahlungsreferenz : (isQrIban(account) ? buildQrReference(beleg.beleg_nr || '0', beleg.beleg_nr || '0') : undefined),
    message: `Mahnung ${beleg.beleg_nr || ''}`.trim(),
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
  const withQr = !!account;

  const stream = BlobStream();
  const pdf = new PDF(qrData, stream, { autoGenerate: false, size: 'A4', bufferPages: true });

  const left = 50, right = 545;
  // Absender (klein, oben)
  const absLines = String(mandant.rechnung_absender || '').split('\n').filter(Boolean);
  const fallback = [mandant.name, mandant.adresse, [mandant.plz, mandant.ort].filter(Boolean).join(' ')].filter(Boolean);
  const sender = absLines.length ? absLines : fallback;
  if (logoBuf) { try { pdf.image(logoBuf, left, 40, { fit: [150, 46] }); } catch { /* ignore */ } }
  pdf.font('Helvetica').fontSize(8.5).fillColor(MUTED_TEXT).text(sender.join(' · '), left, logoBuf ? 92 : 46, { width: 495 });
  resetText(pdf);

  // Empfänger
  let y = 140;
  pdf.font('Helvetica').fontSize(10).fillColor('#000000')
     .text([kunde.name, kunde.adresse, [kunde.plz, kunde.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n'), 320, y, { width: 225 });

  // Datum (rechts) + Betreff
  y = 235;
  pdf.font('Helvetica').fontSize(9).fillColor(MUTED_TEXT)
     .text(`${mandant.ort || ''}${mandant.ort ? ', ' : ''}${fmtDate(new Date().toISOString().slice(0, 10))}`, left, y, { width: 495, align: 'right' });
  resetText(pdf);

  y = 270;
  pdf.font('Helvetica-Bold').fontSize(15).fillColor(ARTIS_GREEN_DARK).text(STUFE_LABEL[stufe] || `${stufe}. Mahnung`, left, y);
  resetText(pdf);
  y += 28;

  // Anrede + Text
  pdf.font('Helvetica').fontSize(10).fillColor('#000000');
  pdf.text(`Sehr geehrte Damen und Herren${kunde.name ? ` (${kunde.name})` : ''}`, left, y, { width: 495 });
  y += 18;
  pdf.text(STUFE_TEXT[stufe] || STUFE_TEXT[1], left, y, { width: 495, lineGap: 2 });
  y = pdf.y + 16;

  // Tabelle: die überfällige Rechnung
  const headerH = 18;
  pdf.fillColor(ARTIS_GREEN_LIGHT_BG).rect(left, y, 495, headerH).fill();
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(ARTIS_GREEN_DARK);
  pdf.text('Rechnung', left + 4, y + 5);
  pdf.text('Datum', 200, y + 5, { width: 70, align: 'right' });
  pdf.text('Fällig war', 280, y + 5, { width: 80, align: 'right' });
  pdf.text('Betrag', 470, y + 5, { width: 70, align: 'right' });
  resetText(pdf);
  y += headerH + 4;

  pdf.font('Helvetica').fontSize(9.5).fillColor('#000000');
  const rowVal = (label, betrag, bold) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? ARTIS_GREEN_DARK : '#000000');
    pdf.text(label, left + 4, y, { width: 380 });
    pdf.text('CHF ' + fmtChf(betrag), 440, y, { width: 100, align: 'right' });
    resetText(pdf); y += 16;
  };
  pdf.text(beleg.beleg_nr || '', left + 4, y, { width: 150 });
  pdf.text(fmtDate(beleg.belegdatum), 200, y, { width: 70, align: 'right' });
  pdf.text(fmtDate(beleg.faelligkeit), 280, y, { width: 80, align: 'right' });
  pdf.text('CHF ' + fmtChf((beleg.betrag_brutto || 0) - (beleg.betrag_bezahlt || 0)), 470, y, { width: 70, align: 'right' });
  y += 20;
  pdf.lineWidth(0.5).strokeColor('#dddddd').moveTo(330, y - 4).lineTo(right, y - 4).stroke();
  if ((parseFloat(gebuehr) || 0) > 0) rowVal('Mahngebühr', parseFloat(gebuehr));
  rowVal('Zahlbar bis ' + fmtDate(faelligAm), offen, true);

  // Fusszeile
  if (mandant.rechnung_fusszeile) {
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED_TEXT)
       .text(mandant.rechnung_fusszeile, left, 690, { width: 495, align: 'center' });
    resetText(pdf);
  }

  if (withQr) { try { pdf.addQRBill(); } catch { /* ohne Zahlteil */ } }
  pdf.end();

  const blob = await new Promise((resolve) => {
    stream.on('finish', () => resolve(stream.toBlob('application/pdf')));
  });

  if (!upload) return { url: null, path: null, blob };

  const path = `debitoren/mahnung-${beleg.id}-s${stufe}.pdf`;
  const up = await supabase.storage.from('invoices').upload(path, blob, { upsert: true, contentType: 'application/pdf' });
  if (up.error) { console.error('Mahnung-PDF-Upload fehlgeschlagen:', up.error); return { url: null, path: null, blob }; }
  const { data: pub } = supabase.storage.from('invoices').getPublicUrl(path);
  return { url: pub?.publicUrl ?? null, path, blob };
}
