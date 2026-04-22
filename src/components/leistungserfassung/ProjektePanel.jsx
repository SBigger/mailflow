import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Archive, RotateCcw, Plus, X, Search } from 'lucide-react';
import { leProject, leEmployee, leRateGroup, customersForProjects } from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from '@/components/leistungserfassung/shared';

const EMPTY_PROJECT = {
  project_no: '',
  name: '',
  customer_id: '',
  responsible_employee_id: '',
  rate_group_id: '',
  billing_mode: 'effektiv',
  pauschal_amount: '',
  pauschal_cycle: 'monatlich',
  budget_hours: '',
  budget_amount: '',
  started_at: '',
  note: '',
};

function suggestProjectNo(projects) {
  const year = new Date().getFullYear();
  const prefix = `P-${year}-`;
  let maxN = 0;
  for (const p of projects ?? []) {
    const m = String(p.project_no ?? '').match(/^P-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === year) {
      const n = Number(m[2]);
      if (n > maxN) maxN = n;
    }
  }
  return `${prefix}${String(maxN + 1).padStart(3, '0')}`;
}

export default function ProjektePanel() {
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState('offen');
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create, object = edit

  const projectsQ = useQuery({
    queryKey: ['le', 'project', statusTab],
    queryFn: () => leProject.list({ status: statusTab }),
  });
  const customersQ = useQuery({
    queryKey: ['le', 'customers'],
    queryFn: customersForProjects,
  });
  const employeesQ = useQuery({
    queryKey: ['le', 'employee'],
    queryFn: leEmployee.list,
  });
  const rateGroupsQ = useQuery({
    queryKey: ['le', 'rate_group'],
    queryFn: leRateGroup.list,
  });

  const allOffenQ = useQuery({
    queryKey: ['le', 'project', 'offen'],
    queryFn: () => leProject.list({ status: 'offen' }),
    enabled: statusTab !== 'offen',
  });
  const projectsForNumbering = statusTab === 'offen' ? (projectsQ.data ?? []) : (allOffenQ.data ?? projectsQ.data ?? []);

  const createM = useMutation({
    mutationFn: (payload) => leProject.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'project'] });
      toast.success('Projekt angelegt');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }) => leProject.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'project'] });
      toast.success('Projekt gespeichert');
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const archiveM = useMutation({
    mutationFn: (id) => leProject.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'project'] });
      toast.success('Projekt archiviert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const reopenM = useMutation({
    mutationFn: (id) => leProject.reopen(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'project'] });
      toast.success('Projekt wieder aktiv');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const filteredProjects = useMemo(() => {
    const list = projectsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((p) => {
      if (customerFilter && String(p.customer_id ?? '') !== customerFilter) return false;
      if (!q) return true;
      const hay = `${p.name ?? ''} ${p.project_no ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [projectsQ.data, search, customerFilter]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (project) => {
    setEditing(project);
    setDialogOpen(true);
  };

  if (projectsQ.isLoading) return <PanelLoader />;
  if (projectsQ.error) return <PanelError error={projectsQ.error} onRetry={() => projectsQ.refetch()} />;

  return (
    <div>
      <PanelHeader
        title="Projekte"
        subtitle={'Projektname-Konvention: "Kundenname, BWL"'}
        right={
          <>
            <div className="inline-flex rounded border overflow-hidden" style={{ borderColor: '#d1dcd1' }}>
              {[
                { k: 'offen', lbl: 'Offen' },
                { k: 'archiviert', lbl: 'Archiviert' },
              ].map((t) => (
                <button
                  key={t.k}
                  onClick={() => setStatusTab(t.k)}
                  className="px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    background: statusTab === t.k ? '#7a9b7f' : '#fff',
                    color: statusTab === t.k ? '#fff' : '#3d4a3d',
                  }}
                >
                  {t.lbl}
                </button>
              ))}
            </div>
            <button className={artisBtn.primary} style={artisPrimaryStyle} onClick={openCreate}>
              <Plus className="w-4 h-4" /> Neues Projekt
            </button>
          </>
        }
      />

      {/* Filter-Zeile */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <Input
            className="pl-7"
            placeholder="Suche (Name oder Projekt-Nr.)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="min-w-[220px]">
          <Select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">Alle Kunden</option>
            {(customersQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </Select>
        </div>
        {(search || customerFilter) && (
          <button
            className="text-xs text-zinc-500 underline"
            onClick={() => { setSearch(''); setCustomerFilter(''); }}
          >
            Filter zurücksetzen
          </button>
        )}
        <div className="ml-auto text-xs text-zinc-500">
          {filteredProjects.length} Projekt{filteredProjects.length === 1 ? '' : 'e'}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <th className="px-3 py-2 font-semibold">Projekt-Nr.</th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Kunde</th>
                <th className="px-3 py-2 font-semibold">Verantw.</th>
                <th className="px-3 py-2 font-semibold">Gruppenansatz</th>
                <th className="px-3 py-2 font-semibold">Modus</th>
                <th className="px-3 py-2 font-semibold text-right">Budget Std.</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-zinc-400 text-xs">
                    Keine Projekte in dieser Ansicht.
                  </td>
                </tr>
              )}
              {filteredProjects.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-zinc-50/60" style={{ borderColor: '#eef0ee' }}>
                  <td className="px-3 py-2 font-mono text-xs">{p.project_no ?? '—'}</td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 text-zinc-700">{p.customer?.company_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.responsible?.short_code ? (
                      <Chip tone="neutral">{p.responsible.short_code}</Chip>
                    ) : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{p.rate_group?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.billing_mode === 'pauschal' ? (
                      <Chip tone="blue">
                        Pauschal{p.pauschal_amount ? ` · CHF ${fmt.chf(p.pauschal_amount)}` : ''}
                      </Chip>
                    ) : (
                      <Chip tone="green">Effektiv</Chip>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(p.budget_hours)}</td>
                  <td className="px-3 py-2">
                    {p.status === 'offen'
                      ? <Chip tone="green">Offen</Chip>
                      : <Chip tone="neutral">Archiviert</Chip>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="Bearbeiten" onClick={() => openEdit(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </IconBtn>
                      {p.status === 'offen' ? (
                        <IconBtn
                          title="Archivieren"
                          onClick={() => {
                            if (confirm(`Projekt "${p.name}" archivieren?`)) archiveM.mutate(p.id);
                          }}
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </IconBtn>
                      ) : (
                        <IconBtn
                          title="Wieder öffnen"
                          onClick={() => reopenM.mutate(p.id)}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </IconBtn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {dialogOpen && (
        <ProjektDialog
          editing={editing}
          customers={customersQ.data ?? []}
          employees={employeesQ.data ?? []}
          rateGroups={rateGroupsQ.data ?? []}
          projectNoSuggestion={suggestProjectNo(projectsForNumbering)}
          onClose={() => setDialogOpen(false)}
          onSave={(payload) => {
            if (editing) updateM.mutate({ id: editing.id, patch: payload });
            else createM.mutate(payload);
          }}
          saving={createM.isPending || updateM.isPending}
        />
      )}
    </div>
  );
}

function ProjektDialog({ editing, customers, employees, rateGroups, projectNoSuggestion, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => {
    if (editing) {
      return {
        project_no: editing.project_no ?? '',
        name: editing.name ?? '',
        customer_id: editing.customer_id ?? '',
        responsible_employee_id: editing.responsible_employee_id ?? '',
        rate_group_id: editing.rate_group_id ?? '',
        billing_mode: editing.billing_mode ?? 'effektiv',
        pauschal_amount: editing.pauschal_amount ?? '',
        pauschal_cycle: editing.pauschal_cycle ?? 'monatlich',
        budget_hours: editing.budget_hours ?? '',
        budget_amount: editing.budget_amount ?? '',
        started_at: editing.started_at ?? '',
        note: editing.note ?? '',
      };
    }
    return { ...EMPTY_PROJECT, project_no: projectNoSuggestion };
  });

  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onCustomerChange = (newId) => {
    setForm((f) => {
      const next = { ...f, customer_id: newId };
      if (!f.name?.trim() && newId) {
        const c = customers.find((x) => String(x.id) === String(newId));
        if (c) next.name = `${c.company_name}, BWL`;
      }
      return next;
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.project_no?.trim()) { toast.error('Projekt-Nr. ist Pflicht'); return; }
    if (!form.name?.trim()) { toast.error('Name ist Pflicht'); return; }

    const payload = {
      project_no: form.project_no.trim(),
      name: form.name.trim(),
      customer_id: form.customer_id || null,
      responsible_employee_id: form.responsible_employee_id || null,
      rate_group_id: form.rate_group_id || null,
      billing_mode: form.billing_mode,
      pauschal_amount: form.billing_mode === 'pauschal' && form.pauschal_amount !== ''
        ? Number(form.pauschal_amount) : null,
      pauschal_cycle: form.billing_mode === 'pauschal' ? (form.pauschal_cycle || null) : null,
      budget_hours: form.budget_hours !== '' ? Number(form.budget_hours) : null,
      budget_amount: form.budget_amount !== '' ? Number(form.budget_amount) : null,
      started_at: form.started_at || null,
      note: form.note?.trim() || null,
    };
    onSave(payload);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <h3 className="text-base font-semibold">
            {editing ? 'Projekt bearbeiten' : 'Neues Projekt'}
          </h3>
          <IconBtn title="Schliessen" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconBtn>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Projekt-Nr.">
              <Input
                value={form.project_no}
                onChange={(e) => patch('project_no', e.target.value)}
                placeholder="P-2026-001"
              />
            </Field>
            <Field label="Startdatum">
              <Input
                type="date"
                value={form.started_at ?? ''}
                onChange={(e) => patch('started_at', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Kunde">
            <Select value={form.customer_id ?? ''} onChange={(e) => onCustomerChange(e.target.value)}>
              <option value="">— kein Kunde —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Projektname" hint={'Konvention: "Kundenname, BWL" (z.B. "Steuern 2024" als Alternative)'}>
            <Input
              value={form.name}
              onChange={(e) => patch('name', e.target.value)}
              placeholder="Huber AG, BWL"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Verantwortlich">
              <Select
                value={form.responsible_employee_id ?? ''}
                onChange={(e) => patch('responsible_employee_id', e.target.value)}
              >
                <option value="">— keine Zuordnung —</option>
                {employees.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.short_code ? `${m.short_code} · ` : ''}{m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gruppenansatz">
              <Select
                value={form.rate_group_id ?? ''}
                onChange={(e) => patch('rate_group_id', e.target.value)}
              >
                <option value="">— Standardansatz —</option>
                {rateGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Verrechnung">
            <div className="flex items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="billing_mode"
                  value="effektiv"
                  checked={form.billing_mode === 'effektiv'}
                  onChange={() => patch('billing_mode', 'effektiv')}
                />
                Effektiv
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="billing_mode"
                  value="pauschal"
                  checked={form.billing_mode === 'pauschal'}
                  onChange={() => patch('billing_mode', 'pauschal')}
                />
                Pauschal
              </label>
            </div>
          </Field>

          {form.billing_mode === 'pauschal' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded border" style={{ borderColor: '#b8c9e0', background: '#f6f9fd' }}>
              <Field label="Pauschalbetrag (CHF)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.pauschal_amount ?? ''}
                  onChange={(e) => patch('pauschal_amount', e.target.value)}
                  placeholder="z.B. 1200.00"
                />
              </Field>
              <Field label="Rhythmus">
                <Select
                  value={form.pauschal_cycle ?? 'monatlich'}
                  onChange={(e) => patch('pauschal_cycle', e.target.value)}
                >
                  <option value="monatlich">monatlich</option>
                  <option value="quartalsweise">quartalsweise</option>
                  <option value="jaehrlich">jährlich</option>
                  <option value="einmalig">einmalig</option>
                </Select>
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget Stunden">
              <Input
                type="number"
                step="0.25"
                min="0"
                value={form.budget_hours ?? ''}
                onChange={(e) => patch('budget_hours', e.target.value)}
                placeholder="z.B. 40"
              />
            </Field>
            <Field label="Budget Betrag (CHF)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.budget_amount ?? ''}
                onChange={(e) => patch('budget_amount', e.target.value)}
                placeholder="optional"
              />
            </Field>
          </div>

          <Field label="Notiz">
            <textarea
              value={form.note ?? ''}
              onChange={(e) => patch('note', e.target.value)}
              rows={3}
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
              placeholder="Interne Bemerkungen zum Projekt…"
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: '#eef0ee' }}>
            <button type="button" className={artisBtn.ghost} style={artisGhostStyle} onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Speichere…' : (editing ? 'Speichern' : 'Anlegen')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
