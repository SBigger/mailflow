// Auswertungen · gemeinsame Helfer
// Kategorisierung intern / effektiv / pauschal, Monats-Handling, Soll-Stunden,
// CSV-Export. Wird von allen Panels unter components/auswertungen genutzt.

// ---------------------------------------------------------------------------
// Kategorien
// ---------------------------------------------------------------------------

// Farbwelt der Kategorien (konsistent in Tabellen, KPIs und Grafiken)
export const CAT = {
  effektiv: { key: 'effektiv', label: 'Effektiv',  color: '#7a9b7f' }, // verrechenbare Std auf Effektiv-Projekten
  pauschal: { key: 'pauschal', label: 'Pauschal',  color: '#d4a056' }, // rapportierte Std auf Pauschalprojekten
  intern:   { key: 'intern',   label: 'Intern',    color: '#8fa3b8' }, // interne Projekte (keine Verrechnung)
  uebrig:   { key: 'uebrig',   label: 'Übrige',    color: '#cfd8cf' }, // nicht verrechenbare Std auf Kundenprojekten
};
export const CAT_KEYS = ['effektiv', 'pauschal', 'intern', 'uebrig'];

// Ordnet einen Zeiteintrag einer Kategorie zu.
// intern schlägt billing_mode; nicht-billable Leistungsarten auf
// Effektiv-Projekten zählen als "übrig", damit die Summe der Kategorien
// immer dem Total entspricht.
export function categoryOf(entry) {
  const p = entry.project;
  if (!p) return 'uebrig';
  if (p.is_internal) return 'intern';
  if (p.billing_mode === 'pauschal') return 'pauschal';
  if (entry.service_type?.billable === false) return 'uebrig';
  return 'effektiv';
}

// Stunden + bewerteter Umsatz (h × rate_snapshot) eines Eintrags.
// Stornierte Einträge liefern 0/0 – Aufrufer filtert sie i.d.R. vorher.
export function entryHours(e) { return Number(e.hours_internal || 0); }
export function entryValue(e) { return entryHours(e) * Number(e.rate_snapshot || 0); }

// Leere Kategorien-Akkumulation
export function emptyCatSums() {
  return {
    hours: { effektiv: 0, pauschal: 0, intern: 0, uebrig: 0, total: 0 },
    value: { effektiv: 0, pauschal: 0, total: 0 },
  };
}

// Addiert einen Eintrag in eine Kategorien-Akkumulation
export function addEntry(sums, e) {
  const cat = categoryOf(e);
  const h = entryHours(e);
  sums.hours[cat] += h;
  sums.hours.total += h;
  if (cat === 'effektiv' || cat === 'pauschal') {
    const v = entryValue(e);
    sums.value[cat] += v;
    sums.value.total += v;
  }
  return sums;
}

// ---------------------------------------------------------------------------
// Datum / Monat
// ---------------------------------------------------------------------------

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Monats-Range als ISO-Strings. month0 = 0-basiert.
export function monthRange(year, month0) {
  const from = new Date(year, month0, 1);
  const to = new Date(year, month0 + 1, 0);
  return { fromIso: toIso(from), toIso: toIso(to), days: to.getDate() };
}

// ---------------------------------------------------------------------------
// Soll-Stunden (identische Logik wie LE-AuswertungenPanel – ohne Feiertage)
// ---------------------------------------------------------------------------

export const pickProfile = (profiles, dateIso) => {
  const sorted = [...(profiles ?? [])].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return sorted.find(p =>
    p.valid_from <= dateIso && (!p.valid_to || p.valid_to >= dateIso)
  ) || null;
};

const HOURS_BY_DAY = ['hours_so', 'hours_mo', 'hours_di', 'hours_mi', 'hours_do', 'hours_fr', 'hours_sa'];

// Feiertags-Set aus le_holiday-Zeilen (Set von ISO-Datumsstrings)
export function toHolidaySet(holidayRows, canton = 'SG') {
  return new Set(
    (holidayRows ?? [])
      .filter((holiday) =>
        holiday.canton == null
        || holiday.canton === '*'
        || holiday.canton === canton)
      .map((holiday) => holiday.date),
  );
}

// Soll-Stunden eines einzelnen Tages, zweistufig kaskadiert:
//   1) Feiertag (le_holiday)                      → 0h, unabhängig vom MA
//   2) Mitarbeiter-Override für den Wochentag      → fixer Wert
//   3) sonst Zentral-Plan-Stunden × Pensum-Prozent → geerbt
// employeeProfiles darf leer sein (= 100% Pensum, alles geerbt).
export function sollForDay(templates, employeeProfiles, holidaySet, dateIso) {
  if (holidaySet?.has(dateIso)) return 0;
  const tmpl = pickProfile(templates, dateIso);
  const day = new Date(dateIso + 'T00:00:00').getDay();
  const dayKey = HOURS_BY_DAY[day];
  const baseHours = tmpl ? Number(tmpl[dayKey] || 0) : 0;

  const prof = pickProfile(employeeProfiles, dateIso);
  if (!prof) return baseHours;
  const override = prof[dayKey];
  if (override != null) return Number(override);
  const pensumPct = Number(prof.pensum_pct ?? 100);
  return baseHours * pensumPct / 100;
}

// Aggregierte Soll-Stunden über einen Range
export function calcSollHours(templates, employeeProfiles, holidaySet, fromIso, toIsoStr) {
  let total = 0;
  const d = new Date(fromIso + 'T00:00:00');
  const end = new Date(toIsoStr + 'T00:00:00');
  while (d <= end) {
    total += sollForDay(templates, employeeProfiles, holidaySet, toIso(d));
    d.setDate(d.getDate() + 1);
  }
  return total;
}

// ---------------------------------------------------------------------------
// CSV-Export (Semikolon + BOM für Excel-CH)
// ---------------------------------------------------------------------------

export function downloadCsv(filename, rows) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Kompakte Stunden-Anzeige für Tageszellen: 3.50 → "3.5", 0 → ""
export function fmtDayHours(h) {
  if (!h) return '';
  return Number(h).toFixed(2).replace(/\.?0+$/, '');
}
