import { supabase } from '@/api/supabaseClient';
import { leCompany, leInvoice, sendInvoiceViaMs365 } from '@/lib/leApi';
import { generateInvoicePdf } from '@/lib/leInvoicePdf';

/**
 * Erzeugt das definitive Rechnungs-PDF, versendet es via MS365 und setzt den
 * Status erst nach bestaetigtem Versand. Damit bedeutet "versendet" immer,
 * dass die Mail-Funktion erfolgreich war.
 */
export async function deliverInvoiceByEmail(invoiceId) {
  const company = await leCompany.get();
  if (!company) throw new Error('Firmen-Settings fehlen.');

  const invoice = await leInvoice.getWithEntries(invoiceId);
  if (invoice.status !== 'definitiv') {
    throw new Error(`Rechnung ${invoice.invoice_no || invoice.id} ist nicht versandbereit.`);
  }

  let projectEmail = null;
  if (invoice.project?.id) {
    const { data, error } = await supabase
      .from('le_project')
      .select('billing_email')
      .eq('id', invoice.project.id)
      .maybeSingle();
    if (error && !/billing_email|does not exist|schema cache/i.test(error.message || '')) {
      throw error;
    }
    projectEmail = data?.billing_email || null;
  }

  const recipient = projectEmail || invoice.customer?.billing_email;
  if (!recipient) {
    throw new Error(
      `Keine Rechnungs-E-Mail fuer ${invoice.customer?.company_name || invoice.invoice_no || 'Kunde'} hinterlegt.`,
    );
  }

  const pdf = await generateInvoicePdf({ invoice, company });
  if (!pdf.url) throw new Error('PDF konnte nicht hochgeladen werden.');

  const subject = `Rechnung ${invoice.invoice_no || ''} – ${company.company_name || ''}`.trim();
  const html = [
    '<p>Sehr geehrte Damen und Herren</p>',
    `<p>Anbei erhalten Sie unsere Rechnung${invoice.invoice_no ? ` Nr. ${invoice.invoice_no}` : ''}.</p>`,
    `<p>Mit freundlichen Grüssen<br>${company.company_name || ''}</p>`,
  ].join('');

  await sendInvoiceViaMs365({
    to: recipient,
    subject,
    html,
    attachmentUrl: pdf.url,
    attachmentFilename: `Rechnung-${invoice.invoice_no || 'ohne-Nr'}.pdf`,
  });

  return leInvoice.update(invoice.id, {
    status: 'versendet',
    sent_at: new Date().toISOString(),
    pdf_url: pdf.path,
  });
}
