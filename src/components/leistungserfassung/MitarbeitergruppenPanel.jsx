// Stammdaten · Mitarbeitergruppen
// Pflegt die Liste der Gruppen (Junior, Treuhänder, Senior, Partner) mit
// billable_rate + cost_rate. Wird in Projekten mit rate_mode='employee_group' genutzt.
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, Users } from 'lucide-react';
import { leEmployeeGroup } from '@/lib/leApi';
import {
  Card, Chip, IconBtn, Input, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

const EMPTY = {
  name: '', description: '',
  billable_rate: '', cost_rate: '',
  sort_order: 100, active: true,
};

export default function MitarbeitergruppenPanel() {
  const qc = useQueryClient();
  const groupsQ = useQuery({ queryKey: ['le', 'employee_group'], queryFn: leEmployeeGroup.list });

  const [dialog, setDialog] = useState(null); // null | {editing, form}

  const createMut = useMutation({
    mutationFn: (p) => leEmployeeGroup.create(p),
    onSuccess: () => { toast.success('Gruppe angelegt'); qc.invalidateQueries({ queryKey: ['le', 'employee_group'] }); setDialog(null); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leEmployeeGroup.update(id, patch),
    onSuccess: () => { toast.success('Gespeichert'); qc.invalidateQueries({ queryKey: ['le', 'employee_group'] }); setDialog(null); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => leEmployeeGroup.remove(id),
    onSuccess: () => { toast.success('Gruppe gelöscht'); qc.invalidateQueries({ queryKey: ['le', 'employee_group'] }); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  if (groupsQ.isLoading) return <PanelLoader />;
  if (groupsQ.error) return <PanelError error={groupsQ.error} onRetry={groupsQ.refetch} />;

  const groups = groupsQ.data ?? [];

  const open = (g) => setDialog({ editing: g, form: g
    ? { name: g.name, description: g.description ?? '', billable_rate: g.billable_rate ?? '', cost_rate: g.cost_rate ?? '', sort_order: g.sort_order ?? 100, active: g.active ?? true }
    : EMPTY,
  });

  const save = () => {
    const f = dialog.form;
    if (!f.name?.trim()) { toast.error('Name ist Pflicht'); return; }
    const payload = {
      name: f.name.trim(),
      description: f.description?.trim() || null,
      billable_rate: f.billable_rate === '' ? null : Number(f.billable_rate),
      cost_rate: f.cost_rate === '' ? null : Number(f.cost_rate),
      sort_order: f.sort_order === '' ? 100 : Number(f.sort_order),
      active: !!f.active,
    };
    if (dialog.editing) updateMut.mutate({ id: dialog.editing.id, patch: payload });
    else createMut.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Mitarbeitergruppen"
        subtitle={'Stundenansätze pro Qualifikation – wird bei Projekten mit Ansatz-Modus „Mitarbeitergruppe" genutzt'}
        right={
          <button onClick={() => open(null)} className={artisBtn.primary} style={artisPrimaryStyle}>
            <Plus className="w-4 h-4" /> Neue Gruppe
          </button>
        }
      />

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
              <th className="text-left font-semibold px-3 py-2">Name</th>
              <th className="text-left font-semibold px-3 py-2">Beschreibung</th>
              <th className="text-right font-semibold px-3 py-2 w-32">Ansatz CHF/h</th>
              <th className="text-right font-semibold px-3 py-2 w-32">Kostensatz CHF/h</th>
              <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
              <th className="text-right font-semibold px-3 py-2 w-24">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-400">Keine Gruppen erfasst.</td></tr>
            ) : (
              groups.map((g) => (
                <tr key={g.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                  <td className="px-3 py-2 font-medium flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-zinc-400" />
                    {g.name}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{g.description || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: '#2d5a2d' }}>{fmt.chf(g.billable_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(g.cost_rate)}</td>
                  <td className="px-3 py-2">{g.active ? <Chip tone="green">aktiv</Chip> : <Chip tone="neutral">inaktiv</Chip>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn onClick={() => open(g)} title="Bearbeiten"><Pencil className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn onClick={() => { if (window.confirm(`Gruppe "${g.name}" löschen?`)) deleteMut.mutate(g.id); }} title="Löschen" danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
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
              <h3 className="text-base font-semibold">{dialog.editing ? 'Gruppe bearbeiten' : 'Neue Gruppe'}</h3>
              <button onClick={() => setDialog(null)} className="text-zinc-400 hover:text-zinc-700">×</button>
            </div>
            <div className="p-5 space-y-3">
              <Field label={<>Name <span className="text-red-500">*</span></>}>
                <Input value={dialog.form.name} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, name: e.target.value } })} placeholder="z.B. Treuhänder" />
              </Field>
              <Field label="Beschreibung">
                <Input value={dialog.form.description} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, description: e.target.value } })} placeholder="z.B. Treuhänder mit Berufserfahrung" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ansatz CHF/h">
                  <Input type="number" step="1" min="0" value={dialog.form.billable_rate} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, billable_rate: e.target.value } })} placeholder="220" />
                </Field>
                <Field label="Kostensatz CHF/h" hint="Intern – für Rentabilität">
                  <Input type="number" step="1" min="0" value={dialog.form.cost_rate} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, cost_rate: e.target.value } })} placeholder="100" />
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
