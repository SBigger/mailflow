// Auswertungen · Monats-Navigation (◀ Monat Jahr ▶ + "Heute")
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS } from './util';

export default function MonthPicker({ year, month0, onChange }) {
  const shift = (delta) => {
    const d = new Date(year, month0 + delta, 1);
    onChange(d.getFullYear(), d.getMonth());
  };
  const today = new Date();
  const isCurrent = year === today.getFullYear() && month0 === today.getMonth();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="w-7 h-7 flex items-center justify-center rounded border text-zinc-500 hover:bg-zinc-50 transition-colors"
        style={{ borderColor: '#d9dfd9' }}
        title="Vormonat"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="px-2 text-sm font-semibold tabular-nums text-center" style={{ color: '#2d3a2d', minWidth: 128 }}>
        {MONTHS[month0]} {year}
      </div>
      <button
        type="button"
        onClick={() => shift(1)}
        className="w-7 h-7 flex items-center justify-center rounded border text-zinc-500 hover:bg-zinc-50 transition-colors"
        style={{ borderColor: '#d9dfd9' }}
        title="Folgemonat"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onChange(today.getFullYear(), today.getMonth())}
          className="ml-1 px-2 py-1 rounded text-xs border text-zinc-500 hover:bg-zinc-50 transition-colors"
          style={{ borderColor: '#d9dfd9' }}
        >
          Heute
        </button>
      )}
    </div>
  );
}
