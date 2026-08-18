#!/usr/bin/env node
/**
 * Arbeitsliste für die Erfassung im Steuerportal.
 *
 * Nimmt den gespeicherten Stand der Belegsortierung eines Mandanten und macht
 * daraus die Liste, die im Portal abzutippen ist: je Verzeichnis die
 * Positionen mit Einkommens- und Vermögensbetrag, wie viele Belege dahinter
 * stehen und was der Mensch noch entscheiden muss.
 *
 * Der Erfassungs-Agent liest NUR diese Liste — nicht die Datenbank und nicht
 * die Belegtexte. Damit ist überprüfbar, welche Zahlen ins Portal gehen.
 *
 *   node scripts/steuer-arbeitsliste.mjs --mandant "Dominik Schenkel" --jahr 2025
 *   node scripts/steuer-arbeitsliste.mjs --mandant "…" --jahr 2025 --json
 *
 * Zugang: Token der Supabase-CLI aus dem Windows-Credential-Manager
 * («Supabase CLI:supabase»), oder Umgebungsvariable SB_TOKEN.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KATALOG_NACH_ID, VERZEICHNISSE, VERZEICHNIS_NACH_ID, migriereId }
  from '../src/forms/steuer_np_katalog.js';

const PROJEKT = 'uawgpxcihixqxqxxbjak';

function argument(name, standard = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

function token() {
  if (process.env.SB_TOKEN) return process.env.SB_TOKEN.trim();
  // Sonst aus dem Windows-Credential-Manager, wo die Supabase-CLI ihr Token
  // ablegt. Das Skript dafuer geht ueber eine Datei — PowerShell ueber stdin
  // schluckt mehrzeilige Here-Strings nicht zuverlaessig.
  const ps = join(tmpdir(), 'sb-token.ps1');
  writeFileSync(ps, `$sig = @'
using System; using System.Runtime.InteropServices;
public class CM {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string t, int y, int f, out IntPtr c);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CRED { public int Flags; public int Type; public string TargetName;
    public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int BlobSize; public IntPtr Blob; public int Persist; public int AttrCount;
    public IntPtr Attrs; public string TargetAlias; public string UserName; }
}
'@
Add-Type -TypeDefinition $sig
$p = [IntPtr]::Zero
if ([CM]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$p)) {
  $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][CM+CRED])
  $b = New-Object byte[] $c.BlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($c.Blob, $b, 0, $c.BlobSize)
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($b))
}`, 'utf-8');
  let t = '';
  try {
    t = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps}"`,
                 { encoding: 'utf-8' }).trim();
  } catch { /* faellt unten auf die Meldung */ }
  if (!t) throw new Error('Kein Supabase-Token: SB_TOKEN setzen oder «npx supabase login».');
  return t;
}

async function frage(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJEKT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const daten = await res.json();
  if (!Array.isArray(daten)) throw new Error(`Abfrage fehlgeschlagen: ${JSON.stringify(daten).slice(0, 200)}`);
  return daten;
}

const chf = n => n == null ? '—'
  : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mandant = argument('mandant');
const jahr = Number(argument('jahr', new Date().getFullYear() - 1));
if (!mandant) {
  console.error('Aufruf: node scripts/steuer-arbeitsliste.mjs --mandant "Name" --jahr 2025');
  process.exit(1);
}

// Trockenlauf: Belege aus einer Datei statt aus der Datenbank. Damit laesst
// sich die Ausgabe pruefen, ohne einen Mandantenstand anzulegen.
const ausDatei = argument('datei');
const sicher = mandant.replace(/'/g, "''");
const zeilen = ausDatei
  ? [{ mandant, steuerjahr: jahr, updated_at: new Date().toISOString(),
       belege: JSON.parse(readFileSync(ausDatei, 'utf-8')) }]
  : await frage(`
  SELECT c.company_name AS mandant, b.steuerjahr, b.updated_at, b.belege
  FROM belegsortierung b
  JOIN customers c ON c.id = b.customer_id
  WHERE b.steuerjahr = ${jahr} AND c.company_name ILIKE '%${sicher}%'
  LIMIT 1;
`);

if (!zeilen.length) {
  console.error(`Kein gespeicherter Stand für «${mandant}» / ${jahr}.`);
  process.exit(2);
}

const { mandant: name, updated_at, belege } = zeilen[0];

// Belege je Position bündeln — das Portal will Summen, nicht Einzelbelege.
const proPosition = new Map();
let offen = 0, aussortiert = 0;
for (const b of belege) {
  const id = migriereId(b.position);
  if (!id) { offen++; continue; }
  if (id === '_aussortiert') { aussortiert++; continue; }
  if (!proPosition.has(id)) proPosition.set(id, { anzahl: 0, einkommen: 0, vermoegen: 0, vonHand: 0 });
  const p = proPosition.get(id);
  p.anzahl++;
  p.einkommen += Number(b.einkommen) || 0;
  p.vermoegen += Number(b.vermoegen) || 0;
  if (b.vonHand || b.betragQuelle === 'hand') p.vonHand++;
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ mandant: name, jahr, stand: updated_at,
    positionen: [...proPosition].map(([id, p]) => ({ id, ...p })), offen, aussortiert }, null, 2));
  process.exit(0);
}

console.log(`ARBEITSLISTE  ${name} · Steuerjahr ${jahr}`);
console.log(`Stand der Sortierung: ${new Date(updated_at).toLocaleString('de-CH')}`);
console.log(`${belege.length} Belege · ${offen} noch nicht zugeordnet · ${aussortiert} nicht benötigt\n`);

for (const v of VERZEICHNISSE) {
  if (['arbeitspapiere', 'aussortiert'].includes(v.id)) continue;
  const eintraege = [...proPosition].filter(([id]) => KATALOG_NACH_ID[id]?.verzeichnis === v.id);
  if (!eintraege.length) continue;

  console.log(`── ${v.label}${v.speist ? `   (${v.speist})` : ''}`);
  for (const [id, p] of eintraege) {
    const k = KATALOG_NACH_ID[id];
    const teile = [];
    if (k.einkommen) teile.push(`${k.wirkung === 'abzug' ? 'Abzug' : 'Einkunft'} ${chf(p.einkommen || null)}`);
    if (k.vermoegen) teile.push(`Vermögen ${chf(p.vermoegen || null)}`);
    console.log(`   ${k.label}`);
    console.log(`      ${teile.join(' · ')}   (${p.anzahl} Beleg${p.anzahl === 1 ? '' : 'e'}${p.vonHand ? `, ${p.vonHand} von Hand geprüft` : ''})`);
    if (k.dimensionen?.length) console.log(`      ⚠ braucht noch: ${k.dimensionen.join(' + ')}`);
    if (k.pruefen)            console.log(`      ⚠ Entscheid Sascha: ${k.pruefen}`);
  }
  console.log('');
}

if (offen) {
  console.log(`⚠ ${offen} Belege sind noch nicht zugeordnet — sie fehlen in dieser Liste.`);
  console.log('  Erst in der Durchsicht (Schritt 3) zuordnen, dann erfassen.\n');
}
console.log('Diese Liste ist die EINZIGE Quelle für die Erfassung. Was hier nicht steht,');
console.log('wird im Portal nicht eingetippt.');
