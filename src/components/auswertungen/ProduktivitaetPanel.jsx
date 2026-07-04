// Auswertungen · Produktivität
// Monatsübersicht pro Mitarbeiter mit Stunden-Split nach Projekttyp:
//   Effektiv  = verrechenbare Stunden auf Effektiv-Projekten (billing_mode='effektiv')
//   Pauschal  = rapportierte Stunden auf Pauschalprojekten  (billing_mode='pauschal')
//   Intern    = Stunden auf internen Projekten               (is_internal)
//   Übrige    = nicht verrechenbare Leistungsarten auf Kundenprojekten
// Umsatz = Stunden × rate_snapshot (bewertete Leistung, bei Pauschal "externe Rapportierung").
import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { Clock, Users, TrendingUp, Banknote, Download } from 'lucide-react';
import { leTimeEntry, leEmployee, leSollzeitProfile } from '@/lib/leApi';
import {
  Card, Chip, Select, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle,
} from '@/components/leistungserfassung/shared';
import MonthPicker from './MonthPicker';
import {
  CAT, CAT_KEYS, addEntry, emptyCatSums, monthRange, MONTHS, MONTHS_SHORT,
  calcSollHours, downloadCsv,
} from './util';

// KPI-Kachel mit farbigem Akzent
function Kpi({ label, value, hint, color = '#7a9b7f', icon: Icon = Clock }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums" style={{ color: '#2d3a2d' }}>{value}</div>
      {hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>}
    </Card>
  );
}

// Recharts-Tooltip im Artis-Look
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

