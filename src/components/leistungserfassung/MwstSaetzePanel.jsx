// Stammdaten · MWST-Sätze
// Pflegt CH-MWST-Sätze mit gültig_ab Datum. Beim Wechsel z.B. 8.1→8.5
// wird einfach ein neuer Eintrag pro Code erfasst – das System wählt
// automatisch den am Rechnungsdatum gültigen Satz.
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, Percent, Info } from 'lucide-react';
import { leVatRate } from '@/lib/leApi';
import {
  Card, Chip, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

const EMPTY = {
  code: '', label: '', rate: '',
  valid_from: '', valid_to: '',
  active: true, sort_order: 100, notes: '',
};

const CODE_TONES = {
  STD:    'green',
  RED:    'blue',
  HOTEL:  'violet',
  EXP:    'orange',
  EXEMPT: 'neutral',
};

export default function MwstSaetzePanel() {
  const qc = useQueryClient();
  const ratesQ = useQuery({ queryKey: ['le', 'vat_rate'], queryFn: leVatRate.list });
  const [dialog, setDialog] = useState(null);

  const createMut = useMutation({
    mutationFn: (p) => leVatRate.create(p),
    onSuccess: () => { toast.success('Satz angelegt'); qc.invalidateQueries({ queryKey: ['le', 'vat_rate'] }); setDialog(null); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leVatRate.update(id, patch),
    onSuccess: () => { toast.success('Gespeichert'); qc.invalidateQueries({ queryKey: ['le', 'vat_rate'] }); setDialog(null); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => leVatRate.remove(id),
    onSuccess: () => { toast.success('Gelöscht'); qc.invalidateQueries({ queryKey: ['le', 'vat_rate'] }); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  if (ratesQ.isLoading) return <PanelLoader />;
  if (ratesQ.error) return <PanelError error={ratesQ.error} onRetry={ratesQ.refetch} />;

  const rates = ratesQ.data ?? [];

  const open = (r) => setDialog({
    editing: r,
    form: r ? {
      code: r.code, label: r.label, rate: r.rate,
      valid_from: r.valid_from, valid_to: r.valid_to ?? '',
      active: r.active, sort_order: r.sort_order, notes: r.notes ?? '',
    } : EMPTY,
  });

  const save = () => {
    const f = dialog.form;
    if (!f.code?.trim()) { toast.error('Code ist Pflicht'); return; }
    if (!f.label?.trim()) { toast.error('Bezeichnung ist Pflicht'); return; }
    if (f.rate === '' || isNaN(Number(f.rate))) { toast.error('Satz ist Pflicht'); return; }
    if (!f.valid_from) { toast.error('Gültig ab ist Pflicht'); return; }
    const payload = {
      code: f.code.trim().toUpperCase(),
      label: f.label.trim(),
      rate: Number(f.rate),
      valid_from: f.valid_from,
      valid_to: f.valid_to || null,
      active: !!f.active,
      sort_order: f.sort_order === '' ? 100 : Number(f.sort_order),
      notes: f.notes?.trim() || null,
    };
    if (dialog.editing) updateMut.mutate({ id: dialog.editing.id, patch: payload });
    else createMut.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title="MWST-Sätze"
        subtitle="CH-MWST-Sätze mit Gültigkeit. Bei einer Erhöhung (z.B. 8.1→8.5) einfach neuen Eintrag mit gültig_ab erfassen."
        right={
          <button onClick={() => open(null)} className={artisBtn.primary} style={artisPrimaryStyle}>
            <Plus className="w-4 h-4" /> Neuer Satz
          </button>
        }
      />

      <Card className="p-3 flex items-start gap-2 text-xs" style={{ background: '#f5faf5', borderColor: '#bfd3bf' }}>
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#7a9b7f' }} />
        <div>
          <strong style={{ color: '#2d5a2d' }}>Funktionsweise:</strong> Pro Code (z.B. <code>STD</code>) können mehrere Einträge mit unterschiedlichem <code>gültig ab</code> existieren. Beim Erstellen einer Rechnung wird automatisch der am <em>Rechnungsdatum gültige</em> Satz übernommen und auf der Rechnung eingefroren – ändert sich der Satz später, bleibt die alte Rechnung unverändert.
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
              <th className="text-left font-semibold px-3 py-2 w-24">Code</th>
              <th className="text-left font-semibold px-3 py-2">Bezeichnung</th>
              <th className="text-right font-semibold px-3 py-2 w-20">Satz</th>
              <th className="text-left font-semibold px-3 py-2 w-32">Gültig ab</th>
              <th className="text-left font-semibold px-3 py-2 w-32">Gültig bis</th>
              <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
              <th className="text-right font-semibold px-3 py-2 w-24">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-zinc-400">Keine Sätze erfasst.</td></tr>
            ) : (
              rates.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                  <td className="px-3 py-2">
                    <Chip tone={CODE_TONES[r.code] ?? 'neutral'}>{r.code}</Chip>
                  </td>
                  <td className="px-3 py-2 font-medium flex items-center gap-2">
                    <Percent className="w-3.5 h-3.5 text-zinc-400" />
                    {r.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>{Number(r.rate).toFixed(2)} %</td>
                  <td className="px-3 py-2 text-zinc-700 tabular-nums">{fmt.date(r.valid_from)}</td>
                  <td className="px-3 py-2 text-zinc-500 tabular-nums">{r.valid_to ? fmt.date(r.valid_to) : '—'}</td>
                  <td className="px-3 py-2">{r.active ? <Chip tone="green">aktiv</Chip> : <Chip tone="neutral">inaktiv</Chip>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn onClick={() => open(r)} title="Bearbeiten"><Pencil className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn onClick={() => { if (window.confirm(`Satz "${r.code} ${r.rate}%" löschen?`)) deleteMut.mutate(r.id); }} title="Löschen" danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(30,40,30,0.35)' }} onClick={() => setDialog(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md my-10" style={{ border: '1px solid #e4e7e4' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
              <h3 className="text-base font-semibold">{dialog.editing ? 'Satz bearbeiten' : 'Neuer MWST-Satz'}</h3>
              <button onClick={() => setDialog(null)} className="text-zinc-400 hover:text-zinc-700">×</button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={<>Code <span className="text-red-500">*</span></>} hint="STD, RED, HOTEL, EXP, EXEMPT">
                  <Input value={dialog.form.code} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, code: e.target.value.toUpperCase() } })} placeholder="STD" />
                </Field>
                <Field label={<>Satz % <span className="text-red-500">*</span></>}>
                  <Input type="number" step="0.01" min="0" max="100" value={dialog.form.rate} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, rate: e.target.value } })} placeholder="8.10" />
                </Field>
              </div>
              <Field label={<>Bezeichnung <span className="text-red-500">*</span></>}>
                <Input value={dialog.form.label} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, label: e.target.value } })} placeholder="Normalsatz" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={<>Gültig ab <span className="text-red-500">*</span></>}>
                  <Input type="date" value={dialog.form.valid_from} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, valid_from: e.target.value } })} />
                </Field>
                <Field label="Gültig bis" hint="leer = unbegrenzt">
                  <Input type="date" value={dialog.form.valid_to} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, valid_to: e.target.value } })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sortierung">
                  <Input type="number" step="10" value={dialog.form.sort_order} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, sort_order: e.target.value } })} />
                </Field>
                <Field label="Aktiv">
                  <label className="flex items-center gap-2 mt-1.5">
                    <input type="checkbox" checked={!!dialog.form.active} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, active: e.target.checked } })} />
                    <span className="text-sm">aktiv</span>
                  </label>
                </Field>
              </div>
              <Field label="Notiz">
                <Input value={dialog.form.notes} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, notes: e.target.value } })} placeholder="z.B. Regelsatz CH ab 2024" />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: '#eef0ee' }}>
              <button onClick={() => setDialog(null)} className={artisBtn.ghost} style={artisGhostStyle}>Abbrechen</button>
              <button onClick={save} className={artisBtn.primary} style={artisPrimaryStyle} disabled={createMut.isPending || updateMut.isPending}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
