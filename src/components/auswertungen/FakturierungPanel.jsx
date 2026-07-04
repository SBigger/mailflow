// Auswertungen · Fakturierung / Angefangene Arbeiten (AA)
// Alle offenen (noch nicht fakturierten) Leistungen, gruppiert pro Projekt,
// bewertet mit dem Erfassungs-Stundensatz. Klick auf ein Projekt zeigt die
// einzelnen Buchungen. Interne Projekte erscheinen nicht (keine Verrechnung).
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FolderOpen, Clock, Banknote } from 'lucide-react';
import { fakturaVorschlagData } from '@/lib/leApi';
import {
  Card, Chip, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle,
} from '@/components/leistungserfassung/shared';
import { downloadCsv } from './util';

function Kpi({ label, value, hint, icon: Icon, color = '#7a9b7f' }) {
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

// Sortierwert pro Spalte
function sortValueOf(r, key) {
  switch (key) {
    case 'projekt': return `${r.proj.project_no || ''} ${r.proj.name}`.toLowerCase();
    case 'kunde':   return (r.proj.customer?.company_name || '').toLowerCase();
    case 'typ':     return r.proj.billing_mode === 'pauschal' ? 1 : 0;
    case 'hours':   return r.hours;
    case 'value':   return r.value;
    case 'oldest':  return r.oldest || '';
    default:        return 0;
  }
}

export default function FakturierungPanel() {
  const [selectedId, setSelectedId] = useState(null);
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState('desc');

  const entriesQ = useQuery({
    queryKey: ['ausw', 'aa', 'open'],
    queryFn: () => fakturaVorschlagData({ allOpen: true }),
    staleTime: 60_000,
  });

  // Gruppierung pro Projekt. Kulant-Stunden laufen mit, zählen aber nicht zum Wert.
  const rows = useMemo(() => {
    const byProj = new Map();
    for (const e of entriesQ.data ?? []) {
      const p = e.project;
      if (!p || p.is_internal) continue;
      if (!byProj.has(p.id)) {
        byProj.set(p.id, {
          proj: p, hours: 0, value: 0, kulantHours: 0, oldest: null, entries: [],
        });
      }
      const row = byProj.get(p.id);
      const h = Number(e.hours_internal || 0);
      row.entries.push(e);
      if (!row.oldest || e.entry_date < row.oldest) row.oldest = e.entry_date;
      if (e.status === 'kulant') {
        row.kulantHours += h;
        continue;
      }
      row.hours += h;
      if (e.service_type?.billable !== false) {
        row.value += h * Number(e.rate_snapshot || 0);
      }
    }
    return [...byProj.values()].sort((a, b) => b.value - a.value);
  }, [entriesQ.data]);

  const totals = useMemo(() => ({
    value: rows.reduce((s, r) => s + r.value, 0),
    hours: rows.reduce((s, r) => s + r.hours, 0),
    projects: rows.length,
  }), [rows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = sortValueOf(a, sortKey);
      const vb = sortValueOf(b, sortKey);
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const handleSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'projekt' || key === 'kunde' ? 'asc' : 'desc'); }
  };

  const Th = ({ k, children, right }) => (
    <th
      className={`px-3 py-2 font-semibold cursor-pointer select-none hover:text-zinc-700 ${right ? 'text-right' : ''}`}
      onClick={() => handleSort(k)}
      title="Sortieren"
    >
      {children}
      {sortKey === k && <span className="ml-1 text-zinc-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  const selected = rows.find(r => r.proj.id === selectedId) || null;

  const exportCsv = () => {
    const header = ['Projekt-Nr', 'Projekt', 'Kunde', 'Typ', 'Offene Std', 'Wert CHF', 'Kulant Std', 'Ältester Eintrag'];
    const data = sorted.map(r => [
      r.proj.project_no || '', r.proj.name,
      r.proj.customer?.company_name || '',
      r.proj.billing_mode === 'pauschal' ? 'Pauschal' : 'Effektiv',
      r.hours.toFixed(2), r.value.toFixed(2), r.kulantHours.toFixed(2), r.oldest || '',
    ]);
    downloadCsv(`angefangene-arbeiten_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...data]);
  };

  return (
    <div>
      <PanelHeader
        title="Angefangene Arbeiten"
        subtitle="Offene, noch nicht fakturierte Leistungen pro Projekt – bewertet zum Erfassungs-Ansatz."
        right={(
          <button type="button" onClick={exportCsv} className={artisBtn.ghost} style={artisGhostStyle}>
            <Download className="w-3.5 h-3.5" /> CSV-Export
          </button>
        )}
      />

      {entriesQ.error && <PanelError error={entriesQ.error} onRetry={() => entriesQ.refetch()} />}
      {!entriesQ.error && entriesQ.isLoading && <PanelLoader />}

      {!entriesQ.error && !entriesQ.isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi label="Angefangene Arbeiten" value={fmt.chf(totals.value)} hint="CHF, bewertet" icon={Banknote} />
            <Kpi label="Offene Stunden" value={`${fmt.hours(totals.hours)} h`} icon={Clock} color="#d4a056" />
            <Kpi label="Projekte" value={totals.projects} icon={FolderOpen} color="#5f7891" />
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <Th k="projekt">Projekt</Th>
                    <Th k="kunde">Kunde</Th>
                    <Th k="typ">Typ</Th>
                    <Th k="hours" right>Offene Std</Th>
                    <Th k="value" right>Wert CHF</Th>
                    <Th k="oldest" right>Ältester Eintrag</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-zinc-400 text-xs">Keine offenen Leistungen. Alles fakturiert.</td></tr>
                  )}
                  {sorted.map((r, i) => {
                    const active = r.proj.id === selectedId;
                    return (
                      <tr
                        key={r.proj.id}
                        onClick={() => setSelectedId(active ? null : r.proj.id)}
                        className="border-b last:border-b-0 cursor-pointer transition-colors"
                        style={{
                          borderColor: '#f0f0ec',
                          background: active ? '#e6ede6' : i % 2 === 1 ? '#fafaf8' : '#fff',
                        }}
                      >
                        <td className="px-3 py-2 font-medium">
                          {r.proj.project_no && <span className="text-zinc-400 mr-1.5">{r.proj.project_no}</span>}
                          {r.proj.name}
                        </td>
                        <td className="px-3 py-2 text-zinc-600">{r.proj.customer?.company_name || '—'}</td>
                        <td className="px-3 py-2">
                          <Chip tone={r.proj.billing_mode === 'pauschal' ? 'orange' : 'green'}>
                            {r.proj.billing_mode === 'pauschal' ? 'Pauschal' : 'Effektiv'}
                          </Chip>
                          {r.kulantHours > 0 && (
                            <Chip tone="neutral" className="ml-1.5">{fmt.hours(r.kulantHours)} h kulant</Chip>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(r.hours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt.chf(r.value)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.date(r.oldest)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t font-semibold" style={{ borderColor: '#d9e0d9', background: '#f2f5f2' }}>
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(totals.hours)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(totals.value)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Detail: Einzelbuchungen des angeklickten Projekts */}
          {selected && (
            <Card>
              <div className="px-3 py-2 border-b text-sm font-semibold" style={{ borderColor: '#e4e7e4', color: '#2d3a2d' }}>
                Buchungen · {selected.proj.name}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                      <th className="px-3 py-2 font-semibold">Datum</th>
                      <th className="px-3 py-2 font-semibold">MA</th>
                      <th className="px-3 py-2 font-semibold">Leistungsart</th>
                      <th className="px-3 py-2 font-semibold">Text</th>
                      <th className="px-3 py-2 font-semibold text-right">Std</th>
                      <th className="px-3 py-2 font-semibold text-right">Ansatz</th>
                      <th className="px-3 py-2 font-semibold text-right">Wert CHF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.entries
                      .slice()
                      .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
                      .map((e) => {
                        const kulant = e.status === 'kulant';
                        const billable = e.service_type?.billable !== false;
                        const val = (kulant || !billable) ? 0 : Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0);
                        return (
                          <tr key={e.id} className="border-b last:border-b-0" style={{ borderColor: '#f0f0ec' }}>
                            <td className="px-3 py-1.5 tabular-nums">{fmt.date(e.entry_date)}</td>
                            <td className="px-3 py-1.5">{e.employee?.short_code || '—'}</td>
                            <td className="px-3 py-1.5">
                              {e.service_type?.name || '—'}
                              {kulant && <Chip tone="neutral" className="ml-1.5">kulant</Chip>}
                              {!billable && !kulant && <Chip tone="neutral" className="ml-1.5">n. verr.</Chip>}
                            </td>
                            <td className="px-3 py-1.5 text-zinc-600 max-w-[360px] truncate" title={e.description || ''}>{e.description || '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmt.hours(e.hours_internal)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{fmt.chf(e.rate_snapshot)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{val ? fmt.chf(val) : '—'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
