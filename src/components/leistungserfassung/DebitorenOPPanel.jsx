// Leistungserfassung · Debitoren-Offene-Posten-Liste
// =====================================================================
// Klassischer Treuhand-Report: alle offenen Forderungen mit Aging-Buckets
// (nicht fällig / 1-30 / 31-60 / 61-90 / >90 Tage), gruppiert nach Kunde.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Filter, Users, AlertTriangle } from 'lucide-react';
import { leInvoice } from '@/lib/leApi';
import {
  Card, Chip, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisGhostStyle, Select, Input,
} from './shared';

const todayIso = () => new Date().toISOString().slice(0, 10);

const ageBucket = (dueDateIso) => {
  if (!dueDateIso) return 'unfaellig';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateIso + 'T00:00:00');
  const days = Math.floor((today - due) / 86400000);
  if (days < 0) return 'unfaellig';
  if (days <= 30) return 'b1_30';
  if (days <= 60) return 'b31_60';
  if (days <= 90) return 'b61_90';
  return 'b90plus';
};

const BUCKET_LABELS = {
  unfaellig: 'Nicht fällig',
  b1_30:    '1–30 Tage',
  b31_60:   '31–60 Tage',
  b61_90:   '61–90 Tage',
  b90plus:  '> 90 Tage',
};
const BUCKET_TONES = {
  unfaellig: 'neutral',
  b1_30:    'green',
  b31_60:   'orange',
  b61_90:   'orange',
  b90plus:  'red',
};

