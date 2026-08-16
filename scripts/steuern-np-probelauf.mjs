// Probelauf der Belegerkennung an echten Scans.
//
//   node scripts/steuern-np-probelauf.mjs <ordner-mit-bildern> [ergebnis.json]
//
// Erwartet Bilder, die nach dem Muster <beleg>_s<seite>.png benannt sind
// (z.B. 04_s1.png). Seiten desselben Belegs werden zusammengefasst, bevor
// die Triage laeuft — sonst entscheidet die Erkennung auf einer halben Seite.
//
// Bewusst nur Stufe 1 (Regeln): keine KI, kein Netz, kein Supabase. So ist
// messbar, wie weit die Regeln allein tragen — und wo die KI ueberhaupt
// gebraucht wird.

import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { triageRegeln, brauchtKi, SCHWELLE_KI } from '../src/lib/steuerBelege/triage.js';
import { positionenFuer, offeneDimensionen } from '../src/lib/steuerBelege/belegartZuPosition.js';
import { BELEGART_BY_KEY } from '../src/lib/steuerBelege/belegarten.js';

const ordner = process.argv[2];
const ausgabe = process.argv[3];
if (!ordner) {
  console.error('Aufruf: node scripts/steuern-np-probelauf.mjs <ordner> [ergebnis.json]');
  process.exit(1);
}

// Seiten je Beleg gruppieren
const dateien = (await readdir(ordner)).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
const belege = new Map();
for (const f of dateien) {
  const beleg = f.replace(/_s\d+\.(png|jpe?g)$/i, '');
  if (!belege.has(beleg)) belege.set(beleg, []);
  belege.get(beleg).push(path.join(ordner, f));
}

console.log(`${belege.size} Belege, ${dateien.length} Seiten — OCR laeuft\n`);

const worker = await createWorker(['deu', 'eng'], 1);
const ergebnisse = [];

for (const [name, seiten] of belege) {
  const t0 = Date.now();
  let text = '';
  for (const s of seiten) {
    const { data } = await worker.recognize(s);
    text += (data.text || '') + '\n';
  }

  const tri = triageRegeln({ text, dateiname: name, parseMethode: 'ocr' });
  const pos = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };
  const dims = offeneDimensionen(pos.positionen || []);

  ergebnisse.push({
    beleg: name,
    sekunden: +((Date.now() - t0) / 1000).toFixed(1),
    belegart: tri.belegart,
    belegartLabel: tri.belegart ? BELEGART_BY_KEY[tri.belegart]?.label : null,
    relevanz: tri.relevanz,
    confidence: tri.confidence,
    begruendung: tri.begruendung,
    kiNoetig: brauchtKi(tri),
    positionen: (pos.positionen || []).map(p => ({ id: p.id, seite: p.seite, label: p.label })),
    offen: pos.offen ? (pos.grund || 'keine Position ableitbar') : null,
    kandidaten: (pos.kandidaten || []).map(p => p.id),
    dimensionen: dims,
  });
}
await worker.terminate();

// ── Ausgabe ────────────────────────────────────────────────────────────────
const sicher = ergebnisse.filter(e => e.belegart && !e.kiNoetig).length;
const unsicher = ergebnisse.filter(e => e.kiNoetig).length;

console.log('Beleg  Belegart                      Konf.  Ziel');
console.log('─'.repeat(88));
for (const e of ergebnisse) {
  const art = (e.belegartLabel || '— nicht erkannt —').slice(0, 28).padEnd(28);
  const konf = String(e.confidence ?? 0).padStart(5);
  let ziel;
  if (e.positionen.length) ziel = e.positionen.map(p => `S${p.seite} ${p.id}`).join(' + ');
  else if (e.kandidaten.length) ziel = `offen: ${e.kandidaten.join(' | ')}`;
  else ziel = '—';
  if (e.dimensionen.length) ziel += `   [${e.dimensionen.join('+')}]`;
  console.log(`${e.beleg.padEnd(6)} ${art} ${konf}  ${ziel}`);
}

console.log('─'.repeat(88));
console.log(`${sicher} von ${ergebnisse.length} allein aus Regeln (Schwelle ${SCHWELLE_KI}), ${unsicher} brauchen die KI`);

if (ausgabe) {
  await writeFile(ausgabe, JSON.stringify(ergebnisse, null, 2));
  console.log(`\ngeschrieben: ${ausgabe}`);
}
