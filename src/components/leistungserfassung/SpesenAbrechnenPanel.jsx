// Leistungserfassung · Spesen abrechnen
// Pendant zu "Faktura-Vorschlag", aber für Spesen: Listet alle weiterverrechen-
// baren, genehmigten, noch nicht abgerechneten Spesen, gruppiert nach Kunde,
// und erzeugt pro Kunde EINEN Rechnungsentwurf mit allen ausgewählten Spesen
// als Rechnungszeilen.

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Receipt, Wallet, ChevronDown, ChevronRight, Check, FileText, Calendar, Search,
} from 'lucide-react';
import { leExpense, leInvoice, leInvoiceLine, leCompany } from '@/lib/leApi';
import {
  Card, Chip, Input, Select, Field, PanelLoader, PanelError, PanelHeader,
  artisBtn, artisPrimaryStyle, artisGhostStyle, fmt,
} from './shared';

// ---------------------------------------------------------------------------
// Helpers / Konstanten
// ---------------------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addDays = (iso, days) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const CATEGORY_META = {
  km:              { label: 'KM-Geld',          tone: 'blue' },
  oev:             { label: 'ÖV',               tone: 'blue' },
  verpflegung:     { label: 'Verpflegung',      tone: 'orange' },
  uebernachtung:   { label: 'Übernachtung',     tone: 'violet' },
  telefon:         { label: 'Telefon',          tone: 'neutral' },
  material:        { label: 'Material',         tone: 'neutral' },
  weiterbildung:   { label: 'Weiterbildung',    tone: 'green' },
  repraesentation: { label: 'Repräsentation',   tone: 'orange' },
  behoerden:       { label: 'Behörden',         tone: 'neutral' },
  sonstiges:       { label: 'Sonstiges',        tone: 'neutral' },
};

