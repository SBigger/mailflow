// Leistungserfassung · Zahlungseingänge
// 3 Tabs: Manuell erfassen, camt.054 Import, Historie.
// Schreibt nach `le_payment`, setzt `le_invoice.status='bezahlt'` wenn paid >= total,
// und legt einen `le_camt_import`-Audit-Eintrag pro Import-Run an.

import React, { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, X as XIcon,
  Banknote, Search, Trash2,
} from 'lucide-react';
import { lePayment, leInvoice, leCamtImport } from '@/lib/leApi';
import {
  Card, Chip, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Helpers ---------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const lastMonthIso = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const normRef = (s) => String(s ?? '').replace(/\s/g, '');

const SOURCE_CHIP = {
  manual:  { tone: 'neutral', label: 'Manuell' },
  camt054: { tone: 'blue',    label: 'camt.054' },
  camt053: { tone: 'blue',    label: 'camt.053' },
  esr:     { tone: 'violet',  label: 'ESR' },
};

// camt.054 Parser via DOMParser (Browser-nativ)
function parseCamt054(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('XML-Datei kann nicht gelesen werden.');

  const entries = [...doc.querySelectorAll('Ntry')];
  return entries.map((e) => {
    const isCredit = e.querySelector('CdtDbtInd')?.textContent === 'CRDT';
    const amt = e.querySelector('Amt');
    return {
      amount: Number(amt?.textContent || 0),
      currency: amt?.getAttribute('Ccy') || 'CHF',
      bookingDate: e.querySelector('BookgDt > Dt')?.textContent ?? null,
      valueDate: e.querySelector('ValDt > Dt')?.textContent ?? null,
      bankRef: e.querySelector('Refs > AcctSvcrRef')?.textContent ?? null,
      reference: normRef(e.querySelector('RmtInf Strd CdtrRefInf > Ref')?.textContent),
      debtorName: e.querySelector('RltdPties Dbtr > Nm')?.textContent ?? null,
      debtorIban: e.querySelector('RltdPties DbtrAcct IBAN')?.textContent ?? null,
      isCredit,
    };
  }).filter((p) => p.isCredit);
}

// --- Haupt-Panel -----------------------------------------------------------

const TABS = [
  { key: 'erfassen', label: 'Erfassen',     icon: Banknote },
  { key: 'import',   label: 'camt.054 Import', icon: Upload },
  { key: 'historie', label: 'Historie',     icon: FileText },
];

export default function ZahlungseingaengePanel() {
  const [tab, setTab] = useState('erfassen');

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Zahlungseingänge"
        subtitle="Manuelle Erfassung, camt.054-Import und Historie aller erfassten Zahlungen."
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
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
            </button>
          );
        })}
      </div>

      {tab === 'erfassen' && <ManuellTab />}
      {tab === 'import'   && <CamtImportTab />}
      {tab === 'historie' && <HistorieTab />}
    </div>
  );
}

// =============================================================================
// Tab 1 · Manuell erfassen
// =============================================================================

