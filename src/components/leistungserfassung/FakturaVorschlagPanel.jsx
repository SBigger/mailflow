// Leistungserfassung · Faktura-Vorschlag
// Offene, nicht-verrechnete Zeiteinträge nach Projekt gruppieren und als
// Rechnungsentwürfe erzeugen.

import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Filter, CheckSquare, Receipt, ChevronDown, ChevronRight, Calendar,
} from 'lucide-react';
import { fakturaVorschlagData, createInvoiceDraftsFromEntries } from '@/lib/leApi';
import {
  Card, Chip, IconBtn, Input, Field, PanelLoader, PanelError, PanelHeader,
  artisBtn, artisPrimaryStyle, artisGhostStyle, fmt,
} from './shared';

// --- Helpers ---------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (iso, days) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const STATUS_CHIP = {
  erfasst:     { tone: 'neutral', label: 'erfasst' },
  freigegeben: { tone: 'green',   label: 'freigegeben' },
  verrechnet:  { tone: 'blue',    label: 'verrechnet' },
  storniert:   { tone: 'red',     label: 'storniert' },
};

// --- Panel -----------------------------------------------------------------

export default function FakturaVorschlagPanel() {
  const qc = useQueryClient();

  // Default-Zeitraum: letzte 90 Tage bis heute
  const [fromDate, setFromDate] = useState(() => addDays(todayIso(), -90));
  const [toDate, setToDate] = useState(() => todayIso());

  // Applied filter (changed by "Aktualisieren"-Button)
  const [appliedRange, setAppliedRange] = useState(() => ({
    fromIso: addDays(todayIso(), -90),
    toIso: todayIso(),
  }));

  const [selectedProjectIds, setSelectedProjectIds] = useState(() => new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState(() => new Set());

  // Cross-Panel: Projekt-Vorauswahl aus Tagesansicht (sessionStorage)
  useEffect(() => {
    const id = sessionStorage.getItem('le.fakvor.preselectProject');
    if (id) {
      sessionStorage.removeItem('le.fakvor.preselectProject');
      setSelectedProjectIds(new Set([id]));
      setExpandedProjectIds(new Set([id]));
      toast.info('Projekt vorausgewählt – Zeitraum bei Bedarf anpassen');
    }
  }, []);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // --- Query ---------------------------------------------------------------
  const entriesQ = useQuery({
    queryKey: ['le', 'faktura', appliedRange.fromIso, appliedRange.toIso],
    queryFn: () => fakturaVorschlagData({ fromIso: appliedRange.fromIso, toIso: appliedRange.toIso }),
  });

  const entries = entriesQ.data ?? [];

  // --- Gruppierung nach Projekt -------------------------------------------
  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = e.project_id;
      if (!map.has(key)) {
        map.set(key, {
          project_id: key,
          project: e.project,
          customer: e.project?.customer,
          entries: [],
        });
      }
      map.get(key).entries.push(e);
    }
    return [...map.values()].map((g) => {
      const totalHours = g.entries.reduce((s, e) => s + Number(e.hours_internal || 0), 0);
      const totalChf = g.entries
        .filter((e) => e.service_type?.billable !== false)
        .reduce((s, e) => s + Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0), 0);
      // Status-Mix
      const statusSet = new Set(g.entries.map((e) => e.status));
      return { ...g, totalHours, totalChf, statuses: [...statusSet] };
    }).sort((a, b) => (a.project?.name ?? '').localeCompare(b.project?.name ?? ''));
  }, [entries]);

  // --- Auswahl-Helpers -----------------------------------------------------
  const toggleProject = (id) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = grouped.length > 0 && grouped.every((g) => selectedProjectIds.has(g.project_id));
  const someSelected = grouped.some((g) => selectedProjectIds.has(g.project_id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(grouped.map((g) => g.project_id)));
    }
  };

  // --- Selection-Summary ---------------------------------------------------
  const selectionSummary = useMemo(() => {
    const selected = grouped.filter((g) => selectedProjectIds.has(g.project_id));
    const projectCount = selected.length;
    const entryCount = selected.reduce((s, g) => s + g.entries.length, 0);
    const hours = selected.reduce((s, g) => s + g.totalHours, 0);
    const chf = selected.reduce((s, g) => s + g.totalChf, 0);
    return { projectCount, entryCount, hours, chf, selected };
  }, [grouped, selectedProjectIds]);

  // --- Mutation: Drafts erstellen -----------------------------------------
  const createDraftsMut = useMutation({
    mutationFn: async () => {
      const selected = selectionSummary.selected;
      const allEntries = selected.flatMap((g) => g.entries);
      const projectIds = selected.map((g) => g.project_id);
      return createInvoiceDraftsFromEntries({
        entries: allEntries,
        projectIds,
        periodFrom: appliedRange.fromIso,
        periodTo: appliedRange.toIso,
      });
    },
    onSuccess: (invoices) => {
      const n = Array.isArray(invoices) ? invoices.length : selectionSummary.projectCount;
      toast.success(`${n} Rechnungsentwurf${n === 1 ? '' : 'entwürfe'} erstellt`);
      setSelectedProjectIds(new Set());
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ['le', 'faktura'] });
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
      qc.invalidateQueries({ queryKey: ['le', 'time_entry'] });
    },
    onError: (e) => {
      toast.error('Fehler: ' + (e?.message ?? e));
      setConfirmOpen(false);
    },
  });

  // --- Refresh -------------------------------------------------------------
  const applyFilter = () => {
    setAppliedRange({ fromIso: fromDate, toIso: toDate });
    setSelectedProjectIds(new Set());
    setExpandedProjectIds(new Set());
  };

  // --- Loading / Error -----------------------------------------------------
  if (entriesQ.error) {
    return <PanelError error={entriesQ.error} onRetry={() => entriesQ.refetch()} />;
  }

  // --- Render --------------------------------------------------------------
  return (
    <div className="space-y-4 pb-24">
      <PanelHeader
        title="Faktura-Vorschlag"
        subtitle="Offene Leistungen zu Rechnungsentwürfen bündeln"
      />

      {/* Filter-Card */}
      <Card className="p-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            <Filter className="w-4 h-4" />
            Zeitraum
          </div>
          <div className="w-40">
            <Field label="Von">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Bis">
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={applyFilter}
            className={artisBtn.primary}
            style={artisPrimaryStyle}
          >
            <Calendar className="w-4 h-4" />
            Aktualisieren
          </button>
          {entriesQ.isFetching && (
            <span className="text-xs text-zinc-400 ml-1">Lade…</span>
          )}
        </div>
      </Card>

      {/* Haupt-Tabelle */}
      <Card>
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4' }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Projekte mit offenen Leistungen
          </div>
          <div className="text-xs text-zinc-400 tabular-nums">
            {grouped.length} Projekt{grouped.length === 1 ? '' : 'e'} · {entries.length} Einträge
          </div>
        </div>

        {entriesQ.isLoading ? (
          <PanelLoader />
        ) : grouped.length === 0 ? (
          <div className="p-8 text-sm text-zinc-400 text-center">
            Keine offenen Leistungen im gewählten Zeitraum.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                      onChange={toggleAll}
                      title="Alle auswählen"
                    />
                  </th>
                  <th className="px-2 py-2 w-8" />
                  <th className="text-left font-semibold px-3 py-2">Projekt</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">Einträge</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">Std.</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">CHF</th>
                  <th className="text-left font-semibold px-3 py-2 w-40">Status</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => {
                  const isSelected = selectedProjectIds.has(g.project_id);
                  const isExpanded = expandedProjectIds.has(g.project_id);
                  return (
                    <React.Fragment key={g.project_id}>
                      <tr
                        className="border-b cursor-pointer hover:bg-zinc-50/60"
                        style={{
                          borderColor: '#eef1ee',
                          background: isSelected ? '#f5faf5' : undefined,
                        }}
                        onClick={() => toggleExpanded(g.project_id)}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleProject(g.project_id)}
                          />
                        </td>
                        <td className="px-2 py-2 text-zinc-400">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-800">
                          {g.project?.name ?? <span className="text-zinc-300">— ohne Projekt —</span>}
                        </td>
                        <td className="px-3 py-2 text-zinc-600">
                          {g.customer?.company_name ?? <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.entries.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(g.totalHours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>
                          {fmt.chf(g.totalChf)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {g.statuses.map((s) => {
                              const info = STATUS_CHIP[s] ?? { tone: 'neutral', label: s };
                              return <Chip key={s} tone={info.tone}>{info.label}</Chip>;
                            })}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: '#fafbf9' }}>
                          <td colSpan={8} className="px-0 py-0">
                            <EntriesSubTable entries={g.entries} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Sticky Footer-Bar */}
      {grouped.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 border-t z-20"
          style={{ background: '#ffffffee', borderColor: '#e4e7e4', backdropFilter: 'blur(4px)' }}
        >
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center gap-4">
            <CheckSquare className="w-4 h-4 text-zinc-400" />
            <div className="text-sm text-zinc-700 tabular-nums">
              <span className="font-semibold">{selectionSummary.projectCount}</span>
              <span className="text-zinc-500"> Projekt{selectionSummary.projectCount === 1 ? '' : 'e'} ausgewählt</span>
              <span className="text-zinc-300 mx-2">·</span>
              <span className="font-semibold">{fmt.hours(selectionSummary.hours)}</span>
              <span className="text-zinc-500">h</span>
              <span className="text-zinc-300 mx-2">·</span>
              <span className="font-semibold" style={{ color: '#2d5a2d' }}>CHF {fmt.chf(selectionSummary.chf)}</span>
            </div>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={selectionSummary.projectCount === 0 || createDraftsMut.isPending}
                className={artisBtn.primary}
                style={{
                  ...artisPrimaryStyle,
                  opacity: selectionSummary.projectCount === 0 || createDraftsMut.isPending ? 0.45 : 1,
                }}
              >
                <Receipt className="w-4 h-4" />
                Rechnungsentwürfe erstellen ({selectionSummary.projectCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation-Dialog */}
      {confirmOpen && (
        <ConfirmDialog
          summary={selectionSummary}
          loading={createDraftsMut.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => createDraftsMut.mutate()}
        />
      )}
    </div>
  );
}

// --- Sub-Tabelle: Einträge eines Projekts ----------------------------------

function EntriesSubTable({ entries }) {
  return (
    <div className="px-4 py-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
            <th className="text-left font-semibold px-2 py-1.5 w-24">Datum</th>
            <th className="text-left font-semibold px-2 py-1.5 w-20">MA</th>
            <th className="text-left font-semibold px-2 py-1.5">Leistungsart</th>
            <th className="text-right font-semibold px-2 py-1.5 w-16">Std.</th>
            <th className="text-right font-semibold px-2 py-1.5 w-20">Satz</th>
            <th className="text-right font-semibold px-2 py-1.5 w-24">Wert</th>
            <th className="text-left font-semibold px-2 py-1.5">Beschreibung</th>
          </tr>
        </thead>
        <tbody>
          {entries
            .slice()
            .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
            .map((e) => {
              const billable = e.service_type?.billable !== false;
              const wert = Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0);
              return (
                <tr key={e.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                  <td className="px-2 py-1.5 tabular-nums text-zinc-600">{fmt.date(e.entry_date)}</td>
                  <td className="px-2 py-1.5 text-zinc-600">
                    {e.employee?.short_code ?? e.employee?.full_name ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {e.service_type?.name ?? '—'}
                    {!billable && <span className="ml-1 text-[10px] text-zinc-400">(nicht abrechenbar)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt.hours(e.hours_internal)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{fmt.chf(e.rate_snapshot)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: billable ? '#2d5a2d' : '#a0a0a0' }}>
                    {fmt.chf(wert)}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600 truncate max-w-[320px]">
                    {e.description || <span className="text-zinc-300">—</span>}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// --- Confirmation-Dialog ----------------------------------------------------

function ConfirmDialog({ summary, loading, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,30,20,0.35)' }}
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-lg border shadow-xl max-w-md w-full"
        style={{ borderColor: '#d1dcd1' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 border-b flex items-center gap-2"
          style={{ borderColor: '#e4e7e4', background: '#e6ede6', color: '#2d5a2d' }}
        >
          <Receipt className="w-4 h-4" />
          <div className="text-sm font-semibold">Rechnungsentwürfe erstellen</div>
        </div>
        <div className="p-4 text-sm text-zinc-700 space-y-3">
          <p>
            Aus <b>{summary.projectCount}</b> Projekt{summary.projectCount === 1 ? '' : 'en'}
            {' '}(<b>{summary.entryCount}</b> Einträge, <b style={{ color: '#2d5a2d' }}>CHF {fmt.chf(summary.chf)}</b>)
            {' '}werden Rechnungsentwürfe erstellt.
          </p>
          <p className="text-xs text-zinc-500">
            Die zugehörigen Zeiteinträge werden auf <Chip tone="blue">verrechnet</Chip> gesetzt und können danach nicht mehr ohne Storno geändert werden.
          </p>
          <p className="text-xs text-zinc-500">Fortfahren?</p>
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: '#e4e7e4' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={artisBtn.ghost}
            style={{ ...artisGhostStyle, opacity: loading ? 0.5 : 1 }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: loading ? 0.6 : 1 }}
          >
            <Receipt className="w-4 h-4" />
            {loading ? 'Erstelle…' : 'Entwürfe erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