export default function ProduktivitaetPanel() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month0, setMonth0] = useState(today.getMonth());
  const [maFilter, setMaFilter] = useState('all'); // Filter für den Jahresverlauf

  const range = useMemo(() => monthRange(year, month0), [year, month0]);

  const employeesQ = useQuery({
    queryKey: ['le', 'employees'],
    queryFn: leEmployee.list,
    staleTime: 5 * 60_000,
  });

  // Ganzes Jahr laden: Monat + Jahresverlauf kommen aus demselben Datensatz.
  const entriesQ = useQuery({
    queryKey: ['ausw', 'prod', 'entries', year],
    queryFn: () => leTimeEntry.listForRangeAll(`${year}-01-01`, `${year}-12-31`, {}),
    staleTime: 60_000,
  });

  const employees = employeesQ.data;
  const profileQueries = useQueries({
    queries: (employees ?? []).map(emp => ({
      queryKey: ['le', 'sollzeit', emp.id],
      queryFn: () => leSollzeitProfile.listForEmployee(emp.id),
      staleTime: 5 * 60_000,
    })),
  });
  const profilesById = useMemo(() => {
    const map = new Map();
    (employees ?? []).forEach((emp, idx) => map.set(emp.id, profileQueries[idx]?.data ?? []));
    return map;
  }, [employees, profileQueries]);

  // Stornierte Buchungen zählen nirgends mit
  const yearEntries = useMemo(
    () => (entriesQ.data ?? []).filter(e => e.status !== 'storniert'),
    [entriesQ.data],
  );
  const monthEntries = useMemo(
    () => yearEntries.filter(e => e.entry_date >= range.fromIso && e.entry_date <= range.toIso),
    [yearEntries, range.fromIso, range.toIso],
  );

  // Pro Mitarbeiter: Kategorien-Summen des Monats + Soll
  const rows = useMemo(() => {
    if (!employees) return [];
    const byEmp = new Map();
    for (const emp of employees) {
      byEmp.set(emp.id, {
        emp,
        sums: emptyCatSums(),
        soll: calcSollHours(profilesById.get(emp.id) || [], range.fromIso, range.toIso),
      });
    }
    for (const e of monthEntries) {
      const row = byEmp.get(e.employee_id);
      if (row) addEntry(row.sums, e);
    }
    return [...byEmp.values()]
      .filter(r => r.emp.active || r.sums.hours.total > 0)
      .sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name));
  }, [employees, monthEntries, profilesById, range.fromIso, range.toIso]);

  // Team-Totale (KPI + Fusszeile)
  const totals = useMemo(() => {
    const t = emptyCatSums();
    let soll = 0;
    for (const r of rows) {
      for (const k of CAT_KEYS) t.hours[k] += r.sums.hours[k];
      t.hours.total += r.sums.hours.total;
      t.value.effektiv += r.sums.value.effektiv;
      t.value.pauschal += r.sums.value.pauschal;
      t.value.total += r.sums.value.total;
      soll += r.soll;
    }
    return { ...t, soll };
  }, [rows]);

  // Grafik 1: Stunden-Split pro MA im gewählten Monat
  const chartByEmp = useMemo(() =>
    rows
      .filter(r => r.sums.hours.total > 0)
      .map(r => ({
        name: r.emp.short_code || r.emp.full_name,
        fullName: r.emp.full_name,
        effektiv: Math.round(r.sums.hours.effektiv * 100) / 100,
        pauschal: Math.round(r.sums.hours.pauschal * 100) / 100,
        intern: Math.round(r.sums.hours.intern * 100) / 100,
        uebrig: Math.round(r.sums.hours.uebrig * 100) / 100,
      })),
  [rows]);

  // Grafik 2: Jahresverlauf (12 Monate, optional auf einen MA gefiltert)
  const chartByMonth = useMemo(() => {
    const buckets = MONTHS_SHORT.map(m => ({ name: m, effektiv: 0, pauschal: 0, intern: 0, uebrig: 0 }));
    for (const e of yearEntries) {
      if (maFilter !== 'all' && e.employee_id !== maFilter) continue;
      const m = Number(e.entry_date.slice(5, 7)) - 1;
      const sums = emptyCatSums();
      addEntry(sums, e);
      for (const k of CAT_KEYS) buckets[m][k] = Math.round((buckets[m][k] + sums.hours[k]) * 100) / 100;
    }
    return buckets;
  }, [yearEntries, maFilter]);

  const exportCsv = () => {
    const header = ['Mitarbeiter', 'Soll-Std', 'Total Std', 'Erfassung %',
      'Effektiv Std', 'Pauschal Std', 'Intern Std', 'Übrige Std',
      'Umsatz effektiv CHF', 'Umsatz pauschal CHF', 'Umsatz total CHF', 'Ø CHF/h effektiv'];
    const data = rows.map(r => {
      const erf = r.soll > 0 ? (r.sums.hours.total / r.soll) * 100 : 0;
      const avg = r.sums.hours.effektiv > 0 ? r.sums.value.effektiv / r.sums.hours.effektiv : 0;
      return [
        r.emp.full_name, r.soll.toFixed(2), r.sums.hours.total.toFixed(2), erf.toFixed(1),
        r.sums.hours.effektiv.toFixed(2), r.sums.hours.pauschal.toFixed(2),
        r.sums.hours.intern.toFixed(2), r.sums.hours.uebrig.toFixed(2),
        r.sums.value.effektiv.toFixed(2), r.sums.value.pauschal.toFixed(2),
        r.sums.value.total.toFixed(2), avg.toFixed(2),
      ];
    });
    downloadCsv(`produktivitaet_${range.fromIso}_${range.toIso}.csv`, [header, ...data]);
  };

  const isLoading = employeesQ.isLoading || entriesQ.isLoading;
  const error = employeesQ.error || entriesQ.error;

  return (
    <div>
      <PanelHeader
        title="Produktivität"
        subtitle="Stunden und Umsatz pro Mitarbeiter – aufgeteilt nach Effektiv-, Pauschal- und internen Projekten."
        right={(
          <button type="button" onClick={exportCsv} className={artisBtn.ghost} style={artisGhostStyle}>
            <Download className="w-3.5 h-3.5" /> CSV-Export
          </button>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg border" style={{ borderColor: '#e4e7e4', background: '#fafaf8' }}>
        <MonthPicker year={year} month0={month0} onChange={(y, m) => { setYear(y); setMonth0(m); }} />
        <div className="flex items-center gap-1.5 ml-auto text-[11px] text-zinc-500">
          {CAT_KEYS.map(k => (
            <span key={k} className="inline-flex items-center gap-1 mr-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CAT[k].color }} />
              {CAT[k].label}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <PanelError error={error} onRetry={() => { employeesQ.refetch(); entriesQ.refetch(); }} />
      )}
      {!error && isLoading && <PanelLoader />}

      {!error && !isLoading && (
        <div className="space-y-4">
          {/* KPI-Zeile */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Total Stunden" value={`${fmt.hours(totals.hours.total)} h`}
              hint={`Soll: ${fmt.hours(totals.soll)} h`} icon={Clock} color="#4d6a50" />
            <Kpi label="Effektiv" value={`${fmt.hours(totals.hours.effektiv)} h`}
              hint="verrechenbar" icon={TrendingUp} color={CAT.effektiv.color} />
            <Kpi label="Pauschal" value={`${fmt.hours(totals.hours.pauschal)} h`}
              hint="rapportiert" icon={Clock} color={CAT.pauschal.color} />
            <Kpi label="Intern" value={`${fmt.hours(totals.hours.intern)} h`}
              hint="ohne Verrechnung" icon={Users} color={CAT.intern.color} />
            <Kpi label="Umsatz effektiv" value={fmt.chf(totals.value.effektiv)}
              hint="CHF, bewertet" icon={Banknote} color={CAT.effektiv.color} />
            <Kpi label="Umsatz pauschal" value={fmt.chf(totals.value.pauschal)}
              hint="CHF, bewertet" icon={Banknote} color={CAT.pauschal.color} />
          </div>

          {/* Grafik: Stunden pro Mitarbeiter (Monat) */}
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3" style={{ color: '#2d3a2d' }}>
              Stunden pro Mitarbeiter · {MONTHS[month0]} {year}
            </div>
            {chartByEmp.length === 0 ? (
              <div className="text-xs text-zinc-400 py-8 text-center">Keine Stunden im gewählten Monat.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartByEmp} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={{ stroke: '#d9e0d9' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<HoursTooltip />} cursor={{ fill: 'rgba(122,155,127,0.07)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {CAT_KEYS.map(k => (
                    <Bar key={k} dataKey={k} stackId="h" name={CAT[k].label} fill={CAT[k].color}
                      radius={k === 'uebrig' ? [3, 3, 0, 0] : 0} maxBarSize={56} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Tabelle: Monatswerte pro MA */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="px-3 py-2 font-semibold">Mitarbeiter</th>
                    <th className="px-3 py-2 font-semibold text-right">Soll</th>
                    <th className="px-3 py-2 font-semibold text-right">Total</th>
                    <th className="px-3 py-2 font-semibold text-right">Erfassung</th>
                    <th className="px-3 py-2 font-semibold text-right" style={{ color: CAT.effektiv.color }}>Effektiv</th>
                    <th className="px-3 py-2 font-semibold text-right" style={{ color: '#a87c2e' }}>Pauschal</th>
                    <th className="px-3 py-2 font-semibold text-right" style={{ color: '#5f7891' }}>Intern</th>
                    <th className="px-3 py-2 font-semibold text-right">Übrige</th>
                    <th className="px-3 py-2 font-semibold text-right">Umsatz eff.</th>
                    <th className="px-3 py-2 font-semibold text-right">Umsatz pausch.</th>
                    <th className="px-3 py-2 font-semibold text-right">Umsatz total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-4 text-zinc-400 text-xs">Keine Daten im gewählten Monat.</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const erf = r.soll > 0 ? (r.sums.hours.total / r.soll) * 100 : null;
                    return (
                      <tr key={r.emp.id} className="border-b last:border-b-0"
                        style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}>
                        <td className="px-3 py-2 font-medium">
                          {r.emp.full_name}
                          {!r.emp.active && <Chip tone="neutral" className="ml-2">inaktiv</Chip>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.hours(r.soll)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt.hours(r.sums.hours.total)}</td>
                        <td className="px-3 py-2 text-right">
                          {erf == null
                            ? <span className="text-zinc-300">—</span>
                            : <Chip tone={erf < 80 ? 'orange' : erf < 95 ? 'neutral' : 'green'}>{erf.toFixed(0)} %</Chip>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.sums.hours.effektiv)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.sums.hours.pauschal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.sums.hours.intern)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.hours(r.sums.hours.uebrig)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(r.sums.value.effektiv)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(r.sums.value.pauschal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt.chf(r.sums.value.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t font-semibold" style={{ borderColor: '#d9e0d9', background: '#f2f5f2' }}>
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.soll)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours.total)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours.effektiv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours.pauschal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours.intern)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours.uebrig)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(totals.value.effektiv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(totals.value.pauschal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(totals.value.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Grafik: Jahresverlauf */}
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-sm font-semibold" style={{ color: '#2d3a2d' }}>
                Jahresverlauf {year}
              </div>
              <div className="ml-auto" style={{ width: 220 }}>
                <Select value={maFilter} onChange={(e) => setMaFilter(e.target.value)}>
                  <option value="all">Alle Mitarbeiter</option>
                  {(employees ?? []).filter(e => e.active).map(e => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
                </Select>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartByMonth} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={{ stroke: '#d9e0d9' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<HoursTooltip />} cursor={{ fill: 'rgba(122,155,127,0.07)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CAT_KEYS.map(k => (
                  <Bar key={k} dataKey={k} stackId="h" name={CAT[k].label} fill={CAT[k].color}
                    radius={k === 'uebrig' ? [3, 3, 0, 0] : 0} maxBarSize={40} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
