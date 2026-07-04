// Auswertungen · Produktivität Mehrjahre
// Matrix Jahre × Mitarbeiter (Stunden oder bewerteter Umsatz), Jahre per
// Klick auf Monate aufklappbar – wie die Power BI-Seite «Total Stunden».
// Lädt jedes Jahr einzeln (gecacht, gleiche Query-Keys wie die Übersicht).
import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { Download, ChevronRight, ChevronDown } from 'lucide-react';
import { leTimeEntry, leEmployee } from '@/lib/leApi';
import {
  Card, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle,
} from '@/components/leistungserfassung/shared';
import { CAT, CAT_KEYS, addEntry, emptyCatSums, MONTHS, downloadCsv } from './util';

// Zellwert je Modus
const cellOf = (sums, mode) => (mode === 'value' ? sums.value.total : sums.hours.total);
const fmtCell = (v, mode) => (v ? (mode === 'value' ? fmt.chf(v) : fmt.hours(v)) : '');

function HoursTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border bg-white p-2.5 text-xs shadow-sm" style={{ borderColor: '#d9e0d9' }}>
      <div className="font-semibold mb-1" style={{ color: '#2d3a2d' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-zinc-600">{p.name}</span>
          <span className="ml-auto pl-4 tabular-nums font-medium">{fmt.hours(p.value)} h</span>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1 pt-1 border-t" style={{ borderColor: '#eef1ee' }}>
        <span className="text-zinc-600 font-semibold">Total</span>
        <span className="ml-auto pl-4 tabular-nums font-semibold">{fmt.hours(total)} h</span>
      </div>
    </div>
  );
}

