// Auswertungen · Produktivität
// Stunden/Umsatz pro Mitarbeiter nach Projekttyp, mit frei wählbarem
// Zeitraum (Monat/Quartal/YTD/Jahr, Pfeil-Navigation in alle Vorperioden)
// und einblendbarem Vorjahresvergleich (KPI-Deltas, Vergleichsspalten,
// Vorjahreslinie im Jahresverlauf).
//   Effektiv  = verrechenbare Stunden auf Effektiv-Projekten
//   Pauschal  = rapportierte Stunden auf Pauschalprojekten
//   Intern    = Stunden auf internen Projekten
//   Übrige    = nicht verrechenbare Leistungsarten auf Kundenprojekten
// Umsatz = Stunden × rate_snapshot (bewertete Leistung).
import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { Clock, Users, TrendingUp, Banknote, Download } from 'lucide-react';
import { leTimeEntry, leEmployee, leSollzeitProfile, leSollzeitTemplate, leHoliday } from '@/lib/leApi';
import {
  Card, Chip, Select, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle,
} from '@/components/leistungserfassung/shared';
import PeriodPicker, { periodRange, prevYearPeriod } from './PeriodPicker';
import {
  CAT, CAT_KEYS, addEntry, emptyCatSums, MONTHS_SHORT,
  calcSollHours, toHolidaySet, downloadCsv,
} from './util';

const VJ_COLOR = '#8a94a6';

// prozentuale Abweichung zum Vorjahr (null wenn kein Vergleichswert)
function deltaPct(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function DeltaChip({ pct }) {
  if (pct == null) return <span className="text-zinc-300">—</span>;
  const up = pct >= 0;
  return (
    <Chip tone={up ? 'green' : 'red'}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)} %
    </Chip>
  );
}

// KPI-Kachel; zeigt bei aktivem Vergleich Vorjahreswert + Delta
function Kpi({ label, value, hint, color = '#7a9b7f', icon: Icon = Clock, vj }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums" style={{ color: '#2d3a2d' }}>{value}</div>
      {vj ? (
        <div className="text-[11px] mt-0.5 flex items-center gap-1.5">
          <span className="text-zinc-400">VJ {vj.value}</span>
          {vj.pct != null && (
            <span className="font-medium tabular-nums" style={{ color: vj.pct >= 0 ? '#2d5a2d' : '#c34141' }}>
              {vj.pct >= 0 ? '+' : ''}{vj.pct.toFixed(0)} %
            </span>
          )}
        </div>
      ) : (
        hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>
      )}
    </Card>
  );
}

// Recharts-Tooltip im Artis-Look (Stunden)
function HoursTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const stack = payload.filter(p => p.dataKey !== 'vjTotal');
  const vj = payload.find(p => p.dataKey === 'vjTotal');
  const total = stack.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border bg-white p-2.5 text-xs shadow-sm" style={{ borderColor: '#d9e0d9' }}>
      <div className="font-semibold mb-1" style={{ color: '#2d3a2d' }}>{label}</div>
      {stack.map((p) => (
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
      {vj && vj.value != null && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: VJ_COLOR }} />
          <span className="text-zinc-500">{vj.name}</span>
          <span className="ml-auto pl-4 tabular-nums text-zinc-500">{fmt.hours(vj.value)} h</span>
        </div>
      )}
    </div>
  );
}

