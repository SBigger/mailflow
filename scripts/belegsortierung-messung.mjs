// Gold-Messung der Belegerkennung.
//
// Jede Handkorrektur in der Belegsortierung ist Ground Truth: ein Mensch hat
// entschieden, wohin der Beleg gehört. Dieses Skript lässt die REGELSTUFE
// (offline, ohne KI-Aufrufe) gegen genau diese Entscheide laufen und misst,
// was sie allein trifft — der kostenlose Boden der Pipeline. Steigt der Wert
// nach einer Regeländerung nicht, war die Änderung Gefühl statt Fortschritt.
//
// Zusätzlich: die Auto-Zuordnungsquote über alle gespeicherten Belege —
// wie viel Prozent der Stapel überhaupt ohne Hand liegen bleiben.
//
// Nutzung (Token aus dem Windows-Credential-Manager «Supabase CLI:supabase»):
//   SB_TOKEN=sbp_… node scripts/belegsortierung-messung.mjs
//
// KI-Stufen werden bewusst NICHT nachgespielt: nicht deterministisch und
// nicht gratis. Was die Regeln offen lassen, zählt als «offen», nicht als
// Fehler — offen ist der gewollte Zustand unterhalb der Schwelle.

import { triageRegeln } from '../src/lib/steuerBelege/triage.js';
import { positionenFuer } from '../src/lib/steuerBelege/belegartZuPosition.js';
import { migriereId } from '../src/forms/steuer_np_katalog.js';

const TOKEN = process.env.SB_TOKEN;
const PROJEKT = 'uawgpxcihixqxqxxbjak';
if (!TOKEN) {
  console.error('SB_TOKEN fehlt (Supabase-Management-Token, sbp_…)');
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJEKT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management-API: HTTP ${res.status}`);
  return res.json();
}

const zeilen = await sql(`
  SELECT steuerjahr, b
  FROM belegsortierung, jsonb_array_elements(belege) b
`);

let gesamt = 0, zugeordnet = 0, offen = 0, aussortiert = 0;
const gold = [];
for (const { steuerjahr, b } of zeilen) {
  gesamt++;
  const position = migriereId(b.position);
  if (!position) offen++;
  else if (position === '_aussortiert') aussortiert++;
  else zugeordnet++;
  if (b.vonHand && position && b.text) gold.push({ steuerjahr, b, wahrheit: position });
}

console.log('── Bestand ─────────────────────────────────────────────');
console.log(`${gesamt} gespeicherte Belege · zugeordnet ${zugeordnet} `
  + `(${Math.round(zugeordnet / gesamt * 100)}%) · offen ${offen} · aussortiert ${aussortiert}`);

console.log('\n── Gold-Messung (Regelstufe gegen Handentscheide) ──────');
if (!gold.length) {
  console.log('Noch keine Handkorrekturen mit Text gespeichert — der Goldbestand');
  console.log('wächst mit jeder Durchsicht. Danach hier: Trefferquote der Regeln.');
  process.exit(0);
}

let richtig = 0, kandidat = 0, regelOffen = 0, falsch = 0;
const fehler = [];
for (const { steuerjahr, b, wahrheit } of gold) {
  const r = triageRegeln(
    { text: b.text, dateiname: b.name || '', parseMethode: 'ocr' },
    { periode: steuerjahr },
  );
  const zuord = r.belegart ? positionenFuer(r.belegart) : { positionen: [] };
  const eindeutig = (zuord.positionen || []).length === 1 ? zuord.positionen[0].id : null;
  const kandidaten = [
    ...(zuord.positionen || []).map(p => p.id),
    ...(zuord.kandidaten || []).map(p => p.id),
  ];

  if (eindeutig === wahrheit) richtig++;
  else if (kandidaten.includes(wahrheit)) kandidat++;   // Wahl-Stufe hätte die Chance
  else if (!eindeutig) regelOffen++;
  else {
    falsch++;
    fehler.push(`  ${String(b.name || '?').slice(0, 40).padEnd(42)} `
      + `Regel: ${eindeutig} · Hand: ${wahrheit}`);
  }
}

const q = n => `${n} (${Math.round(n / gold.length * 100)}%)`;
console.log(`${gold.length} Handentscheide als Massstab`);
console.log(`  richtig:          ${q(richtig)}`);
console.log(`  im Kandidatenset: ${q(kandidat)}   ← löst die Wahl-Stufe`);
console.log(`  Regeln offen:     ${q(regelOffen)} ← löst Text-/Bild-KI`);
console.log(`  FALSCH:           ${q(falsch)}   ← das ist die Baustelle`);
if (fehler.length) {
  console.log('\nFalsch zugeordnet (Regel ≠ Hand):');
  for (const f of fehler.slice(0, 20)) console.log(f);
}
