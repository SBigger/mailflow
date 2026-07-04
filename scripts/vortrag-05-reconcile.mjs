import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
function loadEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}
const envLocal = loadEnv('.env.local');
const envMig = loadEnv('.env.migration.local');
const supabase = createClient(envLocal.VITE_SUPABASE_URL, envMig.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const data = JSON.parse(readFileSync('scripts/fakturaliste-full.json', 'utf8'));

const { data: projects } = await supabase.from('le_project').select('id, project_no, name');
const { data: employees } = await supabase.from('le_employee').select('id, short_code, full_name');
const { data: serviceTypes } = await supabase.from('le_service_type').select('id, code, name');

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Gruppieren nach project_no -> erster project_name/customer_name als Referenz
const byProjectNo = {};
for (const d of data) {
  byProjectNo[d.project_no] ??= { name: d.project_name, customer: d.customer_name, count: 0, hours: 0, amount: 0, employees: new Set(), kontogruppen: new Set() };
  const p = byProjectNo[d.project_no];
  p.count++; p.hours += d.hours; p.amount += d.amount;
  if (d.employee_raw) p.employees.add(d.employee_raw);
  p.kontogruppen.add(d.kontogruppe_code + ' ' + d.kontogruppe_name);
}

const STOPWORDS = new Set(['ag','gmbh','co','bwl','und','the','of','ug','sa','kg','inc']);
function tokens(s) {
  return norm(s).length ? (s || '')
    .toLowerCase()
    .replace(/c\/o.*/,'')                    // "c/o Markus Frei" etc. abschneiden
    .replace(/[^a-zäöüß0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    : [];
}
function tokenOverlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  const common = aTokens.filter(t => bSet.has(t) || bTokens.some(b => b.startsWith(t) || t.startsWith(b)));
  return common.length / Math.min(aTokens.length, bTokens.length);
}

// Manuell verifizierte Zuordnungen, die der automatische Abgleich nicht sicher fand
// (zu kurzer/abgeschnittener Kundenname im Quelltext, aber eindeutig verifiziert).
const MANUAL_PROJECT_OVERRIDE = {
  '115901': 'Green Dental Recycling GmbH, BWL', // "GDR -" abgeschnitten, gleicher Kunde wie 120301
};

const matched = [];
const unmatched = [];
for (const [projNo, info] of Object.entries(byProjectNo)) {
  if (MANUAL_PROJECT_OVERRIDE[projNo]) {
    const p = (projects || []).find(pr => pr.name === MANUAL_PROJECT_OVERRIDE[projNo]);
    if (p) {
      matched.push({ projNo, oldName: info.name, customer: info.customer, smartisProject: p.name, smartisId: p.id, matchScore: 1, count: info.count, hours: info.hours, amount: info.amount });
      continue;
    }
  }
  const custNormed = norm(info.customer);
  // 1) Versuch: klassischer Substring-Match (schnell, für einfache Faelle)
  let match = (projects || []).find(p => norm(p.name).startsWith(custNormed) || norm(p.name).includes(custNormed) || (custNormed.length > 4 && custNormed.includes(norm(p.name).replace(/,bwl$/,''))));
  let score = match ? 1 : 0;
  // 2) Versuch: Wort-Overlap (Reihenfolge/Zusätze wie "c/o" egal), Schwelle 0.7
  if (!match) {
    const custTokens = tokens(info.customer);
    let best = null, bestScore = 0;
    for (const p of projects || []) {
      const s = tokenOverlapScore(custTokens, tokens(p.name));
      if (s > bestScore) { bestScore = s; best = p; }
    }
    if (best && bestScore >= 0.7) { match = best; score = bestScore; }
  }
  if (match) {
    matched.push({ projNo, oldName: info.name, customer: info.customer, smartisProject: match.name, smartisId: match.id, matchScore: score, count: info.count, hours: info.hours, amount: info.amount });
  } else {
    unmatched.push({ projNo, oldName: info.name, customer: info.customer, count: info.count, hours: info.hours, amount: info.amount });
  }
}

console.log('=== GEMATCHT:', matched.length, 'Projekte ===');
console.log('Summe Buchungen:', matched.reduce((s,m)=>s+m.count,0), 'Summe CHF:', matched.reduce((s,m)=>s+m.amount,0).toFixed(2));

console.log('\n=== FUZZY-MATCHES (Score < 1, BITTE MANUELL PRÜFEN) ===');
for (const m of matched.filter(m => m.matchScore < 1).sort((a,b)=>b.amount-a.amount)) {
  console.log(`  "${m.customer}" -> "${m.smartisProject}" (Score ${m.matchScore.toFixed(2)}, ${m.count} Buchungen, CHF ${m.amount.toFixed(2)})`);
}

console.log('\n=== NICHT GEMATCHT:', unmatched.length, 'Projekte ===');
for (const u of unmatched.sort((a,b)=>b.amount-a.amount)) {
  console.log(`  ${u.projNo} "${u.oldName}" (Kunde: ${u.customer}) - ${u.count} Buchungen, CHF ${u.amount.toFixed(2)}`);
}
console.log('Summe nicht gematcht CHF:', unmatched.reduce((s,u)=>s+u.amount,0).toFixed(2));

// Mitarbeiter-Abgleich
const allEmployeeNames = new Set();
for (const d of data) if (d.employee_raw) allEmployeeNames.add(d.employee_raw);
const empByNorm = {};
for (const e of employees || []) empByNorm[norm(e.full_name)] = e;
console.log('\n=== MITARBEITER ===');
const unmatchedEmp = [];
for (const name of allEmployeeNames) {
  const key = norm(name);
  // Versuch: Nachname+Vorname vertauschen für Vergleich
  const parts = name.split(' ').filter(Boolean);
  const swapped = parts.length >= 2 ? norm(parts.slice(1).join(' ') + parts[0]) : key;
  const found = empByNorm[key] || Object.entries(empByNorm).find(([k]) => k === swapped)?.[1];
  if (!found) unmatchedEmp.push(name);
}
console.log('Bekannte MA (Namen):', [...allEmployeeNames].filter(n => !unmatchedEmp.includes(n)));
console.log('UNBEKANNTE MA (-> Vortrag):', unmatchedEmp);

// Kontogruppen-Abgleich
const allKonto = new Set();
for (const d of data) allKonto.add(d.kontogruppe_code + ' ' + d.kontogruppe_name);
console.log('\n=== KONTOGRUPPEN ===');
console.log([...allKonto].sort());

writeFileSync('scripts/reconcile-result.json', JSON.stringify({ matched, unmatched }, null, 2));
