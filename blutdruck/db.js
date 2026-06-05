// Datenzugriff über Supabase – ausschliesslich mit dem Token des angemeldeten
// Nutzers, sodass Row-Level-Security (RLS) greift. KEIN Admin-/service_role-
// Schlüssel: dadurch kommt die App selbst in einem geteilten Projekt nur an
// ihre eigene Tabelle und nur an die eigenen Zeilen.
// Der user-spezifische Client (`sb`) wird je Request in auth.js erstellt.
const TABLE = process.env.SUPABASE_TABLE || 'readings';

export async function insertReading(sb, r) {
  const { data, error } = await sb
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

export async function listReadings(sb) {
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .order('measured_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error('DB list: ' + error.message);
  return data || [];
}

export async function getReading(sb, id) {
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('DB get: ' + error.message);
  return data || null;
}

export async function updateReading(sb, id, fields) {
  const allowed = ['measured_at', 'systolic', 'diastolic', 'pulse', 'arrhythmia', 'note'];
  const patch = {};
  for (const key of allowed) {
    if (key in fields) patch[key] = key === 'arrhythmia' ? Boolean(fields[key]) : fields[key];
  }
  if (!Object.keys(patch).length) return getReading(sb, id);
  const { data, error } = await sb.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw new Error('DB update: ' + error.message);
  return data;
}

export async function deleteReading(sb, id) {
  const row = await getReading(sb, id);
  const { error } = await sb.from(TABLE).delete().eq('id', id);
  if (error) throw new Error('DB delete: ' + error.message);
  return row;
}
