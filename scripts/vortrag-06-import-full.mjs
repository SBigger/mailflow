// Vollständiger Vortrag-Import (175-Seiten-Fakturaliste, 112 gematchte Projekte).
// Standard = DRY RUN. Erst mit --apply wird tatsächlich geschrieben.
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

const entries = JSON.parse(readFileSync(join(__dirname, 'fakturaliste-full.json'), 'utf8'));
const reconcile = JSON.parse(readFileSync(join(__dirname, 'reconcile-result.json'), 'utf8'));

// project_no -> Smartis le_project.id (nur die gematchten aus dem Abgleich)
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
  '2000': 'ADM', '4900': 'BER',
};

async function main() {
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
    if (APPLY) {
      const { data, error } = await supabase.from('le_employee').insert({
        short_code: VORTRAG_SHORT_CODE, full_name: 'Vortrag (Altbestand)', role: 'Vortrag', active: false,
      }).select().single();
      if (error) throw error;
      vortragEmployee = data;
      console.log('Neu angelegt: Mitarbeiter "Vortrag" ->', data.id);
    } else {
      console.log('[DRY RUN] Würde Mitarbeiter "Vortrag" neu anlegen.');
      vortragEmployee = { id: '<NEU>' };
    }
  } else {
    console.log('Mitarbeiter "Vortrag" existiert bereits ->', vortragEmployee.id);
  }

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
    return;
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
  console.log('Fertig.');
}

main().catch(e => { console.error(e); process.exit(1); });
