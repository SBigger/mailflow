// Löst die pdfUrl eines Formulars zu einer abrufbaren URL auf.
//
// Die leeren amtlichen Formular-PDFs liegen im Storage-Bucket
// `steuerformulare` (Migration 20260820150000). In den Formulardefinitionen
// steht deshalb ein Marker statt eines Pfads:
//
//   pdfUrl: 'storage:zh/500_STE_2025.pdf'
//
// Ein neuer Jahrgang ist damit ein Datei-Austausch im Dashboard und kein
// Deploy mehr. Normale URLs (http://, https://, /pfad) laufen unverändert
// durch, damit externe Quellen weiter funktionieren.

import { supabase } from '@/api/supabaseClient';

const BUCKET = 'steuerformulare';
const MARKER = 'storage:';

// Gültigkeit der Signed URL. Grosszügig, weil die Vorschau dieselbe URL für
// die ganze Sitzung wiederverwendet; erneuert wird kurz vor Ablauf.
const GUELTIG_SEK = 3600;
const PUFFER_MS   = 60_000;

const cache = new Map(); // pfad -> { url, gueltigBis }

export function istStoragePfad(pdfUrl) {
  return typeof pdfUrl === 'string' && pdfUrl.startsWith(MARKER);
}

export async function resolveFormularPdfUrl(pdfUrl) {
  if (!istStoragePfad(pdfUrl)) return pdfUrl;

  const pfad = pdfUrl.slice(MARKER.length);
  const treffer = cache.get(pfad);
  if (treffer && treffer.gueltigBis - PUFFER_MS > Date.now()) return treffer.url;

  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUrl(pfad, GUELTIG_SEK);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Formular-PDF "${pfad}" konnte nicht geladen werden: ${error?.message ?? 'keine URL erhalten'}`,
    );
  }

  cache.set(pfad, { url: data.signedUrl, gueltigBis: Date.now() + GUELTIG_SEK * 1000 });
  return data.signedUrl;
}