export default function ProduktivitaetPanel() {
  const today = new Date();
  const [period, setPeriod] = useState({ mode: 'month', year: today.getFullYear(), month0: today.getMonth() });
  const [compare, setCompare] = useState(false);
  const [maFilter, setMaFilter] = useState('all'); // Filter für den Jahresverlauf

  const range = useMemo(() => periodRange(period), [period]);
  const prevRange = useMemo(() => periodRange(prevYearPeriod(period)), [period]);

  const employeesQ = useQuery({
    queryKey: ['le', 'employees'],
    queryFn: leEmployee.list,
    staleTime: 5 * 60_000,
  });

  // Pro Jahr ein gecachter Load: Periode + Jahresverlauf aus demselben Datensatz,
  // Vorjahr nur wenn der Vergleich eingeblendet ist.
  const entriesQ = useQuery({
    queryKey: ['ausw', 'prod', 'entries', period.year],
    queryFn: () => leTimeEntry.listForRangeAll(`${period.year}-01-01`, `${period.year}-12-31`, {}),
    staleTime: 60_000,
  });
  const prevEntriesQ = useQuery({
    queryKey: ['ausw', 'prod', 'entries', period.year - 1],
    queryFn: () => leTimeEntry.listForRangeAll(`${period.year - 1}-01-01`, `${period.year - 1}-12-31`, {}),
    staleTime: 5 * 60_000,
    enabled: compare,
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

  // Zentraler Sollzeit-Plan + Feiertage (für die Soll-Berechnung, s. util.sollForDay)
  const templatesQ = useQuery({
    queryKey: ['le', 'sollzeit-template'],
    queryFn: leSollzeitTemplate.list,
    staleTime: 10 * 60_000,
  });
  const holidaysQ = useQuery({
    queryKey: ['le', 'holiday', period.year],
    queryFn: () => leHoliday.list({ from: `${period.year}-01-01`, to: `${period.year}-12-31` }),
    staleTime: 10 * 60_000,
  });
  const holidaySet = useMemo(() => toHolidaySet(holidaysQ.data), [holidaysQ.data]);

  // Stornierte Buchungen zählen nirgends mit
  const yearEntries = useMemo(
    () => (entriesQ.data ?? []).filter(e => e.status !== 'storniert'),
    [entriesQ.data],
  );
  const prevYearEntries = useMemo(
    () => (prevEntriesQ.data ?? []).filter(e => e.status !== 'storniert'),
    [prevEntriesQ.data],
  );
  const periodEntries = useMemo(
    () => yearEntries.filter(e => e.entry_date >= range.fromIso && e.entry_date <= range.toIso),
    [yearEntries, range.fromIso, range.toIso],
  );
  const prevPeriodEntries = useMemo(
    () => prevYearEntries.filter(e => e.entry_date >= prevRange.fromIso && e.entry_date <= prevRange.toIso),
    [prevYearEntries, prevRange.fromIso, prevRange.toIso],
  );

  // Vorjahres-Summen pro MA (für Vergleichsspalten)
  const prevByEmp = useMemo(() => {
    const map = new Map();
    for (const e of prevPeriodEntries) {
      if (!map.has(e.employee_id)) map.set(e.employee_id, emptyCatSums());
      addEntry(map.get(e.employee_id), e);
    }
    return map;
  }, [prevPeriodEntries]);

  // Pro Mitarbeiter: Kategorien-Summen der Periode + Soll (+ Vorjahr)
  const rows = useMemo(() => {
    if (!employees) return [];
    const byEmp = new Map();
    for (const emp of employees) {
      byEmp.set(emp.id, {
        emp,
        sums: emptyCatSums(),
        soll: calcSollHours(templatesQ.data || [], profilesById.get(emp.id) || [], holidaySet, range.fromIso, range.toIso),
        prev: prevByEmp.get(emp.id) || null,
      });
    }
    for (const e of periodEntries) {
      const row = byEmp.get(e.employee_id);
      if (row) addEntry(row.sums, e);
    }
    // Nur Personen mit erfassten Stunden zeigen (keine 0.00-Zeilen);
    // bei aktivem Vergleich reicht auch Vorjahres-Aktivität.
    return [...byEmp.values()]
      .filter(r => r.sums.hours.total > 0 || (compare && r.prev?.hours.total > 0))
      .sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name));
  }, [employees, periodEntries, profilesById, range.fromIso, range.toIso, prevByEmp, compare]);

  // Team-Totale (KPI + Fusszeile), aktuelle Periode + Vorjahr
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
  const prevTotals = useMemo(() => {
    const t = emptyCatSums();
    for (const s of prevByEmp.values()) {
      for (const k of CAT_KEYS) t.hours[k] += s.hours[k];
      t.hours.total += s.hours.total;
      t.value.effektiv += s.value.effektiv;
      t.value.pauschal += s.value.pauschal;
      t.value.total += s.value.total;
    }
    return t;
  }, [prevByEmp]);

  const vjOf = (cur, prev, isChf) => (compare ? {
    value: isChf ? fmt.chf(prev) : `${fmt.hours(prev)} h`,
    pct: deltaPct(cur, prev),
  } : null);

  // Grafik 1: Stunden-Split pro MA in der Periode
  const chartByEmp = useMemo(() =>
    rows
      .filter(r => r.sums.hours.total > 0)
      .map(r => ({
        name: r.emp.short_code || r.emp.full_name,
        effektiv: Math.round(r.sums.hours.effektiv * 100) / 100,
        pauschal: Math.round(r.sums.hours.pauschal * 100) / 100,
        intern: Math.round(r.sums.hours.intern * 100) / 100,
        uebrig: Math.round(r.sums.hours.uebrig * 100) / 100,
      })),
  [rows]);

  // Grafik 2: Jahresverlauf (12 Monate, optional MA-Filter + Vorjahreslinie)
  const chartByMonth = useMemo(() => {
    const buckets = MONTHS_SHORT.map(m => ({ name: m, effektiv: 0, pauschal: 0, intern: 0, uebrig: 0, vjTotal: null }));
    for (const e of yearEntries) {
      if (maFilter !== 'all' && e.employee_id !== maFilter) continue;
      const m = Number(e.entry_date.slice(5, 7)) - 1;
      const sums = emptyCatSums();
      addEntry(sums, e);
      for (const k of CAT_KEYS) buckets[m][k] = Math.round((buckets[m][k] + sums.hours[k]) * 100) / 100;
    }
    if (compare) {
      for (const b of buckets) b.vjTotal = 0;
      for (const e of prevYearEntries) {
        if (maFilter !== 'all' && e.employee_id !== maFilter) continue;
        const m = Number(e.entry_date.slice(5, 7)) - 1;
        buckets[m].vjTotal = Math.round((buckets[m].vjTotal + Number(e.hours_internal || 0)) * 100) / 100;
      }
    }
    return buckets;
  }, [yearEntries, prevYearEntries, maFilter, compare]);

  const exportCsv = () => {
    const header = ['Mitarbeiter', 'Soll-Std', 'Total Std',
      ...(compare ? ['VJ Total Std', 'Δ %'] : []),
      'Erfassung %', 'Effektiv Std', 'Pauschal Std', 'Intern Std', 'Übrige Std',
      'Umsatz effektiv CHF', 'Umsatz pauschal CHF', 'Umsatz total CHF'];
    const data = rows.map(r => {
      const erf = r.soll > 0 ? (r.sums.hours.total / r.soll) * 100 : 0;
      const prevTotal = r.prev?.hours.total || 0;
      const d = deltaPct(r.sums.hours.total, prevTotal);
      return [
        r.emp.full_name, r.soll.toFixed(2), r.sums.hours.total.toFixed(2),
        ...(compare ? [prevTotal.toFixed(2), d != null ? d.toFixed(1) : ''] : []),
        erf.toFixed(1),
        r.sums.hours.effektiv.toFixed(2), r.sums.hours.pauschal.toFixed(2),
        r.sums.hours.intern.toFixed(2), r.sums.hours.uebrig.toFixed(2),
        r.sums.value.effektiv.toFixed(2), r.sums.value.pauschal.toFixed(2),
        r.sums.value.total.toFixed(2),
      ];
    });
    downloadCsv(`produktivitaet_${range.fromIso}_${range.toIso}.csv`, [header, ...data]);
  };

  // Zentral-Plan/Feiertage sind optional (Migration evtl. noch nicht eingespielt):
  // Fehler dort blocken nur die Soll-Berechnung (fällt auf 0h zurück), nicht das ganze Panel.
  const isLoading = employeesQ.isLoading || entriesQ.isLoading || (compare && prevEntriesQ.isLoading);
  const error = employeesQ.error || entriesQ.error || (compare ? prevEntriesQ.error : null);
  const sollUnavailable = !!(templatesQ.error || holidaysQ.error);
  const colSpan = compare ? 13 : 11;

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
        <PeriodPicker period={period} onChange={setPeriod} />
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            style={{ accentColor: '#7a9b7f' }}
          />
          Vorjahr vergleichen
        </label>
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
        <PanelError error={error} onRetry={() => { employeesQ.refetch(); entriesQ.refetch(); prevEntriesQ.refetch(); templatesQ.refetch(); holidaysQ.refetch(); }} />
      )}
      {!error && isLoading && <PanelLoader />}

      {!error && !isLoading && sollUnavailable && (
        <div className="mb-4 text-xs rounded border px-3 py-2" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
          Zentral-Sollzeit-Plan noch nicht eingerichtet (Migration ausstehend) – Soll zeigt vorübergehend 0h.
        </div>
      )}

      {!error && !isLoading && (
        <div className="space-y-4">
          {/* KPI-Zeile */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Total Stunden" value={`${fmt.hours(totals.hours.total)} h`}
              hint={`Soll: ${fmt.hours(totals.soll)} h`} icon={Clock} color="#4d6a50"
              vj={vjOf(totals.hours.total, prevTotals.hours.total)} />
            <Kpi label="Effektiv" value={`${fmt.hours(totals.hours.effektiv)} h`}
              hint="verrechenbar" icon={TrendingUp} color={CAT.effektiv.color}
              vj={vjOf(totals.hours.effektiv, prevTotals.hours.effektiv)} />
            <Kpi label="Pauschal" value={`${fmt.hours(totals.hours.pauschal)} h`}
              hint="rapportiert" icon={Clock} color={CAT.pauschal.color}
              vj={vjOf(totals.hours.pauschal, prevTotals.hours.pauschal)} />
            <Kpi label="Intern" value={`${fmt.hours(totals.hours.intern)} h`}
              hint="ohne Verrechnung" icon={Users} color={CAT.intern.color}
              vj={vjOf(totals.hours.intern, prevTotals.hours.intern)} />
            <Kpi label="Umsatz effektiv" value={fmt.chf(totals.value.effektiv)}
              hint="CHF, bewertet" icon={Banknote} color={CAT.effektiv.color}
              vj={vjOf(totals.value.effektiv, prevTotals.value.effektiv, true)} />
            <Kpi label="Umsatz pauschal" value={fmt.chf(totals.value.pauschal)}
              hint="CHF, bewertet" icon={Banknote} color={CAT.pauschal.color}
              vj={vjOf(totals.value.pauschal, prevTotals.value.pauschal, true)} />
          </div>

          {/* Grafik: Stunden pro Mitarbeiter (Periode) */}
          <Card className="p-4">
            <div className="text-sm font-semibold mb-3" style={{ color: '#2d3a2d' }}>
              Stunden pro Mitarbeiter · {range.label}
            </div>
            {chartByEmp.length === 0 ? (
              <div className="text-xs text-zinc-400 py-8 text-center">Keine Stunden im gewählten Zeitraum.</div>
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

          {/* Tabelle: Periodenwerte pro MA */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="px-3 py-2 font-semibold">Mitarbeiter</th>
                    <th className="px-3 py-2 font-semibold text-right">Soll</th>
                    <th className="px-3 py-2 font-semibold text-right">Total</th>
                    {compare && <th className="px-3 py-2 font-semibold text-right" style={{ color: VJ_COLOR }}>VJ Total</th>}
                    {compare && <th className="px-3 py-2 font-semibold text-right" style={{ color: VJ_COLOR }}>Δ VJ</th>}
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
                    <tr><td colSpan={colSpan} className="px-3 py-4 text-zinc-400 text-xs">Keine Daten im gewählten Zeitraum.</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const erf = r.soll > 0 ? (r.sums.hours.total / r.soll) * 100 : null;
                    const prevTotal = r.prev?.hours.total || 0;
                    return (
                      <tr key={r.emp.id} className="border-b last:border-b-0"
                        style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}>
                        <td className="px-3 py-2 font-medium">
                          {r.emp.full_name}
                          {!r.emp.active && <Chip tone="neutral" className="ml-2">inaktiv</Chip>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.hours(r.soll)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt.hours(r.sums.hours.total)}</td>
                        {compare && (
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: VJ_COLOR }}>{fmt.hours(prevTotal)}</td>
                        )}
                        {compare && (
                          <td className="px-3 py-2 text-right">
                            <DeltaChip pct={deltaPct(r.sums.hours.total, prevTotal)} />
                          </td>
                        )}
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
                      {compare && (
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: VJ_COLOR }}>{fmt.hours(prevTotals.hours.total)}</td>
                      )}
                      {compare && (
                        <td className="px-3 py-2 text-right">
                          <DeltaChip pct={deltaPct(totals.hours.total, prevTotals.hours.total)} />
                        </td>
                      )}
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
                Jahresverlauf {period.year}{compare ? ` vs ${period.year - 1}` : ''}
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
              <ComposedChart data={chartByMonth} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={{ stroke: '#d9e0d9' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={false} />
                <Tooltip content={<HoursTooltip />} cursor={{ fill: 'rgba(122,155,127,0.07)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CAT_KEYS.map(k => (
                  <Bar key={k} dataKey={k} stackId="h" name={CAT[k].label} fill={CAT[k].color}
                    radius={k === 'uebrig' ? [3, 3, 0, 0] : 0} maxBarSize={40} />
                ))}
                {compare && (
                  <Line type="monotone" dataKey="vjTotal" name={`Total ${period.year - 1}`}
                    stroke={VJ_COLOR} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2.5 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
