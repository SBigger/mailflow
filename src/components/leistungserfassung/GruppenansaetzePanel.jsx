// Gruppenansätze-Stammdaten · Tarifgruppen mit Service-Type-spezifischen Override-Sätzen
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, X, Save, Layers } from 'lucide-react';
import { leRateGroup, leRateGroupRate, leServiceType } from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Field,
  PanelLoader, PanelError, PanelHeader,
  fmt, artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

const todayIso = () => new Date().toISOString().slice(0, 10);

// Aktuellen Satz einer Gruppe für einen Service-Typ ermitteln (jüngster mit valid_from <= heute)
function currentRateFor(group, serviceTypeId) {
  const today = todayIso();
  const rates = (group?.le_rate_group_rate ?? [])
    .filter((r) => r.service_type_id === serviceTypeId && r.valid_from <= today)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return rates[0] ?? null;
}

export default function GruppenansaetzePanel() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null); // null | { mode: 'create'|'edit', item? }

  const groupsQ = useQuery({
    queryKey: ['le', 'rate_group'],
    queryFn: leRateGroup.list,
  });
  const typesQ = useQuery({
    queryKey: ['le', 'service_type'],
    queryFn: leServiceType.list,
  });

  const groups = groupsQ.data ?? [];
  const types = typesQ.data ?? [];

  // Auto-select erstes Item, wenn nichts gewählt
  useEffect(() => {
    if (!selectedId && groups.length > 0) setSelectedId(groups[0].id);
    if (selectedId && !groups.find((g) => g.id === selectedId)) {
      setSelectedId(groups[0]?.id ?? null);
    }
  }, [groups, selectedId]);

  const selected = useMemo(
    () => groups.find((g) => g.id === selectedId) ?? null,
    [groups, selectedId]
  );

  // Mutations
  const createGroupM = useMutation({
    mutationFn: leRateGroup.create,
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['le', 'rate_group'] });
      setSelectedId(row.id);
      setDialog(null);
      toast.success('Gruppe erstellt');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const updateGroupM = useMutation({
    mutationFn: ({ id, patch }) => leRateGroup.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'rate_group'] });
      setDialog(null);
      toast.success('Gruppe aktualisiert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const removeGroupM = useMutation({
    mutationFn: (id) => leRateGroup.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'rate_group'] });
      toast.success('Gruppe gelöscht');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const upsertRateM = useMutation({
    mutationFn: leRateGroupRate.upsert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'rate_group'] });
      toast.success('Satz gespeichert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });
  const removeRateM = useMutation({
    mutationFn: (id) => leRateGroupRate.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'rate_group'] });
      toast.success('Override entfernt');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const handleDelete = (group) => {
    if (!window.confirm(`Gruppe "${group.name}" wirklich löschen? Alle zugehörigen Sätze werden ebenfalls entfernt.`)) return;
    removeGroupM.mutate(group.id);
  };

  const headerRight = (
    <button
      type="button"
      className={artisBtn.primary}
      style={artisPrimaryStyle}
      onClick={() => setDialog({ mode: 'create' })}
    >
      <Plus className="w-4 h-4" /> Neue Gruppe
    </button>
  );

  if (groupsQ.isLoading || typesQ.isLoading) {
    return (
      <div>
        <PanelHeader
          title="Gruppenansätze"
          subtitle="Tarif-Varianten pro Kunde/Projekt – z.B. Standard, Premium, KMU-Pauschal"
          right={headerRight}
        />
        <PanelLoader />
      </div>
    );
  }
  if (groupsQ.error) {
    return (
      <div>
        <PanelHeader
          title="Gruppenansätze"
          subtitle="Tarif-Varianten pro Kunde/Projekt – z.B. Standard, Premium, KMU-Pauschal"
          right={headerRight}
        />
        <PanelError error={groupsQ.error} onRetry={() => groupsQ.refetch()} />
      </div>
    );
  }
  if (typesQ.error) {
    return (
      <div>
        <PanelHeader
          title="Gruppenansätze"
          subtitle="Tarif-Varianten pro Kunde/Projekt – z.B. Standard, Premium, KMU-Pauschal"
          right={headerRight}
        />
        <PanelError error={typesQ.error} onRetry={() => typesQ.refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title="Gruppenansätze"
        subtitle="Tarif-Varianten pro Kunde/Projekt – z.B. Standard, Premium, KMU-Pauschal"
        right={headerRight}
      />

      {groups.length === 0 ? (
        <Card className="p-10 text-center">
          <div
            className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3"
            style={{ background: '#e6ede6', color: '#7a9b7f' }}
          >
            <Layers className="w-7 h-7" />
          </div>
          <div className="text-sm font-medium mb-1">Noch keine Gruppenansätze angelegt</div>
          <div className="text-xs text-zinc-500 mb-4">
            Lege Tarif-Varianten wie „Standard", „Premium" oder „KMU-Pauschal" an und weise sie Kunden oder Projekten zu.
          </div>
          <button
            type="button"
            className={artisBtn.primary}
            style={artisPrimaryStyle}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus className="w-4 h-4" /> Neue Gruppe
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* LINKS: Liste */}
          <div className="flex flex-col gap-2">
            {groups.map((g) => {
              const isSel = g.id === selectedId;
              const overrideCount = (g.le_rate_group_rate ?? []).length;
              return (
                <Card
                  key={g.id}
                  className="p-3 cursor-pointer transition-colors"
                  style={{
                    borderColor: isSel ? '#7a9b7f' : '#e4e7e4',
                    background: isSel ? '#f3f7f3' : '#fff',
                    boxShadow: isSel ? '0 0 0 1px #7a9b7f' : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0" onClick={() => setSelectedId(g.id)}>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium truncate">{g.name}</div>
                        {g.active ? <Chip tone="green">aktiv</Chip> : <Chip tone="neutral">inaktiv</Chip>}
                      </div>
                      {g.description && (
                        <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{g.description}</div>
                      )}
                      <div className="text-[10px] text-zinc-400 mt-1">
                        {overrideCount} Override{overrideCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <IconBtn title="Bearbeiten" onClick={() => setDialog({ mode: 'edit', item: g })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </IconBtn>
                      <IconBtn title="Löschen" danger onClick={() => handleDelete(g)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* RECHTS: Details */}
          <div>
            {!selected ? (
              <Card className="p-8 text-center text-sm text-zinc-500">
                Wähle links eine Gruppe aus, um die Sätze je Leistungsart zu bearbeiten.
              </Card>
            ) : (
              <RateMatrix
                group={selected}
                types={types}
                onUpsertRate={(payload) => upsertRateM.mutate(payload)}
                onRemoveRate={(id) => removeRateM.mutate(id)}
                busy={upsertRateM.isPending || removeRateM.isPending}
              />
            )}
          </div>
        </div>
      )}

      {dialog && (
        <GroupDialog
          mode={dialog.mode}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createGroupM.mutate(payload);
            else updateGroupM.mutate({ id: dialog.item.id, patch: payload });
          }}
          busy={createGroupM.isPending || updateGroupM.isPending}
        />
      )}
    </div>
  );
}

// ---------- Matrix: Service-Type × Rate ----------
function RateMatrix({ group, types, onUpsertRate, onRemoveRate, busy }) {
  // Lokaler Edit-State (map serviceTypeId -> string)
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    // Reset beim Gruppenwechsel
    setDrafts({});
  }, [group?.id]);

  const getValue = (typeId) => {
    if (drafts[typeId] !== undefined) return drafts[typeId];
    const cur = currentRateFor(group, typeId);
    return cur ? String(cur.rate) : '';
  };
  const isDirty = (typeId) => {
    if (drafts[typeId] === undefined) return false;
    const cur = currentRateFor(group, typeId);
    const currentStr = cur ? String(cur.rate) : '';
    return drafts[typeId] !== currentStr;
  };

  const saveRow = (typeId) => {
    const raw = (drafts[typeId] ?? '').trim();
    if (raw === '') {
      toast.info('Leerer Wert: Fallback auf Default-Satz. Zum Entfernen bitte "Override löschen" nutzen.');
      return;
    }
    const num = Number(raw.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Bitte gültigen Betrag eingeben.');
      return;
    }
    onUpsertRate({
      rate_group_id: group.id,
      service_type_id: typeId,
      rate: num,
      valid_from: todayIso(),
    });
    setDrafts((d) => {
      const nd = { ...d };
      delete nd[typeId];
      return nd;
    });
  };

  const removeOverride = (typeId) => {
    const cur = currentRateFor(group, typeId);
    if (!cur) return;
    if (!window.confirm('Override wirklich entfernen? Die Gruppe fällt für diese Leistungsart auf den Default-Satz zurück.')) return;
    onRemoveRate(cur.id);
    setDrafts((d) => {
      const nd = { ...d };
      delete nd[typeId];
      return nd;
    });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            {group.name}
            {group.active ? <Chip tone="green">aktiv</Chip> : <Chip tone="neutral">inaktiv</Chip>}
          </div>
          {group.description && <div className="text-xs text-zinc-500 mt-0.5">{group.description}</div>}
          <div className="text-[10px] text-zinc-400 mt-1">
            Änderungen werden mit gültig-ab {fmt.date(todayIso())} gespeichert.
          </div>
        </div>
      </div>

      {types.length === 0 ? (
        <div className="text-xs text-zinc-500 py-6 text-center">
          Noch keine Leistungsarten angelegt. Lege zuerst Leistungsarten unter „Leistungsarten" an.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
                <th className="text-left py-2 pr-2 font-semibold">Leistungsart</th>
                <th className="text-right py-2 px-2 font-semibold w-32">Default</th>
                <th className="text-right py-2 px-2 font-semibold w-36">Gruppen-Satz</th>
                <th className="text-right py-2 pl-2 font-semibold w-48">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const cur = currentRateFor(group, t.id);
                const val = getValue(t.id);
                const dirty = isDirty(t.id);
                return (
                  <tr key={t.id} className="border-b last:border-b-0" style={{ borderColor: '#f1f3f1' }}>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{t.name}</div>
                      {!t.billable && <Chip tone="neutral" className="mt-0.5">nicht verrechenbar</Chip>}
                    </td>
                    <td className="py-2 px-2 text-right text-zinc-500 tabular-nums">
                      {t.default_rate != null ? `CHF ${fmt.chf(t.default_rate)}` : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={val}
                        placeholder="Leer = Default"
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                        className="text-right tabular-nums"
                        style={dirty ? { borderColor: '#7a9b7f', background: '#f3f7f3' } : {}}
                      />
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={!dirty || busy}
                          className={artisBtn.primary}
                          style={{
                            ...artisPrimaryStyle,
                            opacity: !dirty || busy ? 0.4 : 1,
                            cursor: !dirty || busy ? 'not-allowed' : 'pointer',
                          }}
                          onClick={() => saveRow(t.id)}
                        >
                          <Save className="w-3.5 h-3.5" /> Speichern
                        </button>
                        {cur && (
                          <IconBtn title="Override entfernen" danger onClick={() => removeOverride(t.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[10px] text-zinc-400 mt-3">
        Leer gelassene Werte fallen automatisch auf den Default-Satz der Leistungsart zurück.
      </div>
    </Card>
  );
}

// ---------- Dialog: Gruppe anlegen / bearbeiten ----------
function GroupDialog({ mode, item, onClose, onSubmit, busy }) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [active, setActive] = useState(item?.active ?? true);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name ist erforderlich.');
      return;
    }
    onSubmit({
      name: trimmed,
      description: description.trim() || null,
      active,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,25,20,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl border"
        style={{ borderColor: '#d1dcd1' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#e4e7e4' }}>
          <div className="text-sm font-semibold">
            {mode === 'create' ? 'Neue Gruppe' : 'Gruppe bearbeiten'}
          </div>
          <IconBtn title="Schliessen" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconBtn>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <Field label="Name *">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Standard, Premium, KMU-Pauschal"
            />
          </Field>
          <Field label="Beschreibung" hint="Optional – sichtbar in der Liste">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kurze Beschreibung"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ accentColor: '#7a9b7f' }}
            />
            <span>Aktiv</span>
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={artisBtn.ghost}
              style={artisGhostStyle}
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: busy ? 0.6 : 1 }}
              disabled={busy}
            >
              <Save className="w-4 h-4" /> {mode === 'create' ? 'Erstellen' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
