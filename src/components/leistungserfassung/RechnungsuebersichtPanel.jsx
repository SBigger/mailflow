// Leistungserfassung · Rechnungsübersicht
// Liste aller Rechnungen (alle Stati) mit Filter, Suche und Inline-Actions.
// Anzeigen (Modal), Versenden, Bezahlt markieren, Stornieren, Löschen (nur Entwürfe).

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileText, Send, CheckCircle2, X as XIcon, Trash2, Eye, Search, Calendar, FileDown,
} from 'lucide-react';
import { leInvoice, leCompany } from '@/lib/leApi';
import { generateInvoicePdf, triggerDownload } from '@/lib/leInvoicePdf';
import {
  Card, Chip, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Status-Mapping --------------------------------------------------------

const STATUS_CHIP = {
  entwurf:   { tone: 'neutral', label: 'Entwurf' },
  definitiv: { tone: 'blue',    label: 'Definitiv' },
  versendet: { tone: 'violet',  label: 'Versendet' },
  bezahlt:   { tone: 'green',   label: 'Bezahlt' },
  storniert: { tone: 'red',     label: 'Storniert' },
};

const STATUS_TABS = [
  { key: '',          label: 'Alle' },
  { key: 'entwurf',   label: 'Entwurf' },
  { key: 'definitiv', label: 'Definitiv' },
  { key: 'versendet', label: 'Versendet' },
  { key: 'bezahlt',   label: 'Bezahlt' },
  { key: 'storniert', label: 'Storniert' },
];

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// --- Haupt-Panel -----------------------------------------------------------

export default function RechnungsuebersichtPanel() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState(''); // '' = alle
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [detailInvoice, setDetailInvoice] = useState(null);
  const [payInvoice, setPayInvoice] = useState(null); // Invoice-Objekt wenn Zahlungsdialog offen

  // Hauptquery nach Status-Tab
  const invoicesQ = useQuery({
    queryKey: ['le', 'invoice', statusFilter],
    queryFn: () => leInvoice.list({ status: statusFilter || undefined }),
  });

  // Zusätzlicher Query (alle), um Counts pro Status-Tab zu ermitteln
  const allInvoicesQ = useQuery({
    queryKey: ['le', 'invoice', ''],
    queryFn: () => leInvoice.list({}),
    enabled: statusFilter !== '', // wenn schon "alle" aktiv, reicht die Hauptquery
  });

  const allInvoices = statusFilter === '' ? (invoicesQ.data ?? []) : (allInvoicesQ.data ?? []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'invoice'] });

  // --- Mutations -----------------------------------------------------------
  const sendMut = useMutation({
    // TODO: Später: echte Mail via MS365/MailFlow-Versand anbinden
    mutationFn: (id) => leInvoice.update(id, {
      status: 'versendet',
      sent_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      toast.info('Rechnung versendet (Mail-Integration folgt)');
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const payMut = useMutation({
    mutationFn: ({ id, patch }) => leInvoice.update(id, patch),
    onSuccess: () => {
      toast.success('Als bezahlt markiert');
      invalidate();
      setPayInvoice(null);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => leInvoice.update(id, { status: 'storniert' }),
    onSuccess: () => {
      toast.success('Rechnung storniert');
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leInvoice.remove(id),
    onSuccess: () => {
      toast.success('Entwurf gelöscht');
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // --- Abgeleitete Daten ---------------------------------------------------

  const invoices = invoicesQ.data ?? [];

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (fromDate && inv.issue_date && inv.issue_date < fromDate) return false;
      if (toDate && inv.issue_date && inv.issue_date > toDate) return false;
      if (!s) return true;
      const hay = [
        inv.invoice_no,
        inv.customer?.company_name,
        inv.project?.name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [invoices, search, fromDate, toDate]);

  const total = useMemo(
    () => filtered.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0),
    [filtered],
  );

  // Counts pro Status-Tab (aus allInvoices)
  const counts = useMemo(() => {
    const c = { '': allInvoices.length };
    for (const inv of allInvoices) {
      c[inv.status] = (c[inv.status] ?? 0) + 1;
    }
    return c;
  }, [allInvoices]);

  // --- Loading / Error -----------------------------------------------------
  if (invoicesQ.error) return <PanelError error={invoicesQ.error} onRetry={() => invoicesQ.refetch()} />;

  // --- Render --------------------------------------------------------------
  return (
    <div className="space-y-4">
      <PanelHeader
        title="Rechnungsübersicht"
        subtitle={
          invoicesQ.isLoading
            ? 'Lade…'
            : `${filtered.length} Rechnungen · Total CHF ${fmt.chf(total)}`
        }
      />

      {/* Filter-Leiste */}
      <Card className="p-3 space-y-3">
        {/* Status-Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.key;
            const n = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key || 'alle'}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                style={
                  active
                    ? { background: '#7a9b7f', color: '#fff', borderColor: '#7a9b7f' }
                    : { background: '#fff', color: '#3d4a3d', borderColor: '#d1dcd1' }
                }
              >
                {tab.label}
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

        {/* Suche + Zeitraum */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
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
          </div>
          <Field label="Von (Rechnungsdatum)">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="Bis (Rechnungsdatum)">
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* Tabelle */}
      <Card>
        {invoicesQ.isLoading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <FileText className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine Rechnungen gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="text-left font-semibold px-3 py-2 w-36">Rechnungsnr.</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Datum</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2">Projekt</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Total</th>
                  <th className="text-left font-semibold px-3 py-2 w-28">Status</th>
                  <th className="text-right font-semibold px-3 py-2 w-48">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <InvoiceRow
                    key={inv.id}
                    inv={inv}
                    onOpen={() => setDetailInvoice(inv)}
                    onSend={() => sendMut.mutate(inv.id)}
                    onPay={() => setPayInvoice(inv)}
                    onCancel={() => {
                      if (window.confirm('Rechnung wirklich stornieren?')) cancelMut.mutate(inv.id);
                    }}
                    onRemove={() => {
                      if (window.confirm('Entwurf wirklich löschen?')) removeMut.mutate(inv.id);
                    }}
                    sending={sendMut.isPending && sendMut.variables === inv.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Details-Modal */}
      {detailInvoice && (
        <InvoiceDetailDialog
          invoice={detailInvoice}
          onClose={() => setDetailInvoice(null)}
          onSend={() => {
            sendMut.mutate(detailInvoice.id);
            setDetailInvoice(null);
          }}
          onPay={() => {
            setPayInvoice(detailInvoice);
            setDetailInvoice(null);
          }}
          onCancel={() => {
            if (window.confirm('Rechnung wirklich stornieren?')) {
              cancelMut.mutate(detailInvoice.id);
              setDetailInvoice(null);
            }
          }}
        />
      )}

      {/* Zahlungs-Dialog */}
      {payInvoice && (
        <PaymentDialog
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onSubmit={(patch) => payMut.mutate({ id: payInvoice.id, patch })}
          saving={payMut.isPending}
        />
      )}
    </div>
  );
}

// --- Tabellenzeile ---------------------------------------------------------

function InvoiceRow({ inv, onOpen, onSend, onPay, onCancel, onRemove, sending }) {
  const statusInfo = STATUS_CHIP[inv.status] ?? STATUS_CHIP.entwurf;
  const isDraft = inv.status === 'entwurf';
  const canSend = inv.status === 'definitiv';
  const canPay = inv.status === 'versendet';
  const canCancel = inv.status !== 'storniert' && inv.status !== 'entwurf';

  return (
    <tr
      className="border-b last:border-b-0 hover:bg-zinc-50 cursor-pointer"
      style={{ borderColor: '#eef1ee' }}
      onClick={onOpen}
    >
      <td className="px-3 py-2">
        {inv.invoice_no ? (
          <span className="font-semibold tabular-nums">{inv.invoice_no}</span>
        ) : (
          <span className="text-zinc-400 italic">(Entwurf)</span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(inv.issue_date)}</td>
      <td className="px-3 py-2">{inv.customer?.company_name ?? <span className="text-zinc-300">—</span>}</td>
      <td className="px-3 py-2 text-zinc-600">{inv.project?.name ?? <span className="text-zinc-300">—</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(inv.total)}</td>
      <td className="px-3 py-2"><Chip tone={statusInfo.tone}>{statusInfo.label}</Chip></td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <IconBtn onClick={onOpen} title="Ansicht">
            <Eye className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn
            onClick={async () => {
              try {
                const company = await leCompany.get();
                if (!company) { toast.error('Firmen-Settings fehlen.'); return; }
                const fresh = await leInvoice.get(inv.id);
                const result = await generateInvoicePdf({ invoice: fresh, company });
                if (result.blob) triggerDownload(result.blob, `Rechnung-${fresh.invoice_no || 'Entwurf'}.pdf`);
                toast.success('PDF erzeugt');
              } catch (e) { toast.error('PDF-Fehler: ' + (e?.message ?? e)); }
            }}
            title="PDF herunterladen"
          >
            <FileDown className="w-3.5 h-3.5" />
          </IconBtn>
          {canSend && (
            <IconBtn onClick={onSend} title={sending ? 'Versende…' : 'Versenden'}>
              <Send className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canPay && (
            <IconBtn onClick={onPay} title="Bezahlt markieren">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canCancel && (
            <IconBtn onClick={onCancel} title="Stornieren">
              <XIcon className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {isDraft && (
            <IconBtn onClick={onRemove} title="Entwurf löschen" danger>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

// --- Details-Modal ---------------------------------------------------------

function InvoiceDetailDialog({ invoice, onClose, onSend, onPay, onCancel }) {
  const statusInfo = STATUS_CHIP[invoice.status] ?? STATUS_CHIP.entwurf;
  const lines = invoice.lines ?? [];
  const canSend = invoice.status === 'definitiv';
  const canPay = invoice.status === 'versendet';
  const canCancel = invoice.status !== 'storniert' && invoice.status !== 'entwurf';

  const subtotal = Number(invoice.subtotal ?? 0);
  const vat = Number(invoice.vat_total ?? 0);
  const total = Number(invoice.total ?? 0);

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
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-zinc-400" />
              <h3 className="text-base font-semibold">
                {invoice.invoice_no ?? <span className="text-zinc-400 italic">(Entwurf)</span>}
              </h3>
              <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
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

        {/* Meta-Block */}
        <div className="px-5 py-3 border-b grid grid-cols-2 md:grid-cols-4 gap-3 text-xs" style={{ borderColor: '#eef0ee' }}>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Rechnungsdatum</div>
            <div className="mt-0.5">{fmt.date(invoice.issue_date)}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Fälligkeit</div>
            <div className="mt-0.5">{fmt.date(invoice.due_date)}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Versendet</div>
            <div className="mt-0.5">{invoice.sent_at ? fmt.date(invoice.sent_at) : '—'}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Bezahlt</div>
            <div className="mt-0.5">
              {invoice.paid_at
                ? `${fmt.date(invoice.paid_at)} · CHF ${fmt.chf(invoice.paid_amount)}`
                : '—'}
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Positionen</div>
          {lines.length === 0 ? (
            <div className="text-sm text-zinc-400 italic">Keine Positionen.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#eef1ee' }}>
                    <th className="text-left font-semibold px-2 py-1.5">Beschreibung</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-16">Menge</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-20">Satz</th>
                    <th className="text-right font-semibold px-2 py-1.5 w-24">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln) => (
                    <tr key={ln.id} className="border-b last:border-b-0" style={{ borderColor: '#f3f5f3' }}>
                      <td className="px-2 py-1.5">{ln.description ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt.hours(ln.quantity)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{fmt.chf(ln.unit_price)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt.chf(ln.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Beträge */}
        <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Zwischensumme</span>
              <span className="tabular-nums">{fmt.chf(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">MWST</span>
              <span className="tabular-nums">{fmt.chf(vat)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t font-semibold" style={{ borderColor: '#eef0ee' }}>
              <span>Total CHF</span>
              <span className="tabular-nums" style={{ color: '#2d5a2d' }}>{fmt.chf(total)}</span>
            </div>
          </div>
        </div>

        {/* Notizen */}
        {invoice.notes && (
          <div className="px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Notizen</div>
            <div className="text-sm text-zinc-700 whitespace-pre-wrap">{invoice.notes}</div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={artisBtn.ghost} style={artisGhostStyle}>
            Schliessen
          </button>
          {canCancel && (
            <button type="button" onClick={onCancel} className={artisBtn.ghost} style={artisGhostStyle}>
              <XIcon className="w-4 h-4" /> Stornieren
            </button>
          )}
          {canSend && (
            <button type="button" onClick={onSend} className={artisBtn.primary} style={artisPrimaryStyle}>
              <Send className="w-4 h-4" /> Versenden
            </button>
          )}
          {canPay && (
            <button type="button" onClick={onPay} className={artisBtn.primary} style={artisPrimaryStyle}>
              <CheckCircle2 className="w-4 h-4" /> Bezahlt markieren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Zahlungs-Dialog -------------------------------------------------------

function PaymentDialog({ invoice, onClose, onSubmit, saving }) {
  const [paidAt, setPaidAt] = useState(() => todayIso());
  const [paidAmount, setPaidAmount] = useState(() => String(invoice.total ?? ''));

  const submit = (e) => {
    e.preventDefault();
    if (!paidAt) { toast.error('Zahlungsdatum ist Pflicht'); return; }
    const amt = Number(paidAmount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Betrag ungültig'); return; }
    onSubmit({
      status: 'bezahlt',
      paid_at: paidAt,
      paid_amount: amt,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" style={{ color: '#2d5a2d' }} />
            Zahlung erfassen
          </h3>
          <IconBtn title="Schliessen" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </IconBtn>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="text-xs text-zinc-500">
            Rechnung <span className="font-semibold text-zinc-700">{invoice.invoice_no ?? '(ohne Nr.)'}</span>
            {invoice.customer?.company_name ? ` · ${invoice.customer.company_name}` : ''}
          </div>

          <Field label="Zahlungsdatum">
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="pl-8"
              />
            </div>
          </Field>

          <Field label="Betrag (CHF)" hint={`Rechnungstotal: CHF ${fmt.chf(invoice.total)}`}>
            <Input
              type="number" step="0.05" min="0"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={artisBtn.ghost} style={artisGhostStyle}>
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: saving ? 0.6 : 1 }}
            >
              <CheckCircle2 className="w-4 h-4" />
              {saving ? 'Speichere…' : 'Als bezahlt markieren'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
