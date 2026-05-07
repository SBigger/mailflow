import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2, CalendarClock, Plus, Archive, ArchiveRestore } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { leServiceType, leServiceRateHistory, leVatRate } from '@/lib/leApi';
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
  artisGhostStyle,
} from './shared';

// ---------- Panel ----------
export default function LeistungsartenPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['le', 'service_type'],
    queryFn: leServiceType.list,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = neu, sonst Row
  const [rateOpen, setRateOpen] = useState(false);
  const [rateType, setRateType] = useState(null);

  const removeMut = useMutation({
    mutationFn: (id) => leServiceType.remove(id),
    onSuccess: () => {
      toast.success('Leistungsart gelöscht');
      qc.invalidateQueries({ queryKey: ['le', 'service_type'] });
    },
    onError: (e) => toast.error(String(e?.message ?? e)),
  });

  const archiveMut = useMutation({
    mutationFn: (id) => leServiceType.archive(id),
    onSuccess: () => { toast.success('Leistungsart deaktiviert'); qc.invalidateQueries({ queryKey: ['le', 'service_type'] }); },
    onError: (e) => toast.error(String(e?.message ?? e)),
  });
  const unarchiveMut = useMutation({
    mutationFn: (id) => leServiceType.unarchive(id),
    onSuccess: () => { toast.success('Leistungsart reaktiviert'); qc.invalidateQueries({ queryKey: ['le', 'service_type'] }); },
    onError: (e) => toast.error(String(e?.message ?? e)),
  });

  const openNew = () => { setEditing(null); setEditOpen(true); };
  const openEdit = (row) => { setEditing(row); setEditOpen(true); };
  const openRate = (row) => { setRateType(row); setRateOpen(true); };
  const onDelete = async (row) => {
    try {
      const check = await leServiceType.canDelete(row.id);
      if (!check?.can_delete) {
        toast.error(
          `Löschen nicht möglich: ${check.entry_count} Rapport(e), ${check.line_count} Rechnungsposition(en), ${check.rate_count} Gruppen-Sätze, ${check.history_count} Satz-Historie verknüpft. Bitte stattdessen deaktivieren.`,
          { duration: 6000 }
        );
        return;
      }
      if (!window.confirm(`Leistungsart "${row.name}" endgültig löschen? (Es sind keine Rapporte verknüpft.)`)) return;
      removeMut.mutate(row.id);
    } catch (e) {
      toast.error('Prüfung fehlgeschlagen: ' + (e?.message ?? e));
    }
  };

  const onToggleActive = (row) => {
    const action = row.active ? 'deaktivieren' : 'reaktivieren';
    if (!window.confirm(`Leistungsart "${row.name}" ${action}?`)) return;
    if (row.active) archiveMut.mutate(row.id);
    else unarchiveMut.mutate(row.id);
  };

  return (
    <div>
      <PanelHeader
        title="Leistungsarten"
        subtitle="Code · Name · abrechenbar · Sortierung"
        right={
          <button
            type="button"
            onClick={openNew}
            className={artisBtn.primary}
            style={artisPrimaryStyle}
          >
            <Plus className="w-4 h-4" /> Neue Leistungsart
          </button>
        }
      />

      {isLoading && <PanelLoader />}
      {error && <PanelError error={error} onRetry={refetch} />}

      {!isLoading && !error && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                  <th className="px-3 py-2 font-semibold">Code</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Abrechenbar</th>
                  <th className="px-3 py-2 font-semibold">Reihenfolge</th>
                  <th className="px-3 py-2 font-semibold">Aktiv</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-zinc-400">
                      Keine Leistungsarten erfasst.
                    </td>
                  </tr>
                )}
                {(data ?? []).map((row) => (
                  <tr key={row.id} className="border-b last:border-0" style={{ borderColor: '#eef0ee' }}>
                    <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">
                      {row.billable
                        ? <Chip tone="green">abrechenbar</Chip>
                        : <Chip tone="neutral">intern</Chip>}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{row.sort_order ?? '—'}</td>
                    <td className="px-3 py-2">
                      {row.active
                        ? <Chip tone="green">aktiv</Chip>
                        : <Chip tone="red">inaktiv</Chip>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="Bearbeiten" onClick={() => openEdit(row)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={row.active ? 'Satzhistorie' : 'Nur für aktive Leistungsarten'}
                          onClick={() => row.active && openRate(row)}
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                        </IconBtn>
                        {row.active ? (
                          <IconBtn title="Deaktivieren (Rapporte bleiben erhalten)" onClick={() => onToggleActive(row)}>
                            <Archive className="w-3.5 h-3.5" />
                          </IconBtn>
                        ) : (
                          <IconBtn title="Reaktivieren" onClick={() => onToggleActive(row)}>
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </IconBtn>
                        )}
                        <IconBtn title="Löschen (nur wenn keine Rapporte verknüpft)" danger onClick={() => onDelete(row)}>
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

      <EditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editing}
      />
      <RateHistoryDialog
        open={rateOpen}
        onOpenChange={setRateOpen}
        serviceType={rateType}
      />
    </div>
  );
}

// ---------- Edit / Create Dialog ----------
function EditDialog({ open, onOpenChange, initial }) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const ratesQ = useQuery({ queryKey: ['le', 'vat_rate'], queryFn: leVatRate.list });
  const vatCodes = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of (ratesQ.data ?? [])) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      out.push({ code: r.code, label: r.label });
    }
    return out;
  }, [ratesQ.data]);

  const [form, setForm] = useState(() => defaultForm(initial));
  // reset form on open change
  React.useEffect(() => {
    if (open) setForm(defaultForm(initial));
  }, [open, initial]);

  const saveMut = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) return leServiceType.update(initial.id, payload);
      return leServiceType.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Leistungsart gespeichert' : 'Leistungsart angelegt');
      qc.invalidateQueries({ queryKey: ['le', 'service_type'] });
      onOpenChange(false);
    },
    onError: (e) => {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
        toast.error('Code existiert bereits – bitte anderen Code wählen.');
      } else {
        toast.error(msg);
      }
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim()) { toast.error('Code erforderlich'); return; }
    if (!form.name.trim()) { toast.error('Name erforderlich'); return; }
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      billable: !!form.billable,
      sort_order: Number(form.sort_order) || 100,
      active: !!form.active,
      default_vat_code: form.default_vat_code || 'STD',
      default_section: form.default_section || 'honorar',
    };
    saveMut.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Leistungsart bearbeiten' : 'Neue Leistungsart'}</DialogTitle>
          <DialogDescription>
            Code, Name sowie Abrechenbarkeit und Sortierung.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="BUCH"
                style={{ textTransform: 'uppercase' }}
                autoFocus
              />
            </Field>
            <Field label="Reihenfolge">
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Buchhaltung"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default-MWST" hint="Code wird beim Erstellen einer Rechnungsposition übernommen.">
              <Select
                value={form.default_vat_code}
                onChange={(e) => setForm({ ...form, default_vat_code: e.target.value })}
              >
                {vatCodes.length === 0 && <option value="STD">STD</option>}
                {vatCodes.map((v) => (
                  <option key={v.code} value={v.code}>{v.code} – {v.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Default-Sektion" hint="Gruppierung auf der Rechnung.">
              <Select
                value={form.default_section}
                onChange={(e) => setForm({ ...form, default_section: e.target.value })}
              >
                <option value="honorar">Honorar</option>
                <option value="spesen">Spesen</option>
                <option value="drittleistungen">Drittleistungen</option>
                <option value="kulant">Kulant</option>
              </Select>
            </Field>
          </div>
          <div className="flex items-center gap-6 pt-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.billable}
                onChange={(e) => setForm({ ...form, billable: e.target.checked })}
              />
              abrechenbar
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              aktiv
            </label>
          </div>

          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={artisBtn.ghost}
              style={artisGhostStyle}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saveMut.isPending}
              className={artisBtn.primary}
              style={artisPrimaryStyle}
            >
              {saveMut.isPending ? 'Speichern…' : 'Speichern'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultForm(initial) {
  return {
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    billable: initial?.billable ?? true,
    sort_order: initial?.sort_order ?? 100,
    active: initial?.active ?? true,
    default_vat_code: initial?.default_vat_code ?? 'STD',
    default_section: initial?.default_section ?? 'honorar',
  };
}

// ---------- Rate History Dialog ----------
function RateHistoryDialog({ open, onOpenChange, serviceType }) {
  const qc = useQueryClient();
  const typeId = serviceType?.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['le', 'service_rate_history', typeId],
    queryFn: () => leServiceRateHistory.listForType(typeId),
    enabled: !!typeId && open,
  });

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [draft, setDraft] = useState({ valid_from: today, rate: '', note: '' });
  React.useEffect(() => {
    if (open) setDraft({ valid_from: today, rate: '', note: '' });
  }, [open, today]);

  const createMut = useMutation({
    mutationFn: (payload) => leServiceRateHistory.create(payload),
    onSuccess: () => {
      toast.success('Satz hinzugefügt');
      qc.invalidateQueries({ queryKey: ['le', 'service_rate_history', typeId] });
      setDraft({ valid_from: today, rate: '', note: '' });
    },
    onError: (e) => toast.error(String(e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leServiceRateHistory.remove(id),
    onSuccess: () => {
      toast.success('Satz gelöscht');
      qc.invalidateQueries({ queryKey: ['le', 'service_rate_history', typeId] });
    },
    onError: (e) => toast.error(String(e?.message ?? e)),
  });

  const onAdd = () => {
    if (!draft.valid_from) { toast.error('Gültig ab erforderlich'); return; }
    const rate = Number(draft.rate);
    if (!Number.isFinite(rate) || rate < 0) { toast.error('Satz muss eine Zahl sein'); return; }
    createMut.mutate({
      service_type_id: typeId,
      valid_from: draft.valid_from,
      rate,
      note: draft.note?.trim() || null,
    });
  };

  const onRemove = (row) => {
    if (!window.confirm(`Satz vom ${fmt.date(row.valid_from)} löschen?`)) return;
    removeMut.mutate(row.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Satzhistorie {serviceType ? `· ${serviceType.code} – ${serviceType.name}` : ''}
          </DialogTitle>
          <DialogDescription>
            Zeitlich gestaffelte Stundensätze (CHF). Der jüngste Eintrag mit
            valid_from ≤ Leistungsdatum gilt.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <PanelLoader />}
        {error && <PanelError error={error} onRetry={refetch} />}

        {!isLoading && !error && (
          <div className="space-y-3">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                      <th className="px-3 py-2 font-semibold">Gültig ab</th>
                      <th className="px-3 py-2 font-semibold">Satz (CHF)</th>
                      <th className="px-3 py-2 font-semibold">Notiz</th>
                      <th className="px-3 py-2 font-semibold text-right">Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                          Noch keine Sätze erfasst.
                        </td>
                      </tr>
                    )}
                    {(data ?? []).map((row) => (
                      <tr key={row.id} className="border-b last:border-0" style={{ borderColor: '#eef0ee' }}>
                        <td className="px-3 py-2">{fmt.date(row.valid_from)}</td>
                        <td className="px-3 py-2 font-medium">{fmt.chf(row.rate)}</td>
                        <td className="px-3 py-2 text-zinc-500">{row.note || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end">
                            <IconBtn title="Löschen" danger onClick={() => onRemove(row)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f7f9f7' }}>
                      <td className="px-3 py-2">
                        <Input
                          type="date"
                          value={draft.valid_from}
                          onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.05"
                          min="0"
                          value={draft.rate}
                          onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                          placeholder="z. B. 160"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={draft.note}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                          placeholder="optional"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={onAdd}
                            disabled={createMut.isPending}
                            className={artisBtn.primary}
                            style={artisPrimaryStyle}
                          >
                            <Plus className="w-4 h-4" /> Neuer Satz
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
