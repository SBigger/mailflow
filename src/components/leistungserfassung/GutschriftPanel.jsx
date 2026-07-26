// Leistungserfassung · Gutschrift / Storno
// Zwei Tabs:
//   1. Erstellen  – versendete/bezahlte Rechnungen, jeweils Button "Gutschrift erstellen"
//   2. Übersicht  – alle existierenden Gutschriften (invoice_type='gutschrift')
//
// Storno bei Entwürfen: in RechnungsuebersichtPanel (Trash-Icon).
// Bei versendeten/bezahlten Rechnungen IMMER Gutschrift verwenden – lückenlose
// Nummerierung ist MWST-rechtlich Pflicht.

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Receipt, Undo2, AlertTriangle, FileDown, Eye, Search, X as XIcon, FileText,
} from 'lucide-react';
import { leInvoice, leCompany, createCreditFromInvoice } from '@/lib/leApi';
import { generateInvoicePdf, triggerDownload } from '@/lib/leInvoicePdf';
import {
  Card, Chip, IconBtn, Input, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CHIP = {
  entwurf:   { tone: 'neutral', label: 'Entwurf' },
  definitiv: { tone: 'blue',    label: 'Definitiv' },
  versendet: { tone: 'violet',  label: 'Versendet' },
  bezahlt:   { tone: 'green',   label: 'Bezahlt' },
  storniert: { tone: 'red',     label: 'Storniert' },
};

const isGutschrift = (inv) => inv?.invoice_type === 'gutschrift';

// vat_amount ist im DB-Schema gebräuchlich, vat_total als Fallback aus älteren Datensätzen.
const vatOf = (inv) => Number(inv?.vat_amount ?? inv?.vat_total ?? 0);

async function downloadInvoicePdf(invoice, filenamePrefix = 'Rechnung') {
  const company = await leCompany.get();
  if (!company) {
    toast.error('Firmen-Settings fehlen.');
    return;
  }
  const fresh = await leInvoice.get(invoice.id);
  const result = await generateInvoicePdf({ invoice: fresh, company });
  if (result?.blob) {
    triggerDownload(result.blob, `${filenamePrefix}-${fresh.invoice_no || 'ohne-Nr'}.pdf`);
    toast.success('PDF erzeugt');
  }
}

// ---------------------------------------------------------------------------
// Hauptkomponente
// ---------------------------------------------------------------------------

export default function GutschriftPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('erstellen'); // 'erstellen' | 'uebersicht'

  // --- Query: versendete + bezahlte Rechnungen (Quellen für Gutschriften) ---
  const versendetQ = useQuery({
    queryKey: ['le', 'invoice', 'versendet'],
    queryFn: () => leInvoice.list({ status: 'versendet' }),
  });
  const bezahltQ = useQuery({
    queryKey: ['le', 'invoice', 'bezahlt'],
    queryFn: () => leInvoice.list({ status: 'bezahlt' }),
  });

  // --- Query: alle Gutschriften ---
  // leInvoice.list filtert nur nach status, daher alle Rechnungen ziehen und client-seitig
  // auf invoice_type='gutschrift' filtern.
  const allQ = useQuery({
    queryKey: ['le', 'invoice', ''],
    queryFn: () => leInvoice.list({}),
  });

  const sourceInvoices = useMemo(() => {
    const list = [
      ...(versendetQ.data ?? []),
      ...(bezahltQ.data ?? []),
    ].filter((inv) => !isGutschrift(inv) && inv.status !== 'storniert');
    return list;
  }, [versendetQ.data, bezahltQ.data]);

  const credits = useMemo(
    () => (allQ.data ?? []).filter(isGutschrift),
    [allQ.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'invoice'] });

  // --- Modal-State: Gutschrift-Erstellen-Dialog ---
  const [creditFor, setCreditFor] = useState(null);

  const handleCreateCredit = async (originalId, payload) => {
    try {
      const credit = await createCreditFromInvoice(originalId, payload);
      toast.success(`Gutschrift ${credit.invoice_no ?? ''} erstellt`);
      invalidate();
      setCreditFor(null);
      setTab('uebersicht');
    } catch (e) {
      toast.error('Fehler: ' + (e?.message ?? e));
    }
  };

  // --- Error-Handling (wenn beide Hauptqueries fehlen) ---
  const anyError = versendetQ.error ?? bezahltQ.error ?? allQ.error;
  if (anyError) {
    return (
      <PanelError
        error={anyError}
        onRetry={() => {
          versendetQ.refetch();
          bezahltQ.refetch();
          allQ.refetch();
        }}
      />
    );
  }

  // ------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Gutschrift / Storno"
        subtitle="Korrektur-Buchungen mit eigener Nummer und invertierten Beträgen."
      />

      {/* Tab-Switch */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'erstellen',  label: 'Erstellen',  icon: Receipt, n: sourceInvoices.length },
          { key: 'uebersicht', label: 'Übersicht', icon: Undo2,    n: credits.length },
        ].map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
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
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              <span
                className="inline-flex items-center justify-center min-w-[18px] px-1 h-4 rounded text-[10px] tabular-nums"
                style={{
                  background: active ? 'rgba(255,255,255,0.22)' : '#f1f1ef',
                  color: active ? '#fff' : '#6a6a6a',
                }}
              >
                {t.n}
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'erstellen' ? (
        <ErstellenTab
          loading={versendetQ.isLoading || bezahltQ.isLoading}
          invoices={sourceInvoices}
          onCreate={(inv) => setCreditFor(inv)}
        />
      ) : (
        <UebersichtTab
          loading={allQ.isLoading}
          credits={credits}
          allInvoices={allQ.data ?? []}
        />
      )}

      {creditFor && (
        <CreateCreditDialog
          original={creditFor}
          onClose={() => setCreditFor(null)}
          onSubmit={(payload) => handleCreateCredit(creditFor.id, payload)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Erstellen
// ---------------------------------------------------------------------------

function ErstellenTab({ loading, invoices, onCreate }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return invoices;
    return invoices.filter((inv) => {
      const hay = [
        inv.invoice_no,
        inv.customer?.company_name,
        inv.project?.name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [invoices, search]);

  return (
    <>
      <Card className="p-3">
        <Field label="Suche">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechnungsnr., Kunde oder Projekt…"
              className="pl-8"
            />
          </div>
        </Field>
      </Card>

      <Card>
        {loading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <Receipt className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine versendeten oder bezahlten Rechnungen gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-wider text-zinc-500 border-b"
                  style={{ borderColor: '#e4e7e4' }}
                >
                  <th className="text-left font-semibold px-3 py-2 w-36">Rechnungsnr.</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Datum</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2">Projekt</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Total</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Status</th>
                  <th className="text-right font-semibold px-3 py-2 w-44">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const statusInfo = STATUS_CHIP[inv.status] ?? STATUS_CHIP.versendet;
                  return (
                    <tr
                      key={inv.id}
                      className="border-b last:border-b-0 hover:bg-zinc-50"
                      style={{ borderColor: '#eef1ee' }}
                    >
                      <td className="px-3 py-2 font-semibold tabular-nums">
                        {inv.invoice_no ?? <span className="text-zinc-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-zinc-600">
                        {fmt.date(inv.issue_date)}
                      </td>
                      <td className="px-3 py-2">
                        {inv.customer?.company_name ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {inv.project?.name ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmt.chf(inv.total)}
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onCreate(inv)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors"
                          style={{
                            background: '#fff4f4',
                            color: '#8a2d2d',
                            borderColor: '#e8b4b4',
                          }}
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          Gutschrift erstellen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Übersicht
// ---------------------------------------------------------------------------

function UebersichtTab({ loading, credits, allInvoices }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);

  // Lookup für parent_invoice_id → Original-Nr
  const byId = useMemo(() => {
    const m = new Map();
    for (const inv of allInvoices) m.set(inv.id, inv);
    return m;
  }, [allInvoices]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return credits.filter((c) => {
      if (fromDate && c.issue_date && c.issue_date < fromDate) return false;
      if (toDate && c.issue_date && c.issue_date > toDate) return false;
      if (!s) return true;
      const orig = c.parent_invoice_id ? byId.get(c.parent_invoice_id) : null;
      const hay = [
        c.invoice_no,
        c.customer?.company_name,
        c.project?.name,
        orig?.invoice_no,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [credits, search, fromDate, toDate, byId]);

  const totalSum = useMemo(
    () => filtered.reduce((sum, c) => sum + Number(c.total ?? 0), 0),
    [filtered],
  );

  return (
    <>
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Field label="Suche">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Gutschrift-Nr., Kunde, Original-Rechnung…"
                  className="pl-8"
                />
              </div>
            </Field>
          </div>
          <Field label="Von">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="Bis">
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
        </div>
        <div className="text-xs text-zinc-500 mt-2 tabular-nums">
          {filtered.length} Gutschriften · Summe CHF {fmt.chf(totalSum)}
        </div>
      </Card>

      <Card>
        {loading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <Undo2 className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine Gutschriften gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-wider text-zinc-500 border-b"
                  style={{ borderColor: '#e4e7e4' }}
                >
                  <th className="text-left font-semibold px-3 py-2 w-36">Gutschrift-Nr.</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Datum</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2 w-40">Original-Rechnung</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Total</th>
                  <th className="text-right font-semibold px-3 py-2 w-32">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const orig = c.parent_invoice_id ? byId.get(c.parent_invoice_id) : null;
                  return (
                    <tr
                      key={c.id}
                      className="border-b last:border-b-0 hover:bg-zinc-50 cursor-pointer"
                      style={{ borderColor: '#eef1ee' }}
                      onClick={() => setDetail(c)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{c.invoice_no ?? '—'}</span>
                          <Chip tone="red">Gutschrift</Chip>
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-zinc-600">
                        {fmt.date(c.issue_date)}
                      </td>
                      <td className="px-3 py-2">
                        {c.customer?.company_name ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {orig ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetail(orig);
                            }}
                            className="text-xs underline tabular-nums"
                            style={{ color: '#2e4a7d' }}
                            title="Original-Rechnung anzeigen"
                          >
                            {orig.invoice_no ?? '—'}
                          </button>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums font-semibold"
                        style={{ color: '#8a2d2d' }}
                      >
                        {fmt.chf(c.total)}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconBtn onClick={() => setDetail(c)} title="Ansicht">
                            <Eye className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            onClick={async () => {
                              try {
                                await downloadInvoicePdf(c, 'Gutschrift');
                              } catch (e) {
                                toast.error('PDF-Fehler: ' + (e?.message ?? e));
                              }
                            }}
                            title="PDF herunterladen"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail && <InvoicePreviewDialog invoice={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal: Gutschrift erstellen
// ---------------------------------------------------------------------------

function CreateCreditDialog({ original, onClose, onSubmit }) {
  const lines0 = original.lines ?? [];
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Positions-Auswahl für Teilgutschrift (initial alle gewählt, voller Betrag)
  const [sel, setSel] = useState(() => lines0.map((l) => ({
    id: l.id, service_type_id: l.service_type_id, description: l.description,
    hours: l.hours, rate: l.rate, amount: Number(l.amount || 0),
    vat_pct: Number(l.vat_pct ?? original.vat_pct ?? 8.1), checked: true,
  })));
  const setLine = (id, patch) => setSel((arr) => arr.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const chosen = sel.filter((l) => l.checked);
  const allChecked = sel.length > 0 && chosen.length === sel.length;
  const amountsUnchanged = sel.every((l) =>
    Math.abs(Number(l.amount || 0) - Number(lines0.find((x) => x.id === l.id)?.amount || 0)) < 0.005);
  // Voll = alle Positionen gewählt + unveränderte Beträge (oder gar keine Positionen).
  const isFull = sel.length === 0 || (allChecked && amountsUnchanged);
  const selSubtotal = chosen.reduce((s, l) => s + Number(l.amount || 0), 0);
  const originalLineTotal = lines0.reduce((s, l) => s + Number(l.amount || 0), 0);
  // Teilgutschriften übernehmen den Rabattfaktor und die MWST je Originalzeile.
  const netFactor = Math.abs(originalLineTotal) > 0.000001
    ? Math.abs(Number(original.subtotal ?? 0)) / Math.abs(originalLineTotal)
    : 1;
  const subtotal = isFull ? Number(original.subtotal ?? 0) : selSubtotal * netFactor;
  const vat = isFull
    ? vatOf(original)
    : chosen.reduce(
      (s, l) => s + Number(l.amount || 0) * netFactor * Number(l.vat_pct || 0) / 100,
      0,
    );
  const total = isFull ? Number(original.total ?? 0) : subtotal + vat;

  const handleConfirm = async () => {
    if (!isFull && chosen.length === 0) { toast.error('Keine Position gewählt.'); return; }
    const msg = isFull
      ? 'Vollgutschrift: Original wird storniert. Fortfahren?'
      : 'Teilgutschrift erstellen? Das Original bleibt bestehen.';
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    try {
      await onSubmit({
        reason: reason.trim(),
        lines: isFull ? null : chosen.map((l) => ({
          id: l.id,
          amount: Number(l.amount || 0),
        })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between px-5 py-3 border-b"
          style={{ borderColor: '#eef0ee' }}
        >
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Undo2 className="w-4 h-4" style={{ color: '#8a2d2d' }} />
              Gutschrift zu {original.invoice_no ?? '—'} erstellen?
            </h3>
            <div className="text-xs text-zinc-500 mt-1">
              {original.customer?.company_name ?? '—'}
              {original.project?.name ? ` · ${original.project.name}` : ''}
            </div>
          </div>
          <IconBtn title="Schliessen" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </IconBtn>
        </div>

        <div className="p-5 space-y-4">
          {/* Positions-Auswahl (Teilgutschrift) */}
          {lines0.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Positionen gutschreiben — abwählen oder Betrag ändern für Teilgutschrift
              </div>
              <div className="rounded border divide-y" style={{ borderColor: '#eef0ee' }}>
                {sel.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <input type="checkbox" checked={l.checked}
                      onChange={(e) => setLine(l.id, { checked: e.target.checked })} />
                    <span className="flex-1 truncate" title={l.description}>{l.description || 'Position'}</span>
                    <input type="number" step="0.05" value={l.amount} disabled={!l.checked}
                      onChange={(e) => setLine(l.id, { amount: e.target.value })}
                      className="w-24 text-right border rounded px-1.5 py-0.5 tabular-nums"
                      style={{ borderColor: '#d9dfd9', opacity: l.checked ? 1 : 0.5 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vorschau invertierter Beträge */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Vorschau {isFull ? 'Vollgutschrift' : 'Teilgutschrift'}
            </div>
            <div
              className="rounded border p-3 space-y-1 text-sm"
              style={{ borderColor: '#eef0ee', background: '#fafbfa' }}
            >
              <div className="flex justify-between">
                <span className="text-zinc-500">Zwischensumme</span>
                <span className="tabular-nums" style={{ color: '#8a2d2d' }}>
                  − {fmt.chf(subtotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">MWST</span>
                <span className="tabular-nums" style={{ color: '#8a2d2d' }}>
                  − {fmt.chf(vat)}
                </span>
              </div>
              <div
                className="flex justify-between pt-1 border-t font-semibold"
                style={{ borderColor: '#eef0ee' }}
              >
                <span>Total CHF</span>
                <span className="tabular-nums" style={{ color: '#8a2d2d' }}>
                  − {fmt.chf(total)}
                </span>
              </div>
            </div>
          </div>

          {/* Grund */}
          <Field label="Grund (optional)" hint="Wird in den Notizen der Gutschrift gespeichert.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="z.B. Falsche Mengen, Stornierung Auftrag, Kulanz…"
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </Field>

          {/* Warning-Card */}
          <div
            className="rounded border p-3 flex items-start gap-2 text-xs"
            style={{ borderColor: '#e8b4b4', background: '#fff4f4', color: '#8a2d2d' }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              {isFull ? (
                <>
                  <div className="font-semibold">Vollgutschrift — Original-Rechnung wird «storniert».</div>
                  <div className="mt-0.5">
                    Die zugehörigen Buchungen werden wieder freigegeben (neu verrechenbar). Die
                    Gutschrift erhält eine eigene Nummer mit den Positionen als negative Beträge.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold">Teilgutschrift — Original bleibt bestehen.</div>
                  <div className="mt-0.5">
                    Nur die gewählten Positionen werden gutgeschrieben; der offene Betrag der
                    Rechnung reduziert sich entsprechend. Keine Stornierung, keine Freigabe von Buchungen.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2 border-t"
          style={{ borderColor: '#eef0ee' }}
        >
          <button
            type="button"
            onClick={onClose}
            className={artisBtn.ghost}
            style={artisGhostStyle}
            disabled={submitting}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={artisBtn.primary}
            style={{ background: '#8a2d2d', opacity: submitting ? 0.6 : 1 }}
          >
            <Undo2 className="w-4 h-4" />
            {submitting ? 'Erstelle…' : 'Gutschrift erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: Detail-Vorschau (read-only)
// ---------------------------------------------------------------------------

function InvoicePreviewDialog({ invoice, onClose }) {
  const lines = invoice.lines ?? [];
  const subtotal = Number(invoice.subtotal ?? 0);
  const vat = vatOf(invoice);
  const total = Number(invoice.total ?? 0);
  const isCredit = isGutschrift(invoice);
  const totalColor = isCredit ? '#8a2d2d' : '#2d5a2d';

  const statusInfo = STATUS_CHIP[invoice.status] ?? STATUS_CHIP.entwurf;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between px-5 py-3 border-b"
          style={{ borderColor: '#eef0ee' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-zinc-400" />
              <h3 className="text-base font-semibold">
                {invoice.invoice_no ?? <span className="text-zinc-400 italic">(Entwurf)</span>}
              </h3>
              {isCredit ? <Chip tone="red">Gutschrift</Chip> : <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {invoice.customer?.company_name ?? '—'}
              {invoice.project?.name ? ` · ${invoice.project.name}` : ''}
              {invoice.issue_date ? ` · ${fmt.date(invoice.issue_date)}` : ''}
            </div>
          </div>
          <IconBtn title="Schliessen" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </IconBtn>
        </div>

        <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            Positionen
          </div>
          {lines.length === 0 ? (
            <div className="text-sm text-zinc-400 italic">Keine Positionen.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-[10px] uppercase tracking-wider text-zinc-500 border-b"
                    style={{ borderColor: '#eef1ee' }}
                  >
                    <th className="text-left font-semibold px-2 py-1.5">Beschreibung</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-16">Menge</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-20">Satz</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-24">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => (
                    <tr
                      key={ln.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: '#f3f5f3' }}
                    >
                      <td className="px-2 py-1.5">{ln.description ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmt.hours(ln.hours ?? ln.quantity)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">
                        {fmt.chf(ln.rate ?? ln.unit_price)}
                      </td>
                      <td
                        className="px-2 py-1.5 text-right tabular-nums font-medium"
                        style={{ color: Number(ln.amount) < 0 ? '#8a2d2d' : undefined }}
                      >
                        {fmt.chf(ln.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Zwischensumme</span>
              <span className="tabular-nums" style={{ color: subtotal < 0 ? '#8a2d2d' : undefined }}>
                {fmt.chf(subtotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">MWST</span>
              <span className="tabular-nums" style={{ color: vat < 0 ? '#8a2d2d' : undefined }}>
                {fmt.chf(vat)}
              </span>
            </div>
            <div
              className="flex justify-between pt-1 border-t font-semibold"
              style={{ borderColor: '#eef0ee' }}
            >
              <span>Total CHF</span>
              <span className="tabular-nums" style={{ color: totalColor }}>
                {fmt.chf(total)}
              </span>
            </div>
          </div>
        </div>

        {invoice.notes && (
          <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Notizen
            </div>
            <div className="text-sm text-zinc-700 whitespace-pre-wrap">{invoice.notes}</div>
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await downloadInvoicePdf(invoice, isCredit ? 'Gutschrift' : 'Rechnung');
              } catch (e) {
                toast.error('PDF-Fehler: ' + (e?.message ?? e));
              }
            }}
            className={artisBtn.ghost}
            style={artisGhostStyle}
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className={artisBtn.primary}
            style={artisPrimaryStyle}
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}
