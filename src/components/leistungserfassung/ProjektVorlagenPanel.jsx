// ProjektVorlagenPanel
// -----------------------------------------------------------------------------
// Verwaltet Projekt-Templates für die Leistungserfassung. Templates liefern
// Defaults (Suffix, Abrechnungsart, Rate-Gruppe, Budget, Notiz) beim Anlegen
// neuer Projekte.
//
// Erforderliche Migration (separat zu schreiben/ausführen):
// -----------------------------------------------------------------------------
// create table public.le_project_template (
//   id uuid primary key default gen_random_uuid(),
//   name text not null unique,
//   description text,
//   name_suffix text,
//   billing_mode le_project_billing_mode default 'effektiv',
//   pauschal_amount numeric(12,2),
//   pauschal_cycle text,
//   rate_group_id uuid references le_rate_group(id) on delete set null,
//   budget_hours numeric(10,2),
//   budget_amount numeric(12,2),
//   default_notes text,
//   active boolean default true,
//   created_at timestamptz not null default now(),
//   updated_at timestamptz not null default now()
// );
// -----------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, Plus, Pencil, Trash2, Tag, Briefcase, X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { leRateGroup } from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// Erkennung: Tabelle fehlt noch (Migration nicht ausgeführt)
const isTableMissing = (e) => {
  const msg = String(e?.message || '');
  return msg.includes('le_project_template') && msg.includes('does not exist');
};

