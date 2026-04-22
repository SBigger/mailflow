// Angefangene Arbeiten (AA) – Übersicht offene Leistungen pro Projekt
// Read-only WIP-Panel, berechnet client-side aus le_project + le_time_entry.
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Download, Calculator, Search } from 'lucide-react';
import { toast } from 'sonner';
import { leProject, leTimeEntry } from '@/lib/leApi';
import {
  Chip, Card, Input, Select, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared.jsx';

// --- Hilfsfunktionen ----------------------------------------------------
const todayIso = () => new Date().toISOString().slice(0, 10);
const isoMinusYears = (iso, years) => {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (fromIso, toIso) => {
  if (!fromIso || !toIso) return 0;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

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
  // UTF-8 BOM für Excel
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

// --- Sortier-Header -----------------------------------------------------
const SortHeader = ({ label, colKey, sort, setSort, align = 'left' }) => {
  const active = sort.key === colKey;
  const dir = active ? sort.dir : null;
  return (
    <th
      className={`px-2 py-2 text-${align} font-semibold text-[11px] uppercase tracking-wider text-zinc-600 cursor-pointer select-none hover:bg-zinc-50`}
      onClick={() => setSort((s) => ({ key: colKey, dir: s.key === colKey && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'text-zinc-700' : 'text-zinc-300'}`} />
        {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}
      </span>
    </th>
  );
};

// --- Panel --------------------------------------------------------------
export default function AAPanel() {
  const [stichtag, setStichtag] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [filterResp, setFilterResp] = useState('');
  const [minAgeOnly, setMinAgeOnly] = useState(false);
  const [minAgeDays, setMinAgeDays] = useState(60);
  const [sort, setSort] = useState({ key: 'age', dir: 'desc' });

  const fromIso = useMemo(() => isoMinusYears(stichtag, 2), [stichtag]);

  const projectsQ = useQuery({
    queryKey: ['le', 'project', 'offen'],
    queryFn: () => leProject.list({ status: 'offen' }),
  });

  // Alle nicht-verrechneten Einträge holen: status 'erfasst' + 'freigegeben' separat.
  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', 'aa', fromIso, stichtag],
    queryFn: async () => {
      const [erfasst, freigegeben] = await Promise.all([
        leTimeEntry.listForRange(fromIso, stichtag, { status: 'erfasst' }),
        leTimeEntry.listForRange(fromIso, stichtag, { status: 'freigegeben' }),
      ]);
      return [...erfasst, ...freigegeben];
    },
  });

  const isLoading = projectsQ.isLoading || entriesQ.isLoading;
  const error = projectsQ.error || entriesQ.error;

  // Aggregation pro Projekt
  const rows = useMemo(() => {
    if (!projectsQ.data || !entriesQ.data) return [];
    const byProject = new Map();
    for (const e of entriesQ.data) {
      if (!e.project_id) continue;
      let b = byProject.get(e.project_id);
      if (!b) {
        b = { hoursInternal: 0, geleistet: 0, oldest: null };
        byProject.set(e.project_id, b);
      }
      const h = Number(e.hours_internal ?? 0);
      const rate = Number(e.rate_snapshot ?? 0);
      b.hoursInternal += h;
      b.geleistet += h * rate;
      if (e.entry_date && (!b.oldest || e.entry_date < b.oldest)) {
        b.oldest = e.entry_date;
      }
    }
    return projectsQ.data.map((p) => {
      const b = byProject.get(p.id) ?? { hoursInternal: 0, geleistet: 0, oldest: null };
      const akonto = 0; // noch nicht implementiert
      const offen = b.geleistet - akonto;
      const age = b.oldest ? daysBetween(b.oldest, stichtag) : null;
      return {
        id: p.id,
        projectName: p.name ?? '—',
        customerName: p.customer?.company_name ?? '—',
        responsibleId: p.responsible?.id ?? null,
        responsibleShort: p.responsible?.short_code ?? '—',
        responsibleName: p.responsible?.full_name ?? '',
        billingMode: p.billing_mode ?? 'effektiv',
        hoursInternal: b.hoursInternal,
        geleistet: b.geleistet,
        akonto,
        akontoShown: null, // "—"
        offen,
        lastInvoice: null,
        prevInvoice: null,
        oldest: b.oldest,
        age: age ?? 0,
        hasEntries: b.hoursInternal > 0 || b.geleistet > 0,
      };
    });
  }, [projectsQ.data, entriesQ.data, stichtag]);

  // Responsibles für Dropdown
  const responsibles = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (r.responsibleId && !map.has(r.responsibleId)) {
        map.set(r.responsibleId, { id: r.responsibleId, label: r.responsibleShort + (r.responsibleName ? ' · ' + r.responsibleName : '') });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Filter + Sortierung
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows.filter((x) => {
      if (q && !(x.projectName.toLowerCase().includes(q) || x.customerName.toLowerCase().includes(q))) return false;
      if (filterResp && x.responsibleId !== filterResp) return false;
      if (minAgeOnly && x.age < minAgeDays) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const pick = (x) => {
      switch (sort.key) {
        case 'project': return x.projectName.toLowerCase();
        case 'customer': return x.customerName.toLowerCase();
        case 'responsible': return x.responsibleShort.toLowerCase();
        case 'hours': return x.hoursInternal;
        case 'geleistet': return x.geleistet;
        case 'offen': return x.offen;
        case 'age': return x.age;
        case 'mode': return x.billingMode;
        default: return 0;
      }
    };
    r.sort((a, b) => {
      const va = pick(a), vb = pick(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return r;
  }, [rows, search, filterResp, minAgeOnly, minAgeDays, sort]);

  // Summen
  const totals = useMemo(() => {
    let h = 0, g = 0, o = 0;
    for (const r of filtered) {
      h += r.hoursInternal;
      g += r.geleistet;
      if (r.billingMode !== 'pauschal') o += r.offen;
    }
    return { h, g, o };
  }, [filtered]);

  const handleExport = () => {
    const header = ['Projekt', 'Kunde', 'Verantwortlich', 'Std. intern', 'Geleistet CHF', 'Akonto CHF', 'Offen CHF', 'Letzte Rg', 'Vorletzte Rg', 'Alter (Tage)', 'Modus'];
    const body = filtered.map((r) => [
      r.projectName,
      r.customerName,
      r.responsibleShort,
      r.hoursInternal.toFixed(2),
      r.geleistet.toFixed(2),
      '',
      r.billingMode === 'pauschal' ? '' : r.offen.toFixed(2),
      '',
      '',
      r.oldest ? r.age : '',
      r.billingMode,
    ]);
    downloadCsv(`AA-${stichtag}.csv`, [header, ...body]);
  };

  const handleRechnen = (row) => {
    toast.info(`Faktura-Vorschlag für "${row.projectName}" öffnen (im nächsten Schritt verdrahtet)`);
  };

  // --- Render -----------------------------------------------------------
  const rightHeader = (
    <>
      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
        Stichtag
        <Input
          type="date"
          value={stichtag}
          onChange={(e) => setStichtag(e.target.value)}
          className="!w-40"
        />
      </label>
      <button
        type="button"
        onClick={handleExport}
        className={artisBtn.ghost}
        style={artisGhostStyle}
        disabled={isLoading || !!error}
      >
        <Download className="w-4 h-4" /> Export CSV
      </button>
    </>
  );

  return (
    <div>
      <PanelHeader
        title="Angefangene Arbeiten (AA)"
        subtitle="Übersicht offene Leistungen pro Projekt · Stichtag basiert"
        right={rightHeader}
      />

      {isLoading && <PanelLoader />}
      {error && <PanelError error={error} onRetry={() => { projectsQ.refetch(); entriesQ.refetch(); }} />}

      {!isLoading && !error && (
        <>
          {/* Filter-Bar */}
          <Card className="mb-3">
            <div className="p-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Suche</div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <Input
                    placeholder="Projekt oder Kunde…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="!pl-7"
                  />
                </div>
              </div>
              <div className="min-w-[200px]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Verantwortlich</div>
                <Select value={filterResp} onChange={(e) => setFilterResp(e.target.value)}>
                  <option value="">Alle</option>
                  {responsibles.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700 whitespace-nowrap pb-1.5">
                <input
                  type="checkbox"
                  checked={minAgeOnly}
                  onChange={(e) => setMinAgeOnly(e.target.checked)}
                  style={{ accentColor: '#7a9b7f' }}
                />
                nur älter als
                <input
                  type="number"
                  min={0}
                  value={minAgeDays}
                  onChange={(e) => setMinAgeDays(Number(e.target.value) || 0)}
                  disabled={!minAgeOnly}
                  className="w-16 border rounded px-2 py-1 text-sm"
                  style={{ borderColor: '#d9dfd9' }}
                />
                Tage
              </label>
              <div className="text-xs text-zinc-400 pb-2 ml-auto">
                {filtered.length} / {rows.length} Projekte
              </div>
            </div>
          </Card>

          {/* Tabelle */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ background: '#f7f9f7', borderBottom: '1px solid #e4e7e4' }}>
                  <tr>
                    <SortHeader label="Projekt" colKey="project" sort={sort} setSort={setSort} />
                    <SortHeader label="Kunde" colKey="customer" sort={sort} setSort={setSort} />
                    <SortHeader label="Verantw." colKey="responsible" sort={sort} setSort={setSort} />
                    <SortHeader label="Std." colKey="hours" sort={sort} setSort={setSort} align="right" />
                    <SortHeader label="Geleistet CHF" colKey="geleistet" sort={sort} setSort={setSort} align="right" />
                    <th className="px-2 py-2 text-right font-semibold text-[11px] uppercase tracking-wider text-zinc-600">Akonto</th>
                    <SortHeader label="Offen" colKey="offen" sort={sort} setSort={setSort} align="right" />
                    <th className="px-2 py-2 text-right font-semibold text-[11px] uppercase tracking-wider text-zinc-600">Letzte Rg</th>
                    <th className="px-2 py-2 text-right font-semibold text-[11px] uppercase tracking-wider text-zinc-600">Vorletzte Rg</th>
                    <SortHeader label="Alter" colKey="age" sort={sort} setSort={setSort} align="right" />
                    <SortHeader label="Modus" colKey="mode" sort={sort} setSort={setSort} />
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center text-zinc-400 text-sm">
                        Keine Projekte gefunden.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const pauschal = r.billingMode === 'pauschal';
                    const ageTone = r.age >= 180 ? 'red' : r.age >= 90 ? 'orange' : 'green';
                    return (
                      <tr key={r.id} className="border-t hover:bg-zinc-50" style={{ borderColor: '#eef1ee' }}>
                        <td className="px-2 py-2 font-medium text-zinc-800">{r.projectName}</td>
                        <td className="px-2 py-2 text-zinc-600">{r.customerName}</td>
                        <td className="px-2 py-2">
                          <Chip tone="neutral">{r.responsibleShort}</Chip>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.hoursInternal > 0 ? fmt.hours(r.hoursInternal) : '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.geleistet > 0 ? fmt.chf(r.geleistet) : '—'}</td>
                        <td className="px-2 py-2 text-right text-zinc-400">—</td>
                        <td className="px-2 py-2 text-right tabular-nums" style={{ color: pauschal ? '#a0a0a0' : undefined }}>
                          {pauschal ? <span className="text-zinc-400">—</span> : (r.offen > 0 ? <span style={{ color: '#2d5a2d', fontWeight: 500 }}>{fmt.chf(r.offen)}</span> : fmt.chf(r.offen))}
                        </td>
                        <td className="px-2 py-2 text-right text-zinc-400">—</td>
                        <td className="px-2 py-2 text-right text-zinc-400">—</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {r.oldest ? (
                            <Chip tone={ageTone}>{r.age} T</Chip>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {pauschal
                            ? <Chip tone="blue">Pauschal</Chip>
                            : <Chip tone="green">Effektiv</Chip>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRechnen(r)}
                            className={artisBtn.primary + ' !py-1 !px-2 !text-xs'}
                            style={artisPrimaryStyle}
                          >
                            <Calculator className="w-3.5 h-3.5" /> Rechnen →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#f7f9f7', borderTop: '2px solid #bfd3bf' }}>
                      <td className="px-2 py-2 font-semibold text-zinc-700" colSpan={3}>
                        Summen ({filtered.length})
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-zinc-800">{fmt.hours(totals.h)}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-zinc-800">{fmt.chf(totals.g)}</td>
                      <td className="px-2 py-2 text-right text-zinc-400">—</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold" style={{ color: '#2d5a2d' }}>{fmt.chf(totals.o)}</td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          <div className="mt-2 text-[10px] text-zinc-400">
            Hinweis: Akonto, Letzte/Vorletzte Rechnung werden im nächsten Schritt aus dem Faktura-Modul befüllt.
          </div>
        </>
      )}
    </div>
  );
}
