// Leistungserfassung · Faktura-Vorschlag
// Offene, nicht-verrechnete Zeiteinträge nach Projekt gruppieren und als
// Rechnungsentwürfe erzeugen.

import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Filter, CheckSquare, Receipt, ChevronDown, ChevronRight, Calendar, Zap,
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
  kulant:      { tone: 'violet',  label: 'Kulant' },
  verrechnet:  { tone: 'blue',    label: 'verrechnet' },
  storniert:   { tone: 'red',     label: 'storniert' },
};

// --- Panel -----------------------------------------------------------------

export default function FakturaVorschlagPanel() {
  const qc = useQueryClient();

  // Default-Zeitraum: letzte 90 Tage bis heute
  const [fromDate, setFromDate] = useState(() => addDays(todayIso(), -90));
  const [toDate, setToDate] = useState(() => todayIso());
  const [allOpen, setAllOpen] = useState(false);

  // Applied filter (changed by "Aktualisieren"-Button)
  const [appliedRange, setAppliedRange] = useState(() => ({
    fromIso: addDays(todayIso(), -90),
    toIso: todayIso(),
    allOpen: false,
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
    queryKey: ['le', 'faktura', appliedRange.fromIso, appliedRange.toIso, appliedRange.allOpen],
    queryFn: () => fakturaVorschlagData({
      fromIso: appliedRange.fromIso,
      toIso: appliedRange.toIso,
      allOpen: appliedRange.allOpen,
    }),
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
      // Splitting: billable (erfasst/freigegeben + service.billable) vs. kulant
      const billable = g.entries.filter((e) => e.status !== 'kulant' && e.service_type?.billable !== false);
      const kulant = g.entries.filter((e) => e.status === 'kulant');
      const billableHours = billable.reduce((s, e) => s + Number(e.hours_internal || 0), 0);
      const billableChf = billable.reduce((s, e) => s + Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0), 0);
      const kulantHours = kulant.reduce((s, e) => s + Number(e.hours_internal || 0), 0);
      const kulantChf = kulant.reduce((s, e) => s + Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0), 0);
      const statusSet = new Set(g.entries.map((e) => e.status));
      return {
        ...g,
        totalHours: billableHours + kulantHours,
        totalChf: billableChf,
        billableHours, billableChf,
        kulantHours, kulantChf,
        billableCount: billable.length,
        kulantCount: kulant.length,
        statuses: [...statusSet],
      };
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
    const billableHours = selected.reduce((s, g) => s + g.billableHours, 0);
    const billableChf = selected.reduce((s, g) => s + g.billableChf, 0);
    const kulantHours = selected.reduce((s, g) => s + g.kulantHours, 0);
    const kulantChf = selected.reduce((s, g) => s + g.kulantChf, 0);
    return {
      projectCount, entryCount,
      hours: billableHours + kulantHours, chf: billableChf,
      billableHours, billableChf, kulantHours, kulantChf,
      selected,
    };
  }, [grouped, selectedProjectIds]);

  // --- Mutation: Rechnungen erstellen (Entwurf oder Direkt) ----------------
  const [confirmMode, setConfirmMode] = useState('draft'); // 'draft' | 'direct'

  const createInvoicesMut = useMutation({
    mutationFn: async () => {
      const selected = selectionSummary.selected;
      const allEntries = selected.flatMap((g) => g.entries);
      const projectIds = selected.map((g) => g.project_id);
      return createInvoiceDraftsFromEntries({
        entries: allEntries,
        projectIds,
        periodFrom: appliedRange.allOpen ? null : appliedRange.fromIso,
        periodTo: appliedRange.allOpen ? null : appliedRange.toIso,
        direct: confirmMode === 'direct',
        includeKulant: true,
      });
    },
    onSuccess: (invoices) => {
      const n = Array.isArray(invoices) ? invoices.length : selectionSummary.projectCount;
      const verb = confirmMode === 'direct' ? 'Rechnung' : 'Rechnungsentwurf';
      toast.success(`${n} ${verb}${n === 1 ? '' : 'en'} erstellt`);
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
    setAppliedRange({ fromIso: fromDate, toIso: toDate, allOpen });
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
                disabled={allOpen}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Bis">
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={allOpen}
              />
            </Field>
          </div>
          <label
            className="inline-flex items-center gap-2 text-sm cursor-pointer select-none mb-1"
            title="Alle offenen Leistungen ohne Datumsfilter anzeigen"
          >
            <input
              type="checkbox"
              checked={allOpen}
              onChange={(e) => setAllOpen(e.target.checked)}
            />
            <span className="text-zinc-700">Alle offenen Leistungen</span>
          </label>
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
                  <th className="text-right font-semibold px-3 py-2 w-24" title="Kulant-Anteil (Std. / CHF)">Kulant</th>
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
                        <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(g.billableHours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>
                          {fmt.chf(g.billableChf)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#4d2995' }}>
                          {g.kulantCount > 0 ? (
                            <span title={`${g.kulantCount} kulante Einträge · ${fmt.chf(g.kulantChf)} CHF Wert`}>
                              {fmt.hours(g.kulantHours)}h
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
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
                          <td colSpan={9} className="px-0 py-0">
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
              <span className="text-zinc-500"> Projekt{selectionSummary.projectCount === 1 ? '' : 'e'} · </span>
              <span className="font-semibold">{fmt.hours(selectionSummary.billableHours)}h</span>
              <span className="text-zinc-300 mx-1">·</span>
              <span className="font-semibold" style={{ color: '#2d5a2d' }}>CHF {fmt.chf(selectionSummary.billableChf)}</span>
              {selectionSummary.kulantHours > 0 && (
                <>
                  <span className="text-zinc-300 mx-2">+</span>
                  <span className="text-xs" style={{ color: '#4d2995' }}>
                    {fmt.hours(selectionSummary.kulantHours)}h kulant
                  </span>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setConfirmMode('draft'); setConfirmOpen(true); }}
                disabled={selectionSummary.projectCount === 0 || createInvoicesMut.isPending}
                className={artisBtn.ghost}
                style={{
                  ...artisGhostStyle,
                  opacity: selectionSummary.projectCount === 0 || createInvoicesMut.isPending ? 0.45 : 1,
                }}
              >
                <Receipt className="w-4 h-4" />
                Entwürfe ({selectionSummary.projectCount})
              </button>
              <button
                type="button"
                onClick={() => { setConfirmMode('direct'); setConfirmOpen(true); }}
                disabled={selectionSummary.projectCount === 0 || createInvoicesMut.isPending}
                className={artisBtn.primary}
                style={{
                  ...artisPrimaryStyle,
                  opacity: selectionSummary.projectCount === 0 || createInvoicesMut.isPending ? 0.45 : 1,
                }}
                title="Sofortige Rechnung (Status definitiv, mit Issue-Date heute)"
              >
                <Zap className="w-4 h-4" />
                Direkt-Rechnung ({selectionSummary.projectCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation-Dialog */}
      {confirmOpen && (
        <ConfirmDialog
          mode={confirmMode}
          summary={selectionSummary}
          loading={createInvoicesMut.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => createInvoicesMut.mutate()}
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
              const billable = e.status !== 'kulant' && e.service_type?.billable !== false;
              const isKulant = e.status === 'kulant';
              const wert = Number(e.hours_internal || 0) * Number(e.rate_snapshot || 0);
              const rowStyle = isKulant
                ? { borderColor: '#eef1ee', background: '#faf6ff' }
                : { borderColor: '#eef1ee' };
              return (
                <tr key={e.id} className="border-b last:border-b-0" style={rowStyle}>
                  <td className="px-2 py-1.5 tabular-nums text-zinc-600">{fmt.date(e.entry_date)}</td>
                  <td className="px-2 py-1.5 text-zinc-600">
                    {e.employee?.short_code ?? e.employee?.full_name ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {e.service_type?.name ?? '—'}
                    {isKulant && <span className="ml-1 text-[10px] font-medium" style={{ color: '#4d2995' }}>(kulant)</span>}
                    {!isKulant && !billable && <span className="ml-1 text-[10px] text-zinc-400">(nicht abrechenbar)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt.hours(e.hours_internal)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{fmt.chf(e.rate_snapshot)}</td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{
                      color: isKulant ? '#4d2995' : (billable ? '#2d5a2d' : '#a0a0a0'),
                      textDecoration: isKulant ? 'line-through' : undefined,
                    }}
                  >
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

function ConfirmDialog({ mode = 'draft', summary, loading, onCancel, onConfirm }) {
  const isDirect = mode === 'direct';
  const titleText = isDirect ? 'Direkt-Rechnungen erstellen' : 'Rechnungsentwürfe erstellen';
  const headerStyle = isDirect
    ? { background: '#fff8e6', color: '#7a5a00', borderColor: '#f0e4c0' }
    : { background: '#e6ede6', color: '#2d5a2d', borderColor: '#e4e7e4' };
  const Icon = isDirect ? Zap : Receipt;
  const targetStatus = isDirect ? 'definitiv' : 'entwurf';

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
          style={headerStyle}
        >
          <Icon className="w-4 h-4" />
          <div className="text-sm font-semibold">{titleText}</div>
        </div>
        <div className="p-4 text-sm text-zinc-700 space-y-3">
          <p>
            Aus <b>{summary.projectCount}</b> Projekt{summary.projectCount === 1 ? '' : 'en'}
            {' '}werden <b>{summary.projectCount}</b> {isDirect ? 'Rechnung' : 'Rechnungsentwurf'}
            {summary.projectCount === 1 ? '' : 'en'} mit Status <Chip tone={isDirect ? 'orange' : 'neutral'}>{targetStatus}</Chip> erstellt.
          </p>
          <div className="rounded border bg-zinc-50/60 px-3 py-2 text-xs space-y-1" style={{ borderColor: '#eef1ee' }}>
            <div>
              <span className="text-zinc-500">Verrechnet (Subtotal): </span>
              <b>{fmt.hours(summary.billableHours)}h</b>{' · '}
              <b style={{ color: '#2d5a2d' }}>CHF {fmt.chf(summary.billableChf)}</b>
            </div>
            {summary.kulantHours > 0 && (
              <div>
                <span className="text-zinc-500">Kulant (Beiblatt, nicht im Subtotal): </span>
                <b style={{ color: '#4d2995' }}>{fmt.hours(summary.kulantHours)}h</b>{' · '}
                <span style={{ color: '#4d2995' }}>CHF {fmt.chf(summary.kulantChf)}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Verrechnete Einträge → <Chip tone="blue">verrechnet</Chip>
            {summary.kulantHours > 0 && <>, kulante Einträge → <Chip tone="violet">kulant_abgerechnet</Chip></>}.
            Fortfahren?
          </p>
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
            style={{
              ...artisPrimaryStyle,
              ...(isDirect ? { background: '#c89a2a' } : {}),
              opacity: loading ? 0.6 : 1,
            }}
          >
            <Icon className="w-4 h-4" />
            {loading ? 'Erstelle…' : (isDirect ? 'Direkt-Rechnung erstellen' : 'Entwürfe erstellen')}
          </button>
        </div>
      </div>
    </div>
  );
}
