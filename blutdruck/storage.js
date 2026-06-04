// Foto-Speicher über Supabase Storage (privater Bucket), immer mit dem
// user-spezifischen Client (`sb`) – RLS-Policies sorgen dafür, dass nur die
// eigenen Fotos les-/schreibbar sind.
const BUCKET = process.env.SUPABASE_BUCKET || 'blutdruck-fotos';

export async function savePhoto(sb, filename, buffer, contentType) {
  const { error } = await sb.storage.from(BUCKET).upload(filename, buffer, {
    contentType: contentType || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error('Foto-Upload: ' + error.message);
  return filename;
}

export async function loadPhoto(sb, filename) {
  const { data, error } = await sb.storage.from(BUCKET).download(filename);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type || 'image/jpeg' };
}

export async function removePhoto(sb, filename) {
  if (!filename) return;
  await sb.storage.from(BUCKET).remove([filename]);
}