export default function DebitorenOPPanel() {
  const [search, setSearch] = useState('');
  const [bucketFilter, setBucketFilter] = useState('alle');
  const [expanded, setExpanded] = useState(new Set());

  // Versendet + Definitiv = offen. Bezahlt/Storniert/Entwurf raus.
  const definitivQ = useQuery({ queryKey: ['le','invoice','definitiv-op'], queryFn: () => leInvoice.list({ status: 'definitiv' }) });
  const versendetQ = useQuery({ queryKey: ['le','invoice','versendet-op'], queryFn: () => leInvoice.list({ status: 'versendet' }) });

  if (definitivQ.error) return <PanelError error={definitivQ.error} onRetry={definitivQ.refetch} />;
  if (versendetQ.error) return <PanelError error={versendetQ.error} onRetry={versendetQ.refetch} />;
  if (definitivQ.isLoading || versendetQ.isLoading) return <PanelLoader />;

  const allOpen = [...(definitivQ.data ?? []), ...(versendetQ.data ?? [])]
    // Gutschriften und negative Beträge ausblenden – die sind keine Forderungen
    .filter(inv => Number(inv.total) > 0)
    .filter(inv => inv.invoice_type !== 'gutschrift');

  // Per-Invoice Bucket
  const enriched = allOpen.map(inv => ({
    ...inv,
    bucket: ageBucket(inv.due_date),
    daysOverdue: inv.due_date ? Math.max(0, Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000)) : 0,
  }));

  // Filter
  const filtered = enriched.filter(inv => {
    if (bucketFilter !== 'alle' && inv.bucket !== bucketFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = [inv.invoice_no, inv.customer?.company_name, inv.project?.name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  // Gruppe pro Kunde
  const grouped = useMemo(() => {
    const m = new Map();
    for (const inv of filtered) {
      const key = inv.customer_id ?? '__nokunde__';
      if (!m.has(key)) m.set(key, { customer: inv.customer, customerId: key, invoices: [] });
      m.get(key).invoices.push(inv);
    }
    return [...m.values()].map(g => {
      const sums = { unfaellig: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 };
      for (const inv of g.invoices) {
        const t = Number(inv.total || 0);
        sums[inv.bucket] += t;
        sums.total += t;
      }
      return { ...g, sums, count: g.invoices.length };
    }).sort((a, b) => b.sums.total - a.sums.total);
  }, [filtered]);

  // Gesamtsumme
  const totalSum = useMemo(() => {
    const t = { unfaellig: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0, count: 0 };
    for (const g of grouped) {
      t.unfaellig += g.sums.unfaellig;
      t.b1_30 += g.sums.b1_30;
      t.b31_60 += g.sums.b31_60;
      t.b61_90 += g.sums.b61_90;
      t.b90plus += g.sums.b90plus;
      t.total += g.sums.total;
      t.count += g.count;
    }
    return t;
  }, [grouped]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const rows = [['Kunde','Rechnungsnr','Datum','Fälligkeit','Tage überfällig','Bucket','Total CHF']];
    for (const g of grouped) {
      for (const inv of g.invoices) {
        rows.push([
          g.customer?.company_name ?? '—',
          inv.invoice_no ?? '',
          inv.issue_date ?? '',
          inv.due_date ?? '',
          String(inv.daysOverdue),
          BUCKET_LABELS[inv.bucket],
          Number(inv.total ?? 0).toFixed(2).replace('.', ','),
        ]);
      }
    }
    const bom = '﻿';
    const csv = bom + rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Debitoren-OP-${todayIso()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Debitoren-OP-Liste"
        subtitle={`${totalSum.count} offene Rechnungen · CHF ${fmt.chf(totalSum.total)}`}
        right={
          <button onClick={exportCsv} className={artisBtn.ghost} style={artisGhostStyle}>
            <Download className="w-4 h-4" /> CSV
          </button>
        }
      />

      {/* KPI-Kacheln Aging */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ['unfaellig', 'Nicht fällig', '#7a9b7f'],
          ['b1_30',    '1–30 Tage',    '#7a9b7f'],
          ['b31_60',   '31–60 Tage',   '#d4a056'],
          ['b61_90',   '61–90 Tage',   '#c87a3a'],
          ['b90plus',  '> 90 Tage',    '#c34141'],
        ].map(([key, label, color]) => (
          <Card key={key} className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
            <div className="text-lg font-semibold tabular-nums mt-1" style={{ color }}>
              CHF {fmt.chf(totalSum[key])}
            </div>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-zinc-400" />
          <Select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)} style={{ minWidth: 180 }}>
            <option value="alle">Alle Fälligkeiten</option>
            <option value="unfaellig">Nicht fällig</option>
            <option value="b1_30">1–30 Tage</option>
            <option value="b31_60">31–60 Tage</option>
            <option value="b61_90">61–90 Tage</option>
            <option value="b90plus">&gt; 90 Tage</option>
          </Select>
          <Input
            placeholder="Suche Kunde / Rechnungsnr…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <div className="ml-auto text-sm text-zinc-500">{grouped.length} Kunde{grouped.length === 1 ? '' : 'n'}</div>
        </div>
      </Card>

      {/* Liste */}
      {grouped.length === 0 ? (
        <Card className="p-6 text-center text-sm text-zinc-400">
          Keine offenen Forderungen mit aktuellem Filter.
        </Card>
      ) : (
        <div className="space-y-2">
          {grouped.map(g => (
            <Card key={g.customerId} className="overflow-hidden">
              <button
                onClick={() => toggle(g.customerId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
              >
                {expanded.has(g.customerId)
                  ? <ChevronDown className="w-4 h-4 text-zinc-400" />
                  : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                <Users className="w-4 h-4 text-zinc-400" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{g.customer?.company_name ?? '(Kein Kunde zugeordnet)'}</div>
                  <div className="text-[11px] text-zinc-500">
                    {g.count} Rechnung{g.count === 1 ? '' : 'en'}
                    {g.sums.b90plus > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-3 h-3" /> CHF {fmt.chf(g.sums.b90plus)} {'>'} 90 Tage
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold tabular-nums" style={{ color: '#2d5a2d' }}>
                    CHF {fmt.chf(g.sums.total)}
                  </div>
                </div>
              </button>

              {expanded.has(g.customerId) && (
                <div className="border-t" style={{ borderColor: '#e4e7e4' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#eef1ee', background: '#fafbf9' }}>
                        <th className="text-left font-semibold px-4 py-2">Rechnungsnr.</th>
                        <th className="text-left font-semibold px-3 py-2">Datum</th>
                        <th className="text-left font-semibold px-3 py-2">Fällig</th>
                        <th className="text-right font-semibold px-3 py-2">Tage überfällig</th>
                        <th className="text-left font-semibold px-3 py-2">Status</th>
                        <th className="text-right font-semibold px-3 py-2">Total CHF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.invoices
                        .sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0))
                        .map(inv => (
                        <tr key={inv.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                          <td className="px-4 py-2 font-medium text-zinc-700">{inv.invoice_no || '(Entwurf)'}</td>
                          <td className="px-3 py-2 text-zinc-600 tabular-nums">{fmt.date(inv.issue_date)}</td>
                          <td className="px-3 py-2 text-zinc-600 tabular-nums">{fmt.date(inv.due_date)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {inv.daysOverdue > 0 ? (
                              <span className={inv.daysOverdue > 90 ? 'text-red-600 font-medium' : inv.daysOverdue > 30 ? 'text-orange-600' : 'text-zinc-600'}>
                                {inv.daysOverdue}
                              </span>
                            ) : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-3 py-2"><Chip tone={BUCKET_TONES[inv.bucket]}>{BUCKET_LABELS[inv.bucket]}</Chip></td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(inv.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
