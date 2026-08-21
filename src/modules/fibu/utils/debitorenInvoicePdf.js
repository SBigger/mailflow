// Debitoren · QR-Rechnungs-PDF (Swiss QR-Bill) mit 3 Vorlagen
// =====================================================================
// Generiert eine Ausgangsrechnung als PDF mit swissqrbill-Zahlteil und legt
// sie mandantengetrennt im Bucket "fibu-debitoren" ab (siehe debitorenStorage).
// Vorlagen: 'klassisch' | 'modern' | 'kompakt' (Kopf-Layout variiert).
import { supabase } from '@/api/supabaseClient';
import { DEBITOREN_BUCKET, rechnungPfad } from './debitorenStorage';

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

  const path = rechnungPfad(mandatenId, belegId);
  const up = await supabase.storage.from(DEBITOREN_BUCKET)
    .upload(path, data, { upsert: true, contentType: 'application/pdf' });
  if (up.error) {
    console.error('PDF-Upload fehlgeschlagen:', up.error);
    return;
  }
  // Nur den Pfad ablegen — die Anzeige-URL wird beim Öffnen frisch signiert.
  await supabase.from('fibu_debitoren_belege').update({ pdf_url: path }).eq('id', belegId);
}