function ManuellTab() {
  const qc = useQueryClient();

  const openInvoicesQ = useQuery({
    queryKey: ['le', 'invoice', 'versendet'],
    queryFn: () => leInvoice.list({ status: 'versendet' }),
  });

  const [invoiceId, setInvoiceId] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // Sortiert nach Fälligkeit (älteste zuerst)
  const openInvoices = useMemo(() => {
    const arr = openInvoicesQ.data ?? [];
    return [...arr].sort((a, b) => {
      const da = a.due_date ?? '9999-12-31';
      const db = b.due_date ?? '9999-12-31';
      return da.localeCompare(db);
    });
  }, [openInvoicesQ.data]);

  const selectedInvoice = useMemo(
    () => openInvoices.find((i) => i.id === invoiceId) ?? null,
    [openInvoices, invoiceId],
  );

  // Default-Betrag = Total der gewählten Rechnung
  const onPickInvoice = (id) => {
    setInvoiceId(id);
    const inv = openInvoices.find((i) => i.id === id);
    if (inv) {
      setAmount(String(inv.total ?? ''));
      setReference(inv.qr_reference ?? '');
    }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice) throw new Error('Bitte eine Rechnung auswählen.');
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Betrag ungültig.');
      if (!paidAt) throw new Error('Zahlungsdatum ist Pflicht.');

      // 1) Payment anlegen
      await lePayment.create({
        invoice_id:   selectedInvoice.id,
        customer_id:  selectedInvoice.customer_id ?? selectedInvoice.customer?.id ?? null,
        amount:       amt,
        currency:     selectedInvoice.currency ?? 'CHF',
        paid_at:      paidAt,
        reference:    reference || null,
        source:       'manual',
        notes:        notes || null,
      });

      // 2) Invoice ggf. auf "bezahlt" setzen
      const prevPaid = Number(selectedInvoice.paid_amount ?? 0);
      const newPaid = prevPaid + amt;
      const total = Number(selectedInvoice.total ?? 0);
      const patch = { paid_amount: newPaid };
      if (newPaid + 0.01 >= total) {
        patch.status = 'bezahlt';
        patch.paid_at = paidAt;
      }
      await leInvoice.update(selectedInvoice.id, patch);
    },
    onSuccess: () => {
      toast.success('Zahlung erfasst');
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
      qc.invalidateQueries({ queryKey: ['le', 'payment'] });
      // Reset
      setInvoiceId('');
      setAmount('');
      setReference('');
      setNotes('');
      setPaidAt(todayIso());
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  if (openInvoicesQ.error) {
    return <PanelError error={openInvoicesQ.error} onRetry={() => openInvoicesQ.refetch()} />;
  }

  return (
    <Card className="p-5">
      {openInvoicesQ.isLoading ? (
        <PanelLoader />
      ) : openInvoices.length === 0 ? (
        <div className="p-8 text-center text-sm text-zinc-400">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
          Keine offenen (versendeten) Rechnungen vorhanden.
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
          className="space-y-4"
        >
          <Field label="Rechnung" hint="Sortiert nach Fälligkeit (älteste zuerst)">
            <Select value={invoiceId} onChange={(e) => onPickInvoice(e.target.value)} required>
              <option value="">– Rechnung wählen –</option>
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {(inv.invoice_no ?? '(ohne Nr.)')}
                  {' · '}
                  {inv.customer?.company_name ?? '—'}
                  {' · CHF '}
                  {fmt.chf(inv.total)}
                  {inv.due_date ? ` · fällig ${fmt.date(inv.due_date)}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          {selectedInvoice && (
            <div
              className="rounded p-3 text-xs"
              style={{ background: '#f7f8f6', border: '1px solid #e4e7e4' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-semibold">{selectedInvoice.invoice_no ?? '(ohne Nr.)'}</span>
                <span className="text-zinc-500">· {selectedInvoice.customer?.company_name ?? '—'}</span>
              </div>
              <div className="text-zinc-500">
                Total CHF <span className="tabular-nums">{fmt.chf(selectedInvoice.total)}</span>
                {' · '}Bereits bezahlt CHF <span className="tabular-nums">{fmt.chf(selectedInvoice.paid_amount)}</span>
                {selectedInvoice.qr_reference && (
                  <> · QR-Ref <span className="font-mono text-[10px]">{selectedInvoice.qr_reference}</span></>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Zahlungsdatum">
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
            </Field>
            <Field label="Betrag (CHF)">
              <Input
                type="number" step="0.05" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Referenz" hint="QR-Referenz / SCOR / freitext">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>

          <Field label="Notizen">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={createMut.isPending || !invoiceId}
              className={artisBtn.primary}
              style={{
                ...artisPrimaryStyle,
                opacity: (createMut.isPending || !invoiceId) ? 0.6 : 1,
              }}
            >
              <CheckCircle2 className="w-4 h-4" />
              {createMut.isPending ? 'Speichere…' : 'Zahlung erfassen'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// =============================================================================
// Tab 2 · camt.054 Import
// =============================================================================

function CamtImportTab() {
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const [filename, setFilename] = useState('');
  const [parsedPayments, setParsedPayments] = useState(null); // null = noch nichts geladen
  const [matchTab, setMatchTab] = useState('auto');
  const [selected, setSelected] = useState({});       // { tempId: bool }
  const [overrideInv, setOverrideInv] = useState({}); // { tempId: invoiceId }

  // Für Matching: alle offenen Rechnungen
  const openInvoicesQ = useQuery({
    queryKey: ['le', 'invoice', 'versendet'],
    queryFn: () => leInvoice.list({ status: 'versendet' }),
    enabled: parsedPayments != null,
  });

  const openInvoices = openInvoicesQ.data ?? [];

  const matchMap = useMemo(() => {
    const m = new Map();
    for (const inv of openInvoices) {
      const k = normRef(inv.qr_reference);
      if (k) m.set(k, inv);
    }
    return m;
  }, [openInvoices]);

  // Parsed + matched
  const items = useMemo(() => {
    if (!parsedPayments) return [];
    return parsedPayments.map((p, idx) => {
      const tempId = String(idx);
      const refKey = normRef(p.reference);
      const inv = refKey ? matchMap.get(refKey) : null;
      let status = 'unmatched';
      if (inv) {
        const total = Number(inv.total ?? 0);
        const diff = Math.abs(Number(p.amount) - total);
        status = diff <= 1 ? 'auto' : 'ambig';
      }
      return { ...p, tempId, status, matchedInvoice: inv };
    });
  }, [parsedPayments, matchMap]);

  const counts = useMemo(() => ({
    auto:      items.filter((i) => i.status === 'auto').length,
    ambig:     items.filter((i) => i.status === 'ambig').length,
    unmatched: items.filter((i) => i.status === 'unmatched').length,
  }), [items]);

  const visibleItems = items.filter((i) => i.status === matchTab);

  // Datei-Handler
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    try {
      const text = await file.text();
      const payments = parseCamt054(text);
      setParsedPayments(payments);

      // Auto-Auswahl: nur "auto" vorausgewählt → erfolgt nach Matching im Effekt unten
      // Hier nur leeres Set; Default wird beim ersten Render angewendet
      setSelected({});
      setOverrideInv({});
      setMatchTab('auto');

      if (payments.length === 0) {
        toast.warning('Keine Gutschriften (CRDT-Buchungen) in der Datei gefunden.');
      } else {
        toast.success(`${payments.length} Zahlung${payments.length === 1 ? '' : 'en'} eingelesen`);
      }
    } catch (err) {
      toast.error('Parse-Fehler: ' + (err?.message ?? err));
      setParsedPayments(null);
      setFilename('');
    }
  };

  // Sobald `items` (Matching) gerechnet ist und keine Selection existiert → "auto" vorauswählen
  React.useEffect(() => {
    if (!items.length) return;
    if (Object.keys(selected).length > 0) return;
    const init = {};
    for (const it of items) {
      if (it.status === 'auto') init[it.tempId] = true;
    }
    setSelected(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const toggleSelected = (tempId) => {
    setSelected((s) => ({ ...s, [tempId]: !s[tempId] }));
  };

  // Bestätigen
  const confirmMut = useMutation({
    mutationFn: async () => {
      const chosen = items.filter((it) => selected[it.tempId]);
      if (chosen.length === 0) throw new Error('Keine Zahlungen ausgewählt.');

      let matchedCount = 0;
      let totalAmount = 0;

      for (const it of chosen) {
        const overrideId = overrideInv[it.tempId] || null;
        const inv = overrideId
          ? openInvoices.find((i) => i.id === overrideId)
          : it.matchedInvoice;

        // Payment anlegen
        await lePayment.create({
          invoice_id:   inv?.id ?? null,
          customer_id:  inv?.customer_id ?? inv?.customer?.id ?? null,
          amount:       it.amount,
          currency:     it.currency || 'CHF',
          paid_at:      it.bookingDate ?? it.valueDate ?? todayIso(),
          value_date:   it.valueDate ?? null,
          reference:    it.reference || null,
          debtor_name:  it.debtorName ?? null,
          debtor_iban:  it.debtorIban ?? null,
          bank_ref:     it.bankRef ?? null,
          source:       'camt054',
        });

        totalAmount += Number(it.amount) || 0;

        // Falls einer Rechnung zugeordnet → ggf. auf "bezahlt" setzen
        if (inv) {
          matchedCount += 1;
          const prevPaid = Number(inv.paid_amount ?? 0);
          const newPaid = prevPaid + Number(it.amount);
          const total = Number(inv.total ?? 0);
          const patch = { paid_amount: newPaid };
          if (newPaid + 0.01 >= total) {
            patch.status = 'bezahlt';
            patch.paid_at = it.bookingDate ?? it.valueDate ?? todayIso();
          }
          await leInvoice.update(inv.id, patch);
        }
      }

      // Audit
      await leCamtImport.create({
        filename:      filename || null,
        total_count:   chosen.length,
        matched_count: matchedCount,
        total_amount:  Number(totalAmount.toFixed(2)),
      });
    },
    onSuccess: () => {
      toast.success('Zahlungen importiert');
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
      qc.invalidateQueries({ queryKey: ['le', 'payment'] });
      qc.invalidateQueries({ queryKey: ['le', 'camt-import'] });
      // Reset
      setParsedPayments(null);
      setFilename('');
      setSelected({});
      setOverrideInv({});
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  return (
    <div className="space-y-4">
      {/* Upload */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-zinc-500" />
              camt.054-Datei einlesen
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              ISO-20022-XML aus E-Banking. Es werden nur Gutschriften (CRDT) berücksichtigt.
            </div>
            {filename && (
              <div className="text-xs text-zinc-600 mt-2">
                <Chip tone="blue">{filename}</Chip>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,application/xml,text/xml"
              className="hidden"
              onChange={onFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={artisBtn.primary}
              style={artisPrimaryStyle}
            >
              <Upload className="w-4 h-4" />
              Datei wählen
            </button>
            {parsedPayments && (
              <button
                type="button"
                onClick={() => {
                  setParsedPayments(null);
                  setFilename('');
                  setSelected({});
                  setOverrideInv({});
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className={artisBtn.ghost}
                style={artisGhostStyle}
              >
                <XIcon className="w-4 h-4" />
                Verwerfen
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Match-Liste */}
      {parsedPayments && (
        <Card className="p-3 space-y-3">
          {openInvoicesQ.isLoading ? (
            <PanelLoader />
          ) : (
            <>
              {/* Tabs auto / ambig / unmatched */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'auto',      label: 'Automatisch', tone: 'green'   },
                  { key: 'ambig',     label: 'Mehrdeutig',  tone: 'orange'  },
                  { key: 'unmatched', label: 'Kein Match',  tone: 'red'     },
                ].map((t) => {
                  const active = matchTab === t.key;
                  const n = counts[t.key];
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setMatchTab(t.key)}
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

              {/* Tabelle */}
              {visibleItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-400">
                  Keine Einträge in dieser Kategorie.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                        <th className="text-left font-semibold px-2 py-2 w-8"></th>
                        <th className="text-left font-semibold px-2 py-2 w-28">Datum</th>
                        <th className="text-right font-semibold px-2 py-2 w-28">Betrag</th>
                        <th className="text-left font-semibold px-2 py-2">Referenz</th>
                        <th className="text-left font-semibold px-2 py-2">Zahler</th>
                        <th className="text-left font-semibold px-2 py-2 w-72">Rechnung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((it) => (
                        <tr key={it.tempId} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={!!selected[it.tempId]}
                              onChange={() => toggleSelected(it.tempId)}
                            />
                          </td>
                          <td className="px-2 py-2 tabular-nums text-zinc-600">
                            {fmt.date(it.bookingDate ?? it.valueDate)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium">
                            {fmt.chf(it.amount)}
                          </td>
                          <td className="px-2 py-2 font-mono text-[10px] break-all">
                            {it.reference || <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-2 py-2">
                            <div>{it.debtorName ?? <span className="text-zinc-300">—</span>}</div>
                            {it.debtorIban && (
                              <div className="text-[10px] text-zinc-400 font-mono">{it.debtorIban}</div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {it.status === 'auto' ? (
                              <div>
                                <div className="font-semibold">
                                  {it.matchedInvoice?.invoice_no ?? '—'}
                                </div>
                                <div className="text-[10px] text-zinc-500">
                                  {it.matchedInvoice?.customer?.company_name ?? '—'}
                                </div>
                              </div>
                            ) : (
                              <Select
                                value={overrideInv[it.tempId] ?? it.matchedInvoice?.id ?? ''}
                                onChange={(e) => setOverrideInv((m) => ({ ...m, [it.tempId]: e.target.value }))}
                              >
                                <option value="">– keine Rechnung zuordnen –</option>
                                {openInvoices.map((inv) => (
                                  <option key={inv.id} value={inv.id}>
                                    {(inv.invoice_no ?? '(ohne Nr.)')}
                                    {' · '}{inv.customer?.company_name ?? '—'}
                                    {' · CHF '}{fmt.chf(inv.total)}
                                  </option>
                                ))}
                              </Select>
                            )}
                            {it.status === 'ambig' && (
                              <div className="text-[10px] mt-1" style={{ color: '#8a5a00' }}>
                                <AlertTriangle className="w-3 h-3 inline mr-1" />
                                Betrag weicht ab – bitte prüfen.
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Bestätigen */}
              <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
                <div className="text-xs text-zinc-500">
                  {Object.values(selected).filter(Boolean).length} von {items.length} Zahlungen ausgewählt
                </div>
                <button
                  type="button"
                  disabled={confirmMut.isPending || Object.values(selected).filter(Boolean).length === 0}
                  onClick={() => confirmMut.mutate()}
                  className={artisBtn.primary}
                  style={{
                    ...artisPrimaryStyle,
                    opacity: (confirmMut.isPending || Object.values(selected).filter(Boolean).length === 0) ? 0.6 : 1,
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {confirmMut.isPending ? 'Importiere…' : 'Bestätigen & Importieren'}
                </button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// Tab 3 · Historie
// =============================================================================

function HistorieTab() {
  const qc = useQueryClient();

  const [from, setFrom] = useState(lastMonthIso());
  const [to, setTo] = useState(todayIso());
  const [search, setSearch] = useState('');

  const paymentsQ = useQuery({
    queryKey: ['le', 'payment', from, to],
    queryFn: () => lePayment.list({ from: from || undefined, to: to || undefined }),
  });

  const removeMut = useMutation({
    mutationFn: (id) => lePayment.remove(id),
    onSuccess: () => {
      toast.success('Zahlung gelöscht');
      qc.invalidateQueries({ queryKey: ['le', 'payment'] });
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const payments = paymentsQ.data ?? [];

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return payments;
    return payments.filter((p) => {
      const hay = [
        p.invoice?.invoice_no,
        p.customer?.company_name,
        p.debtor_name,
        p.reference,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [payments, search]);

  const total = useMemo(
    () => filtered.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
    [filtered],
  );

  if (paymentsQ.error) {
    return <PanelError error={paymentsQ.error} onRetry={() => paymentsQ.refetch()} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Field label="Suche">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-2.5 text-zinc-400 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechnungsnr., Kunde, Zahler oder Referenz…"
                  className="pl-8"
                />
              </div>
            </Field>
          </div>
          <Field label="Von (Zahlungsdatum)">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Bis (Zahlungsdatum)">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* Tabelle */}
      <Card>
        {paymentsQ.isLoading ? (
          <PanelLoader />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            <Banknote className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
            Keine Zahlungen im gewählten Zeitraum.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                    <th className="text-left font-semibold px-3 py-2 w-28">Datum</th>
                    <th className="text-left font-semibold px-3 py-2 w-32">Rechnung</th>
                    <th className="text-left font-semibold px-3 py-2">Kunde / Zahler</th>
                    <th className="text-right font-semibold px-3 py-2 w-28">Betrag</th>
                    <th className="text-left font-semibold px-3 py-2 w-24">Quelle</th>
                    <th className="text-left font-semibold px-3 py-2">Referenz</th>
                    <th className="text-right font-semibold px-3 py-2 w-16">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const src = SOURCE_CHIP[p.source] ?? SOURCE_CHIP.manual;
                    return (
                      <tr key={p.id} className="border-b last:border-b-0 hover:bg-zinc-50" style={{ borderColor: '#eef1ee' }}>
                        <td className="px-3 py-2 tabular-nums text-zinc-600">{fmt.date(p.paid_at)}</td>
                        <td className="px-3 py-2 font-semibold tabular-nums">
                          {p.invoice?.invoice_no ?? <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div>{p.customer?.company_name ?? <span className="text-zinc-300">—</span>}</div>
                          {p.debtor_name && p.debtor_name !== p.customer?.company_name && (
                            <div className="text-[10px] text-zinc-400">Zahler: {p.debtor_name}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(p.amount)}</td>
                        <td className="px-3 py-2"><Chip tone={src.tone}>{src.label}</Chip></td>
                        <td className="px-3 py-2 font-mono text-[10px] text-zinc-500 break-all">
                          {p.reference || <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn
                              danger
                              title="Löschen"
                              onClick={() => {
                                if (window.confirm('Zahlung wirklich löschen? Status der Rechnung bleibt unverändert.')) {
                                  removeMut.mutate(p.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              className="px-3 py-2 text-xs flex items-center justify-between border-t"
              style={{ borderColor: '#eef1ee', background: '#fafbf9' }}
            >
              <span className="text-zinc-500">
                {filtered.length} Zahlung{filtered.length === 1 ? '' : 'en'}
              </span>
              <span className="font-semibold">
                Total CHF <span className="tabular-nums">{fmt.chf(total)}</span>
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