export default function MehrjahrePanel() {
  const [mode, setMode] = useState('hours'); // 'hours' | 'value'
  const [expanded, setExpanded] = useState(() => new Set());

  const employeesQ = useQuery({ queryKey: ['le', 'employees'], queryFn: leEmployee.list, staleTime: 5 * 60_000 });
  const firstDateQ = useQuery({ queryKey: ['ausw', 'firstEntryDate'], queryFn: leTimeEntry.firstEntryDate, staleTime: 30 * 60_000 });

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const first = firstDateQ.data ? Number(firstDateQ.data.slice(0, 4)) : currentYear;
    const list = [];
    for (let y = first; y <= currentYear; y++) list.push(y);
    return list;
  }, [firstDateQ.data, currentYear]);

  const yearQueries = useQueries({
    queries: years.map(y => ({
      queryKey: ['ausw', 'prod', 'entries', y],
      queryFn: () => leTimeEntry.listForRangeAll(`${y}-01-01`, `${y}-12-31`, {}),
      staleTime: 5 * 60_000,
    })),
  });

  // Aggregation: pro Jahr {catSums, byEmp: Map(empId→catSums), byMonth: [12]{byEmp}}
  const perYear = useMemo(() => {
    const map = new Map();
    years.forEach((y, idx) => {
      const entries = (yearQueries[idx]?.data ?? []).filter(e => e.status !== 'storniert');
      const agg = {
        sums: emptyCatSums(),
        byEmp: new Map(),
        byMonthEmp: Array.from({ length: 12 }, () => new Map()),
      };
      for (const e of entries) {
        addEntry(agg.sums, e);
        if (!agg.byEmp.has(e.employee_id)) agg.byEmp.set(e.employee_id, emptyCatSums());
        addEntry(agg.byEmp.get(e.employee_id), e);
        const m = Number(e.entry_date.slice(5, 7)) - 1;
        if (!agg.byMonthEmp[m].has(e.employee_id)) agg.byMonthEmp[m].set(e.employee_id, emptyCatSums());
        addEntry(agg.byMonthEmp[m].get(e.employee_id), e);
      }
      map.set(y, agg);
    });
    return map;
  }, [years, yearQueries]);

  // Spalten: nur MA mit Aktivität in irgendeinem Jahr
  const columns = useMemo(() => {
    const active = new Set();
    for (const agg of perYear.values()) {
      for (const [empId, sums] of agg.byEmp) if (sums.hours.total > 0) active.add(empId);
    }
    return (employeesQ.data ?? [])
      .filter(e => active.has(e.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [perYear, employeesQ.data]);

  // Gesamt pro MA über alle Jahre
  const totalByEmp = useMemo(() => {
    const map = new Map();
    for (const agg of perYear.values()) {
      for (const [empId, sums] of agg.byEmp) {
        map.set(empId, (map.get(empId) || 0) + cellOf(sums, mode));
      }
    }
    return map;
  }, [perYear, mode]);
  const grandTotal = useMemo(
    () => [...totalByEmp.values()].reduce((s, v) => s + v, 0),
    [totalByEmp],
  );

  // Chart: Jahres-Totale gestapelt nach Kategorie (immer Stunden)
  const chartData = useMemo(() => years.map(y => {
    const agg = perYear.get(y);
    return {
      name: String(y),
      effektiv: Math.round((agg?.sums.hours.effektiv || 0) * 100) / 100,
      pauschal: Math.round((agg?.sums.hours.pauschal || 0) * 100) / 100,
      intern: Math.round((agg?.sums.hours.intern || 0) * 100) / 100,
      uebrig: Math.round((agg?.sums.hours.uebrig || 0) * 100) / 100,
    };
  }), [years, perYear]);

  const toggleYear = (y) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(y)) next.delete(y); else next.add(y);
    return next;
  });

  const exportCsv = () => {
    const header = ['Jahr', ...columns.map(c => c.full_name), 'Gesamt'];
    const data = years.map(y => {
      const agg = perYear.get(y);
      return [
        y,
        ...columns.map(c => {
          const v = agg?.byEmp.get(c.id) ? cellOf(agg.byEmp.get(c.id), mode) : 0;
          return v ? v.toFixed(2) : '';
        }),
        cellOf(agg?.sums ?? emptyCatSums(), mode).toFixed(2),
      ];
    });
    downloadCsv(`produktivitaet-mehrjahre_${mode === 'value' ? 'umsatz' : 'stunden'}.csv`, [header, ...data]);
  };

  const isLoading = employeesQ.isLoading || firstDateQ.isLoading || yearQueries.some(q => q.isLoading);
  const error = employeesQ.error || firstDateQ.error || yearQueries.find(q => q.error)?.error;

  return (
    <div>
      <PanelHeader
        title="Mehrjahre"
        subtitle="Stunden bzw. bewerteter Umsatz pro Mitarbeiter über alle Jahre – Jahre per Klick auf Monate aufklappbar."
        right={(
          <button type="button" onClick={exportCsv} className={artisBtn.ghost} style={artisGhostStyle}>
            <Download className="w-3.5 h-3.5" /> CSV-Export
          </button>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg border" style={{ borderColor: '#e4e7e4', background: '#fafaf8' }}>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg border bg-white" style={{ borderColor: '#d9dfd9' }}>
          {[{ id: 'hours', label: 'Stunden' }, { id: 'value', label: 'Umsatz CHF' }].map(m => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
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
        <div className="text-[11px] text-zinc-500">
          Umsatz = Stunden × Erfassungs-Ansatz (Effektiv + Pauschal, bewertet)
        </div>
      </div>

      {error && <PanelError error={error} onRetry={() => yearQueries.forEach(q => q.refetch())} />}
      {!error && isLoading && <PanelLoader />}

      {!error && !isLoading && (
        <div className="space-y-4">
          {/* Matrix Jahre × Mitarbeiter */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="px-3 py-2 font-semibold">Jahr</th>
                    {columns.map(c => (
                      <th key={c.id} className="px-3 py-2 font-semibold text-right" title={c.full_name}>
                        {c.short_code || c.full_name}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-semibold text-right">Gesamt</th>
                  </tr>
                </thead>
                <tbody>
                  {years.length === 0 && (
                    <tr><td colSpan={columns.length + 2} className="px-3 py-4 text-zinc-400 text-xs">Noch keine Daten.</td></tr>
                  )}
                  {years.map((y) => {
                    const agg = perYear.get(y);
                    const open = expanded.has(y);
                    return (
                      <React.Fragment key={y}>
                        <tr
                          onClick={() => toggleYear(y)}
                          className="border-b cursor-pointer transition-colors hover:bg-zinc-50"
                          style={{ borderColor: '#f0f0ec', background: open ? '#eef4ee' : undefined }}
                        >
                          <td className="px-3 py-2 font-semibold whitespace-nowrap">
                            {open
                              ? <ChevronDown className="inline w-3.5 h-3.5 mr-1 text-zinc-400" />
                              : <ChevronRight className="inline w-3.5 h-3.5 mr-1 text-zinc-400" />}
                            {y}
                          </td>
                          {columns.map(c => {
                            const v = agg?.byEmp.get(c.id) ? cellOf(agg.byEmp.get(c.id), mode) : 0;
                            return (
                              <td key={c.id} className="px-3 py-2 text-right tabular-nums">{fmtCell(v, mode)}</td>
                            );
                          })}
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {fmtCell(cellOf(agg?.sums ?? emptyCatSums(), mode), mode)}
                          </td>
                        </tr>
                        {open && MONTHS.map((mName, m) => {
                          const byEmp = agg?.byMonthEmp[m] ?? new Map();
                          let rowTotal = 0;
                          const cells = columns.map(c => {
                            const v = byEmp.get(c.id) ? cellOf(byEmp.get(c.id), mode) : 0;
                            rowTotal += v;
                            return <td key={c.id} className="px-3 py-1 text-right tabular-nums text-zinc-600">{fmtCell(v, mode)}</td>;
                          });
                          if (rowTotal === 0) return null; // leere Monate weglassen
                          return (
                            <tr key={`${y}-${m}`} className="border-b text-xs" style={{ borderColor: '#f4f6f4', background: '#fbfdfb' }}>
                              <td className="px-3 py-1 pl-8 text-zinc-500">{mName}</td>
                              {cells}
                              <td className="px-3 py-1 text-right tabular-nums text-zinc-600 font-medium">{fmtCell(rowTotal, mode)}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {years.length > 0 && (
                  <tfoot>
                    <tr className="border-t font-semibold" style={{ borderColor: '#d9e0d9', background: '#f2f5f2' }}>
                      <td className="px-3 py-2">Gesamt</td>
                      {columns.map(c => (
                        <td key={c.id} className="px-3 py-2 text-right tabular-nums">
                          {fmtCell(totalByEmp.get(c.id) || 0, mode)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCell(grandTotal, mode)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Grafik: Jahres-Totale gestapelt (Stunden) */}
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3" style={{ color: '#2d3a2d' }}>
              Stunden pro Jahr nach Projekttyp
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={{ stroke: '#d9e0d9' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<HoursTooltip />} cursor={{ fill: 'rgba(122,155,127,0.07)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CAT_KEYS.map(k => (
                  <Bar key={k} dataKey={k} stackId="h" name={CAT[k].label} fill={CAT[k].color}
                    radius={k === 'uebrig' ? [3, 3, 0, 0] : 0} maxBarSize={48} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
