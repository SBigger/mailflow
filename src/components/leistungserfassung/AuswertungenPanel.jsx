// Leistungserfassung · Auswertungen
// Drei Sub-Tabs: Mitarbeiter-Rapport, Projekt-Rentabilität, Budget-Warnungen.
// Top-Filter (Zeitraum-Selector) wird von allen Sub-Tabs geteilt.

import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  BarChart3, Users, FolderKanban, AlertTriangle, Download,
  Calendar, Filter, TrendingUp, TrendingDown,
} from 'lucide-react';
import {
  leTimeEntry, leEmployee, leProject, leSollzeitProfile, leExpense,
} from '@/lib/leApi';
import {
  Card, Chip, Select, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle,
} from './shared';

// ===========================================================================
// Date / Range Helpers
// ===========================================================================

const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfQuarter = (d = new Date()) => {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
};
const endOfQuarter = (d = new Date()) => {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
};
const startOfYear = (d = new Date()) => new Date(d.getFullYear(), 0, 1);

// Liefert {fromIso, toIso} basierend auf Preset
function rangeForPreset(preset, custom) {
  const today = new Date();
  switch (preset) {
    case 'month':   return { fromIso: toIso(startOfMonth(today)),   toIso: toIso(endOfMonth(today)) };
    case 'quarter': return { fromIso: toIso(startOfQuarter(today)), toIso: toIso(endOfQuarter(today)) };
    case 'ytd':     return { fromIso: toIso(startOfYear(today)),    toIso: toIso(today) };
    case 'custom':  return { fromIso: custom?.from || toIso(startOfMonth(today)), toIso: custom?.to || toIso(today) };
    default:        return { fromIso: toIso(startOfMonth(today)), toIso: toIso(endOfMonth(today)) };
  }
}

// ===========================================================================
// CSV Export
// ===========================================================================

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
  // UTF-8 BOM für Excel-CH
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

// ===========================================================================
// Soll-Stunden Berechnung (vereinfacht – ohne Feiertage)
// ===========================================================================

// Wählt das passende Sollzeit-Profil eines Mitarbeiters für ein gegebenes Datum
const pickProfile = (profiles, dateIso) => {
  const sorted = [...profiles].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return sorted.find(p =>
    p.valid_from <= dateIso && (!p.valid_to || p.valid_to >= dateIso)
  ) || sorted[0] || null;
};

// Aggregiert Soll-Stunden über den Range. Wenn mehrere Profile pro MA bestehen,
// wird je Tag das passende Profil eingesetzt. (Vereinfacht – ohne Feiertage.)
const calcSollHours = (profiles, fromIso, toIsoStr) => {
  if (!profiles?.length) return 0;
  let total = 0;
  const d = new Date(fromIso + 'T00:00:00');
  const end = new Date(toIsoStr + 'T00:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const prof = pickProfile(profiles, iso);
    if (prof) {
      const day = d.getDay(); // 0=So..6=Sa
      const hoursMap = ['hours_so', 'hours_mo', 'hours_di', 'hours_mi', 'hours_do', 'hours_fr', 'hours_sa'];
      total += Number(prof[hoursMap[day]] || 0);
    }
    d.setDate(d.getDate() + 1);
  }
  return total;
};

// ===========================================================================
// Style-Helpers
// ===========================================================================

const ARTIS_GREEN  = '#7a9b7f';
const ARTIS_ORANGE = '#d4a056';
const ARTIS_RED    = '#c34141';

// Farbe für Verbrauchs-Progressbar
const usageColor = (pct) => {
  if (pct < 50) return ARTIS_GREEN;
  if (pct <= 80) return ARTIS_ORANGE;
  return ARTIS_RED;
};

// Marge-Ampel-Tone
const marginTone = (pct) => {
  if (pct == null || isNaN(pct)) return 'neutral';
  if (pct < 0)  return 'red';
  if (pct < 10) return 'red';
  if (pct < 30) return 'orange';
  return 'green';
};

