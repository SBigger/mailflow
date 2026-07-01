// Debitoren · QR-Rechnungs-PDF (Swiss QR-Bill) mit 3 Vorlagen
// =====================================================================
// Generiert eine Ausgangsrechnung als PDF mit swissqrbill-Zahlteil,
// lädt sie in Storage (Bucket "invoices") und gibt die URL zurück.
// Vorlagen: 'klassisch' | 'modern' | 'kompakt' (Kopf-Layout variiert).
import { supabase } from '@/api/supabaseClient';

export async function generateDebitorenPdf({ belegId, vorlageId, mandatenId, upload = false }) {
  const { data, error } = await supabase.functions.invoke('create-qr-invoice', {
    body: {
      belegId: belegId,
      template: vorlageId,
      mandatenId: mandatenId
    },
  })

  if(error) {
    console.error(error);
  }
  window.open(URL.createObjectURL(data), '_blank');

  if (!upload) return

  const path = `debitoren/${belegId}.pdf`;
  const up = await supabase.storage.from('invoices').upload(path, data, { upsert: true, contentType: 'application/pdf' });
  if (up.error) {
    console.error('PDF-Upload fehlgeschlagen:', up.error);
    return;
  }
  const { data: pub } = supabase.storage.from('invoices').getPublicUrl(path);
  await supabase.from('fibu_debitoren_belege').update({ pdf_url: pub?.publicUrl }).eq('id', belegId);
}
