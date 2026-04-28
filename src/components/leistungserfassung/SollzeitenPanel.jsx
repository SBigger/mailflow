import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, CalendarClock } from 'lucide-react';
import { leEmployee, leSollzeitProfile } from '@/lib/leApi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Card,
  Chip,
  IconBtn,
  Input,
  Field,
  PanelLoader,
  PanelError,
  PanelHeader,
  fmt,
  artisBtn,
  artisPrimaryStyle,
  artisGhostStyle,
} from './shared';

const DAYS = [
  { key: 'mon', label: 'Mo' },
  { key: 'tue', label: 'Di' },
  { key: 'wed', label: 'Mi' },
  { key: 'thu', label: 'Do' },
  { key: 'fri', label: 'Fr' },
  { key: 'sat', label: 'Sa' },
  { key: 'sun', label: 'So' },
];

const defaultProfile = (employeeId) => ({
  employee_id: employeeId,
  pensum_pct: 100,
  valid_from: new Date().toISOString().slice(0, 10),
  valid_to: null,
  hours_mon: 8.4,
  hours_tue: 8.4,
  hours_wed: 8.4,
  hours_thu: 8.4,
  hours_fri: 8.4,
  hours_sat: 0,
  hours_sun: 0,
  vacation_days: 25,
});

export default function SollzeitenPanel() {
  const qc = useQueryClient();
  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: leEmployee.list });
  const [selectedEmpId, setSelectedEmpId] = useState(null);

  // Auto-select erste(n) MA
  useEffect(() => {
    if (!selectedEmpId && employeesQ.data?.length) {
      setSelectedEmpId(employeesQ.data[0].id);
    }
  }, [employeesQ.data, selectedEmpId]);

  const profilesQ = useQuery({
    queryKey: ['le', 'sollzeit', selectedEmpId],
    queryFn: () => leSollzeitProfile.listForEmployee(selectedEmpId),
    enabled: !!selectedEmpId,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultProfile(null));

  const openNew = () => {
    setForm(defaultProfile(selectedEmpId));
    setDialogOpen(true);
  };

  const createMut = useMutation({
    mutationFn: (payload) => leSollzeitProfile.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'sollzeit', selectedEmpId] });
      toast.success('Sollzeit-Profil angelegt');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leSollzeitProfile.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'sollzeit', selectedEmpId] });
      toast.success('Profil gelöscht');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.employee_id) return toast.error('Mitarbeiter wählen');
    if (!form.valid_from) return toast.error('Gültig-ab Datum nötig');
    const payload = {
      ...form,
      pensum_pct: Number(form.pensum_pct),
      vacation_days: Number(form.vacation_days),
      hours_mon: Number(form.hours_mon),
      hours_tue: Number(form.hours_tue),
      hours_wed: Number(form.hours_wed),
      hours_thu: Number(form.hours_thu),
      hours_fri: Number(form.hours_fri),
      hours_sat: Number(form.hours_sat),
      hours_sun: Number(form.hours_sun),
      valid_to: form.valid_to || null,
    };
    createMut.mutate(payload);
  };

  const handleDelete = (p) => {
    if (!window.confirm(`Profil ab ${fmt.date(p.valid_from)} wirklich löschen?`)) return;
    removeMut.mutate(p.id);
  };

  const setDay = (k, v) => setForm((f) => ({ ...f, [`hours_${k}`]: v }));
  const weeklySum = useMemo(
    () => DAYS.reduce((s, d) => s + Number(form[`hours_${d.key}`] || 0), 0),
    [form]
  );

  const selectedEmp = employeesQ.data?.find((e) => e.id === selectedEmpId);

  return (
    <div>
      <PanelHeader
        title="Sollzeiten"
        subtitle="Pensum, Wochenstunden, Ferien – versioniert pro Mitarbeiter"
        right={
          selectedEmpId && (
            <button type="button" onClick={openNew} className={artisBtn.primary} style={artisPrimaryStyle}>
              <Plus className="w-4 h-4" /> Neues Profil
            </button>
          )
        }
      />

      {employeesQ.isLoading ? (
        <PanelLoader />
      ) : employeesQ.error ? (
        <PanelError error={employeesQ.error} onRetry={employeesQ.refetch} />
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 md:col-span-4 overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500" style={{ background: '#f6f8f6' }}>
              Mitarbeiter ({employeesQ.data?.length ?? 0})
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {(employeesQ.data ?? []).map((emp) => {
                const isSel = emp.id === selectedEmpId;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setSelectedEmpId(emp.id)}
                    className="w-full text-left px-3 py-2 border-t flex items-center justify-between"
                    style={{
                      borderColor: '#eef1ee',
                      background: isSel ? '#e6ede6' : '#fff',
                      color: isSel ? '#2d5a2d' : 'inherit',
                    }}
                  >
                    <div>
                      <div className="text-sm font-medium">{emp.full_name}</div>
                      <div className="text-[11px] text-zinc-500 font-mono">{emp.short_code}</div>
                    </div>
                    {!emp.active && <Chip tone="neutral">inaktiv</Chip>}
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="col-span-12 md:col-span-8">
            {!selectedEmpId ? (
              <div className="text-sm text-zinc-400 text-center py-12">Mitarbeiter auswählen</div>
            ) : profilesQ.isLoading ? (
              <PanelLoader />
            ) : profilesQ.error ? (
              <PanelError error={profilesQ.error} onRetry={profilesQ.refetch} />
            ) : (
              <div>
                <div className="text-xs text-zinc-500 mb-2">
                  Profile von <span className="font-semibold text-zinc-700">{selectedEmp?.full_name}</span>
                </div>
                {(profilesQ.data ?? []).length === 0 ? (
                  <Card className="p-5 text-sm text-zinc-400 text-center">
                    Noch keine Sollzeit-Profile. Lege ein erstes Profil an.
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {profilesQ.data.map((p) => {
                      const isCurrent = !p.valid_to || p.valid_to >= new Date().toISOString().slice(0, 10);
                      const sum =
                        Number(p.hours_mon || 0) + Number(p.hours_tue || 0) + Number(p.hours_wed || 0) +
                        Number(p.hours_thu || 0) + Number(p.hours_fri || 0) + Number(p.hours_sat || 0) +
                        Number(p.hours_sun || 0);
                      return (
                        <Card key={p.id} className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CalendarClock className="w-4 h-4 text-zinc-500" />
                              <span className="text-sm font-medium">{p.pensum_pct}% Pensum</span>
                              <Chip tone={isCurrent ? 'green' : 'neutral'}>
                                {fmt.date(p.valid_from)} – {p.valid_to ? fmt.date(p.valid_to) : 'offen'}
                              </Chip>
                              <Chip tone="blue">{sum.toFixed(2).replace('.', '.')} h/Woche</Chip>
                              <Chip tone="violet">{p.vacation_days} Ferientage</Chip>
                            </div>
                            <IconBtn title="Löschen" danger onClick={() => handleDelete(p)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </IconBtn>
                          </div>
                          <div className="mt-3 grid grid-cols-7 gap-1.5 text-center">
                            {DAYS.map((d) => (
                              <div key={d.key} className="rounded border px-1 py-1.5" style={{ borderColor: '#e4e7e4', background: '#fafbfa' }}>
                                <div className="text-[10px] uppercase text-zinc-500">{d.label}</div>
                                <div className="text-sm font-mono">{fmt.hours(p[`hours_${d.key}`])}</div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Neues Sollzeit-Profil</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pensum %">
                <Input
                  type="number" min={0} max={100} step={5}
                  value={form.pensum_pct}
                  onChange={(e) => setForm((f) => ({ ...f, pensum_pct: e.target.value }))}
                />
              </Field>
              <Field label="Gültig ab *">
                <Input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Gültig bis" hint="leer = offen">
                <Input
                  type="date"
                  value={form.valid_to || ''}
                  onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))}
                />
              </Field>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                Wochenstunden (Summe: {weeklySum.toFixed(2)} h)
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d) => (
                  <label key={d.key} className="block">
                    <div className="text-[10px] text-center text-zinc-500">{d.label}</div>
                    <Input
                      type="number" min={0} step="0.1"
                      value={form[`hours_${d.key}`]}
                      onChange={(e) => setDay(d.key, e.target.value)}
                      className="text-center"
                    />
                  </label>
                ))}
              </div>
            </div>
            <Field label="Ferientage / Jahr">
              <Input
                type="number" min={0} step={1}
                value={form.vacation_days}
                onChange={(e) => setForm((f) => ({ ...f, vacation_days: e.target.value }))}
              />
            </Field>
            <DialogFooter className="pt-2">
              <button type="button" onClick={() => setDialogOpen(false)} className={artisBtn.ghost} style={artisGhostStyle}>
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={createMut.isPending}
                className={artisBtn.primary}
                style={{ ...artisPrimaryStyle, opacity: createMut.isPending ? 0.6 : 1 }}
              >
                {createMut.isPending ? 'Speichere…' : 'Anlegen'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
