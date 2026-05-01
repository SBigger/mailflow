import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, Archive, ArchiveRestore } from 'lucide-react';
import { leEmployee, leEmployeeGroup } from '@/lib/leApi';
import {
  Chip,
  Card,
  IconBtn,
  Input,
  Select,
  Field,
  PanelLoader,
  PanelError,
  PanelHeader,
  fmt,
  artisBtn,
  artisPrimaryStyle,
} from '@/components/leistungserfassung/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const EMPTY = {
  short_code: '',
  full_name: '',
  email: '',
  role: '',
  pensum_pct: 100,
  entry_date: '',
  exit_date: '',
  cost_rate: '',
  billable_rate: '',
  employee_group_id: '',
  active: true,
};

const ROLE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'mitarbeiter', label: 'Mitarbeiter' },
  { value: 'praktikant', label: 'Praktikant' },
];

export default function MitarbeiterPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['le', 'employee'],
    queryFn: leEmployee.list,
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['le', 'employee_group'],
    queryFn: leEmployeeGroup.list,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, object = edit
  const [form, setForm] = useState(EMPTY);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({
      short_code: emp.short_code ?? '',
      full_name: emp.full_name ?? '',
      email: emp.email ?? '',
      role: emp.role ?? '',
      pensum_pct: emp.pensum_pct ?? 100,
      entry_date: emp.entry_date ?? '',
      exit_date: emp.exit_date ?? '',
      cost_rate: emp.cost_rate ?? '',
      billable_rate: emp.billable_rate ?? '',
      employee_group_id: emp.employee_group_id ?? '',
      active: emp.active ?? true,
    });
    setDialogOpen(true);
  };

  const createMut = useMutation({
    mutationFn: (payload) => leEmployee.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['le', 'employee'] });
      toast.success('Mitarbeiter angelegt');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leEmployee.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['le', 'employee'] });
      toast.success('Mitarbeiter aktualisiert');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => leEmployee.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['le', 'employee'] });
      toast.success('Mitarbeiter gelöscht');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      short_code: form.short_code.trim(),
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      role: form.role || null,
      pensum_pct: form.pensum_pct === '' ? null : Number(form.pensum_pct),
      entry_date: form.entry_date || null,
      exit_date: form.exit_date || null,
      cost_rate: form.cost_rate === '' ? null : Number(form.cost_rate),
      billable_rate: form.billable_rate === '' ? null : Number(form.billable_rate),
      employee_group_id: form.employee_group_id || null,
      active: !!form.active,
    };
    if (!payload.short_code || !payload.full_name) {
      toast.error('Kürzel und Name sind Pflichtfelder');
      return;
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, patch: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const archiveMut = useMutation({
    mutationFn: (id) => leEmployee.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['le', 'employee'] });
      toast.success('Mitarbeiter archiviert – Rapporte bleiben erhalten');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const unarchiveMut = useMutation({
    mutationFn: (id) => leEmployee.unarchive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['le', 'employee'] });
      toast.success('Mitarbeiter reaktiviert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleArchive = (emp) => {
    const action = emp.archived_at || !emp.active ? 'reaktivieren' : 'archivieren';
    if (!window.confirm(`Mitarbeiter "${emp.full_name}" ${action}?`)) return;
    if (emp.archived_at || !emp.active) unarchiveMut.mutate(emp.id);
    else archiveMut.mutate(emp.id);
  };

  // Echtes Löschen NUR wenn keine Rapporte/Spesen/Abwesenheiten existieren.
  const handleDelete = async (emp) => {
    try {
      const check = await leEmployee.canDelete(emp.id);
      if (!check.can_delete) {
        toast.error(
          `Löschen nicht möglich: ${check.entry_count} Rapport(e), ${check.expense_count} Spesen, ${check.absence_count} Abwesenheit(en) verknüpft. Bitte stattdessen archivieren.`,
          { duration: 6000 }
        );
        return;
      }
      if (!window.confirm(`Mitarbeiter "${emp.full_name}" endgültig löschen? (Es sind keine Rapporte verknüpft.)`)) return;
      deleteMut.mutate(emp.id);
    } catch (e) {
      toast.error('Prüfung fehlgeschlagen: ' + (e?.message ?? e));
    }
  };

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <PanelHeader
        title="Mitarbeiter"
        subtitle="Stammdaten – Kürzel, Pensum, Ein-/Austritt"
        right={
          <button
            type="button"
            onClick={openNew}
            className={artisBtn.primary}
            style={artisPrimaryStyle}
          >
            <Plus className="w-4 h-4" /> Neuer Mitarbeiter
          </button>
        }
      />

      {isLoading ? (
        <PanelLoader />
      ) : error ? (
        <PanelError error={error} onRetry={refetch} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500" style={{ background: '#f6f8f6' }}>
                  <th className="px-3 py-2 font-semibold">Kürzel</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">E-Mail</th>
                  <th className="px-3 py-2 font-semibold">Rolle</th>
                  <th className="px-3 py-2 font-semibold text-right">Pensum %</th>
                  <th className="px-3 py-2 font-semibold">Eintritt</th>
                  <th className="px-3 py-2 font-semibold">Austritt</th>
                  <th className="px-3 py-2 font-semibold text-right">Kostensatz CHF/h</th>
                  <th className="px-3 py-2 font-semibold">Aktiv</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-zinc-400">
                      Noch keine Mitarbeiter erfasst.
                    </td>
                  </tr>
                ) : (
                  (data ?? []).map((emp) => (
                    <tr key={emp.id} className="border-t" style={{ borderColor: '#eef1ee' }}>
                      <td className="px-3 py-2 font-mono text-xs">{emp.short_code}</td>
                      <td className="px-3 py-2">{emp.full_name}</td>
                      <td className="px-3 py-2 text-zinc-600">{emp.email || '—'}</td>
                      <td className="px-3 py-2 text-zinc-600">{emp.role || '—'}</td>
                      <td className="px-3 py-2 text-right">{emp.pensum_pct ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-600">{fmt.date(emp.entry_date)}</td>
                      <td className="px-3 py-2 text-zinc-600">{fmt.date(emp.exit_date)}</td>
                      <td className="px-3 py-2 text-right">{fmt.chf(emp.cost_rate)}</td>
                      <td className="px-3 py-2">
                        {emp.archived_at ? (
                          <Chip tone="neutral">archiviert</Chip>
                        ) : emp.active ? (
                          <Chip tone="green">aktiv</Chip>
                        ) : (
                          <Chip tone="orange">inaktiv</Chip>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <IconBtn title="Bearbeiten" onClick={() => openEdit(emp)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </IconBtn>
                          {emp.archived_at || !emp.active ? (
                            <IconBtn title="Reaktivieren" onClick={() => handleArchive(emp)}>
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            </IconBtn>
                          ) : (
                            <IconBtn title="Archivieren (Rapporte bleiben erhalten)" onClick={() => handleArchive(emp)}>
                              <Archive className="w-3.5 h-3.5" />
                            </IconBtn>
                          )}
                          <IconBtn
                            title="Löschen (nur wenn keine Rapporte verknüpft)"
                            danger
                            onClick={() => handleDelete(emp)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kürzel *">
                <Input
                  value={form.short_code}
                  onChange={(e) => setForm((f) => ({ ...f, short_code: e.target.value }))}
                  placeholder="z.B. SB"
                  maxLength={8}
                  required
                />
              </Field>
              <Field label="Rolle">
                <Select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Name *">
              <Input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Vorname Nachname"
                required
              />
            </Field>
            <Field label="E-Mail">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@firma.ch"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pensum %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={form.pensum_pct}
                  onChange={(e) => setForm((f) => ({ ...f, pensum_pct: e.target.value }))}
                />
              </Field>
              <Field label="Kostensatz CHF/h" hint="Intern · für Rentabilitäts-Auswertungen">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.cost_rate}
                  onChange={(e) => setForm((f) => ({ ...f, cost_rate: e.target.value }))}
                  placeholder="z.B. 85.00"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stundenansatz CHF/h" hint={'Bei Projekten mit Ansatz-Modus „Mitarbeiter"'}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.billable_rate}
                  onChange={(e) => setForm((f) => ({ ...f, billable_rate: e.target.value }))}
                  placeholder="z.B. 220.00"
                />
              </Field>
              <Field label="Mitarbeitergruppe" hint={'Bei Projekten mit Ansatz-Modus „Mitarbeitergruppe"'}>
                <Select
                  value={form.employee_group_id}
                  onChange={(e) => setForm((f) => ({ ...f, employee_group_id: e.target.value }))}
                >
                  <option value="">— keine —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}{g.billable_rate ? ` · ${fmt.chf(g.billable_rate)}/h` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Eintritt">
                <Input
                  type="date"
                  value={form.entry_date}
                  onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
                />
              </Field>
              <Field label="Austritt">
                <Input
                  type="date"
                  value={form.exit_date}
                  onChange={(e) => setForm((f) => ({ ...f, exit_date: e.target.value }))}
                />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm pt-1">
              <input
                type="checkbox"
                checked={!!form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="rounded"
                style={{ accentColor: '#7a9b7f' }}
              />
              <span>Aktiv</span>
            </label>
            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="px-3 py-1.5 rounded text-sm font-medium border"
                style={{ borderColor: '#d1dcd1', color: '#3d4a3d', background: '#fff' }}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className={artisBtn.primary}
                style={{ ...artisPrimaryStyle, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Speichere…' : editing ? 'Speichern' : 'Anlegen'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
