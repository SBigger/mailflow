// Foto-Speicher über Supabase Storage (privater Bucket).
// Auf Vercel gibt es keine persistente Festplatte – die Bilder liegen
// deshalb im selben Supabase-Projekt wie die Datenbank.
import { getClient } from './db.js';

const BUCKET = process.env.SUPABASE_BUCKET || 'blutdruck-fotos';

export async function savePhoto(filename, buffer, contentType) {
  const { error } = await getClient().storage.from(BUCKET).upload(filename, buffer, {
    contentType: contentType || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error('Foto-Upload: ' + error.message);
  return filename;
}

export async function loadPhoto(filename) {
  const { data, error } = await getClient().storage.from(BUCKET).download(filename);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type || 'image/jpeg' };
}

export async function removePhoto(filename) {
  if (!filename) return;
  await getClient().storage.from(BUCKET).remove([filename]);
}