const categoryLabel = (id) => CATEGORY_META[id]?.label ?? (id || '—');
const categoryTone  = (id) => CATEGORY_META[id]?.tone  ?? 'neutral';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function SpesenAbrechnenPanel() {
  const qc = useQueryClient();

  // Filter-State
  const [fromDate, setFromDate] = useState(() => addDays(todayIso(), -90));
  const [toDate, setToDate] = useState(() => todayIso());
  const [appliedRange, setAppliedRange] = useState(() => ({
    fromIso: addDays(todayIso(), -90),
    toIso: todayIso(),
  }));
  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Auswahl
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [expandedCustomerIds, setExpandedCustomerIds] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // --- Queries -------------------------------------------------------------
  const expensesQ = useQuery({
    queryKey: ['le', 'expense', 'abrechnen', appliedRange.fromIso, appliedRange.toIso],
    queryFn: () => leExpense.list({
      status: 'genehmigt',
      from: appliedRange.fromIso,
      to: appliedRange.toIso,
    }),
  });

  const companyQ = useQuery({
    queryKey: ['le', 'company'],
    queryFn: () => leCompany.get(),
  });

  const expenses = expensesQ.data ?? [];
  const company = companyQ.data;

  // --- Filter: weiterverrechenbar + nicht abgerechnet ---------------------
  const billable = useMemo(() => {
    return expenses
      .filter((e) => e.rebillable && !e.invoiced_invoice_id && e.status === 'genehmigt')
      .filter((e) => e.customer_id || e.project?.customer_id || e.project_id);
  }, [expenses]);

  // --- Gruppierung nach Kunde ---------------------------------------------
  const groupedByCustomer = useMemo(() => {
    const m = new Map();
    for (const e of billable) {
      const key = e.customer_id ?? e.project?.customer_id ?? null;
      if (!key) continue;
      if (!m.has(key)) {
        m.set(key, {
          customer_id: key,
          customer: e.customer ?? e.project?.customer ?? null,
          expenses: [],
        });
      }
      m.get(key).expenses.push(e);
    }
    let rows = [...m.values()].map((g) => {
      const totalGross = g.expenses.reduce((s, e) => s + Number(e.amount_gross || 0), 0);
      return { ...g, totalGross };
    });
    // Customer-Filter
    if (customerFilter !== 'all') {
      rows = rows.filter((g) => String(g.customer_id) === String(customerFilter));
    }
    // Suche
    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      rows = rows.filter((g) => {
        const name = (g.customer?.company_name ?? '').toLowerCase();
        if (name.includes(t)) return true;
        return g.expenses.some((e) =>
          (e.description ?? '').toLowerCase().includes(t)
          || categoryLabel(e.category).toLowerCase().includes(t)
        );
      });
    }
    return rows.sort((a, b) =>
      (a.customer?.company_name ?? '').localeCompare(b.customer?.company_name ?? ''),
    );
  }, [billable, customerFilter, searchTerm]);

  // Customer-Liste für Filter-Dropdown (alle, die billable Expenses haben)
  const customerOptions = useMemo(() => {
    const m = new Map();
    for (const e of billable) {
      const id = e.customer_id ?? e.project?.customer_id ?? null;
      if (!id) continue;
      const c = e.customer ?? e.project?.customer ?? null;
      if (!m.has(id)) m.set(id, { id, name: c?.company_name ?? '— ohne Name —' });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [billable]);

  // --- Auswahl-Helpers -----------------------------------------------------
  const toggleExpense = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (cid) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  };

  const toggleCustomerAll = (group) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = group.expenses.every((e) => next.has(e.id));
      if (allOn) {
        for (const e of group.expenses) next.delete(e.id);
      } else {
        for (const e of group.expenses) next.add(e.id);
      }
      return next;
    });
  };

  // --- Selection-Summary ---------------------------------------------------
  const selectionSummary = useMemo(() => {
    const flat = groupedByCustomer.flatMap((g) => g.expenses);
    const selected = flat.filter((e) => selectedIds.has(e.id));
    const customerSet = new Set(selected.map((e) => e.customer_id ?? e.project?.customer_id));
    const sumGross = selected.reduce((s, e) => s + Number(e.amount_gross || 0), 0);
    return {
      selectedExpenses: selected,
      expenseCount: selected.length,
      customerCount: customerSet.size,
      sumGross,
    };
  }, [groupedByCustomer, selectedIds]);

  // --- Mutation: Rechnungsentwürfe erstellen -------------------------------
  const createInvoicesMut = useMutation({
    mutationFn: async () => {
      const selected = selectionSummary.selectedExpenses;
      // Pro Kunde sammeln
      const byCustomer = new Map();
      for (const e of selected) {
        const cid = e.customer_id ?? e.project?.customer_id;
        if (!cid) continue;
        if (!byCustomer.has(cid)) byCustomer.set(cid, []);
        byCustomer.get(cid).push(e);
      }

      const created = [];
      for (const [customerId, items] of byCustomer) {
        const subtotal = items.reduce((s, e) => s + Number(e.amount_gross || 0), 0);
        const vatPct = company?.vat_default_pct ?? 8.1;
        const vatAmount = Math.round(subtotal * vatPct) / 100;
        const total = subtotal + vatAmount;

        const inv = await leInvoice.create({
          customer_id: customerId,
          project_id: items[0].project_id ?? null,
          status: 'entwurf',
          subtotal,
          vat_pct: vatPct,
          vat_amount: vatAmount,
          total,
          notes: 'Spesen-Verrechnung',
        });

        const lines = items.map((e, i) => ({
          invoice_id: inv.id,
          description: `${categoryLabel(e.category)}: ${e.description ?? ''} (${fmt.date(e.expense_date)})`,
          hours: 0,
          rate: 0,
          amount: Number(e.amount_gross || 0),
          sort_order: (i + 1) * 10,
        }));
        await leInvoiceLine.bulkCreate(lines);

        // Spesen markieren
        for (const e of items) {
          await leExpense.update(e.id, {
            status: 'abgerechnet',
            invoiced_invoice_id: inv.id,
          });
        }
        created.push(inv);
      }
      return created;
    },
    onSuccess: (invoices) => {
      const n = invoices.length;
      toast.success(`${n} Rechnungsentwurf${n === 1 ? '' : 'entwürfe'} erstellt`);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ['le', 'expense'] });
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    },
    onError: (e) => {
      toast.error('Fehler: ' + (e?.message ?? e));
      setConfirmOpen(false);
    },
  });

  // --- Filter-Apply --------------------------------------------------------
  const applyFilter = () => {
    setAppliedRange({ fromIso: fromDate, toIso: toDate });
    setSelectedIds(new Set());
    setExpandedCustomerIds(new Set());
  };

  // --- Loading / Error -----------------------------------------------------
  if (expensesQ.error) {
    return <PanelError error={expensesQ.error} onRetry={() => expensesQ.refetch()} />;
  }

  // --- Render --------------------------------------------------------------
  return (
    <div className="space-y-4 pb-24">
      <PanelHeader
        title="Spesen abrechnen"
        subtitle="Genehmigte, weiterverrechenbare Spesen → Rechnungsentwürfe"
      />

      {/* Filter-Card */}
      <Card className="p-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            <Calendar className="w-4 h-4" />
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

          <div className="w-56">
            <Field label="Kunde">
              <Select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
              >
                <option value="all">Alle Kunden</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="w-56">
            <Field label="Suche">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Beschreibung, Kategorie…"
                  className="pl-7"
                />
              </div>
            </Field>
          </div>

          {expensesQ.isFetching && (
            <span className="text-xs text-zinc-400 ml-1">Lade…</span>
          )}
        </div>
      </Card>

      {/* Haupt-Tabelle */}
      <Card>
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4' }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5" />
            Kunden mit offenen Spesen
          </div>
          <div className="text-xs text-zinc-400 tabular-nums">
            {groupedByCustomer.length} Kunde{groupedByCustomer.length === 1 ? '' : 'n'} ·{' '}
            {billable.length} Spesen
          </div>
        </div>

        {expensesQ.isLoading ? (
          <PanelLoader />
        ) : groupedByCustomer.length === 0 ? (
          <div className="p-8 text-sm text-zinc-400 text-center">
            Keine offenen, weiterverrechenbaren Spesen im gewählten Zeitraum.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#eef1ee' }}>
            {groupedByCustomer.map((g) => (
              <CustomerGroup
                key={g.customer_id}
                group={g}
                expanded={expandedCustomerIds.has(g.customer_id)}
                onToggleExpanded={() => toggleExpanded(g.customer_id)}
                selectedIds={selectedIds}
                onToggleExpense={toggleExpense}
                onToggleAll={() => toggleCustomerAll(g)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Sticky Footer-Bar */}
      {groupedByCustomer.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 border-t z-20"
          style={{ background: '#ffffffee', borderColor: '#e4e7e4', backdropFilter: 'blur(4px)' }}
        >
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center gap-4">
            <Receipt className="w-4 h-4 text-zinc-400" />
            <div className="text-sm text-zinc-700 tabular-nums">
              <span className="font-semibold">{selectionSummary.expenseCount}</span>
              <span className="text-zinc-500"> Spesen ausgewählt</span>
              <span className="text-zinc-300 mx-2">·</span>
              <span className="font-semibold" style={{ color: '#2d5a2d' }}>
                CHF {fmt.chf(selectionSummary.sumGross)}
              </span>
              <span className="text-zinc-300 mx-2">·</span>
              <span className="font-semibold">{selectionSummary.customerCount}</span>
              <span className="text-zinc-500"> Kunde{selectionSummary.customerCount === 1 ? '' : 'n'}</span>
            </div>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={selectionSummary.expenseCount === 0 || createInvoicesMut.isPending}
                className={artisBtn.primary}
                style={{
                  ...artisPrimaryStyle,
                  opacity: selectionSummary.expenseCount === 0 || createInvoicesMut.isPending ? 0.45 : 1,
                }}
              >
                <FileText className="w-4 h-4" />
                Rechnungsentwürfe erstellen ({selectionSummary.customerCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation-Dialog */}
      {confirmOpen && (
        <ConfirmDialog
          summary={selectionSummary}
          loading={createInvoicesMut.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => createInvoicesMut.mutate()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer-Group: Header + ausklappbare Tabelle aller Spesen-Zeilen
// ---------------------------------------------------------------------------

function CustomerGroup({ group, expanded, onToggleExpanded, selectedIds, onToggleExpense, onToggleAll }) {
  const allOn = group.expenses.length > 0 && group.expenses.every((e) => selectedIds.has(e.id));
  const someOn = group.expenses.some((e) => selectedIds.has(e.id));
  const selectedCount = group.expenses.filter((e) => selectedIds.has(e.id)).length;
  const selectedSum = group.expenses
    .filter((e) => selectedIds.has(e.id))
    .reduce((s, e) => s + Number(e.amount_gross || 0), 0);

  return (
    <div>
      {/* Header */}
      <div
        className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-zinc-50/60"
        style={{ background: someOn ? '#f5faf5' : undefined }}
        onClick={onToggleExpanded}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={allOn}
            ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
            onChange={onToggleAll}
            title="Alle auswählen"
          />
        </div>
        <div className="text-zinc-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className="font-medium text-zinc-800 flex-1">
          {group.customer?.company_name ?? <span className="text-zinc-300">— ohne Kunde —</span>}
          {selectedCount > 0 && (
            <span className="ml-2 text-xs text-zinc-500">
              ({selectedCount}/{group.expenses.length} ausgewählt)
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 tabular-nums">
          {group.expenses.length} Spesen
        </div>
        <div className="text-sm tabular-nums font-medium" style={{ color: '#2d5a2d', minWidth: 110, textAlign: 'right' }}>
          CHF {fmt.chf(group.totalGross)}
        </div>
        {selectedCount > 0 && (
          <div className="text-[11px] text-zinc-500 tabular-nums" style={{ minWidth: 110, textAlign: 'right' }}>
            ausgew.: CHF {fmt.chf(selectedSum)}
          </div>
        )}
      </div>

      {/* Tabelle */}
      {expanded && (
        <div style={{ background: '#fafbf9' }} className="px-4 py-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <th className="px-2 py-1.5 w-8" />
                <th className="text-left font-semibold px-2 py-1.5 w-24">Datum</th>
                <th className="text-left font-semibold px-2 py-1.5 w-16">MA</th>
                <th className="text-left font-semibold px-2 py-1.5 w-32">Kategorie</th>
                <th className="text-left font-semibold px-2 py-1.5">Beschreibung</th>
                <th className="text-left font-semibold px-2 py-1.5 w-40">Projekt</th>
                <th className="text-right font-semibold px-2 py-1.5 w-24">Brutto</th>
                <th className="text-right font-semibold px-2 py-1.5 w-16">MWST</th>
                <th className="text-center font-semibold px-2 py-1.5 w-10">Beleg</th>
              </tr>
            </thead>
            <tbody>
              {group.expenses
                .slice()
                .sort((a, b) => String(a.expense_date).localeCompare(String(b.expense_date)))
                .map((e) => {
                  const checked = selectedIds.has(e.id);
                  return (
                    <tr key={e.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleExpense(e.id)}
                        />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-600">{fmt.date(e.expense_date)}</td>
                      <td className="px-2 py-1.5 text-zinc-600">
                        {e.employee?.short_code ?? e.employee?.full_name ?? '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <Chip tone={categoryTone(e.category)}>{categoryLabel(e.category)}</Chip>
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 truncate max-w-[300px]">
                        {e.description || <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-600 truncate max-w-[200px]">
                        {e.project?.name ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>
                        {fmt.chf(e.amount_gross)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">
                        {e.vat_pct != null ? `${Number(e.vat_pct).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {e.receipt_url ? (
                          <a
                            href={e.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            title="Beleg öffnen"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:bg-zinc-100"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation-Dialog
// ---------------------------------------------------------------------------

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
          <FileText className="w-4 h-4" />
          <div className="text-sm font-semibold">Rechnungsentwürfe erstellen</div>
        </div>
        <div className="p-4 text-sm text-zinc-700 space-y-3">
          <p>
            Aus <b>{summary.expenseCount}</b> Spese{summary.expenseCount === 1 ? '' : 'n'}
            {' '}für <b>{summary.customerCount}</b> Kunde{summary.customerCount === 1 ? '' : 'n'}
            {' '}(<b style={{ color: '#2d5a2d' }}>CHF {fmt.chf(summary.sumGross)}</b>)
            {' '}werden Rechnungsentwürfe erstellt.
          </p>
          <p className="text-xs text-zinc-500">
            Pro Kunde wird <b>eine Rechnung</b> mit allen ausgewählten Spesen als Zeilen
            angelegt. Die Spesen werden auf <Chip tone="blue">abgerechnet</Chip> gesetzt
            und mit der Rechnung verknüpft.
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
            <Check className="w-4 h-4" />
            {loading ? 'Erstelle…' : 'Entwürfe erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
