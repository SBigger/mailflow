// Leistungserfassung · Mahnwesen
// Zwei Tabs:
//   - Vorschläge: überfällige Rechnungen → Bulk-Erstellung von Mahnungs-Entwürfen
//   - Mahnungen:  Liste aller Mahnungen mit Filter und Inline-Aktionen
//
// CH-Standard: Verzugszins 5% p.a. (OR Art. 104), 3 Stufen mit Standard-Gebühren.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, FileText, Send, CheckCircle2, X as XIcon,
  ChevronUp, Plus, Calendar, FileDown,
} from 'lucide-react';
import { leOverdueInvoices, leDunning, leCompany, leInvoice } from '@/lib/leApi';
import { generateDunningPdf } from '@/lib/leDunningPdf';
import { triggerDownload } from '@/lib/leInvoicePdf';
import {
  Card, Chip, IconBtn, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Konstanten ------------------------------------------------------------

const DEFAULT_FEES = { 1: 20, 2: 30, 3: 50 };
const DEFAULT_DAYS = { 1: 14, 2: 10, 3: 10 };

const STATUS_TABS = [
  { key: '',          label: 'Alle' },
  { key: 'entwurf',   label: 'Entwurf' },
  { key: 'versendet', label: 'Versendet' },
  { key: 'bezahlt',   label: 'Bezahlt' },
  { key: 'eskaliert', label: 'Eskaliert' },
];

const STATUS_CHIP = {
  entwurf:   { tone: 'neutral', label: 'Entwurf' },
  versendet: { tone: 'violet',  label: 'Versendet' },
  bezahlt:   { tone: 'green',   label: 'Bezahlt' },
  eskaliert: { tone: 'orange',  label: 'Eskaliert' },
  storniert: { tone: 'red',     label: 'Storniert' },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDaysIso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (fromIso, toIso = null) => {
  if (!fromIso) return 0;
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.floor((to - from) / 86400000));
};

const computeInterest = (outstanding, dueDateIso, ratePct = 5) => {
  const days = daysBetween(dueDateIso);
  const raw = Number(outstanding) * (ratePct / 100) * days / 365;
  return Math.round(raw * 100) / 100;
};

const levelChipTone = (level) => {
  if (level >= 3) return 'red';
  if (level === 2) return 'orange';
  return 'blue';
};

// --- Haupt-Panel -----------------------------------------------------------

export default function MahnungenPanel() {
  const [tab, setTab] = useState('vorschlaege'); // 'vorschlaege' | 'mahnungen'

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Mahnwesen"
        subtitle="Überfällige Rechnungen und versendete Mahnungen verwalten"
      />

      {/* Tab-Umschalter */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'vorschlaege', label: 'Vorschläge' },
          { key: 'mahnungen',   label: 'Mahnungen' },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
              style={
                active
                  ? { background: '#7a9b7f', color: '#fff', borderColor: '#7a9b7f' }
                  : { background: '#fff', color: '#3d4a3d', borderColor: '#d1dcd1' }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'vorschlaege' ? <VorschlaegeTab /> : <MahnungenTab />}
    </div>
  );
}

// --- Tab: Vorschläge -------------------------------------------------------

function VorschlaegeTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(() => new Set());

  const overdueQ = useQuery({
    queryKey: ['le', 'overdue-invoices'],
    queryFn: leOverdueInvoices,
  });

  const companyQ = useQuery({
    queryKey: ['le', 'company'],
    queryFn: leCompany.get,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['le', 'overdue-invoices'] });
    qc.invalidateQueries({ queryKey: ['le', 'dunning'] });
    qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
  };

  // Empfohlene Stufe: max(bestehende, status != storniert) + 1, gecappt auf 3
  const computeRecommendedLevel = (inv) => {
    const lastLevel = Math.max(
      0,
      ...((inv.dunnings ?? [])
        .filter((d) => d.status !== 'storniert')
        .map((d) => d.level || 0)),
    );
    return Math.min(3, lastLevel + 1);
  };

  // Filtere überfällige Rechnungen, die noch keine aktive Mahnung in Stufe 3 haben:
  // (alles eskaliert/bezahlt blendet Liste implizit über status='versendet' eh aus)
  const overdueRows = useMemo(() => {
    const list = overdueQ.data ?? [];
    return list
      .filter((inv) => {
        // Keine offene Mahnung mit Status 'entwurf' oder 'versendet' bereits auf maxlevel?
        // Fachlich: solange offen, immer wieder mahnen können – also nur ausschliessen,
        // wenn schon eine entwurfs-Mahnung existiert (sonst doppelte Entwürfe).
        const hasOpenDraft = (inv.dunnings ?? []).some((d) => d.status === 'entwurf');
        return !hasOpenDraft;
      })
      .map((inv) => {
        const recommended = computeRecommendedLevel(inv);
        const overdue = daysBetween(inv.due_date);
        const interest = computeInterest(inv.total, inv.due_date);
        const fee = DEFAULT_FEES[recommended] ?? 0;
        return {
          ...inv,
          _recommended: recommended,
          _overdue: overdue,
          _interest: interest,
          _fee: fee,
          _total: Number(inv.total ?? 0) + fee + interest,
          _existingLevels: (inv.dunnings ?? [])
            .filter((d) => d.status !== 'storniert')
            .map((d) => d.level)
            .sort((a, b) => a - b),
        };
      })
      .sort((a, b) => b._overdue - a._overdue);
  }, [overdueQ.data]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === overdueRows.length) return new Set();
      return new Set(overdueRows.map((r) => r.id));
    });
  };

  const createMut = useMutation({
    mutationFn: async (rows) => {
      const today = todayIso();
      // Standard-Werte (CH); company-Settings könnten sie später übersteuern
      const fees = DEFAULT_FEES;
      const newDays = DEFAULT_DAYS;
      let created = 0;
      for (const inv of rows) {
        const level = inv._recommended;
        const fee = fees[level] ?? 0;
        const newDue = addDaysIso(newDays[level] ?? 10);
        const interestAmount = computeInterest(inv.total, inv.due_date);
        const outstanding = Number(inv.total ?? 0);
        await leDunning.create({
          invoice_id: inv.id,
          customer_id: inv.customer_id,
          level,
          dunning_date: today,
          new_due_date: newDue,
          fee,
          interest_rate_pct: 5.0,
          interest_from: inv.due_date,
          interest_amount: interestAmount,
          outstanding_amount: outstanding,
          total_amount: outstanding + fee + interestAmount,
          is_betreibungsandrohung: level === 3,
          status: 'entwurf',
        });
        created += 1;
      }
      return created;
    },
    onSuccess: (n) => {
      toast.success(`${n} Mahnungs-Entwurf${n === 1 ? '' : 'e'} erstellt`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  if (overdueQ.error) {
    return <PanelError error={overdueQ.error} onRetry={() => overdueQ.refetch()} />;
  }

  const selectedRows = overdueRows.filter((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      {companyQ.data?.dunning_fee_level1 != null && (
        <div className="text-[11px] text-zinc-500">
          Standard-Gebühren: Stufe 1 CHF {fmt.chf(DEFAULT_FEES[1])} ·
          Stufe 2 CHF {fmt.chf(DEFAULT_FEES[2])} ·
          Stufe 3 CHF {fmt.chf(DEFAULT_FEES[3])} (Betreibungsandrohung)
        </div>
      )}

      <Card>
        {overdueQ.isLoading ? (
          <PanelLoader />
        ) : overdueRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine überfälligen Rechnungen ohne Mahnungs-Entwurf.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="text-left font-semibold px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={overdueRows.length > 0 && selected.size === overdueRows.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="text-left font-semibold px-3 py-2 w-32">Rechnungsnr.</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Fällig am</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Tage überf.</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Offen CHF</th>
                  <th className="text-left font-semibold px-3 py-2 w-32">Bisher</th>
                  <th className="text-left font-semibold px-3 py-2 w-32">Empfohlen</th>
                </tr>
              </thead>
              <tbody>
                {overdueRows.map((inv) => {
                  const checked = selected.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className="border-b last:border-b-0 hover:bg-zinc-50 cursor-pointer"
                      style={{ borderColor: '#eef1ee' }}
                      onClick={() => toggle(inv.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(inv.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold tabular-nums">
                          {inv.invoice_no ?? <span className="text-zinc-400 italic">(Entwurf)</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {inv.customer?.company_name ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(inv.due_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span style={{ color: inv._overdue > 30 ? '#8a2d2d' : '#8a5a00' }}>
                          {inv._overdue}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(inv.total)}</td>
                      <td className="px-3 py-2">
                        {inv._existingLevels.length === 0 ? (
                          <span className="text-zinc-300">—</span>
                        ) : (
                          <div className="flex gap-1">
                            {inv._existingLevels.map((lv, i) => (
                              <Chip key={i} tone={levelChipTone(lv)}>S{lv}</Chip>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={levelChipTone(inv._recommended)}>
                          {inv._recommended >= 3 && (
                            <AlertTriangle className="w-3 h-3 mr-0.5" />
                          )}
                          Stufe {inv._recommended}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer mit Bulk-Action */}
        {overdueRows.length > 0 && (
          <div
            className="flex items-center justify-between px-3 py-2 border-t"
            style={{ borderColor: '#eef1ee', background: '#f9faf9' }}
          >
            <div className="text-xs text-zinc-500">
              {selected.size === 0
                ? `${overdueRows.length} überfällige Rechnungen`
                : `${selected.size} ausgewählt`}
            </div>
            <button
              type="button"
              disabled={selected.size === 0 || createMut.isPending}
              onClick={() => createMut.mutate(selectedRows)}
              className={artisBtn.primary}
              style={{
                ...artisPrimaryStyle,
                opacity: selected.size === 0 || createMut.isPending ? 0.5 : 1,
              }}
            >
              <Plus className="w-4 h-4" />
              {createMut.isPending
                ? 'Erstelle…'
                : `Mahnungen erstellen${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Tab: Mahnungen --------------------------------------------------------

function MahnungenTab() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState(''); // '' = alle
  const [levelFilter, setLevelFilter] = useState('');   // '' = alle, '1','2','3'

  const dunningQ = useQuery({
    queryKey: ['le', 'dunning', statusFilter || 'all'],
    queryFn: () => leDunning.list({ status: statusFilter || undefined }),
  });

  const allDunningQ = useQuery({
    queryKey: ['le', 'dunning', 'all'],
    queryFn: () => leDunning.list({}),
    enabled: statusFilter !== '',
  });

  const allDunnings = statusFilter === '' ? (dunningQ.data ?? []) : (allDunningQ.data ?? []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'dunning'] });

  // --- Mutations ---
  const sendMut = useMutation({
    mutationFn: (id) => leDunning.finalize(id),
    onSuccess: () => {
      toast.success('Mahnung versendet (Mahnnummer vergeben)');
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const payMut = useMutation({
    mutationFn: (id) => leDunning.update(id, {
      status: 'bezahlt',
    }),
    onSuccess: () => {
      toast.success('Mahnung als bezahlt markiert');
      invalidate();
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const escalateMut = useMutation({
    mutationFn: async (dun) => {
      const nextLevel = Math.min(3, (dun.level || 1) + 1);
      // Aktuelle Mahnung als 'eskaliert' markieren
      await leDunning.update(dun.id, { status: 'eskaliert' });
      // Neue Mahnung auf nächster Stufe als Entwurf erstellen
      const today = todayIso();
      const fee = DEFAULT_FEES[nextLevel] ?? 0;
      const outstanding = Number(dun.outstanding_amount ?? 0);
      const interestAmount = computeInterest(outstanding, dun.interest_from);
      await leDunning.create({
        invoice_id: dun.invoice_id,
        customer_id: dun.customer_id,
        level: nextLevel,
        dunning_date: today,
        new_due_date: addDaysIso(DEFAULT_DAYS[nextLevel] ?? 10),
        fee,
        interest_rate_pct: 5.0,
        interest_from: dun.interest_from,
        interest_amount: interestAmount,
        outstanding_amount: outstanding,
        total_amount: outstanding + fee + interestAmount,
        is_betreibungsandrohung: nextLevel === 3,
        status: 'entwurf',
      });
      return nextLevel;
    },
    onSuccess: (lv) => {
      toast.success(`Auf Stufe ${lv} eskaliert (neuer Entwurf erstellt)`);
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // --- Abgeleitete Daten ---
  const dunnings = dunningQ.data ?? [];

  const filtered = useMemo(() => {
    return dunnings.filter((d) => {
      if (levelFilter && String(d.level) !== levelFilter) return false;
      return true;
    });
  }, [dunnings, levelFilter]);

  const counts = useMemo(() => {
    const c = { '': allDunnings.length };
    for (const d of allDunnings) {
      c[d.status] = (c[d.status] ?? 0) + 1;
    }
    return c;
  }, [allDunnings]);

  const totalSum = useMemo(
    () => filtered.reduce((sum, d) => sum + Number(d.total_amount ?? 0), 0),
    [filtered],
  );

  if (dunningQ.error) {
    return <PanelError error={dunningQ.error} onRetry={() => dunningQ.refetch()} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter-Leiste */}
      <Card className="p-3 space-y-3">
        {/* Status-Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => {
            const active = statusFilter === t.key;
            const n = counts[t.key] ?? 0;
            return (
              <button
                key={t.key || 'alle'}
                type="button"
                onClick={() => setStatusFilter(t.key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                style={
                  active
                    ? { background: '#7a9b7f', color: '#fff', borderColor: '#7a9b7f' }
                    : { background: '#fff', color: '#3d4a3d', borderColor: '#d1dcd1' }
                }
              >
                {t.label}
                <span
                  className="inline-flex items-center justify-center min-w-[18px] px-1 h-4 rounded text-[10px] tabular-nums"
                  style={{
                    background: active ? 'rgba(255,255,255,0.22)' : '#f1f1ef',
                    color: active ? '#fff' : '#6a6a6a',
                  }}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {/* Stufen-Filter */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Stufe">
            <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="">Alle Stufen</option>
              <option value="1">Stufe 1</option>
              <option value="2">Stufe 2</option>
              <option value="3">Stufe 3 (Betreibungsandrohung)</option>
            </Select>
          </Field>
        </div>
      </Card>

      {/* Tabelle */}
      <Card>
        {dunningQ.isLoading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <FileText className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine Mahnungen gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="text-left font-semibold px-3 py-2 w-32">Mahnnr.</th>
                  <th className="text-left font-semibold px-3 py-2 w-24">Datum</th>
                  <th className="text-left font-semibold px-3 py-2 w-20">Stufe</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Rechnung</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Hauptford.</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">Gebühr</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">Zins</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Total</th>
                  <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
                  <th className="text-right font-semibold px-3 py-2 w-40">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <DunningRow
                    key={d.id}
                    dun={d}
                    onSend={() => sendMut.mutate(d.id)}
                    onPay={() => {
                      if (window.confirm('Diese Mahnung als bezahlt markieren?')) payMut.mutate(d.id);
                    }}
                    onEscalate={() => {
                      if (d.level >= 3) {
                        toast.info('Bereits Stufe 3 (Betreibungsandrohung) – höher nicht möglich');
                        return;
                      }
                      if (window.confirm(`Auf Stufe ${d.level + 1} eskalieren? Es wird ein neuer Entwurf erstellt.`)) {
                        escalateMut.mutate(d);
                      }
                    }}
                    sending={sendMut.isPending && sendMut.variables === d.id}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t" style={{ borderColor: '#e4e7e4' }}>
                  <td colSpan={8} className="px-3 py-2 text-right text-xs text-zinc-500">
                    {filtered.length} Mahnung{filtered.length === 1 ? '' : 'en'} · Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: '#2d5a2d' }}>
                    {fmt.chf(totalSum)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Mahnungs-Zeile --------------------------------------------------------

function DunningRow({ dun, onSend, onPay, onEscalate, sending }) {
  const statusInfo = STATUS_CHIP[dun.status] ?? STATUS_CHIP.entwurf;
  const canSend = dun.status === 'entwurf';
  const canPay = dun.status === 'versendet' || dun.status === 'eskaliert';
  const canEscalate = (dun.status === 'versendet' || dun.status === 'eskaliert') && (dun.level || 0) < 3;

  return (
    <tr className="border-b last:border-b-0 hover:bg-zinc-50" style={{ borderColor: '#eef1ee' }}>
      <td className="px-3 py-2">
        {dun.dunning_no ? (
          <span className="font-semibold tabular-nums">{dun.dunning_no}</span>
        ) : (
          <span className="text-zinc-400 italic">(Entwurf)</span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(dun.dunning_date)}</td>
      <td className="px-3 py-2">
        <Chip tone={levelChipTone(dun.level)}>
          {dun.level >= 3 && <AlertTriangle className="w-3 h-3 mr-0.5" />}
          {dun.level}
        </Chip>
      </td>
      <td className="px-3 py-2">
        {dun.customer?.company_name ?? <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-600">
        {dun.invoice?.invoice_no ?? <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(dun.outstanding_amount)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(dun.fee)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(dun.interest_amount)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>
        {fmt.chf(dun.total_amount)}
      </td>
      <td className="px-3 py-2">
        <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconBtn
            onClick={async () => {
              try {
                const company = await leCompany.get();
                if (!company) { toast.error('Firmen-Settings fehlen.'); return; }
                const fullInv = await leInvoice.get(dun.invoice_id);
                const result = await generateDunningPdf({
                  dunning: dun, invoice: fullInv,
                  customer: fullInv.customer, company,
                });
                if (result.blob) triggerDownload(result.blob, `Mahnung-${dun.dunning_no || 'Entwurf'}.pdf`);
                toast.success('Mahn-PDF erzeugt');
              } catch (e) { toast.error('PDF-Fehler: ' + (e?.message ?? e)); }
            }}
            title="PDF herunterladen"
          >
            <FileDown className="w-3.5 h-3.5" />
          </IconBtn>
          {canSend && (
            <IconBtn onClick={onSend} title={sending ? 'Versende…' : 'Versenden (finalisiert)'}>
              <Send className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canPay && (
            <IconBtn onClick={onPay} title="Bezahlt markieren">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canEscalate && (
            <IconBtn onClick={onEscalate} title={`Auf Stufe ${(dun.level || 1) + 1} eskalieren`}>
              <ChevronUp className="w-3.5 h-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}
