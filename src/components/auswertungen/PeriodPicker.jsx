// Auswertungen · Zeitraum-Steuerung
// Modus-Pills (Monat/Quartal/Jahr/YTD) + Pfeil-Navigation + "Heute".
// periodRange() liefert den ISO-Range zum Zustand; Vorjahresperiode =
// gleicher Range ein Jahr früher (YTD mit identischem Stichtag, damit
// der Vergleich fair bleibt).
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS, toIso } from './util';

export const PERIOD_MODES = [
  { id: 'month', label: 'Monat' },
  { id: 'quarter', label: 'Quartal' },
  { id: 'ytd', label: 'Year-to-Date' },
  { id: 'year', label: 'Jahr' },
];

// period = { mode, year, month0 }
export function periodRange(period, todayArg) {
  const today = todayArg || new Date();
  const { mode, year, month0 } = period;
  if (mode === 'quarter') {
    const q = Math.floor(month0 / 3);
    const from = new Date(year, q * 3, 1);
    const to = new Date(year, q * 3 + 3, 0);
    return { fromIso: toIso(from), toIso: toIso(to), label: `Q${q + 1} ${year}` };
  }
  if (mode === 'year') {
    return { fromIso: `${year}-01-01`, toIso: `${year}-12-31`, label: String(year) };
  }
  if (mode === 'ytd') {
    // Stichtag = heutiger Monat/Tag, auch in früheren Jahren (vergleichbar)
    const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
    const cut = new Date(year, today.getMonth(), Math.min(today.getDate(), lastDay));
    return {
      fromIso: `${year}-01-01`,
      toIso: toIso(cut),
      label: `1.1. – ${cut.getDate()}.${cut.getMonth() + 1}.${year}`,
    };
  }
  // month (Default)
  const from = new Date(year, month0, 1);
  const to = new Date(year, month0 + 1, 0);
  return { fromIso: toIso(from), toIso: toIso(to), label: `${MONTHS[month0]} ${year}` };
}

// Vorjahresperiode zum gleichen Zustand
export function prevYearPeriod(period) {
  return { ...period, year: period.year - 1 };
}

// Navigation: Monat ±1, Quartal ±3 Monate, Jahr/YTD ±1 Jahr
export function shiftPeriod(period, dir) {
  const { mode, year, month0 } = period;
  if (mode === 'year' || mode === 'ytd') return { ...period, year: year + dir };
  const step = mode === 'quarter' ? 3 : 1;
  const d = new Date(year, month0 + dir * step, 1);
  return { ...period, year: d.getFullYear(), month0: d.getMonth() };
}

export default function PeriodPicker({ period, onChange }) {
  const today = new Date();
  const range = periodRange(period, today);
  const isCurrent = period.year === today.getFullYear()
    && (period.mode === 'year' || period.mode === 'ytd'
      || (period.mode === 'month' && period.month0 === today.getMonth())
      || (period.mode === 'quarter' && Math.floor(period.month0 / 3) === Math.floor(today.getMonth() / 3)));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Modus-Pills */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg border bg-white" style={{ borderColor: '#d9dfd9' }}>
        {PERIOD_MODES.map(m => {
          const active = m.id === period.mode;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...period, mode: m.id })}
              className="px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors"
              style={{
                background: active ? '#7a9b7f' : 'transparent',
                color: active ? '#fff' : '#5a6a5a',
                fontWeight: active ? 600 : 500,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, -1))}
          className="w-7 h-7 flex items-center justify-center rounded border text-zinc-500 hover:bg-zinc-50 transition-colors"
          style={{ borderColor: '#d9dfd9', background: '#fff' }}
          title="Zurück"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="px-2 text-sm font-semibold tabular-nums text-center" style={{ color: '#2d3a2d', minWidth: 140 }}>
          {range.label}
        </div>
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, 1))}
          className="w-7 h-7 flex items-center justify-center rounded border text-zinc-500 hover:bg-zinc-50 transition-colors"
          style={{ borderColor: '#d9dfd9', background: '#fff' }}
          title="Vor"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {!isCurrent && (
          <button
            type="button"
            onClick={() => onChange({ ...period, year: today.getFullYear(), month0: today.getMonth() })}
            className="ml-1 px-2 py-1 rounded text-xs border text-zinc-500 hover:bg-zinc-50 transition-colors"
            style={{ borderColor: '#d9dfd9', background: '#fff' }}
          >
            Heute
          </button>
        )}
      </div>
    </div>
  );
}