// Direkt-CRUD über Supabase (es gibt noch keinen leApi-Wrapper)
const tplApi = {
  async list() {
    const { data, error } = await supabase
      .from('le_project_template')
      .select('*, rate_group:le_rate_group(id, name)')
      .order('name', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  async create(payload) {
    const { data, error } = await supabase
      .from('le_project_template')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await supabase
      .from('le_project_template')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id) {
    const { error } = await supabase
      .from('le_project_template')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },
};

const EMPTY_TPL = {
  name: '',
  description: '',
  name_suffix: '',
  billing_mode: 'effektiv',
  pauschal_amount: '',
  pauschal_cycle: 'monatlich',
  rate_group_id: '',
  budget_hours: '',
  budget_amount: '',
  default_notes: '',
  active: true,
};

// ---------- Panel ----------
export default function ProjektVorlagenPanel() {
  const qc = useQueryClient();

  const tplQ = useQuery({
    queryKey: ['le', 'project_template'],
    queryFn: tplApi.list,
    retry: (count, err) => !isTableMissing(err) && count < 2,
  });
  const rateGroupsQ = useQuery({
    queryKey: ['le', 'rate_group'],
    queryFn: leRateGroup.list,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const removeM = useMutation({
    mutationFn: (id) => tplApi.remove(id),
    onSuccess: () => {
      toast.success('Vorlage gelöscht');
      qc.invalidateQueries({ queryKey: ['le', 'project_template'] });
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const createM = useMutation({
    mutationFn: (payload) => tplApi.create(payload),
    onSuccess: () => {
      toast.success('Vorlage angelegt');
      qc.invalidateQueries({ queryKey: ['le', 'project_template'] });
      setDialogOpen(false);
    },
    onError: (e) => {
      const msg = String(e?.message ?? e);
      if (msg.includes('duplicate') || msg.includes('23505')) {
        toast.error('Name existiert bereits – bitte anderen Namen wählen.');
      } else {
        toast.error('Fehler: ' + msg);
      }
    },
  });

  const updateM = useMutation({
    mutationFn: ({ id, patch }) => tplApi.update(id, patch),
    onSuccess: () => {
      toast.success('Vorlage gespeichert');
      qc.invalidateQueries({ queryKey: ['le', 'project_template'] });
      setDialogOpen(false);
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (row) => { setEditing(row); setDialogOpen(true); };
  const onDelete = (row) => {
    if (!window.confirm(`Vorlage "${row.name}" wirklich löschen?`)) return;
    removeM.mutate(row.id);
  };

  const tableMissing = tplQ.error && isTableMissing(tplQ.error);

  return (
    <div>
      <PanelHeader
        title="Projekt-Vorlagen"
        subtitle="Templates für wiederkehrende Projekttypen (BWL, Steuern, Revision …)"
        right={
          <button
            type="button"
            onClick={openCreate}
            disabled={tableMissing}
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: tableMissing ? 0.5 : 1 }}
          >
            <Plus className="w-4 h-4" /> Neue Vorlage
          </button>
        }
      />

      {tplQ.isLoading && <PanelLoader />}

      {tableMissing && (
        <Card className="p-5" style={{ borderColor: '#f3d9a4', background: '#fff8e6' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#8a5a00' }} />
            <div className="flex-1 text-sm" style={{ color: '#8a5a00' }}>
              <div className="font-semibold">Vorlagen-Tabelle existiert noch nicht.</div>
              <div className="mt-1 text-xs">
                Die Migration für <code className="bg-white/70 px-1 rounded">public.le_project_template</code> muss
                noch ausgeführt werden. Erstelle die Tabelle gemäss SQL-Definition im
                Datei-Header dieses Panels und lade die Seite anschliessend neu.
              </div>
              <div className="mt-3 text-[11px] font-mono bg-white/60 p-2 rounded border" style={{ borderColor: '#f3d9a4' }}>
                create table public.le_project_template ( id uuid primary key default gen_random_uuid(),
                name text not null unique, … );
              </div>
              <button
                onClick={() => tplQ.refetch()}
                className="mt-3 text-xs underline"
              >
                Erneut prüfen
              </button>
            </div>
          </div>
        </Card>
      )}

      {tplQ.error && !tableMissing && (
        <PanelError error={tplQ.error} onRetry={() => tplQ.refetch()} />
      )}

      {!tplQ.isLoading && !tplQ.error && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Suffix</th>
                  <th className="px-3 py-2 font-semibold">Abrechnungsart</th>
                  <th className="px-3 py-2 font-semibold">Rate-Gruppe</th>
                  <th className="px-3 py-2 font-semibold text-right">Budget Std.</th>
                  <th className="px-3 py-2 font-semibold text-right">Budget CHF</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {(tplQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-zinc-400 text-xs">
                      <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      Noch keine Vorlagen erfasst. Lege eine Vorlage an, um sie beim Projekt-Anlegen auszuwählen.
                    </td>
                  </tr>
                )}
                {(tplQ.data ?? []).map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-zinc-50/60" style={{ borderColor: '#eef0ee' }}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-3.5 h-3.5 text-zinc-400" />
                        <div>
                          <div className="font-medium">{row.name}</div>
                          {row.description && (
                            <div className="text-[11px] text-zinc-500">{row.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.name_suffix ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono text-zinc-700">
                          <Tag className="w-3 h-3 text-zinc-400" />
                          {row.name_suffix}
                        </span>
                      ) : <span className="text-zinc-400 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {row.billing_mode === 'pauschal' ? (
                        <Chip tone="blue">
                          Pauschal{row.pauschal_amount ? ` · CHF ${fmt.chf(row.pauschal_amount)}` : ''}
                          {row.pauschal_cycle ? ` · ${row.pauschal_cycle}` : ''}
                        </Chip>
                      ) : (
                        <Chip tone="green">Effektiv</Chip>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{row.rate_group?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(row.budget_hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.chf(row.budget_amount)}</td>
                    <td className="px-3 py-2">
                      {row.active
                        ? <Chip tone="green">aktiv</Chip>
                        : <Chip tone="neutral">inaktiv</Chip>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="Bearbeiten" onClick={() => openEdit(row)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </IconBtn>
                        <IconBtn title="Löschen" danger onClick={() => onDelete(row)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {dialogOpen && (
        <TemplateDialog
          editing={editing}
          rateGroups={rateGroupsQ.data ?? []}
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

// ---------- Dialog ----------
function TemplateDialog({ editing, rateGroups, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => {
    if (!editing) return { ...EMPTY_TPL };
    return {
      name: editing.name ?? '',
      description: editing.description ?? '',
      name_suffix: editing.name_suffix ?? '',
      billing_mode: editing.billing_mode ?? 'effektiv',
      pauschal_amount: editing.pauschal_amount ?? '',
      pauschal_cycle: editing.pauschal_cycle ?? 'monatlich',
      rate_group_id: editing.rate_group_id ?? '',
      budget_hours: editing.budget_hours ?? '',
      budget_amount: editing.budget_amount ?? '',
      default_notes: editing.default_notes ?? '',
      active: editing.active ?? true,
    };
  });

  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ESC schliesst Dialog
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    if (!form.name?.trim()) { toast.error('Name ist Pflicht'); return; }

    const payload = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      name_suffix: form.name_suffix?.trim() || null,
      billing_mode: form.billing_mode,
      pauschal_amount: form.billing_mode === 'pauschal' && form.pauschal_amount !== ''
        ? Number(form.pauschal_amount) : null,
      pauschal_cycle: form.billing_mode === 'pauschal' ? (form.pauschal_cycle || null) : null,
      rate_group_id: form.rate_group_id || null,
      budget_hours: form.budget_hours !== '' ? Number(form.budget_hours) : null,
      budget_amount: form.budget_amount !== '' ? Number(form.budget_amount) : null,
      default_notes: form.default_notes?.trim() || null,
      active: !!form.active,
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
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-zinc-500" />
            {editing ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
          </h3>
          <IconBtn title="Schliessen" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconBtn>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" hint="z.B. ‚BWL-Standard'">
              <Input
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="BWL-Standard"
                autoFocus
              />
            </Field>
            <Field label="Name-Suffix" hint="wird beim Projekt-Anlegen an Kundenname angehängt, z.B. ‚, BWL'">
              <Input
                value={form.name_suffix}
                onChange={(e) => patch('name_suffix', e.target.value)}
                placeholder=", BWL"
              />
            </Field>
          </div>

          <Field label="Beschreibung">
            <Input
              value={form.description}
              onChange={(e) => patch('description', e.target.value)}
              placeholder="Kurzbeschreibung der Vorlage"
            />
          </Field>

          <Field label="Verrechnung">
            <div className="flex items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="tpl_billing_mode"
                  value="effektiv"
                  checked={form.billing_mode === 'effektiv'}
                  onChange={() => patch('billing_mode', 'effektiv')}
                />
                Effektiv
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="tpl_billing_mode"
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
                  value={form.pauschal_amount}
                  onChange={(e) => patch('pauschal_amount', e.target.value)}
                  placeholder="z.B. 1200.00"
                />
              </Field>
              <Field label="Rhythmus">
                <Select
                  value={form.pauschal_cycle}
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

          <Field label="Rate-Gruppe">
            <Select
              value={form.rate_group_id}
              onChange={(e) => patch('rate_group_id', e.target.value)}
            >
              <option value="">— Standardansatz —</option>
              {rateGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget Stunden">
              <Input
                type="number"
                step="0.25"
                min="0"
                value={form.budget_hours}
                onChange={(e) => patch('budget_hours', e.target.value)}
                placeholder="optional, z.B. 40"
              />
            </Field>
            <Field label="Budget Betrag (CHF)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.budget_amount}
                onChange={(e) => patch('budget_amount', e.target.value)}
                placeholder="optional"
              />
            </Field>
          </div>

          <Field label="Standard-Notizen" hint="wird beim Projekt-Anlegen als Notiz vorausgefüllt">
            <textarea
              value={form.default_notes}
              onChange={(e) => patch('default_notes', e.target.value)}
              rows={3}
              className="w-full border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
              placeholder="z.B. Standardumfang, Lieferfristen, Hinweise…"
            />
          </Field>

          <div className="pt-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => patch('active', e.target.checked)}
              />
              Vorlage aktiv (in Projekt-Anlage auswählbar)
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: '#eef0ee' }}>
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
