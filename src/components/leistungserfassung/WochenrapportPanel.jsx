// Leistungserfassung · Wochenrapport
// Eine Woche (Mo–So) im Überblick. Zeilen = Projekt+Leistungsart, Spalten = Tage.
// Zellen = Stundensumme (mit Tooltip aller Einträge). Unten: Tages-Summe.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, CalendarDays, Download, User,
} from 'lucide-react';
import {
  leTimeEntry, leProject, leServiceType, leEmployee, currentEmployee,
} from '@/lib/leApi';
import {
  Card, Chip, Select, PanelLoader, PanelError, PanelHeader, IconBtn,
  artisBtn, artisGhostStyle, fmt,
} from './shared';

// --- Date Helpers ----------------------------------------------------------

const getMonday = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const out = new Date(d.setDate(diff));
  out.setHours(0, 0, 0, 0);
  return out;
};

const isoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const kw = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const formatDayHeader = (date) => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
};

const formatRangeLabel = (monday) => {
  const sunday = addDays(monday, 6);
  const fmtShort = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return `${fmtShort(monday)} – ${fmtShort(sunday)}`;
};

// --- CSV Export ------------------------------------------------------------

function downloadCsv(filename, rows) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Panel -----------------------------------------------------------------

export default function WochenrapportPanel() {
  const [monday, setMonday] = useState(() => getMonday(new Date()));
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);
  const [tooltip, setTooltip] = useState(null); // { rowIdx, dayIdx, entries }

  // Aktuellen MA initial auflösen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emp = await currentEmployee();
        if (!cancelled) {
          if (emp?.id) setCurrentEmployeeId(emp.id);
          setEmployeeResolved(true);
        }
      } catch {
        if (!cancelled) setEmployeeResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tooltip schliessen bei Click ausserhalb
  useEffect(() => {
    if (!tooltip) return;
    const handler = (e) => {
      if (!e.target.closest('[data-week-cell]') && !e.target.closest('[data-week-tooltip]')) {
        setTooltip(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [tooltip]);

  const fromIso = isoDate(monday);
  const toIso = isoDate(addDays(monday, 6));

  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: () => leEmployee.list() });
  const projectsQ = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const serviceTypesQ = useQuery({ queryKey: ['le', 'service_type'], queryFn: () => leServiceType.list() });

  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', 'week', fromIso, toIso, currentEmployeeId],
    queryFn: () => leTimeEntry.listForRange(fromIso, toIso, { employeeId: currentEmployeeId }),
    enabled: !!currentEmployeeId,
  });

  const employees = employeesQ.data ?? [];
  const entries = entriesQ.data ?? [];

  const anyError = employeesQ.error || entriesQ.error || projectsQ.error || serviceTypesQ.error;
  const loading = employeesQ.isLoading || (currentEmployeeId && entriesQ.isLoading);

  // --- Matrix bauen ----------------------------------------------------
  const matrix = useMemo(() => {
    const rows = new Map();
    for (const e of entries) {
      const key = `${e.project_id}|${e.service_type_id}`;
      if (!rows.has(key)) {
        rows.set(key, {
          project: e.project,
          serviceType: e.service_type,
          days: Array(7).fill(0),
          entries: Array(7).fill(null).map(() => []),
          total: 0,
        });
      }
      const d = new Date(e.entry_date + 'T00:00:00');
      const dayIdx = (d.getDay() + 6) % 7; // Mo=0..So=6
      if (dayIdx < 0 || dayIdx > 6) continue;
      const row = rows.get(key);
      const h = Number(e.hours_internal || 0);
      row.days[dayIdx] += h;
      row.total += h;
      row.entries[dayIdx].push(e);
    }
    return [...rows.values()].sort((a, b) => {
      const an = (a.project?.name ?? '') + (a.serviceType?.name ?? '');
      const bn = (b.project?.name ?? '') + (b.serviceType?.name ?? '');
      return an.localeCompare(bn, 'de');
    });
  }, [entries]);

  // --- Spalten-Summen / KPIs -------------------------------------------
  const daySums = useMemo(() => {
    const sums = Array(7).fill(0);
    for (const row of matrix) {
      for (let i = 0; i < 7; i++) sums[i] += row.days[i];
    }
    return sums;
  }, [matrix]);

  const weekTotal = daySums.reduce((a, b) => a + b, 0);

  const kpis = useMemo(() => {
    let hours = 0; let billableHours = 0; let chf = 0;
    for (const e of entries) {
      const h = Number(e.hours_internal || 0);
      hours += h;
      const billable = e.service_type?.billable !== false;
      if (billable) {
        billableHours += h;
        chf += h * Number(e.rate_snapshot ?? 0);
      }
    }
    return { hours, billableHours, chf };
  }, [entries]);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  // --- CSV-Export ------------------------------------------------------
  const handleExport = () => {
    const header = ['Projekt', 'Leistungsart', ...DAY_LABELS, 'Total'];
    const body = matrix.map((row) => [
      row.project?.name ?? '',
      row.serviceType?.name ?? '',
      ...row.days.map((v) => (v ? v.toFixed(2).replace('.', ',') : '0')),
      row.total.toFixed(2).replace('.', ','),
    ]);
    const totals = ['Summe', '', ...daySums.map((v) => v.toFixed(2).replace('.', ',')), weekTotal.toFixed(2).replace('.', ',')];
    const empShort = employees.find((e) => e.id === currentEmployeeId)?.short_code ?? 'MA';
    downloadCsv(`Wochenrapport-${empShort}-KW${kw(monday)}-${monday.getFullYear()}.csv`, [header, ...body, totals]);
  };

  const weekNumber = kw(monday);
  const year = monday.getFullYear();

  if (!employeeResolved) return <PanelLoader />;
  if (anyError) {
    return <PanelError error={anyError} onRetry={() => { employeesQ.refetch(); entriesQ.refetch(); projectsQ.refetch(); serviceTypesQ.refetch(); }} />;
  }

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Wochenrapport"
        subtitle={formatRangeLabel(monday)}
        right={
          <>
            <User className="w-4 h-4 text-zinc-400" />
            <Select
              value={currentEmployeeId ?? ''}
              onChange={(e) => setCurrentEmployeeId(e.target.value || null)}
              style={{ minWidth: 220 }}
            >
              <option value="">MA auswählen…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.short_code} – {emp.full_name}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {/* Toolbar: Wochen-Navigation + Export */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <IconBtn onClick={() => setMonday(addDays(monday, -7))} title="Vorwoche">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <div className="flex items-center gap-2 px-2 text-sm font-medium text-zinc-700">
            <CalendarDays className="w-4 h-4 text-zinc-400" />
            KW {String(weekNumber).padStart(2, '0')} · {year}
          </div>
          <IconBtn onClick={() => setMonday(addDays(monday, 7))} title="Nächste Woche">
            <ChevronRight className="w-4 h-4" />
          </IconBtn>
          <button
            type="button"
            className={artisBtn.ghost}
            style={artisGhostStyle}
            onClick={() => setMonday(getMonday(new Date()))}
          >
            Diese Woche
          </button>
          <div className="ml-auto">
            <button
              type="button"
              className={artisBtn.ghost}
              style={artisGhostStyle}
              onClick={handleExport}
              disabled={matrix.length === 0}
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>
      </Card>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Erfasste Std." value={fmt.hours(kpis.hours)} />
        <KpiCard label="Davon abrechenbar" value={fmt.hours(kpis.billableHours)} />
        <KpiCard label="CHF billable" value={fmt.chf(kpis.chf)} accent />
      </div>

      {/* Haupt-Tabelle */}
      <Card className="overflow-visible">
        <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider text-zinc-500" style={{ borderColor: '#e4e7e4' }}>
          Wochenmatrix
        </div>
        {loading ? (
          <PanelLoader />
        ) : !currentEmployeeId ? (
          <div className="p-6 text-sm text-zinc-400 text-center">
            Bitte zuerst einen Mitarbeiter auswählen.
          </div>
        ) : matrix.length === 0 ? (
          <div className="p-6 text-sm text-zinc-400 text-center">
            Keine Einträge in dieser Woche.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="text-left font-semibold px-3 py-2">Projekt</th>
                  <th className="text-left font-semibold px-3 py-2">Leistungsart</th>
                  {weekDates.map((d, i) => {
                    const isWeekend = i >= 5;
                    return (
                      <th
                        key={i}
                        className="text-right font-semibold px-3 py-2 w-16"
                        style={{ background: isWeekend ? '#fafbf9' : undefined }}
                      >
                        <div>{DAY_LABELS[i]}</div>
                        <div className="text-[9px] font-normal text-zinc-400 tabular-nums">{formatDayHeader(d)}</div>
                      </th>
                    );
                  })}
                  <th className="text-right font-semibold px-3 py-2 w-20" style={{ background: '#f5faf5', color: '#2d5a2d' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                    <td className="px-3 py-2 font-medium text-zinc-700">{row.project?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-600">{row.serviceType?.name ?? '—'}</td>
                    {row.days.map((hours, dayIdx) => {
                      const isWeekend = dayIdx >= 5;
                      const hasValue = hours > 0;
                      const hasEntries = row.entries[dayIdx].length > 0;
                      const active = tooltip && tooltip.rowIdx === rowIdx && tooltip.dayIdx === dayIdx;
                      return (
                        <td
                          key={dayIdx}
                          data-week-cell
                          className="px-3 py-2 text-right tabular-nums relative"
                          style={{
                            background: active ? '#e6ede6' : (isWeekend ? '#fafbf9' : undefined),
                            cursor: hasEntries ? 'pointer' : 'default',
                            color: hasValue ? '#222' : '#cbd2cb',
                          }}
                          onClick={() => {
                            if (!hasEntries) return;
                            if (active) { setTooltip(null); return; }
                            setTooltip({ rowIdx, dayIdx, entries: row.entries[dayIdx] });
                          }}
                        >
                          {hasValue ? fmt.hours(hours) : '—'}
                          {active && (
                            <CellTooltip entries={row.entries[dayIdx]} onClose={() => setTooltip(null)} />
                          )}
                        </td>
                      );
                    })}
                    <td
                      className="px-3 py-2 text-right tabular-nums font-semibold"
                      style={{ background: '#f5faf5', color: '#2d5a2d' }}
                    >
                      {fmt.hours(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2" style={{ borderColor: '#d9dfd9', background: '#f5faf5' }}>
                  <td className="px-3 py-2 font-semibold text-zinc-700" colSpan={2}>
                    Summe pro Tag
                  </td>
                  {daySums.map((v, i) => {
                    const isWeekend = i >= 5;
                    return (
                      <td
                        key={i}
                        className="px-3 py-2 text-right tabular-nums font-semibold"
                        style={{ background: isWeekend ? '#eef3ee' : undefined }}
                      >
                        {v > 0 ? fmt.hours(v) : '—'}
                      </td>
                    );
                  })}
                  <td
                    className="px-3 py-2 text-right tabular-nums font-bold"
                    style={{ background: '#e6ede6', color: '#2d5a2d' }}
                  >
                    {fmt.hours(weekTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- KPI-Kachel ------------------------------------------------------------

function KpiCard({ label, value, accent }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">{label}</div>
      <div
        className="text-xl font-semibold tabular-nums mt-1"
        style={{ color: accent ? '#2d5a2d' : '#222' }}
      >
        {value}
      </div>
    </Card>
  );
}

// --- Zell-Tooltip (Einträge am Tag) ---------------------------------------

function CellTooltip({ entries, onClose }) {
  return (
    <div
      data-week-tooltip
      className="absolute z-20 right-0 top-full mt-1 w-72 rounded-lg border shadow-lg p-2 text-left"
      style={{ borderColor: '#d9dfd9', background: '#fff' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
          {entries.length} Eintrag{entries.length !== 1 ? 'e' : ''}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600 text-xs"
          title="Schliessen"
        >
          ×
        </button>
      </div>
      <ul className="space-y-1.5 max-h-60 overflow-y-auto">
        {entries.map((e) => {
          const zeit = e.time_from && e.time_to
            ? `${String(e.time_from).slice(0, 5)}–${String(e.time_to).slice(0, 5)}`
            : null;
          return (
            <li key={e.id} className="text-xs border-b last:border-b-0 pb-1.5 last:pb-0" style={{ borderColor: '#eef1ee' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500 tabular-nums">{zeit ?? '—'}</span>
                <Chip tone="green">{fmt.hours(e.hours_internal)} h</Chip>
              </div>
              <div className="text-zinc-700 mt-0.5">
                {e.description || <span className="text-zinc-300">(ohne Beschreibung)</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
