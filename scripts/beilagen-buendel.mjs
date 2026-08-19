#!/usr/bin/env node
/**
 * Beilagenbündel aus dem gespeicherten Stand bauen — ohne Browser.
 *
 * Holt die Sortierung eines Mandanten aus der Datenbank, lädt die
 * Originaldateien aus der Ablage und legt daraus das Bündel-PDF an:
 * Deckblatt mit allen Positionen, dann die Belege in der Reihenfolge der
 * Steuererklärung. Dieselbe Logik wie in der App (beilagenBundle.js), nur
 * eben von der Kommandozeile — nützlich, wenn im Browser etwas klemmt.
 *
 *   node scripts/beilagen-buendel.mjs --mandant "Schenkel" --jahr 2025
 *   node scripts/beilagen-buendel.mjs --mandant "…" --jahr 2025 --ziel "C:\\Temp\\b.pdf"
 *
 * Zugang: SB_TOKEN oder Supabase-CLI-Token (Management-API) für die Daten,
 * SUPABASE_ANON_KEY aus .env.local plus Anmeldung für die Dateien.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { baueBeilagenBundle } from '../src/lib/steuerBelege/beilagenBundle.js';

const PROJEKT = 'uawgpxcihixqxqxxbjak';
const BASIS = `https://${PROJEKT}.supabase.co`;

const arg = (name, standard = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};

function verwaltungsToken() {
  if (process.env.SB_TOKEN) return process.env.SB_TOKEN.trim();
  const ps = join(tmpdir(), 'sb-token-b.ps1');
  writeFileSync(ps, `$sig = @'
using System; using System.Runtime.InteropServices;
public class CMB {
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
if ([CMB]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$p)) {
  $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][CMB+CRED])
  $b = New-Object byte[] $c.BlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($c.Blob, $b, 0, $c.BlobSize)
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($b))
}`, 'utf-8');
  try {
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps}"`,
                    { encoding: 'utf-8' }).trim();
  } catch { return ''; }
}

async function sql(abfrage) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJEKT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${verwaltungsToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: abfrage }),
  });
  const daten = await res.json();
  if (!Array.isArray(daten)) throw new Error(`Abfrage fehlgeschlagen: ${JSON.stringify(daten).slice(0, 200)}`);
  return daten;
}

/**
 * Dienstschlüssel für die Ablage. Die Bucket-Regeln verlangen einen
 * angemeldeten Benutzer; von der Kommandozeile geht das über den
 * service_role-Schlüssel, den die Management-API herausgibt.
 */
async function ablageSchluessel() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJEKT}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${verwaltungsToken()}` },
  });
  const keys = await res.json();
  const dienst = Array.isArray(keys) && keys.find(k => k.name === 'service_role');
  if (!dienst?.api_key) throw new Error('Kein service_role-Schlüssel erhältlich');
  return dienst.api_key;
}

const mandant = arg('mandant');
const jahr = Number(arg('jahr', new Date().getFullYear() - 1));
if (!mandant) {
  console.error('Aufruf: node scripts/beilagen-buendel.mjs --mandant "Name" --jahr 2025');
  process.exit(1);
}

const sicher = mandant.replace(/'/g, "''");
const [stand] = await sql(`
  SELECT c.company_name AS mandant, c.id AS customer_id, b.updated_at, b.belege
  FROM belegsortierung b JOIN customers c ON c.id = b.customer_id
  WHERE b.steuerjahr = ${jahr} AND c.company_name ILIKE '%${sicher}%' LIMIT 1;`);

if (!stand) { console.error(`Kein gespeicherter Stand für «${mandant}» / ${jahr}.`); process.exit(2); }

const belege = stand.belege.filter(b => b.position);
console.log(`${stand.mandant} · ${jahr}: ${stand.belege.length} Belege, davon ${belege.length} zugeordnet`);

const schluessel = await ablageSchluessel();
const endung = n => (String(n || '').match(/[.](pdf|png|jpe?g)$/i) || ['.pdf'])[0].toLowerCase();

// Jede Datei nur einmal laden — mehrere Teilbelege teilen sich dieselbe.
const cache = new Map();
let fehlend = 0;
const mitDatei = [];
for (const b of belege) {
  const basis = String(b.hash || '').split('#')[0];
  const pfad = b.dateiPfad || (basis ? `${stand.customer_id}/${basis}${endung(b.name)}` : null);
  if (!pfad) { fehlend++; continue; }
  if (!cache.has(pfad)) {
    const res = await fetch(`${BASIS}/storage/v1/object/belegsortierung/${encodeURI(pfad)}`, {
      headers: { Authorization: `Bearer ${schluessel}`, apikey: schluessel },
    });
    cache.set(pfad, res.ok ? Buffer.from(await res.arrayBuffer()) : null);
    process.stdout.write(res.ok ? '.' : 'x');
  }
  const daten = cache.get(pfad);
  if (!daten) { fehlend++; continue; }
  // Die Bündel-Logik erwartet ein File-artiges Objekt mit arrayBuffer() und
  // prüft die Endung des DATEInamens — der Beleg heisst «13.pdf · Seiten 1–2»,
  // die Datei aber «13.pdf».
  const dateiName = String(b.name || 'beleg.pdf').split(' · ')[0];
  mitDatei.push({ ...b, datei: { name: dateiName, arrayBuffer: async () => daten } });
}
console.log(`\n${cache.size} Dateien geladen, ${fehlend} Belege ohne Datei`);

const pdf = await baueBeilagenBundle(mitDatei, {
  mandant: stand.mandant,
  steuerjahr: jahr,
  erstellt: new Date().toLocaleDateString('de-CH'),
});

const ziel = arg('ziel', join(homedir(), 'Downloads',
  `Beilagen_${stand.mandant.replace(/[^\wäöüÄÖÜ]+/g, '_')}_${jahr}.pdf`));
writeFileSync(ziel, Buffer.from(pdf));
console.log(`Bündel geschrieben: ${ziel}`);
