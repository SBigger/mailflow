// Auswertungen · Debitoren
// Fakturierter Umsatz aus le_invoice: Umsatz pro Kunde und Jahr, offene
// Posten, Monatsgrafik und Mehrjahres-Matrix. Basis = Rechnungen im Status
// definitiv/versendet/bezahlt (Gutschriften zählen negativ), Entwürfe und
// stornierte Rechnungen bleiben aussen vor.
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Download, Banknote, AlertCircle, FileText } from 'lucide-react';
import { leInvoice } from '@/lib/leApi';
import {
  Card, PanelLoader, PanelError, PanelHeader, fmt, Select,
  artisBtn, artisGhostStyle,
} from '@/components/leistungserfassung/shared';
import { MONTHS_SHORT, downloadCsv } from './util';

const COUNTED = new Set(['definitiv', 'versendet', 'bezahlt']);

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

function ChfTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-2.5 text-xs shadow-sm" style={{ borderColor: '#d9e0d9' }}>
      <div className="font-semibold mb-0.5" style={{ color: '#2d3a2d' }}>{label}</div>
      <div className="tabular-nums">{fmt.chf(payload[0].value)} CHF</div>
    </div>
  );
}

export default function DebitorenAuswertungPanel() {
  const invoicesQ = useQuery({
    queryKey: ['ausw', 'debi', 'invoices'],
    queryFn: leInvoice.listLightAll,
    staleTime: 60_000,
  });

  // Nur zählbare Rechnungen mit Datum
  const counted = useMemo(
    () => (invoicesQ.data ?? []).filter(i => COUNTED.has(i.status) && i.issue_date),
    [invoicesQ.data],
  );

  const years = useMemo(() => {
    const set = new Set(counted.map(i => Number(i.issue_date.slice(0, 4))));
    return [...set].sort((a, b) => b - a);
  }, [counted]);

  const [yearSel, setYearSel] = useState(null);
  const year = yearSel ?? years[0] ?? new Date().getFullYear();

  // Kennzahlen
  const stats = useMemo(() => {
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d30Iso = d30.toISOString().slice(0, 10);
    let umsatzYear = 0, op = 0, last30 = 0, countYear = 0;
    for (const i of counted) {
      const total = Number(i.total || 0);
      if (i.issue_date.slice(0, 4) === String(year)) { umsatzYear += total; countYear += 1; }
      if (i.status !== 'bezahlt' && total > 0) op += total - Number(i.paid_amount || 0);
      if (i.issue_date >= d30Iso) last30 += total;
    }
    return { umsatzYear, op, last30, countYear };
  }, [counted, year]);

  // Umsatz pro Monat (gewähltes Jahr)
  const byMonth = useMemo(() => {
    const buckets = MONTHS_SHORT.map(m => ({ name: m, umsatz: 0 }));
    for (const i of counted) {
      if (i.issue_date.slice(0, 4) !== String(year)) continue;
      const m = Number(i.issue_date.slice(5, 7)) - 1;
      buckets[m].umsatz = Math.round((buckets[m].umsatz + Number(i.total || 0)) * 100) / 100;
    }
    return buckets;
  }, [counted, year]);

  // Pro Kunde: Umsatz je Jahr + OP
  const byCustomer = useMemo(() => {
    const map = new Map();
    for (const i of counted) {
      const key = i.customer?.id || 'none';
      if (!map.has(key)) {
        map.set(key, { name: i.customer?.company_name || '(ohne Kunde)', perYear: {}, total: 0, op: 0 });
      }
      const c = map.get(key);
      const y = Number(i.issue_date.slice(0, 4));
      const total = Number(i.total || 0);
      c.perYear[y] = (c.perYear[y] || 0) + total;
      c.total += total;
      if (i.status !== 'bezahlt' && total > 0) c.op += total - Number(i.paid_amount || 0);
    }
    return [...map.values()].sort((a, b) => (b.perYear[year] || 0) - (a.perYear[year] || 0));
  }, [counted, year]);

  const matrixYears = useMemo(() => [...years].sort((a, b) => a - b), [years]);

  const exportCsv = () => {
    const header = ['Kunde', ...matrixYears.map(String), 'Gesamt', 'OP offen'];
    const data = [...byCustomer]
      .sort((a, b) => b.total - a.total)
      .map(c => [
        c.name,
        ...matrixYears.map(y => (c.perYear[y] ? c.perYear[y].toFixed(2) : '')),
        c.total.toFixed(2),
        c.op ? c.op.toFixed(2) : '',
      ]);
    downloadCsv(`debitoren-umsatz_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...data]);
  };

  return (
    <div>
      <PanelHeader
        title="Debitoren"
        subtitle="Fakturierter Umsatz pro Kunde, offene Posten und Verlauf – aus den Smartis-Rechnungen."
        right={(
          <button type="button" onClick={exportCsv} className={artisBtn.ghost} style={artisGhostStyle}>
            <Download className="w-3.5 h-3.5" /> CSV-Export
          </button>
        )}
      />

      {invoicesQ.error && <PanelError error={invoicesQ.error} onRetry={() => invoicesQ.refetch()} />}
      {!invoicesQ.error && invoicesQ.isLoading && <PanelLoader />}

      {!invoicesQ.error && !invoicesQ.isLoading && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border" style={{ borderColor: '#e4e7e4', background: '#fafaf8' }}>
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Jahr</div>
            <div style={{ width: 110 }}>
              <Select value={year} onChange={(e) => setYearSel(Number(e.target.value))}>
                {(years.length ? years : [year]).map(y => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={`Umsatz ${year}`} value={fmt.chf(stats.umsatzYear)} hint={`${stats.countYear} Rechnungen`} icon={Banknote} />
            <Kpi label="Offene Posten" value={fmt.chf(stats.op)} hint="alle Jahre, unbezahlt" icon={AlertCircle} color="#c34141" />
            <Kpi label="Letzte 30 Tage" value={fmt.chf(stats.last30)} hint="gestellt" icon={FileText} color="#d4a056" />
            <Kpi label="Kunden mit Umsatz" value={byCustomer.filter(c => (c.perYear[year] || 0) !== 0).length} hint={`im Jahr ${year}`} icon={Banknote} color="#5f7891" />
          </div>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3" style={{ color: '#2d3a2d' }}>Fakturierung pro Monat · {year}</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={{ stroke: '#d9e0d9' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6a766a' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip content={<ChfTooltip />} cursor={{ fill: 'rgba(122,155,127,0.07)' }} />
                <Bar dataKey="umsatz" name="Umsatz" fill="#7a9b7f" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <div className="px-3 py-2 border-b text-sm font-semibold" style={{ borderColor: '#e4e7e4', color: '#2d3a2d' }}>
              Umsatz pro Kunde (Mehrjahre)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="px-3 py-2 font-semibold">Kunde</th>
                    {matrixYears.map(y => (
                      <th key={y} className="px-3 py-2 font-semibold text-right" style={y === year ? { color: '#2d5a2d' } : undefined}>{y}</th>
                    ))}
                    <th className="px-3 py-2 font-semibold text-right">Gesamt</th>
                    <th className="px-3 py-2 font-semibold text-right">OP offen</th>
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.length === 0 && (
                    <tr><td colSpan={matrixYears.length + 3} className="px-3 py-4 text-zinc-400 text-xs">Noch keine Rechnungen vorhanden.</td></tr>
                  )}
                  {byCustomer.map((c, i) => (
                    <tr key={c.name + i} className="border-b last:border-b-0"
                      style={{ borderColor: '#f0f0ec', background: i % 2 === 1 ? '#fafaf8' : '#fff' }}>
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      {matrixYears.map(y => (
                        <td key={y} className="px-3 py-2 text-right tabular-nums" style={y === year ? { fontWeight: 600 } : { color: '#7a827a' }}>
                          {c.perYear[y] ? fmt.chf(c.perYear[y]) : ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt.chf(c.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: c.op > 0 ? '#c34141' : '#a0aca0' }}>
                        {c.op > 0 ? fmt.chf(c.op) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
