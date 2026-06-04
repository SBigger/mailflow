// Datenzugriff über Supabase (Postgres).
// Ersetzt die frühere SQLite-Datei, damit die App auf Vercel laufen kann
// (serverlos, ohne eigene Festplatte) und mehrere Mini-Apps sich EINE
// zentrale Supabase-Datenbank teilen können.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE = process.env.SUPABASE_TABLE || 'readings';

export function dbConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// Client erst bei Bedarf erzeugen: so startet die App auch ohne Zugangsdaten
// (z. B. fehlende Vercel-Variable) und liefert eine klare Fehlermeldung,
// statt schon beim Import abzustürzen.
// Service-Role-Key: NUR serverseitig verwenden, nie im Browser. Umgeht
// Row-Level-Security – passt für diese private 1-Nutzer-App.
let _client = null;
export function getClient() {
  if (_client) return _client;
  if (!dbConfigured()) {
    throw new Error('Supabase ist nicht konfiguriert – bitte SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzen.');
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _client;
}

export async function insertReading(r) {
  const { data, error } = await getClient()
    .from(TABLE)
    .insert({
      measured_at: r.measured_at,
      systolic: r.systolic ?? null,
      diastolic: r.diastolic ?? null,
      pulse: r.pulse ?? null,
      arrhythmia: Boolean(r.arrhythmia),
      note: r.note ?? null,
      photo: r.photo ?? null,
      source: r.source ?? 'foto',
      ai_provider: r.ai_provider ?? null,
    })
    .select()
    .single();
  if (error) throw new Error('DB insert: ' + error.message);
  return data;
}

export async function listReadings() {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('*')
    .order('measured_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error('DB list: ' + error.message);
  return data || [];
}

export async function getReading(id) {
  const { data, error } = await getClient().from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('DB get: ' + error.message);
  return data || null;
}

export async function updateReading(id, fields) {
  const allowed = ['measured_at', 'systolic', 'diastolic', 'pulse', 'arrhythmia', 'note'];
  const patch = {};
  for (const key of allowed) {
    if (key in fields) patch[key] = key === 'arrhythmia' ? Boolean(fields[key]) : fields[key];
  }
  if (!Object.keys(patch).length) return getReading(id);
  const { data, error } = await getClient().from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw new Error('DB update: ' + error.message);
  return data;
}

export async function deleteReading(id) {
  const row = await getReading(id);
  const { error } = await getClient().from(TABLE).delete().eq('id', id);
  if (error) throw new Error('DB delete: ' + error.message);
  return row;
}