// ===========================================================================
// UI: Toolbar (Zeitraum)
// ===========================================================================

function RangeToolbar({ preset, setPreset, custom, setCustom, onExport }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-lg border" style={{ borderColor: '#e4e7e4', background: '#fafaf8' }}>
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 uppercase tracking-wider font-semibold">
        <Filter className="w-3.5 h-3.5" /> Zeitraum
      </div>
      <Select
        value={preset}
        onChange={(e) => setPreset(e.target.value)}
        style={{ width: 160 }}
      >
        <option value="month">Aktueller Monat</option>
        <option value="quarter">Aktuelles Quartal</option>
        <option value="ytd">Year-to-Date</option>
        <option value="custom">Benutzerdefiniert</option>
      </Select>
      {preset === 'custom' && (
        <>
          <label className="text-xs">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Von</span>
            <input
              type="date"
              value={custom.from}
              onChange={(e) => setCustom(c => ({ ...c, from: e.target.value }))}
              className="border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </label>
          <label className="text-xs">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Bis</span>
            <input
              type="date"
              value={custom.to}
              onChange={(e) => setCustom(c => ({ ...c, to: e.target.value }))}
              className="border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </label>
        </>
      )}
      <div className="ml-auto">
        <button
          type="button"
          onClick={onExport}
          className={artisBtn.ghost}
          style={artisGhostStyle}
        >
          <Download className="w-3.5 h-3.5" />
          CSV-Export
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// UI: KPI-Kachel
// ===========================================================================

function KpiCard({ icon: Icon, label, value, hint, accent = ARTIS_GREEN }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: '#2d3a2d' }}>{value}</div>
      {hint && <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>}
    </Card>
  );
}

// ===========================================================================
// UI: Progressbar
// ===========================================================================

