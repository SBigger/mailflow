// Löscht alle [Vortrag]-Einträge und importiert sie neu aus fakturaliste-full.json + reconcile-result.json.
// Standard = DRY RUN. Mit --apply wird tatsächlich gelöscht und geschrieben.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}
const envLocal = loadEnv(join(root, '.env.local'));
const envMig = loadEnv(join(root, '.env.migration.local'));
const supabase = createClient(envLocal.VITE_SUPABASE_URL, envMig.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ─── SCHRITT 1: Bestehende [Vortrag]-Einträge zählen und löschen ───

async function countVortrag() {
  let total = 0;
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('le_time_entry')
      .select('id', { count: 'exact' })
      .like('description', '[Vortrag]%')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    total += data.length;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

async function deleteVortrag() {
  // Supabase delete with .like filter — deletes all matching rows
  const { error, count } = await supabase
    .from('le_time_entry')
    .delete({ count: 'exact' })
    .like('description', '[Vortrag]%');
  if (error) throw error;
  return count;
}

// ─── SCHRITT 2: Neu importieren (gleiche Logik wie vortrag-06) ───

const entries = JSON.parse(readFileSync(join(__dirname, 'fakturaliste-full.json'), 'utf8'));
const reconcile = JSON.parse(readFileSync(join(__dirname, 'reconcile-result.json'), 'utf8'));

const PROJECT_ID_BY_NO = Object.fromEntries(reconcile.matched.map(m => [m.projNo, m.smartisId]));

const EMPLOYEE_MAP = {
  'fuster maura': 'MF',
  'bigger sascha': 'SB',
  'mühlemann reto': 'RM',
  'gerber romy': 'RG',
  'nikollbibaj isabella': 'IN',
  'oehler seline': 'OEH',
};
const VORTRAG_SHORT_CODE = 'VTR';

const KONTOGRUPPE_MAP = {
  '1100': 'BER', '1104': 'BUCH', '1106': 'ABS', '1108': 'LOHN', '1190': 'ADM',
  '1200': 'STEU', '1202': 'STDEK', '1204': 'MWST', '1300': 'REV', '1400': 'RECHT',
  '1500': 'UMST', '1508': 'UBE', '1600': 'BUCH', '1602': 'BER', '1604': 'BER',
  '2000': 'ADM', '4900': 'RABATT',
};

async function reimport() {
  const [{ data: employees }, { data: serviceTypes }, { data: profiles }] = await Promise.all([
    supabase.from('le_employee').select('id, short_code, full_name'),
    supabase.from('le_service_type').select('id, code'),
    supabase.from('profiles').select('id, email').ilike('email', 'sascha.bigger%'),
  ]);
  const empByShortCode = Object.fromEntries((employees || []).map(e => [e.short_code, e]));
  const svcByCode = Object.fromEntries((serviceTypes || []).map(s => [s.code, s]));
  const createdByProfileId = profiles?.[0]?.id ?? null;

  const missing = [];
  for (const code of Object.values(EMPLOYEE_MAP)) if (!empByShortCode[code]) missing.push(`Mitarbeiter short_code=${code}`);
  for (const code of new Set(Object.values(KONTOGRUPPE_MAP))) if (!svcByCode[code]) missing.push(`Leistungsart code=${code}`);
  if (missing.length) { console.error('FEHLENDE REFERENZEN:\n - ' + missing.join('\n - ')); process.exit(1); }

  let vortragEmployee = empByShortCode[VORTRAG_SHORT_CODE];
  if (!vortragEmployee) {
    console.error('Mitarbeiter "Vortrag" (VTR) fehlt — sollte bereits existieren!');
    process.exit(1);
  }
  console.log('Mitarbeiter "Vortrag" ->', vortragEmployee.id);

  const rows = [];
  const unmappedEmployees = new Set();
  let skippedNoProject = 0;

  for (const e of entries) {
    const projectId = PROJECT_ID_BY_NO[e.project_no];
    if (!projectId) { skippedNoProject++; continue; }

    const empKey = (e.employee_raw || '').toLowerCase();
    const shortCode = EMPLOYEE_MAP[empKey];
    let employee;
    if (shortCode) {
      employee = empByShortCode[shortCode];
    } else {
      employee = vortragEmployee;
      if (e.employee_raw) unmappedEmployees.add(e.employee_raw);
    }

    const svcCode = KONTOGRUPPE_MAP[e.kontogruppe_code];
    if (!svcCode) { console.error('Unbekannte Kontogruppe:', e.kontogruppe_code, 'bei', e.booking_no); process.exit(1); }
    const serviceType = svcByCode[svcCode];

    const effectiveRate = e.hours > 0 ? Math.round((e.amount / e.hours) * 100) / 100 : 0;

    rows.push({
      project_id: projectId,
      employee_id: employee.id,
      service_type_id: serviceType.id,
      entry_date: e.date,
      hours_internal: e.hours,
      rate_snapshot: effectiveRate,
      description: `[Vortrag] ${e.description}${e.employee_raw ? ` (urspr. ${e.employee_raw})` : ''}${e.type === 'k' ? ' (kulant)' : ''} — Beleg-Nr. ${e.booking_no}`,
      status: 'erfasst',
      created_by: createdByProfileId,
    });
  }

  const totalAmount = rows.reduce((s, r) => s + r.hours_internal * r.rate_snapshot, 0);
  const vortragCount = rows.filter(r => r.employee_id === vortragEmployee.id).length;

  console.log(`\nZu importieren: ${rows.length} Zeitbuchungen (übersprungen ohne Projekt-Match: ${skippedNoProject})`);
  console.log(`Summe CHF: ${totalAmount.toFixed(2)}`);
  console.log(`Davon unter "Vortrag": ${vortragCount}`);
  console.log('Anzahl eindeutiger Projekte:', new Set(rows.map(r => r.project_id)).size);
  console.log('Mitarbeiter unter "Vortrag":', [...unmappedEmployees].sort());

  if (!APPLY) {
    console.log('\n[DRY RUN] Es wurde NICHTS geschrieben. Mit --apply erneut ausführen.');
    return rows.length;
  }

  console.log('\nSchreibe', rows.length, 'Zeitbuchungen...');
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('le_time_entry').insert(chunk);
    if (error) { console.error('Fehler beim Insert ab Zeile', i, ':', error.message); process.exit(1); }
    inserted += chunk.length;
    console.log(`  ${inserted}/${rows.length} geschrieben`);
  }
  console.log('Import fertig.');
  return rows.length;
}

// ─── MAIN ───

async function main() {
  const existingCount = await countVortrag();
  console.log(`Bestehende [Vortrag]-Einträge: ${existingCount}`);

  if (!APPLY) {
    console.log('\n--- DRY RUN: Löschung ---');
    console.log(`Würde ${existingCount} [Vortrag]-Einträge löschen.`);
    console.log('\n--- DRY RUN: Re-Import ---');
    await reimport();
    return;
  }

  // Löschen
  if (existingCount > 0) {
    console.log(`\nLösche ${existingCount} [Vortrag]-Einträge...`);
    const deleted = await deleteVortrag();
    console.log(`Gelöscht: ${deleted} Einträge.`);
  } else {
    console.log('Keine bestehenden [Vortrag]-Einträge zu löschen.');
  }

  // Verifizieren dass alles weg ist
  const afterDelete = await countVortrag();
  console.log(`Nach Löschung noch vorhanden: ${afterDelete}`);
  if (afterDelete > 0) {
    console.error('FEHLER: Nicht alle Einträge gelöscht!');
    process.exit(1);
  }

  // Neu importieren
  console.log('\n--- Re-Import ---');
  const imported = await reimport();

  // Verifizieren
  const afterImport = await countVortrag();
  console.log(`\n=== ERGEBNIS ===`);
  console.log(`Gelöscht: ${existingCount}`);
  console.log(`Neu importiert: ${imported}`);
  console.log(`In DB verifiziert: ${afterImport}`);
}

main().catch(e => { console.error(e); process.exit(1); });
