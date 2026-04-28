// Leistungserfassung · Akonto
// Zwei Tabs:
//   1. Erstellen: Form für neue Akonto-Rechnung (Vorausrechnung auf laufendes Projekt)
//   2. Übersicht: Liste aller Akonto-Rechnungen (invoice_type='akonto') inkl. Status,
//      Verlinkung zu Schlussrechnungen, PDF-Download und Status-Aktionen.
//
// CH-Treuhand Pflichtangaben (ESTV) sind im PDF-Generator und in den Notizen abgebildet:
// - klare "Akonto"-Bezeichnung (invoice_type='akonto', Notizfeld)
// - Mandatsbezug (project_id), Akonto-Nr+Datum, Netto+MWST+Brutto
// - Hinweis "wird in Schlussrechnung verrechnet"

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Banknote, Plus, FileText, Send, FileDown, X as XIcon, Calendar, Wallet,
  Search, CheckCircle2, Link2,
} from 'lucide-react';
import {
  leInvoice, leProject, leCompany, customersForProjects, createAkontoInvoice,
} from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';
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

// Akonto-spezifischer Subtitle-Chip (violet, klare Abgrenzung zu normalen Rechnungen)
const AkontoBadge = ({ className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${className}`}
    style={{ background: '#ede3f7', color: '#4d2995', borderColor: '#c9b8e0' }}
  >
    <Banknote className="w-3 h-3" />
    Akonto
  </span>
);

// --- Haupt-Panel -----------------------------------------------------------

export default function AkontoPanel() {
  const [tab, setTab] = useState('erstellen'); // 'erstellen' | 'uebersicht'

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Akonto"
        subtitle="Vorausrechnungen auf laufende Projekte – wird später in Schlussrechnung verrechnet"
        right={<AkontoBadge />}
      />

      {/* Tab-Switcher */}
      <div className="flex gap-1.5 border-b" style={{ borderColor: '#e4e7e4' }}>
        <TabButton active={tab === 'erstellen'} onClick={() => setTab('erstellen')}>
          <Plus className="w-3.5 h-3.5" /> Erstellen
        </TabButton>
        <TabButton active={tab === 'uebersicht'} onClick={() => setTab('uebersicht')}>
          <FileText className="w-3.5 h-3.5" /> Übersicht
        </TabButton>
      </div>

      {tab === 'erstellen' && <ErstellenTab onCreated={() => setTab('uebersicht')} />}
      {tab === 'uebersicht' && <UebersichtTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px"
      style={{
        borderColor: active ? '#7a9b7f' : 'transparent',
        color: active ? '#2d5a2d' : '#6a6a6a',
        background: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

// =========================================================================
// Tab 1: Erstellen
// =========================================================================

function ErstellenTab({ onCreated }) {
  const qc = useQueryClient();

  const customersQ = useQuery({
    queryKey: ['le', 'customersForProjects'],
    queryFn: () => customersForProjects(),
  });
  const projectsQ = useQuery({
    queryKey: ['le', 'project', 'offen'],
    queryFn: () => leProject.list({ status: 'offen' }),
  });
  const companyQ = useQuery({
    queryKey: ['le', 'company'],
    queryFn: () => leCompany.get(),
  });

  // Form-State
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [amountNet, setAmountNet] = useState('');
  const [vatPct, setVatPct] = useState(''); // wird aus company gespeist
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [description, setDescription] = useState('Akonto auf Honorar');

  // Default-MWST sobald company da ist
  React.useEffect(() => {
    if (vatPct === '' && companyQ.data) {
      setVatPct(String(companyQ.data.vat_default_pct ?? 8.1));
    }
  }, [companyQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Projekte gefiltert auf Kunde
  const projectsFiltered = useMemo(() => {
    const all = projectsQ.data ?? [];
    if (!customerId) return all;
    return all.filter((p) => p.customer_id === customerId);
  }, [projectsQ.data, customerId]);

  // Wenn Projekt ausgewählt wird → automatisch Kunde übernehmen
  const onProjectChange = (id) => {
    setProjectId(id);
    if (id) {
      const proj = (projectsQ.data ?? []).find((p) => p.id === id);
      if (proj?.customer_id && proj.customer_id !== customerId) {
        setCustomerId(proj.customer_id);
      }
    }
  };

  // Wenn Kunde wechselt und Projekt nicht zum Kunden passt → Projekt-Reset
  const onCustomerChange = (id) => {
    setCustomerId(id);
    if (projectId) {
      const proj = (projectsQ.data ?? []).find((p) => p.id === projectId);
      if (!proj || proj.customer_id !== id) setProjectId('');
    }
  };

  // Live-Vorschau
  const preview = useMemo(() => {
    const net = Number(amountNet);
    const pct = Number(vatPct);
    if (!Number.isFinite(net) || net <= 0 || !Number.isFinite(pct)) {
      return { net: 0, vat: 0, total: 0 };
    }
    const vat = Math.round(net * pct) / 100;
    return { net, vat, total: net + vat };
  }, [amountNet, vatPct]);

  const createMut = useMutation({
    mutationFn: () => createAkontoInvoice({
      projectId: projectId || null,
      customerId,
      amountNet: Number(amountNet),
      vatPct: Number(vatPct),
      periodFrom: periodFrom || null,
      periodTo: periodTo || null,
      description: description || 'Akonto auf Honorar',
    }),
    onSuccess: () => {
      toast.success('Akonto-Rechnung als Entwurf erstellt');
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
      // Form-Reset
      setProjectId('');
      setAmountNet('');
      setPeriodFrom('');
      setPeriodTo('');
      setDescription('Akonto auf Honorar');
      onCreated?.();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!customerId) { toast.error('Kunde ist Pflicht'); return; }
    const net = Number(amountNet);
    if (!Number.isFinite(net) || net <= 0) { toast.error('Betrag (Netto) ungültig'); return; }
    const pct = Number(vatPct);
    if (!Number.isFinite(pct) || pct < 0) { toast.error('MWST% ungültig'); return; }
    if (periodFrom && periodTo && periodFrom > periodTo) {
      toast.error('Periode Von ist nach Bis');
      return;
    }
    createMut.mutate();
  };

  if (customersQ.error) return <PanelError error={customersQ.error} onRetry={() => customersQ.refetch()} />;
  if (projectsQ.error)  return <PanelError error={projectsQ.error}  onRetry={() => projectsQ.refetch()} />;

  const loading = customersQ.isLoading || projectsQ.isLoading || companyQ.isLoading;

  return (
    <Card className="p-5">
      {loading ? (
        <PanelLoader />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {/* Hinweis */}
          <div
            className="text-xs px-3 py-2 rounded border flex items-start gap-2"
            style={{ background: '#f7f3fb', borderColor: '#c9b8e0', color: '#4d2995' }}
          >
            <Wallet className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <b>Akonto-Rechnung</b> – Vorausrechnung auf laufendes Mandat. Wird später in der
              Schlussrechnung verrechnet. MWST wird mit Ausweis verrechnet (Vereinbarungs-Methode).
            </div>
          </div>

          {/* Kunde + Projekt */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Kunde *">
              <Select
                value={customerId}
                onChange={(e) => onCustomerChange(e.target.value)}
                required
              >
                <option value="">— Kunde wählen —</option>
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Projekt (optional)" hint="Auf welches laufende Mandat bezieht sich die Akonto?">
              <Select
                value={projectId}
                onChange={(e) => onProjectChange(e.target.value)}
                disabled={projectsFiltered.length === 0 && !!customerId}
              >
                <option value="">— ohne Projektbezug —</option>
                {projectsFiltered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.customer?.company_name ? ` · ${p.customer.company_name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Betrag + MWST */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Betrag Netto (CHF) *">
              <Input
                type="number"
                step="0.05"
                min="0"
                value={amountNet}
                onChange={(e) => setAmountNet(e.target.value)}
                placeholder="0.00"
                required
              />
            </Field>

            <Field label="MWST %" hint="Default aus Firmen-Settings">
              <Input
                type="number"
                step="0.1"
                min="0"
                value={vatPct}
                onChange={(e) => setVatPct(e.target.value)}
                placeholder="8.1"
              />
            </Field>
          </div>

          {/* Periode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Periode Von" hint="z.B. Q1 2026 → 01.01.2026">
              <div className="relative">
                <Calendar className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
                <Input
                  type="date"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                  className="pl-8"
                />
              </div>
            </Field>
            <Field label="Periode Bis">
              <div className="relative">
                <Calendar className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
                <Input
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                  className="pl-8"
                />
              </div>
            </Field>
          </div>

          {/* Beschreibung */}
          <Field label="Beschreibung" hint="Erscheint als Position auf der Rechnung">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Akonto auf Honorar"
            />
          </Field>

          {/* Live-Vorschau */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: '#e4e7e4', background: '#fafbfa' }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Vorschau
            </div>
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Zwischensumme</span>
                <span className="tabular-nums">{fmt.chf(preview.net)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">
                  MWST {Number(vatPct || 0).toLocaleString('de-CH', { minimumFractionDigits: 1 })} %
                </span>
                <span className="tabular-nums">{fmt.chf(preview.vat)}</span>
              </div>
              <div
                className="flex justify-between pt-1 border-t font-semibold"
                style={{ borderColor: '#eef0ee' }}
              >
                <span>Total CHF</span>
                <span className="tabular-nums" style={{ color: '#2d5a2d' }}>
                  {fmt.chf(preview.total)}
                </span>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="submit"
              disabled={createMut.isPending}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: createMut.isPending ? 0.6 : 1 }}
            >
              <Plus className="w-4 h-4" />
              {createMut.isPending ? 'Erstelle…' : 'Akonto-Entwurf erstellen'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// =========================================================================
// Tab 2: Übersicht
// =========================================================================

function UebersichtTab() {
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Akonti laden – direkter Filter via supabase, da leInvoice.list keinen invoice_type-Filter hat
  const akontiQ = useQuery({
    queryKey: ['le', 'invoice', 'akonto', statusFilter || 'all'],
    queryFn: async () => {
      let q = supabase
        .from('le_invoice')
        .select('*, customer:customers(id, company_name), project:le_project(id, name), lines:le_invoice_line(*)')
        .eq('invoice_type', 'akonto')
        .order('created_at', { ascending: false });
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Alle Akonti (für Tab-Counts) – nur wenn Filter aktiv
  const allAkontiQ = useQuery({
    queryKey: ['le', 'invoice', 'akonto', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('le_invoice')
        .select('id, status')
        .eq('invoice_type', 'akonto');
      if (error) throw error;
      return data ?? [];
    },
    enabled: statusFilter !== '',
  });

  // Akonto-Verlinkungen (akonto_invoice_id → schluss_invoice_id) für aktuell sichtbare Akonti
  const akontoIds = useMemo(() => (akontiQ.data ?? []).map((a) => a.id), [akontiQ.data]);
  const linksQ = useQuery({
    queryKey: ['le', 'invoice_akonto_link', 'byAkonto', akontoIds.join(',')],
    queryFn: async () => {
      if (akontoIds.length === 0) return [];
      const { data, error } = await supabase
        .from('le_invoice_akonto_link')
        .select('akonto_invoice_id, schluss_invoice_id, schluss:le_invoice!schluss_invoice_id(id, invoice_no, status)')
        .in('akonto_invoice_id', akontoIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: akontoIds.length > 0,
  });

  const linkByAkonto = useMemo(() => {
    const m = new Map();
    for (const l of (linksQ.data ?? [])) m.set(l.akonto_invoice_id, l);
    return m;
  }, [linksQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    qc.invalidateQueries({ queryKey: ['le', 'invoice_akonto_link'] });
  };

  // --- Mutations -----------------------------------------------------------
  const finalizeMut = useMutation({
    mutationFn: (id) => leInvoice.finalize(id),
    onSuccess: () => { toast.success('Akonto definitiv erstellt'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const sendMut = useMutation({
    mutationFn: (id) => leInvoice.update(id, {
      status: 'versendet',
      sent_at: new Date().toISOString(),
    }),
    onSuccess: () => { toast.info('Akonto versendet (Mail-Integration folgt)'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => leInvoice.update(id, { status: 'storniert' }),
    onSuccess: () => { toast.success('Akonto storniert'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // --- Abgeleitete Daten ---------------------------------------------------
  const akonti = akontiQ.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return akonti;
    return akonti.filter((inv) => {
      const hay = [
        inv.invoice_no,
        inv.customer?.company_name,
        inv.project?.name,
        inv.notes,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [akonti, search]);

  const totalNet = useMemo(
    () => filtered.reduce((s, inv) => s + Number(inv.subtotal ?? 0), 0),
    [filtered],
  );
  const totalGross = useMemo(
    () => filtered.reduce((s, inv) => s + Number(inv.total ?? 0), 0),
    [filtered],
  );

  // Counts pro Status-Tab
  const counts = useMemo(() => {
    const source = statusFilter === '' ? akonti : (allAkontiQ.data ?? []);
    const c = { '': source.length };
    for (const inv of source) c[inv.status] = (c[inv.status] ?? 0) + 1;
    return c;
  }, [akonti, allAkontiQ.data, statusFilter]);

  if (akontiQ.error) return <PanelError error={akontiQ.error} onRetry={() => akontiQ.refetch()} />;

  // PDF-Download
  const downloadPdf = async (inv) => {
    try {
      const company = await leCompany.get();
      if (!company) { toast.error('Firmen-Settings fehlen.'); return; }
      const fresh = await leInvoice.get(inv.id);
      const result = await generateInvoicePdf({ invoice: fresh, company });
      if (result.blob) triggerDownload(result.blob, `Akonto-${fresh.invoice_no || 'Entwurf'}.pdf`);
      toast.success('PDF erzeugt');
    } catch (e) {
      toast.error('PDF-Fehler: ' + (e?.message ?? e));
    }
  };

  return (
    <div className="space-y-4">
      {/* Subtitle-Zeile */}
      <div className="text-xs text-zinc-500 flex items-center gap-2">
        <AkontoBadge />
        {akontiQ.isLoading
          ? 'Lade…'
          : (
            <>
              {filtered.length} Akonto-Rechnungen ·
              {' '}Netto CHF {fmt.chf(totalNet)} ·
              {' '}Brutto CHF {fmt.chf(totalGross)}
            </>
          )}
      </div>

      {/* Filter-Leiste */}
      <Card className="p-3 space-y-3">
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

        <Field label="Suche">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Akonto-Nr., Kunde oder Projekt…"
              className="pl-8"
            />
          </div>
        </Field>
      </Card>

      {/* Tabelle */}
      <Card>
        {akontiQ.isLoading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <Banknote className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine Akonto-Rechnungen gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-wider text-zinc-500 border-b"
                  style={{ borderColor: '#e4e7e4' }}
                >
                  <th className="text-left font-semibold px-3 py-2 w-32">Akonto-Nr.</th>
                  <th className="text-left font-semibold px-3 py-2 w-24">Datum</th>
                  <th className="text-left font-semibold px-3 py-2">Kunde</th>
                  <th className="text-left font-semibold px-3 py-2">Projekt</th>
                  <th className="text-left font-semibold px-3 py-2 w-32">Periode</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Netto</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">MWST</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Total</th>
                  <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
                  <th className="text-left font-semibold px-3 py-2 w-32">Verrechnet</th>
                  <th className="text-right font-semibold px-3 py-2 w-56">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <AkontoRow
                    key={inv.id}
                    inv={inv}
                    link={linkByAkonto.get(inv.id)}
                    onFinalize={() => finalizeMut.mutate(inv.id)}
                    onSend={() => sendMut.mutate(inv.id)}
                    onCancel={() => {
                      if (window.confirm('Akonto wirklich stornieren?')) cancelMut.mutate(inv.id);
                    }}
                    onPdf={() => downloadPdf(inv)}
                    busy={
                      (finalizeMut.isPending && finalizeMut.variables === inv.id) ||
                      (sendMut.isPending && sendMut.variables === inv.id)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Tabellenzeile ---------------------------------------------------------

function AkontoRow({ inv, link, onFinalize, onSend, onCancel, onPdf, busy }) {
  const statusInfo = STATUS_CHIP[inv.status] ?? STATUS_CHIP.entwurf;
  const isDraft = inv.status === 'entwurf';
  const canFinalize = inv.status === 'entwurf';
  const canSend = inv.status === 'definitiv';
  const canCancel = inv.status !== 'storniert' && inv.status !== 'entwurf';

  const period =
    inv.period_from || inv.period_to
      ? `${fmt.date(inv.period_from)} – ${fmt.date(inv.period_to)}`
      : '—';

  return (
    <tr
      className="border-b last:border-b-0 hover:bg-zinc-50"
      style={{ borderColor: '#eef1ee' }}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {inv.invoice_no ? (
            <span className="font-semibold tabular-nums">{inv.invoice_no}</span>
          ) : (
            <span className="text-zinc-400 italic">(Entwurf)</span>
          )}
          <AkontoBadge />
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(inv.issue_date)}</td>
      <td className="px-3 py-2">
        {inv.customer?.company_name ?? <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 text-zinc-600">
        {inv.project?.name ?? <span className="text-zinc-300">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500 tabular-nums">{period}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(inv.subtotal)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(inv.vat_amount)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(inv.total)}</td>
      <td className="px-3 py-2">
        <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
      </td>
      <td className="px-3 py-2">
        {link ? (
          <span
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: '#2d5a2d' }}
            title={`Verrechnet in Schlussrechnung ${link.schluss?.invoice_no ?? ''}`}
          >
            <Link2 className="w-3 h-3" />
            {link.schluss?.invoice_no ?? '✓'}
          </span>
        ) : (
          <span className="text-xs text-zinc-300">offen</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconBtn onClick={onPdf} title="PDF herunterladen">
            <FileDown className="w-3.5 h-3.5" />
          </IconBtn>
          {canFinalize && (
            <IconBtn
              onClick={onFinalize}
              title={busy ? 'Erstelle…' : 'Definitiv erstellen'}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canSend && (
            <IconBtn onClick={onSend} title={busy ? 'Versende…' : 'Versenden'}>
              <Send className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {canCancel && (
            <IconBtn onClick={onCancel} title="Stornieren">
              <XIcon className="w-3.5 h-3.5" />
            </IconBtn>
          )}
          {isDraft && !canFinalize && (
            <span className="text-[10px] text-zinc-400 italic">—</span>
          )}
        </div>
      </td>
    </tr>
  );
}