function Progressbar({ pct, height = 6 }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const overflow = pct > 100;
  return (
    <div className="w-full rounded-full bg-zinc-100 overflow-hidden" style={{ height }}>
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${clamped}%`,
          background: overflow ? ARTIS_RED : usageColor(pct),
        }}
      />
    </div>
  );
}

// ===========================================================================
// Sub-Tab 1: Mitarbeiter-Rapport
// ===========================================================================

function MitarbeiterRapport({ range, onExportRef, employees, entries }) {
  // Sollzeit-Profile parallel laden – einmal pro MA
  const profileQueries = useQueries({
    queries: (employees ?? []).map(emp => ({
      queryKey: ['le', 'sollzeit', emp.id],
      queryFn: () => leSollzeitProfile.listForEmployee(emp.id),
      staleTime: 5 * 60_000,
    })),
  });

  const profilesById = useMemo(() => {
    const map = new Map();
    (employees ?? []).forEach((emp, idx) => {
      map.set(emp.id, profileQueries[idx]?.data ?? []);
    });
    return map;
  }, [employees, profileQueries]);

  // Aggregation: pro MA Ist-Std, Billable-Std, Erlös
  const rows = useMemo(() => {
    if (!employees) return [];
    const byEmp = new Map();
    for (const emp of employees) {
      byEmp.set(emp.id, {
        emp,
        ist: 0,
        billable: 0,
        erloes: 0,
        soll: calcSollHours(profilesById.get(emp.id) || [], range.fromIso, range.toIso),
      });
    }
    for (const e of entries ?? []) {
      const row = byEmp.get(e.employee_id);
      if (!row) continue;
      const h = Number(e.hours_internal || 0);
      row.ist += h;
      const isBillable = e.service_type?.billable !== false;
      if (isBillable) {
        row.billable += h;
        row.erloes += h * Number(e.rate_snapshot || 0);
      }
    }
    return [...byEmp.values()]
      .filter(r => r.emp.active || r.ist > 0)
      .sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name));
  }, [employees, entries, profilesById, range.fromIso, range.toIso]);

  // KPIs
  const totals = useMemo(() => {
    const totalIst = rows.reduce((s, r) => s + r.ist, 0);
    const totalSoll = rows.reduce((s, r) => s + r.soll, 0);
    const totalBillable = rows.reduce((s, r) => s + r.billable, 0);
    const totalErloes = rows.reduce((s, r) => s + r.erloes, 0);
    return {
      totalIst,
      totalSoll,
      erfassungPct: totalSoll > 0 ? (totalIst / totalSoll) * 100 : 0,
      billablePct: totalIst > 0 ? (totalBillable / totalIst) * 100 : 0,
      avgRate: totalBillable > 0 ? totalErloes / totalBillable : 0,
    };
  }, [rows]);

  // CSV-Export bei Bedarf nach oben reichen
  React.useEffect(() => {
    onExportRef.current = () => {
      const header = ['Mitarbeiter', 'Soll-Std', 'Ist-Std', 'Erfassung %', 'Billable Std', 'Billable %', 'Realisiert CHF', 'Ø CHF/h'];
      const data = rows.map(r => {
        const erfPct = r.soll > 0 ? (r.ist / r.soll) * 100 : 0;
        const billPct = r.ist > 0 ? (r.billable / r.ist) * 100 : 0;
        const avg = r.billable > 0 ? r.erloes / r.billable : 0;
        return [
          r.emp.full_name,
          r.soll.toFixed(2),
          r.ist.toFixed(2),
          erfPct.toFixed(1),
          r.billable.toFixed(2),
          billPct.toFixed(1),
          r.erloes.toFixed(2),
          avg.toFixed(2),
        ];
      });
      downloadCsv(`mitarbeiter-rapport_${range.fromIso}_${range.toIso}.csv`, [header, ...data]);
    };
  }, [rows, range, onExportRef]);

  const profilesLoading = profileQueries.some(q => q.isLoading);

  return (
    <div className="space-y-4">
      {/* KPI-Kacheln */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Calendar}
          label="Total erfasst"
          value={`${fmt.hours(totals.totalIst)} h`}
          hint={`Soll: ${fmt.hours(totals.totalSoll)} h`}
        />
        <KpiCard
          icon={BarChart3}
          label="Erfassungsquote"
          value={`${totals.erfassungPct.toFixed(1)} %`}
          hint="Ist / Soll"
          accent={totals.erfassungPct < 90 ? ARTIS_ORANGE : ARTIS_GREEN}
        />
        <KpiCard
          icon={TrendingUp}
          label="Billable-Quote"
          value={`${totals.billablePct.toFixed(1)} %`}
          hint="Verrechenbare Std / Ist"
          accent={totals.billablePct < 60 ? ARTIS_ORANGE : ARTIS_GREEN}
        />
        <KpiCard
          icon={BarChart3}
          label="Ø CHF/h"
          value={fmt.chf(totals.avgRate)}
          hint="Erlös / Billable Std"
        />
      </div>

      {/* Tabelle */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <th className="px-3 py-2 font-semibold">Mitarbeiter</th>
                <th className="px-3 py-2 font-semibold text-right">Soll-Std</th>
                <th className="px-3 py-2 font-semibold text-right">Ist-Std</th>
                <th className="px-3 py-2 font-semibold text-right">Erfassung %</th>
                <th className="px-3 py-2 font-semibold text-right">Billable Std</th>
                <th className="px-3 py-2 font-semibold text-right">Billable %</th>
                <th className="px-3 py-2 font-semibold text-right">Realisiert CHF</th>
                <th className="px-3 py-2 font-semibold text-right">Ø CHF/h</th>
              </tr>
            </thead>
            <tbody>
              {profilesLoading && (
                <tr><td colSpan={8} className="px-3 py-4 text-zinc-400 text-xs">Lade Sollzeit-Profile…</td></tr>
              )}
              {rows.length === 0 && !profilesLoading && (
                <tr><td colSpan={8} className="px-3 py-4 text-zinc-400 text-xs">Keine Daten im gewählten Zeitraum.</td></tr>
              )}
              {rows.map((r, i) => {
                const erfPct = r.soll > 0 ? (r.ist / r.soll) * 100 : 0;
                const billPct = r.ist > 0 ? (r.billable / r.ist) * 100 : 0;
                const avg = r.billable > 0 ? r.erloes / r.billable : 0;
                return (
                  <tr
                    key={r.emp.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}
                  >
                    <td className="px-3 py-2 font-medium">
                      {r.emp.full_name}
                      {!r.emp.active && <Chip tone="neutral" className="ml-2">inaktiv</Chip>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.soll)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.ist)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Chip tone={erfPct < 80 ? 'orange' : erfPct < 95 ? 'neutral' : 'green'}>
                        {erfPct.toFixed(1)} %
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.billable)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Chip tone={billPct < 50 ? 'orange' : billPct < 70 ? 'neutral' : 'green'}>
                        {billPct.toFixed(1)} %
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(r.erloes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// Sub-Tab 2: Projekt-Rentabilität
// ===========================================================================

function ProjektRentabilitaet({ range, onExportRef, projects, employees, entries }) {
  const [sortKey, setSortKey] = useState('marge');
  const [sortDir, setSortDir] = useState('desc');

  // Lookup für Kostensatz pro MA
  const costRateById = useMemo(() => {
    const map = new Map();
    (employees ?? []).forEach(e => map.set(e.id, e.cost_rate != null ? Number(e.cost_rate) : null));
    return map;
  }, [employees]);

  const rows = useMemo(() => {
    if (!projects) return [];
    const byProj = new Map();
    for (const p of projects) {
      byProj.set(p.id, {
        proj: p,
        hours: 0,
        aufwand: 0,   // interne Kosten
        erloes: 0,    // verrechnet
        wip: 0,       // erfasst/freigegeben (offen)
      });
    }
    for (const e of entries ?? []) {
      const row = byProj.get(e.project_id);
      if (!row) continue;
      const h = Number(e.hours_internal || 0);
      const rate = Number(e.rate_snapshot || 0);
      const cost = costRateById.get(e.employee_id);
      // Aufwand: Kostensatz; Fallback rate_snapshot wenn cost_rate null
      const costRate = cost != null ? cost : rate;
      row.hours += h;
      row.aufwand += h * costRate;
      if (e.status === 'verrechnet') {
        row.erloes += h * rate;
      } else if (e.status === 'erfasst' || e.status === 'freigegeben') {
        row.wip += h * rate;
      }
    }
    const list = [...byProj.values()].filter(r => r.hours > 0);
    return list;
  }, [projects, entries, costRateById]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  // CSV
  React.useEffect(() => {
    onExportRef.current = () => {
      const header = ['Projekt', 'Kunde', 'Aufwand-Std', 'Aufwand CHF', 'Erlös CHF', 'WIP CHF', 'Budget CHF', 'Verbraucht %', 'Marge %'];
      const data = sorted.map(r => {
        const m = computeMargin(r);
        const verbraucht = r.proj.budget_amount ? (r.aufwand / Number(r.proj.budget_amount)) * 100 : null;
        return [
          r.proj.name,
          r.proj.customer?.company_name || '',
          r.hours.toFixed(2),
          r.aufwand.toFixed(2),
          r.erloes.toFixed(2),
          r.wip.toFixed(2),
          r.proj.budget_amount ?? '',
          verbraucht != null ? verbraucht.toFixed(1) : '',
          m != null ? m.toFixed(1) : '',
        ];
      });
      downloadCsv(`projekt-rentabilitaet_${range.fromIso}_${range.toIso}.csv`, [header, ...data]);
    };
  }, [sorted, range, onExportRef]);

  const handleSort = (key) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const Th = ({ k, children, right }) => (
    <th
      className={`px-3 py-2 font-semibold cursor-pointer select-none hover:text-zinc-700 ${right ? 'text-right' : ''}`}
      onClick={() => handleSort(k)}
    >
      {children}
      {sortKey === k && <span className="ml-1 text-zinc-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <Th k="name">Projekt</Th>
                <Th k="customer">Kunde</Th>
                <Th k="hours" right>Aufwand-Std</Th>
                <Th k="erloes" right>Erlös CHF</Th>
                <Th k="wip" right>WIP CHF</Th>
                <Th k="budget" right>Budget CHF</Th>
                <Th k="verbraucht" right>Verbraucht %</Th>
                <Th k="marge" right>Marge %</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-zinc-400 text-xs">Keine Aufwände im Zeitraum.</td></tr>
              )}
              {sorted.map((r, i) => {
                const margin = computeMargin(r);
                const verbraucht = r.proj.budget_amount ? (r.aufwand / Number(r.proj.budget_amount)) * 100 : null;
                const tone = marginTone(margin);
                return (
                  <tr
                    key={r.proj.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}
                  >
                    <td className="px-3 py-2 font-medium">{r.proj.name}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.proj.customer?.company_name || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(r.erloes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(r.wip)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.proj.budget_amount ? fmt.chf(r.proj.budget_amount) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {verbraucht != null ? `${verbraucht.toFixed(1)} %` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {margin != null
                        ? <Chip tone={tone} className={margin < 0 ? 'font-bold' : ''}>
                            {margin.toFixed(1)} %
                          </Chip>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Marge: (Erlös - Aufwand) / Erlös × 100
function computeMargin(r) {
  if (!r.erloes || r.erloes === 0) return null;
  return ((r.erloes - r.aufwand) / r.erloes) * 100;
}

function sortValue(r, key) {
  switch (key) {
    case 'name':       return r.proj.name?.toLowerCase() || '';
    case 'customer':   return r.proj.customer?.company_name?.toLowerCase() || '';
    case 'hours':      return r.hours;
    case 'erloes':     return r.erloes;
    case 'wip':        return r.wip;
    case 'budget':     return r.proj.budget_amount != null ? Number(r.proj.budget_amount) : null;
    case 'verbraucht': return r.proj.budget_amount ? (r.aufwand / Number(r.proj.budget_amount)) * 100 : null;
    case 'marge':      return computeMargin(r);
    default:           return 0;
  }
}

// ===========================================================================
// Sub-Tab 3: Budget-Warnungen
// ===========================================================================

function BudgetWarnungen({ range, onExportRef, projects, employees, entries }) {
  const [threshold, setThreshold] = useState(80);

  // Aufwand pro Projekt aggregieren (Std-basiert für Budget_hours)
  const rows = useMemo(() => {
    if (!projects) return [];
    const byProj = new Map();
    for (const p of projects) {
      if (p.budget_hours == null) continue; // nur Projekte mit gesetztem Budget
      byProj.set(p.id, {
        proj: p,
        hours: 0,
        weeks: new Map(),  // ISO-Wochenkey → Stunden (für Trend)
      });
    }
    // Trend: Stunden je Woche der LETZTEN 4 Wochen ab heute
    const todayD = new Date();
    const fourWeeksAgo = new Date(todayD);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fourWeeksAgoIso = toIso(fourWeeksAgo);

    for (const e of entries ?? []) {
      const row = byProj.get(e.project_id);
      if (!row) continue;
      const h = Number(e.hours_internal || 0);
      row.hours += h;
      // Trend nur für jüngste 4 Wochen
      if (e.entry_date >= fourWeeksAgoIso) {
        const weekKey = isoWeekKey(e.entry_date);
        row.weeks.set(weekKey, (row.weeks.get(weekKey) || 0) + h);
      }
    }
    const empById = new Map((employees ?? []).map(e => [e.id, e]));

    return [...byProj.values()].map(r => {
      const budget = Number(r.proj.budget_hours);
      const verbraucht = r.hours;
      const verbrauchtPct = budget > 0 ? (verbraucht / budget) * 100 : 0;
      const restbudget = budget - verbraucht;
      // Trend: Mittelwert h/Woche über letzte 4 Wo
      const sumWeeks = [...r.weeks.values()].reduce((s, n) => s + n, 0);
      const trendPerWeek = sumWeeks / 4;
      // ETA: wann ist Budget aufgebraucht? Annahme: Trend hält an
      let eta = null;
      if (trendPerWeek > 0 && restbudget > 0) {
        const weeksLeft = restbudget / trendPerWeek;
        const etaDate = new Date();
        etaDate.setDate(etaDate.getDate() + Math.round(weeksLeft * 7));
        eta = toIso(etaDate);
      } else if (restbudget <= 0) {
        eta = 'überzogen';
      }
      return {
        ...r,
        budget,
        verbraucht,
        verbrauchtPct,
        restbudget,
        trendPerWeek,
        eta,
        responsible: empById.get(r.proj.responsible_employee_id) || r.proj.responsible || null,
      };
    });
  }, [projects, entries, employees]);

  const filtered = useMemo(() => {
    return rows
      .filter(r => r.verbrauchtPct >= threshold)
      .sort((a, b) => b.verbrauchtPct - a.verbrauchtPct);
  }, [rows, threshold]);

  React.useEffect(() => {
    onExportRef.current = () => {
      const header = ['Projekt', 'Kunde', 'Budget Std', 'Verbraucht Std', 'Verbraucht %', 'Restbudget Std', 'Trend h/Woche', 'ETA Budget-Ende', 'Verantwortlicher MA'];
      const data = filtered.map(r => [
        r.proj.name,
        r.proj.customer?.company_name || '',
        r.budget.toFixed(2),
        r.verbraucht.toFixed(2),
        r.verbrauchtPct.toFixed(1),
        r.restbudget.toFixed(2),
        r.trendPerWeek.toFixed(2),
        r.eta || '',
        r.responsible?.full_name || r.responsible?.short_code || '',
      ]);
      downloadCsv(`budget-warnungen_${range.fromIso}_${range.toIso}.csv`, [header, ...data]);
    };
  }, [filtered, range, onExportRef]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Card className="p-4 flex-1 min-w-[260px]">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: ARTIS_RED }} /> Über-Budget Projekte
          </div>
          <div className="mt-2 text-2xl font-semibold" style={{ color: ARTIS_RED }}>
            {filtered.length}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            Projekte mit ≥ {threshold}% Budgetverbrauch
          </div>
        </Card>
        <Card className="p-4 flex-1 min-w-[260px]">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
            <Filter className="w-3.5 h-3.5" /> Schwellwert
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={50}
              max={120}
              step={5}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: ARTIS_GREEN }}
            />
            <span className="text-lg font-semibold tabular-nums" style={{ color: '#2d3a2d', minWidth: 56 }}>
              {threshold} %
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <th className="px-3 py-2 font-semibold">Projekt</th>
                <th className="px-3 py-2 font-semibold">Kunde</th>
                <th className="px-3 py-2 font-semibold text-right">Budget Std</th>
                <th className="px-3 py-2 font-semibold text-right">Verbraucht Std</th>
                <th className="px-3 py-2 font-semibold">Verbraucht %</th>
                <th className="px-3 py-2 font-semibold text-right">Rest Std</th>
                <th className="px-3 py-2 font-semibold text-right">Trend h/Wo</th>
                <th className="px-3 py-2 font-semibold">ETA Ende</th>
                <th className="px-3 py-2 font-semibold">MA</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-zinc-400 text-xs">
                    Keine Projekte über {threshold}% Budget. Alles im grünen Bereich.
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => (
                <tr
                  key={r.proj.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}
                >
                  <td className="px-3 py-2 font-medium">{r.proj.name}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.proj.customer?.company_name || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.budget)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.verbraucht)}</td>
                  <td className="px-3 py-2 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Progressbar pct={r.verbrauchtPct} />
                      </div>
                      <span className="text-xs tabular-nums font-medium" style={{ color: r.verbrauchtPct > 100 ? ARTIS_RED : '#3d4a3d', minWidth: 56 }}>
                        {r.verbrauchtPct.toFixed(0)} %
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.restbudget < 0 ? ARTIS_RED : undefined }}>
                    {fmt.hours(r.restbudget)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      {r.trendPerWeek > 0 && <TrendingUp className="w-3 h-3 text-zinc-400" />}
                      {r.trendPerWeek === 0 && <TrendingDown className="w-3 h-3 text-zinc-300" />}
                      {fmt.hours(r.trendPerWeek)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.eta === 'überzogen'
                      ? <Chip tone="red">überzogen</Chip>
                      : r.eta
                        ? fmt.date(r.eta)
                        : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.responsible
                      ? (r.responsible.short_code || r.responsible.full_name)
                      : <span className="text-zinc-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ISO-Wochenkey "YYYY-Www" – ausreichend für Bucketing
function isoWeekKey(iso) {
  const d = new Date(iso + 'T00:00:00');
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ===========================================================================
// Main Panel
// ===========================================================================

const TABS = [
  { id: 'mitarbeiter', label: 'Mitarbeiter-Rapport', icon: Users },
  { id: 'projekte',    label: 'Projekt-Rentabilität', icon: FolderKanban },
  { id: 'budget',      label: 'Budget-Warnungen', icon: AlertTriangle },
];

export default function AuswertungenPanel() {
  const [tab, setTab] = useState('mitarbeiter');
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState(() => {
    const today = new Date();
    return { from: toIso(startOfMonth(today)), to: toIso(today) };
  });

  const range = useMemo(() => rangeForPreset(preset, custom), [preset, custom]);

  // CSV-Export-Handler je Sub-Tab in einer Ref ablegen, damit der Toolbar-
  // Button immer den aktuell sichtbaren Sub-Tab exportiert.
  const exportRef = React.useRef(() => {});

  // Shared Queries: einmal laden, an alle Sub-Tabs durchreichen
  const employeesQ = useQuery({
    queryKey: ['le', 'employees'],
    queryFn: leEmployee.list,
    staleTime: 5 * 60_000,
  });

  const projectsQ = useQuery({
    queryKey: ['le', 'projects', 'all'],
    queryFn: () => leProject.list({ status: null }),
    staleTime: 5 * 60_000,
  });

  const entriesQ = useQuery({
    queryKey: ['le', 'auswertungen', 'entries', range.fromIso, range.toIso],
    queryFn: () => leTimeEntry.listForRange(range.fromIso, range.toIso, {}),
    staleTime: 60_000,
  });

  const isLoading = employeesQ.isLoading || projectsQ.isLoading || entriesQ.isLoading;
  const error = employeesQ.error || projectsQ.error || entriesQ.error;

  return (
    <div>
      <PanelHeader
        title="Auswertungen"
        subtitle="Auslastung, Rentabilität und Budget-Warnungen auf einen Blick."
      />

      <RangeToolbar
        preset={preset}
        setPreset={setPreset}
        custom={custom}
        setCustom={setCustom}
        onExport={() => exportRef.current?.()}
      />

      {/* Sub-Tabs */}
      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: '#e4e7e4' }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
              style={{
                borderColor: active ? ARTIS_GREEN : 'transparent',
                color: active ? '#2d3a2d' : '#6b6b6b',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {error && <PanelError error={error} onRetry={() => {
        employeesQ.refetch(); projectsQ.refetch(); entriesQ.refetch();
      }} />}

      {!error && isLoading && <PanelLoader />}

      {!error && !isLoading && (
        <>
          {tab === 'mitarbeiter' && (
            <MitarbeiterRapport
              range={range}
              onExportRef={exportRef}
              employees={employeesQ.data}
              entries={entriesQ.data}
            />
          )}
          {tab === 'projekte' && (
            <ProjektRentabilitaet
              range={range}
              onExportRef={exportRef}
              projects={projectsQ.data}
              employees={employeesQ.data}
              entries={entriesQ.data}
            />
          )}
          {tab === 'budget' && (
            <BudgetWarnungen
              range={range}
              onExportRef={exportRef}
              projects={projectsQ.data}
              employees={employeesQ.data}
              entries={entriesQ.data}
            />
          )}
        </>
      )}
    </div>
  );
}
