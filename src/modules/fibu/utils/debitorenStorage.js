// Debitoren-PDFs (Rechnungen + Mahnungen) im Storage
// =====================================================================
// Bucket "fibu-debitoren", Ordner = mandant_id (gleiche Trennung wie
// fibu-belege). Gespeichert wird in fibu_debitoren_belege.pdf_url nur noch der
// PFAD — die Anzeige-URL wird bei Bedarf frisch signiert.
//
// Warum nicht getPublicUrl: der Bucket ist privat, eine "oeffentliche" URL
// darauf liefert 400. Altbestand enthaelt genau solche toten Links; pfadAus()
// holt den Pfad auch daraus wieder heraus.
import { supabase } from '@/api/supabaseClient';

export const DEBITOREN_BUCKET = 'fibu-debitoren';

export function rechnungPfad(mandantId, belegId) {
  return `${mandantId}/rechnung-${belegId}.pdf`;
}

export function mahnungPfad(mandantId, belegId, stufe) {
  return `${mandantId}/mahnung-${belegId}-s${stufe}.pdf`;
}

// Akzeptiert einen Pfad oder eine alte gespeicherte URL und liefert den Pfad.
// Gibt zusaetzlich den Bucket zurueck, damit Altdaten aus "invoices" weiterhin
// angezeigt werden koennen.
export function pfadAus(wert) {
  if (!wert) return null;
  const s = String(wert);
  const m = s.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) return { bucket: m[1], pfad: decodeURIComponent(m[2]) };
  return { bucket: DEBITOREN_BUCKET, pfad: s };
}

export async function signierteUrl(wert, sekunden = 600) {
  const ziel = pfadAus(wert);
  if (!ziel) return null;
  const { data, error } = await supabase.storage
    .from(ziel.bucket)
    .createSignedUrl(ziel.pfad, sekunden);
  if (error) {
    console.error('Signierte URL fehlgeschlagen:', error.message, ziel);
    return null;
  }
  return data?.signedUrl ?? null;
}
