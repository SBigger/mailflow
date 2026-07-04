// Leistungserfassung · Sollzeiten (Stammdaten)
// Zweistufiger Plan:
//   Zentral    = firmenweiter Plan (Wochenstunden), versioniert
//   Feiertage  = Datums-Overrides, übersteuern IMMER auf 0h
//   Mitarbeiter = Override auf den Zentral-Plan: Pensum skaliert alle nicht
//                 explizit gesetzten Wochentage, einzelne Tage lassen sich
//                 zusätzlich fix übersteuern (z.B. "arbeitet freitags nicht").
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, CalendarClock, CalendarDays, Building2, Users as UsersIcon } from 'lucide-react';
import { leEmployee, leSollzeitProfile, leSollzeitTemplate, leHoliday } from '@/lib/leApi';
import { pickProfile } from '@/components/auswertungen/util';
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
  Select,
  PanelLoader,
  PanelError,
  PanelHeader,
  fmt,
  artisBtn,
  artisPrimaryStyle,
  artisGhostStyle,
} from './shared';

const ARTIS_GREEN = '#7a9b7f';
const DAYS = [
  { key: 'mo', label: 'Mo' },
  { key: 'di', label: 'Di' },
  { key: 'mi', label: 'Mi' },
  { key: 'do', label: 'Do' },
  { key: 'fr', label: 'Fr' },
  { key: 'sa', label: 'Sa' },
  { key: 'so', label: 'So' },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

// ===========================================================================
// Section-Tabs (lokal, nicht die LE-Haupt-Navigation)
// ===========================================================================

const SECTIONS = [
  { id: 'zentral', label: 'Zentral', icon: Building2 },
  { id: 'feiertage', label: 'Feiertage', icon: CalendarDays },
  { id: 'mitarbeiter', label: 'Mitarbeiter', icon: UsersIcon },
];

function SectionTabs({ section, setSection }) {
  return (
    <div className="flex gap-1 mb-4 border-b" style={{ borderColor: '#e4e7e4' }}>
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        const active = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
            style={{
              borderColor: active ? ARTIS_GREEN : 'transparent',
              color: active ? '#2d3a2d' : '#6b6b6b',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Zentral-Tab: firmenweiter Sollzeit-Plan
// ===========================================================================

const defaultTemplate = () => ({
  valid_from: todayIso(),
  valid_to: null,
  hours_mo: 8.2, hours_di: 8.2, hours_mi: 8.2, hours_do: 8.2, hours_fr: 8.2,
  hours_sa: 0, hours_so: 0,
  vacation_days: 25,
});

function ZentralSection() {
  const qc = useQueryClient();
  const templatesQ = useQuery({ queryKey: ['le', 'sollzeit-template'], queryFn: leSollzeitTemplate.list });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultTemplate);

  const createMut = useMutation({
    mutationFn: (payload) => leSollzeitTemplate.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'sollzeit-template'] });
      toast.success('Zentral-Plan angelegt');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const removeMut = useMutation({
    mutationFn: (id) => leSollzeitTemplate.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'sollzeit-template'] });
      toast.success('Zentral-Plan gelöscht');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const openNew = () => { setForm(defaultTemplate()); setDialogOpen(true); };

  const setDay = (k, v) => setForm((f) => ({ ...f, [`hours_${k}`]: v }));
  const weeklySum = useMemo(
    () => DAYS.reduce((s, d) => s + Number(form[`hours_${d.key}`] || 0), 0),
    [form]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.valid_from) return toast.error('Gültig-ab Datum nötig');
    const payload = {
      ...form,
      valid_to: form.valid_to || null,
      vacation_days: Number(form.vacation_days),
      ...Object.fromEntries(DAYS.map((d) => [`hours_${d.key}`, Number(form[`hours_${d.key}`] || 0)])),
    };
    createMut.mutate(payload);
  };

  const handleDelete = (t) => {
    if (!window.confirm(`Zentral-Plan ab ${fmt.date(t.valid_from)} wirklich löschen?`)) return;
    removeMut.mutate(t.id);
  };

  if (templatesQ.isLoading) return <PanelLoader />;
  if (templatesQ.error) return <PanelError error={templatesQ.error} onRetry={templatesQ.refetch} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-zinc-500 max-w-xl">
          Der Zentral-Plan gilt firmenweit als Basis. Mitarbeiter erben diese Wochenstunden,
          sofern sie im Tab „Mitarbeiter" nichts Abweichendes hinterlegt haben.
        </p>
        <button type="button" onClick={openNew} className={artisBtn.primary} style={artisPrimaryStyle}>
          <Plus className="w-4 h-4" /> Neuer Plan
        </button>
      </div>

      {(templatesQ.data ?? []).length === 0 ? (
        <Card className="p-5 text-sm text-zinc-400 text-center">
          Noch kein Zentral-Plan. Lege einen ersten Plan an – ohne ihn ist das Soll überall 0.
        </Card>
      ) : (
        <div className="space-y-3">
          {templatesQ.data.map((t) => {
            const isCurrent = !t.valid_to || t.valid_to >= todayIso();
            const sum = DAYS.reduce((s, d) => s + Number(t[`hours_${d.key}`] || 0), 0);
            return (
              <Card key={t.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CalendarClock className="w-4 h-4 text-zinc-500" />
                    <Chip tone={isCurrent ? 'green' : 'neutral'}>
                      {fmt.date(t.valid_from)} – {t.valid_to ? fmt.date(t.valid_to) : 'offen'}
                    </Chip>
                    <Chip tone="blue">{sum.toFixed(2)} h/Woche</Chip>
                    <Chip tone="violet">{t.vacation_days} Ferientage</Chip>
                  </div>
                  <IconBtn title="Löschen" danger onClick={() => handleDelete(t)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconBtn>
                </div>
                <div className="mt-3 grid grid-cols-7 gap-1.5 text-center">
                  {DAYS.map((d) => (
                    <div key={d.key} className="rounded border px-1 py-1.5" style={{ borderColor: '#e4e7e4', background: '#fafbfa' }}>
                      <div className="text-[10px] uppercase text-zinc-500">{d.label}</div>
                      <div className="text-sm font-mono">{fmt.hours(t[`hours_${d.key}`])}</div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Neuer Zentral-Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gültig ab *">
                <Input
                  type="date" required
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
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
            <Field label="Ferientage / Jahr (Standard)">
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

// ===========================================================================
// Feiertage-Tab: firmenweite Datums-Overrides (immer 0h)
// ===========================================================================

function FeiertageSection() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const holidaysQ = useQuery({
    queryKey: ['le', 'holiday', year],
    queryFn: () => leHoliday.list({ from: `${year}-01-01`, to: `${year}-12-31` }),
  });

  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  const createMut = useMutation({
    mutationFn: (payload) => leHoliday.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'holiday'] });
      toast.success('Feiertag hinzugefügt');
      setNewDate(''); setNewName('');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const removeMut = useMutation({
    mutationFn: (id) => leHoliday.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'holiday'] });
      toast.success('Feiertag entfernt');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newDate) return toast.error('Datum wählen');
    if (!newName.trim()) return toast.error('Name eingeben');
    const exists = (holidaysQ.data ?? []).some((h) => h.date === newDate);
    if (exists) return toast.error('Für dieses Datum existiert bereits ein Feiertag');
    createMut.mutate({ date: newDate, name: newName.trim() });
  };

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => cur - 1 + i);
  }, []);

  return (
    <div>
      <p className="text-xs text-zinc-500 max-w-xl mb-3">
        Feiertage übersteuern für alle Mitarbeiter das Soll auf 0h – unabhängig von Pensum
        oder individuellen Wochentag-Overrides.
      </p>

      <Card className="p-3 mb-4">
        <form onSubmit={handleAdd} className="flex items-end gap-2 flex-wrap">
          <div className="w-40">
            <Field label="Datum">
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Field label="Bezeichnung">
              <Input placeholder="z.B. Nationalfeiertag" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          </div>
          <button
            type="submit"
            disabled={createMut.isPending}
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: createMut.isPending ? 0.6 : 1 }}
          >
            <Plus className="w-4 h-4" /> Hinzufügen
          </button>
        </form>
      </Card>

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Feiertage {year}
        </div>
        <div className="w-28">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      </div>

      {holidaysQ.isLoading ? (
        <PanelLoader />
      ) : holidaysQ.error ? (
        <PanelError error={holidaysQ.error} onRetry={holidaysQ.refetch} />
      ) : (
        <Card>
          {(holidaysQ.data ?? []).length === 0 ? (
            <div className="p-5 text-sm text-zinc-400 text-center">Keine Feiertage für {year} erfasst.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {holidaysQ.data.map((h) => (
                  <tr key={h.id} className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
                    <td className="px-3 py-2 w-32 tabular-nums text-zinc-600">{fmt.date(h.date)}</td>
                    <td className="px-3 py-2">{h.name}</td>
                    <td className="px-3 py-2 w-10 text-right">
                      <IconBtn title="Löschen" danger onClick={() => removeMut.mutate(h.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

// ===========================================================================
// Mitarbeiter-Tab: Override auf den Zentral-Plan
// ===========================================================================

const defaultProfile = (employeeId) => ({
  employee_id: employeeId,
  pensum_pct: 100,
  valid_from: todayIso(),
  valid_to: null,
  overrideDay: Object.fromEntries(DAYS.map((d) => [d.key, false])),
  hours: Object.fromEntries(DAYS.map((d) => [d.key, 8.2])),
  overrideVacation: false,
  vacation_days: 25,
});

function MitarbeiterSection() {
  const qc = useQueryClient();
  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: leEmployee.list });
  const templatesQ = useQuery({ queryKey: ['le', 'sollzeit-template'], queryFn: leSollzeitTemplate.list });
  const [selectedEmpId, setSelectedEmpId] = useState(null);

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

  const openNew = () => { setForm(defaultProfile(selectedEmpId)); setDialogOpen(true); };

  const createMut = useMutation({
    mutationFn: (payload) => leSollzeitProfile.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'sollzeit', selectedEmpId] });
      toast.success('Mitarbeiter-Profil angelegt');
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
      employee_id: form.employee_id,
      valid_from: form.valid_from,
      valid_to: form.valid_to || null,
      pensum_pct: Number(form.pensum_pct),
      vacation_days: form.overrideVacation ? Number(form.vacation_days) : null,
      ...Object.fromEntries(DAYS.map((d) => [
        `hours_${d.key}`,
        form.overrideDay[d.key] ? Number(form.hours[d.key] || 0) : null,
      ])),
    };
    createMut.mutate(payload);
  };

  const handleDelete = (p) => {
    if (!window.confirm(`Profil ab ${fmt.date(p.valid_from)} wirklich löschen?`)) return;
    removeMut.mutate(p.id);
  };

  const toggleDay = (k) => setForm((f) => ({ ...f, overrideDay: { ...f.overrideDay, [k]: !f.overrideDay[k] } }));
  const setDayHour = (k, v) => setForm((f) => ({ ...f, hours: { ...f.hours, [k]: v } }));

  const selectedEmp = employeesQ.data?.find((e) => e.id === selectedEmpId);

  // Aktueller Zentral-Plan (für die "erbt X"-Vorschau in der Profil-Liste)
  const currentTemplate = useMemo(
    () => pickProfile(templatesQ.data ?? [], todayIso()),
    [templatesQ.data]
  );

  if (employeesQ.isLoading) return <PanelLoader />;
  if (employeesQ.error) return <PanelError error={employeesQ.error} onRetry={employeesQ.refetch} />;

  return (
    <div>
      {!templatesQ.isLoading && !currentTemplate && (
        <div className="mb-3 text-xs rounded border px-3 py-2" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
          Noch kein aktueller Zentral-Plan hinterlegt – lege im Tab „Zentral" zuerst einen Plan an, sonst wird überall 0h vererbt.
        </div>
      )}
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
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-500">
                  Overrides von <span className="font-semibold text-zinc-700">{selectedEmp?.full_name}</span> auf den Zentral-Plan
                </div>
                <button type="button" onClick={openNew} className={artisBtn.primary} style={artisPrimaryStyle}>
                  <Plus className="w-4 h-4" /> Neues Override
                </button>
              </div>
              {(profilesQ.data ?? []).length === 0 ? (
                <Card className="p-5 text-sm text-zinc-400 text-center">
                  Kein Override hinterlegt – {selectedEmp?.full_name} arbeitet 100% nach dem Zentral-Plan.
                </Card>
              ) : (
                <div className="space-y-3">
                  {profilesQ.data.map((p) => {
                    const isCurrent = !p.valid_to || p.valid_to >= todayIso();
                    return (
                      <Card key={p.id} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CalendarClock className="w-4 h-4 text-zinc-500" />
                            <span className="text-sm font-medium">{p.pensum_pct}% Pensum</span>
                            <Chip tone={isCurrent ? 'green' : 'neutral'}>
                              {fmt.date(p.valid_from)} – {p.valid_to ? fmt.date(p.valid_to) : 'offen'}
                            </Chip>
                            <Chip tone="violet">
                              {p.vacation_days != null ? `${p.vacation_days} Ferientage` : `erbt ${currentTemplate?.vacation_days ?? '—'} Ferientage`}
                            </Chip>
                          </div>
                          <IconBtn title="Löschen" danger onClick={() => handleDelete(p)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-1.5 text-center">
                          {DAYS.map((d) => {
                            const raw = p[`hours_${d.key}`];
                            const overridden = raw != null;
                            const inherited = currentTemplate
                              ? Number(currentTemplate[`hours_${d.key}`] || 0) * Number(p.pensum_pct ?? 100) / 100
                              : null;
                            return (
                              <div
                                key={d.key}
                                className="rounded border px-1 py-1.5"
                                style={{
                                  borderColor: overridden ? '#f3d9a4' : '#e4e7e4',
                                  background: overridden ? '#fff8ec' : '#fafbfa',
                                }}
                                title={overridden ? 'Fixer Override' : 'Geerbt vom Zentral-Plan × Pensum'}
                              >
                                <div className="text-[10px] uppercase text-zinc-500">{d.label}</div>
                                <div className="text-sm font-mono" style={{ color: overridden ? '#8a5a00' : '#8a9a8c', fontWeight: overridden ? 600 : 400 }}>
                                  {overridden ? fmt.hours(raw) : (inherited != null ? fmt.hours(inherited) : '—')}
                                </div>
                              </div>
                            );
                          })}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Neues Override · {selectedEmp?.full_name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pensum %" hint="skaliert nicht-übersteuerte Tage">
                <Input
                  type="number" min={0} max={100} step={5}
                  value={form.pensum_pct}
                  onChange={(e) => setForm((f) => ({ ...f, pensum_pct: e.target.value }))}
                />
              </Field>
              <Field label="Gültig ab *">
                <Input
                  type="date" required
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
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
                Wochentag-Overrides <span className="normal-case font-normal text-zinc-400">– Häkchen an = fixer Wert, sonst geerbt (Zentral × Pensum)</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d) => {
                  const on = form.overrideDay[d.key];
                  const templateVal = currentTemplate ? Number(currentTemplate[`hours_${d.key}`] || 0) * Number(form.pensum_pct || 0) / 100 : null;
                  return (
                    <div key={d.key} className="block">
                      <label className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 mb-0.5 cursor-pointer">
                        <input type="checkbox" checked={on} onChange={() => toggleDay(d.key)} style={{ accentColor: ARTIS_GREEN }} />
                        {d.label}
                      </label>
                      <Input
                        type="number" min={0} step="0.1"
                        disabled={!on}
                        value={on ? form.hours[d.key] : (templateVal != null ? templateVal.toFixed(2) : '')}
                        onChange={(e) => setDayHour(d.key, e.target.value)}
                        className="text-center"
                        style={!on ? { color: '#a0aca0', background: '#f7f9f7' } : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none mb-1">
                <input
                  type="checkbox"
                  checked={form.overrideVacation}
                  onChange={(e) => setForm((f) => ({ ...f, overrideVacation: e.target.checked }))}
                  style={{ accentColor: ARTIS_GREEN }}
                />
                Eigene Ferientage (sonst geerbt: {currentTemplate?.vacation_days ?? '—'})
              </label>
              {form.overrideVacation && (
                <Input
                  type="number" min={0} step={1}
                  value={form.vacation_days}
                  onChange={(e) => setForm((f) => ({ ...f, vacation_days: e.target.value }))}
                />
              )}
            </div>
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

// ===========================================================================
// Panel
// ===========================================================================

export default function SollzeitenPanel() {
  const [section, setSection] = useState('zentral');

  return (
    <div>
      <PanelHeader
        title="Sollzeiten"
        subtitle="Zentraler Plan, Feiertage und Mitarbeiter-Overrides – Pensum, Wochenstunden, Ferien."
      />
      <SectionTabs section={section} setSection={setSection} />
      {section === 'zentral' && <ZentralSection />}
      {section === 'feiertage' && <FeiertageSection />}
      {section === 'mitarbeiter' && <MitarbeiterSection />}
    </div>
  );
}
