// Entwurfs-Durchgang – Stepper-UI durch alle Rechnungsentwürfe (status='entwurf').
// User arbeitet sich Entwurf für Entwurf durch: Positionen editieren, Rabatt/MWST
// anpassen, speichern, definitiv erstellen. Am Ende: "Alles versenden".
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Check, FileCheck2,
  Send, Save, Receipt, SkipForward, FileDown,
} from 'lucide-react';
import { leInvoice, leInvoiceLine, leCompany } from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';
import { generateInvoicePdf, triggerDownload } from '@/lib/leInvoicePdf';
import {
  Chip, Card, IconBtn, Input, Field, PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared.jsx';

const PRIMARY = '#7a9b7f';
const ACCENT = '#e6ede6';
const DARK = '#2d5a2d';

const todayIso = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

// ------------------------------------------------------------------
// Ein einzelner Entwurf als editierbarer Block. Hält eigenen lokalen
// State (Header + Lines) und signalisiert dirty-Status an Parent.
// ------------------------------------------------------------------
function DraftEditor({ invoice, onSaved, onFinalized, onDirtyChange }) {
  const qc = useQueryClient();

  // Header-Felder
  const [periodFrom, setPeriodFrom] = useState(invoice.period_from ?? '');
  const [periodTo,   setPeriodTo]   = useState(invoice.period_to   ?? '');
  const [dueDate,    setDueDate]    = useState(invoice.due_date    ?? '');
  const [notes,      setNotes]      = useState(invoice.notes       ?? '');
  const [discountPct,    setDiscountPct]    = useState(invoice.discount_pct    ?? 0);
  const [discountAmount, setDiscountAmount] = useState(invoice.discount_amount ?? 0);
  const [vatPct,         setVatPct]         = useState(invoice.vat_pct ?? 8.1);

  // Lines: id === null bei Neu, _deleted bei Lösch, _touched wenn manuell Betrag
  const [lines, setLines] = useState(() =>
    (invoice.lines ?? [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((l) => ({ ...l, _original: { ...l } })),
  );

  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const markDirty = () => { if (!dirty) setDirty(true); };

  // --- Kalkulation (live, ohne Speichern) ---
  const activeLines = lines.filter((l) => !l._deleted);
  const subtotalRaw = activeLines.reduce((s, l) => s + num(l.amount), 0);
  const afterPct = subtotalRaw * (1 - num(discountPct) / 100);
  const subtotalNet = Math.max(0, afterPct - num(discountAmount));
  const vatAmount = subtotalNet * num(vatPct) / 100;
  const total = subtotalNet + vatAmount;

  // --- Line-Operationen ---
  const updateLine = (idx, patch) => {
    setLines((arr) => arr.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, ...patch };
      // Auto-Betrag wenn weder hours noch rate manuell auf amount overridden
      if (('hours' in patch || 'rate' in patch) && !next._amountTouched) {
        next.amount = Number((num(next.hours) * num(next.rate)).toFixed(2));
      }
      if ('amount' in patch) next._amountTouched = true;
      return next;
    }));
    markDirty();
  };

  const addLine = () => {
    setLines((arr) => [...arr, {
      id: null,
      invoice_id: invoice.id,
      position: arr.length + 1,
      description: '',
      hours: 0,
      rate: 0,
      amount: 0,
    }]);
    markDirty();
  };

  const removeLine = (idx) => {
    setLines((arr) => arr.map((l, i) => {
      if (i !== idx) return l;
      if (l.id == null) return { ...l, _drop: true }; // Neue Zeile → einfach weg
      return { ...l, _deleted: true };
    }).filter((l) => !l._drop));
    markDirty();
  };

  // --- Persistieren ---
  const saveMut = useMutation({
    mutationFn: async () => {
      // 1) Header-Patch
      await leInvoice.update(invoice.id, {
        period_from: periodFrom || null,
        period_to: periodTo || null,
        due_date: dueDate || null,
        notes: notes || null,
        discount_pct: num(discountPct),
        discount_amount: num(discountAmount),
        vat_pct: num(vatPct),
        subtotal: subtotalNet,
        vat_amount: vatAmount,
        total,
      });
      // 2) Lines
      for (const l of lines) {
        if (l._deleted && l.id) {
          await leInvoiceLine.remove(l.id);
          continue;
        }
        if (l.id == null) {
          await leInvoiceLine.create({
            invoice_id: invoice.id,
            position: l.position,
            description: l.description || '',
            hours: num(l.hours),
            rate: num(l.rate),
            amount: num(l.amount),
          });
        } else {
          const orig = l._original || {};
          const changed = ['description', 'hours', 'rate', 'amount', 'position']
            .some((k) => String(orig[k] ?? '') !== String(l[k] ?? ''));
          if (changed) {
            await leInvoiceLine.update(l.id, {
              description: l.description || '',
              hours: num(l.hours),
              rate: num(l.rate),
              amount: num(l.amount),
              position: l.position,
            });
          }
        }
      }
    },
    onSuccess: () => {
      toast.success('Entwurf gespeichert');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['le', 'invoice', 'entwurf'] });
      onSaved?.();
    },
    onError: (e) => toast.error('Speichern fehlgeschlagen: ' + (e?.message ?? e)),
  });

  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (dirty) await saveMut.mutateAsync();
      return leInvoice.finalize(invoice.id);
    },
    onSuccess: (inv) => {
      toast.success(`Definitiv: ${inv.invoice_no}`);
      qc.invalidateQueries({ queryKey: ['le', 'invoice', 'entwurf'] });
      onFinalized?.(inv);
    },
    onError: (e) => toast.error('Finalisieren fehlgeschlagen: ' + (e?.message ?? e)),
  });

  return (
    <Card className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b" style={{ borderColor: '#e4e7e4' }}>
        <div>
          <div className="text-sm font-semibold" style={{ color: DARK }}>
            {invoice.customer?.company_name ?? '—'}
            {invoice.project?.name && <span className="text-zinc-400 font-normal"> · {invoice.project.name}</span>}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            Rechnungsnr.: <span className="italic">wird bei Definitiv gesetzt</span>
          </div>
        </div>
        <Chip tone="orange">ENTWURF</Chip>
      </div>

      {/* Perioden-Felder */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Field label="Periode von">
          <Input type="date" value={periodFrom ?? ''} onChange={(e) => { setPeriodFrom(e.target.value); markDirty(); }} />
        </Field>
        <Field label="Periode bis">
          <Input type="date" value={periodTo ?? ''} onChange={(e) => { setPeriodTo(e.target.value); markDirty(); }} />
        </Field>
        <Field label="Fällig am">
          <Input type="date" value={dueDate ?? ''} onChange={(e) => { setDueDate(e.target.value); markDirty(); }} />
        </Field>
      </div>

      {/* Positionen */}
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Positionen</div>
        <div className="border rounded overflow-hidden" style={{ borderColor: '#e4e7e4' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-zinc-600" style={{ background: '#fafaf7' }}>
                <th className="px-2 py-2 text-left font-semibold">Beschreibung</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Stunden</th>
                <th className="px-2 py-2 text-right font-semibold w-24">Satz</th>
                <th className="px-2 py-2 text-right font-semibold w-28">Betrag</th>
                <th className="px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {activeLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-zinc-400 text-xs">
                    Keine Positionen.
                  </td>
                </tr>
              )}
              {lines.map((l, idx) => {
                if (l._deleted) return null;
                return (
                  <tr key={l.id ?? `new-${idx}`} className="border-t" style={{ borderColor: '#eef0ee' }}>
                    <td className="px-2 py-1">
                      <Input
                        value={l.description ?? ''}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        placeholder="Beschreibung"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number" step="0.25" min="0"
                        className="text-right"
                        value={l.hours ?? 0}
                        onChange={(e) => updateLine(idx, { hours: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number" step="1" min="0"
                        className="text-right"
                        value={l.rate ?? 0}
                        onChange={(e) => updateLine(idx, { rate: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number" step="0.05" min="0"
                        className="text-right font-medium"
                        value={l.amount ?? 0}
                        onChange={(e) => updateLine(idx, { amount: e.target.value })}
                        onBlur={(e) => updateLine(idx, { amount: Number(num(e.target.value).toFixed(2)) })}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <IconBtn danger title="Position löschen" onClick={() => removeLine(idx)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: DARK }}
        >
          <Plus className="w-3.5 h-3.5" /> Position
        </button>
      </div>

      {/* Abschluss-Block + Notizen */}
      <div className="grid grid-cols-2 gap-5">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Notizen</div>
          <textarea
            value={notes ?? ''}
            onChange={(e) => { setNotes(e.target.value); markDirty(); }}
            placeholder="Interne Notiz zur Rechnung…"
            rows={5}
            className="w-full border rounded px-2 py-1.5 text-sm"
            style={{ borderColor: '#d9dfd9' }}
          />
        </div>
        <div className="rounded-lg p-4" style={{ background: ACCENT }}>
          <div className="flex justify-between text-sm py-1">
            <span className="text-zinc-600">Zwischensumme</span>
            <span className="font-medium">CHF {fmt.chf(subtotalRaw)}</span>
          </div>
          <div className="flex justify-between items-center text-sm py-1 gap-2">
            <span className="text-zinc-600">Rabatt %</span>
            <Input
              type="number" step="0.1" min="0" max="100"
              className="text-right w-24 bg-white"
              value={discountPct ?? 0}
              onChange={(e) => { setDiscountPct(e.target.value); markDirty(); }}
            />
          </div>
          <div className="flex justify-between items-center text-sm py-1 gap-2">
            <span className="text-zinc-600">Rabatt CHF</span>
            <Input
              type="number" step="0.05" min="0"
              className="text-right w-24 bg-white"
              value={discountAmount ?? 0}
              onChange={(e) => { setDiscountAmount(e.target.value); markDirty(); }}
            />
          </div>
          <div className="flex justify-between items-center text-sm py-1 gap-2">
            <span className="text-zinc-600">MWST %</span>
            <Input
              type="number" step="0.1" min="0"
              className="text-right w-24 bg-white"
              value={vatPct ?? 0}
              onChange={(e) => { setVatPct(e.target.value); markDirty(); }}
            />
          </div>
          <div className="flex justify-between text-sm py-1">
            <span className="text-zinc-600">MWST</span>
            <span className="font-medium">CHF {fmt.chf(vatAmount)}</span>
          </div>
          <div className="h-px my-2" style={{ background: '#bfd3bf' }} />
          <div className="flex justify-between items-baseline py-1">
            <span className="text-sm font-semibold" style={{ color: DARK }}>Total</span>
            <span className="text-xl font-bold" style={{ color: DARK }}>CHF {fmt.chf(total)}</span>
          </div>
        </div>
      </div>

      {/* Action-Row */}
      <div className="mt-5 pt-4 border-t flex items-center justify-end gap-2" style={{ borderColor: '#e4e7e4' }}>
        <button
          type="button"
          onClick={async () => {
            try {
              const company = await leCompany.get();
              if (!company) { toast.error('Firmen-Settings fehlen (Stammdaten → Firma).'); return; }
              const fresh = await leInvoice.get(invoice.id);
              const result = await generateInvoicePdf({ invoice: fresh, company });
              if (result.blob) triggerDownload(result.blob, `Rechnung-${fresh.invoice_no || 'Entwurf'}.pdf`);
              toast.success('PDF generiert' + (result.url ? ' und gespeichert' : ''));
            } catch (e) { toast.error('PDF-Fehler: ' + (e?.message ?? e)); }
          }}
          className={artisBtn.ghost}
          style={artisGhostStyle}
        >
          <FileDown className="w-4 h-4" /> PDF
        </button>
        <button
          type="button"
          disabled={!dirty || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          className={artisBtn.primary}
          style={{ ...artisPrimaryStyle, opacity: (!dirty || saveMut.isPending) ? 0.55 : 1 }}
        >
          <Save className="w-4 h-4" /> Speichern
        </button>
        <button
          type="button"
          disabled={finalizeMut.isPending}
          onClick={() => finalizeMut.mutate()}
          className={artisBtn.primary}
          style={{ background: DARK, opacity: finalizeMut.isPending ? 0.55 : 1 }}
        >
          <FileCheck2 className="w-4 h-4" /> Definitiv erstellen
        </button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Haupt-Panel: Stepper über alle Entwürfe, Ende-State mit "Alles versenden"
// ------------------------------------------------------------------
export default function EntwurfsDurchgangPanel() {
  const qc = useQueryClient();
  const [idx, setIdx] = useState(0);
  const [finalized, setFinalized] = useState([]); // IDs + {no, total} die in dieser Session definitiv wurden
  const [dirty, setDirty] = useState(false);

  const q = useQuery({
    queryKey: ['le', 'invoice', 'entwurf'],
    queryFn: () => leInvoice.list({ status: 'entwurf' }),
  });

  const drafts = q.data ?? [];
  // Bei Reload: Index clampen
  useEffect(() => {
    if (idx > drafts.length - 1) setIdx(Math.max(0, drafts.length - 1));
  }, [drafts.length, idx]);

  const current = drafts[idx];
  const done = drafts.length === 0 || idx >= drafts.length;

  const confirmLeaveDirty = () => {
    if (!dirty) return true;
    return window.confirm('Änderungen nicht gespeichert. Trotzdem weiter?');
  };

  const go = (delta) => {
    if (!confirmLeaveDirty()) return;
    setDirty(false);
    setIdx((i) => Math.max(0, Math.min(drafts.length, i + delta)));
  };

  const skip = () => go(1);

  // Nach Finalisieren: Eintrag merken + automatisch weiter
  const handleFinalized = (inv) => {
    setFinalized((arr) => [...arr, { id: inv.id, invoice_no: inv.invoice_no, total: inv.total }]);
    setDirty(false);
    // Entwürfe-Liste invalidieren wurde schon gemacht; wir setzen trotzdem idx weiter
    // damit User direkt zum nächsten Entwurf kommt. Refetch wird idx clampen.
    setIdx((i) => i + 1);
  };

  // Alles versenden: alle definitiv-Invoices in dieser Session (oder global)
  const sendAllMut = useMutation({
    mutationFn: async () => {
      const nowIso = new Date().toISOString();
      // Wir holen alle aktuell definitiven Invoices und setzen status='versendet'.
      // Alternative: nur die IDs aus `finalized`. Wir nehmen die sichereren finalized-IDs.
      const ids = finalized.map((f) => f.id);
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from('le_invoice')
        .update({ status: 'versendet', sent_at: nowIso })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} Rechnungen versendet`);
      setFinalized([]);
      qc.invalidateQueries({ queryKey: ['le', 'invoice'] });
    },
    onError: (e) => toast.error('Versenden fehlgeschlagen: ' + (e?.message ?? e)),
  });

  // ---------- Render ----------
  if (q.isLoading) return <PanelLoader />;
  if (q.error)     return <PanelError error={q.error} onRetry={() => q.refetch()} />;

  // Leer-State: keine Entwürfe und keine frisch-finalisierten
  if (drafts.length === 0 && finalized.length === 0) {
    return (
      <div>
        <PanelHeader title="Entwurfs-Durchgang" subtitle="Arbeite dich durch alle Rechnungsentwürfe." />
        <Card className="p-8 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: ACCENT }}>
              <Receipt className="w-6 h-6" style={{ color: DARK }} />
            </div>
          </div>
          <div className="text-sm font-semibold" style={{ color: DARK }}>Keine Rechnungsentwürfe</div>
          <div className="text-xs text-zinc-500 mt-1">
            Erstelle welche im Tab <b>„Faktura-Vorschlag“</b>.
          </div>
        </Card>
      </div>
    );
  }

  // Ende-State: durch alle Entwürfe durch oder ursprünglich keine, aber finalized vorhanden
  if (done) {
    const summe = finalized.reduce((s, f) => s + num(f.total), 0);
    return (
      <div>
        <PanelHeader title="Entwurfs-Durchgang" subtitle="Durchgang abgeschlossen." />
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: ACCENT }}>
              <Check className="w-5 h-5" style={{ color: DARK }} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: DARK }}>
                {finalized.length} Rechnungen erstellt
              </div>
              <div className="text-xs text-zinc-500">
                Total CHF {fmt.chf(summe)}
              </div>
            </div>
          </div>

          {finalized.length > 0 && (
            <ul className="text-xs divide-y rounded border mb-4" style={{ borderColor: '#e4e7e4' }}>
              {finalized.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono">{f.invoice_no}</span>
                  <span className="text-zinc-600">CHF {fmt.chf(f.total)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setIdx(0); }}
              disabled={drafts.length === 0}
              className={artisBtn.ghost}
              style={{ ...artisGhostStyle, opacity: drafts.length === 0 ? 0.55 : 1 }}
            >
              <ChevronLeft className="w-4 h-4" /> Zurück zum Anfang
            </button>
            <button
              type="button"
              disabled={finalized.length === 0 || sendAllMut.isPending}
              onClick={() => sendAllMut.mutate()}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: (finalized.length === 0 || sendAllMut.isPending) ? 0.55 : 1 }}
            >
              <Send className="w-4 h-4" /> Alle versenden
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // Stepper-State
  return (
    <div>
      <PanelHeader
        title="Entwurfs-Durchgang"
        subtitle={`Entwurf ${idx + 1} von ${drafts.length}`}
        right={
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={idx === 0}
              className={artisBtn.ghost}
              style={{ ...artisGhostStyle, opacity: idx === 0 ? 0.55 : 1 }}
            >
              <ChevronLeft className="w-4 h-4" /> Zurück
            </button>
            <button
              type="button"
              onClick={skip}
              className={artisBtn.ghost}
              style={artisGhostStyle}
              title="Ohne Speichern überspringen"
            >
              <SkipForward className="w-4 h-4" /> Skip
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className={artisBtn.ghost}
              style={artisGhostStyle}
            >
              Weiter <ChevronRight className="w-4 h-4" />
            </button>
          </>
        }
      />

      {/* Progress-Bar + Dots */}
      <div className="mb-4">
        <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: '#eef0ee' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${((idx + 1) / drafts.length) * 100}%`,
              background: PRIMARY,
            }}
          />
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {drafts.map((d, i) => {
            const isDone = finalized.some((f) => f.id === d.id);
            const isCurrent = i === idx;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  if (!confirmLeaveDirty()) return;
                  setDirty(false);
                  setIdx(i);
                }}
                title={`${i + 1}. ${d.customer?.company_name ?? ''}`}
                className="w-2.5 h-2.5 rounded-full transition-all"
                style={{
                  background: isDone ? DARK : isCurrent ? PRIMARY : '#d9dfd9',
                  transform: isCurrent ? 'scale(1.35)' : 'scale(1)',
                }}
              />
            );
          })}
        </div>
      </div>

      {current && (
        <DraftEditor
          key={current.id}
          invoice={current}
          onDirtyChange={setDirty}
          onSaved={() => q.refetch()}
          onFinalized={handleFinalized}
        />
      )}
    </div>
  );
}
