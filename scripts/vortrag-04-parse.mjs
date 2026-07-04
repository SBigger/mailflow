// Parst die Fakturaliste (aus PDF extrahierter Text, eine "Zeile" = eine Report-Seite)
// deterministisch per Regex in ein JSON-Array von Buchungszeilen.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'C:\\Users\\SaschaBigger\\OneDrive - Artis Treuhand GmbH\\Claude\\mailflow\\scripts\\fakturaliste-full.txt';
const OUT = 'C:\\Users\\SaschaBigger\\OneDrive - Artis Treuhand GmbH\\Claude\\mailflow\\scripts\\fakturaliste-full.json';

// DIAGNOSE-Lauf über die vollständigen 175 Seiten: keine Ausschlüsse, erstmal alles sehen.
const EXCLUDE_PROJECT_NO = new Set([]);

const raw = readFileSync(SRC, 'utf8');
const pageLines = raw.split('\n').map(l => l.replace(/^\d+\t/, '')).filter(l => l.trim());

// Kanonische Namen (bekannte, durch Zeilenumbruch abgeschnittene Varianten -> korrekt).
// Abgleich per Prefix-Match, da der PDF-Umbruch das Namensende variabel verliert.
const CANONICAL_NAMES = [
  'Nabholz Alexander', 'Siegmann Simone', 'Nikollbibaj Isabella', 'Interrevision',
  'Kublanow Lidia', 'Pontis Jessica', 'Nyfeler Andrin', 'Eugster Corina',
  'Ulmann Daniela', 'Amacker Reto', 'Eugster Andrea', 'Troxler Alexandra',
  'Nigg Denise', 'Lutz Marcel', 'Spörri Diana',
  'Fuster Maura', 'Bigger Sascha', 'Mühlemann Reto', 'Gerber Romy', 'Oehler Seline',
];
function fixEmployeeName(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const cleanedNorm = cleaned.toLowerCase();
  // Exakter Treffer oder kanonischer Name ist Erweiterung des erkannten (abgeschnitten)
  const aliasMap = { 'interrevision inter': 'Interrevision' };
  if (aliasMap[cleanedNorm]) return aliasMap[cleanedNorm];
  const exact = CANONICAL_NAMES.find(n => n.toLowerCase() === cleanedNorm);
  if (exact) return exact;
  const prefixMatch = CANONICAL_NAMES.find(n => n.toLowerCase().startsWith(cleanedNorm) && cleanedNorm.length >= 6);
  if (prefixMatch) return prefixMatch;
  return cleaned;
}

// Nach dem Betrag steht neu oft ein Status-Wort (z.B. "Abzurechnen", "Kulant") -
// als optionales einzelnes Wort ohne Ziffern vor dem Lookahead zugelassen.
// Mitarbeiter-Feld: nur Grossbuchstaben-Wörter (echte Namen), max. 3 Tokens, sonst leer
// (verhindert dass Beschreibungstext/Ziffern aus Nachbar-Buchungen mitgerissen werden).
const bookingRe = /(\d{2}\.\d{2}\.\d{4})\s+((?:[A-ZÄÖÜ][A-Za-zÄÖÜäöü.\-]*\s+){0,3}?)(\d{2,3}'\d{3})\s+(.+?)\s+([vk])\s+([\d.]+)\s+([\d.]+)\s+([\d.,']+?)(?:\s+[A-Za-zÄÖÜäöü]+)?(?=\s+\d{2}\.\d{2}\.\d{4}|\s+\d{3,4}\.\s|\s+\d{6}\.\s|\s*$)/g;
const kontoRe = /(\d{3,4})\.\s+([A-ZÄÖÜa-zäöü][A-Za-zäöüÄÖÜ.,\- ]*?)\s+([\d.]+)\s+([\d.,']+)(?:\s+[\d.,']+)*(?=\s+\d{2}\.\d{2}\.\d{4}|\s+\d{6}\.\s|\s*$)/g;

// 1) Pass: Seiten nach Projektnummer gruppieren (mehrseitige Projekte zusammenführen),
//    da die Kontogruppen-Summe pro Projekt erst auf der letzten Seite steht.
let currentProjectNo = null;
let currentProjectName = null;
let currentCustomer = null;
const projectOrder = [];
const projectPages = new Map(); // project_no -> { name, customer, tableText }
const skippedProjects = new Set();

for (const page of pageLines) {
  // Neues Format (175-Seiten-Export): "Projektname: X Projektnummer: NNN Mandatsleiter: ...
  // Mandatsleiter STV: ... Kunde: Y  <Adresse...>  Abrechnungsart: ..."
  const nameMatch = page.match(/Projektname:\s*(.+?)\s+Projektnummer:/);
  const custMatch = page.match(/Kunde:\s*(.+?)\s+(?:[A-ZÄÖÜ][a-zäöüA-ZÄÖÜ.\- ]+\d|Abrechnungsart:)/);
  const projNoMatch = page.match(/Projektnummer:\s*(\d+)/);
  if (projNoMatch) currentProjectNo = projNoMatch[1];
  if (nameMatch) currentProjectName = nameMatch[1].trim();
  if (custMatch) currentCustomer = custMatch[1].trim();

  if (!currentProjectNo || EXCLUDE_PROJECT_NO.has(currentProjectNo)) {
    if (currentProjectNo) skippedProjects.add(currentProjectNo);
    continue;
  }

  const tableStart = page.indexOf('Betrag');
  let tableText = tableStart >= 0 ? page.slice(tableStart + 'Betrag'.length) : page;
  // Seiten-Fusszeile ("04.07.2026   Seite 3") entfernen, sonst verschmilzt sie beim
  // Zusammenführen mehrseitiger Projekte mit der nächsten Buchungszeile.
  tableText = tableText.replace(/\d{2}\.\d{2}\.\d{4}\s+Seite\s+\d+\s*$/, '');

  if (!projectPages.has(currentProjectNo)) {
    projectPages.set(currentProjectNo, { name: currentProjectName, customer: currentCustomer, tableText: '' });
    projectOrder.push(currentProjectNo);
  }
  // Trennzeichen einfügen, damit Regex-Grenzen an Seitenübergängen nicht verschmelzen
  projectPages.get(currentProjectNo).tableText += ' ' + tableText;
}

// 2) Pass: pro (zusammengeführtem) Projekt Buchungen + Kontogruppen extrahieren.
const results = [];
let totalBookingsSeen = 0;

for (const projNo of projectOrder) {
  const { name, customer, tableText } = projectPages.get(projNo);

  const events = [];
  let m;
  bookingRe.lastIndex = 0;
  while ((m = bookingRe.exec(tableText)) !== null) {
    events.push({ pos: m.index, kind: 'booking', m });
  }
  kontoRe.lastIndex = 0;
  while ((m = kontoRe.exec(tableText)) !== null) {
    events.push({ pos: m.index, kind: 'konto', m });
  }
  events.sort((a, b) => a.pos - b.pos);

  // Die Kontogruppen-Summenzeile steht im Text NACH ihren Buchungen ->
  // rückwirkend allen seit der letzten Gruppe gepufferten Buchungen zuweisen.
  let pending = [];
  for (const ev of events) {
    if (ev.kind === 'konto') {
      const code = ev.m[1];
      const name = ev.m[2].trim();
      for (const b of pending) { b.kontogruppe_code = code; b.kontogruppe_name = name; }
      pending = [];
      continue;
    }
    totalBookingsSeen++;
    const [, dateStr, employeeRaw, bookingNo, description, type, hoursStr, rateStr, amountStr] = ev.m;
    const [dd, mm, yyyy] = dateStr.split('.');
    const entry = {
      project_no: projNo,
      project_name: name,
      customer_name: customer,
      kontogruppe_code: null,
      kontogruppe_name: null,
      date: `${yyyy}-${mm}-${dd}`,
      employee_raw: fixEmployeeName(employeeRaw),
      booking_no: bookingNo.replace("'", ''),
      description: description.trim(),
      type,
      hours: parseFloat(hoursStr),
      rate: parseFloat(rateStr.replace(',', '.')),
      amount: parseFloat(amountStr.replace(/'/g, '').replace(',', '.')),
    };
    results.push(entry);
    pending.push(entry);
  }
  if (pending.length) {
    console.warn(`WARNUNG: Projekt ${projNo} hat ${pending.length} Buchungen ohne abschliessende Kontogruppen-Zeile`);
  }
}

writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');
console.log('Buchungen extrahiert:', results.length);
console.log('Übersprungene Projektnummern (ausgeschlossen):', [...skippedProjects]);

// Validierung pro Projekt
const byProject = {};
for (const r of results) {
  byProject[r.project_no] ??= { name: r.project_name, count: 0, hours: 0, amount: 0 };
  byProject[r.project_no].count++;
  byProject[r.project_no].hours += r.hours;
  byProject[r.project_no].amount += r.amount;
}
console.log('\nProjekt-Summen (zur Kontrolle gegen die bekannten Zahlen):');
for (const [no, v] of Object.entries(byProject)) {
  console.log(`  ${no} ${v.name}: ${v.count} Buchungen, ${v.hours.toFixed(2)}h, CHF ${v.amount.toFixed(2)}`);
}

// Plausi-Check: bei "v" (verrechenbar) sollte hours*rate == amount sein (Toleranz 0.02 CHF)
const suspicious = results.filter(r => {
  if (r.type !== 'v') return false;
  const expected = Math.round(r.hours * r.rate * 100) / 100;
  return Math.abs(expected - r.amount) > 0.02;
});
console.log('\n=== VERDÄCHTIGE EINTRÄGE (hours*rate != amount bei Typ v):', suspicious.length, '===');
for (const s of suspicious.slice(0, 30)) {
  console.log(`  ${s.date} "${s.employee_raw}" ${s.booking_no} "${s.description}" ${s.hours}h x ${s.rate} = ${(s.hours*s.rate).toFixed(2)} (Betrag: ${s.amount})`);
}
// Verdächtige Mitarbeiter-Namen: mehr als 25 Zeichen oder Ziffern enthalten
const suspiciousEmp = [...new Set(results.filter(r => r.employee_raw && (r.employee_raw.length > 25 || /\d/.test(r.employee_raw))).map(r => r.employee_raw))];
console.log('\n=== VERDÄCHTIGE MITARBEITER-WERTE ===');
console.log(suspiciousEmp);
