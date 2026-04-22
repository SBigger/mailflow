// Leistungserfassung · Meine Rapporte
// Persönliche Übersicht aller eigenen Zeiteinträge mit Filter, Bulk-Freigabe,
// CSV-Export. Admins können MA-Filter umschalten.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Filter, Download, Check, CheckSquare, Pencil, Trash2, Calendar,
} from 'lucide-react';
import {
  leTimeEntry, leProject, leServiceType, leEmployee, currentEmployee,
} from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';
import {
  Card, Chip, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader,
  artisBtn, artisPrimaryStyle, artisGhostStyle, fmt,
} from './shared';

// --- Helpers ---------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const firstOfMonthIso = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

const lastOfMonthIso = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

const STATUS_CHIP = {
  erfasst:     { tone: 'neutral', label: 'erfasst' },
  freigegeben: { tone: 'green',   label: 'freigegeben' },
  verrechnet:  { tone: 'blue',    label: 'verrechnet' },
  storniert:   { tone: 'red',     label: 'storniert' },
};

const MAX_ROWS = 200;

function downloadCsv(filename, rows) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Panel -----------------------------------------------------------------

export default function MeineRapportePanel() {
  const qc = useQueryClient();

  // Wer bin ich + Rolle?
  const [meEmployeeId, setMeEmployeeId] = useState(null);
  const [meResolved, setMeResolved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Filter
  const [fromIso, setFromIso] = useState(() => firstOfMonthIso());
  const [toIso, setToIso] = useState(() => lastOfMonthIso());
  const [projectId, setProjectId] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState(''); // admin only, '' = me

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Auth/Admin initial auflösen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emp = await currentEmployee();
        if (cancelled) return;
        if (emp?.id) setMeEmployeeId(emp.id);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
          if (!cancelled && profile?.role === 'admin') setIsAdmin(true);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setMeResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Effektive employeeId: Admin mit employeeFilter != '' → dieser, sonst me.
  const effectiveEmployeeId = isAdmin && employeeFilter ? employeeFilter : meEmployeeId;

  // --- Queries -------------------------------------------------------------
  const projectsQ = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const serviceTypesQ = useQuery({ queryKey: ['le', 'service_type'], queryFn: () => leServiceType.list() });
  const employeesQ = useQuery({
    queryKey: ['le', 'employee'],
    queryFn: () => leEmployee.list(),
    enabled: isAdmin,
  });

  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', 'meine', fromIso, toIso, effectiveEmployeeId, projectId, statusFilter],
    queryFn: () => leTimeEntry.listForRange(fromIso, toIso, {
      employeeId: effectiveEmployeeId,
      projectId: projectId || undefined,
      status: statusFilter || undefined,
    }),
    enabled: !!effectiveEmployeeId,
  });

  const projects = projectsQ.data ?? [];
  const serviceTypes = serviceTypesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const rawEntries = entriesQ.data ?? [];

  // Client-seitiger Leistungsart-Filter (nicht in API-Call verfügbar)
  const entriesAll = useMemo(() => {
    let arr = rawEntries;
    if (serviceTypeId) arr = arr.filter((e) => e.service_type_id === serviceTypeId);
    // Sortierung nach Datum absteigend, Zeit absteigend
    arr = [...arr].sort((a, b) => {
      if (a.entry_date < b.entry_date) return 1;
      if (a.entry_date > b.entry_date) return -1;
      return String(b.time_from ?? '').localeCompare(String(a.time_from ?? ''));
    });
    return arr;
  }, [rawEntries, serviceTypeId]);

  const truncated = entriesAll.length > MAX_ROWS;
  const entries = truncated ? entriesAll.slice(0, MAX_ROWS) : entriesAll;

  // Selektion bereinigen, wenn sich Resultset ändert
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set();
      for (const e of entries) if (prev.has(e.id)) next.add(e.id);
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  // --- Aggregate -----------------------------------------------------------
  const stats = useMemo(() => {
    let hours = 0;
    let chfBillable = 0;
    let chfIntern = 0;
    for (const e of entriesAll) {
      const h = Number(e.hours_internal ?? 0);
      const rate = Number(e.rate_snapshot ?? 0);
      hours += h;
      const billable = e.service_type?.billable !== false;
      if (billable) chfBillable += h * rate;
      else chfIntern += h * rate;
    }
    return { count: entriesAll.length, hours, chfBillable, chfIntern };
  }, [entriesAll]);

  // --- Mutations -----------------------------------------------------------
  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'time_entry'] });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leTimeEntry.update(id, patch),
    onSuccess: () => { toast.success('Gespeichert'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leTimeEntry.remove(id),
    onSuccess: () => { toast.success('Gelöscht'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const freigabeMut = useMutation({
    mutationFn: async (ids) => {
      const { error } = await supabase
        .from('le_time_entry')
        .update({ status: 'freigegeben' })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} Einträge freigegeben`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // --- Loading / Error -----------------------------------------------------
  if (!meResolved) return <PanelLoader />;
  if (!meEmployeeId) {
    return (
      <div>
        <PanelHeader title="Meine Rapporte" subtitle="Persönliche Übersicht" />
        <Card className="p-5 text-sm text-zinc-600">
          Kein Mitarbeiter-Profil gefunden. Bitte erst im Tab <b>Stammdaten → Mitarbeiter</b> ein Profil verknüpfen.
        </Card>
      </div>
    );
  }

  const anyError = projectsQ.error || serviceTypesQ.error || entriesQ.error || (isAdmin && employeesQ.error);
  if (anyError) {
    return (
      <div>
        <PanelHeader title="Meine Rapporte" subtitle="Persönliche Übersicht" />
        <PanelError
          error={anyError}
          onRetry={() => { projectsQ.refetch(); serviceTypesQ.refetch(); entriesQ.refetch(); if (isAdmin) employeesQ.refetch(); }}
        />
      </div>
    );
  }

  const loading = projectsQ.isLoading || serviceTypesQ.isLoading || entriesQ.isLoading;

  // --- Handlers ------------------------------------------------------------
  const selectableEntries = entries.filter((e) => e.status !== 'verrechnet' && e.status !== 'storniert');
  const allSelectable = selectableEntries.length > 0 && selectableEntries.every((e) => selectedIds.has(e.id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (selectableEntries.every((e) => prev.has(e.id)) && selectableEntries.length > 0) return new Set();
      return new Set(selectableEntries.map((e) => e.id));
    });
  };

  const toggleOne = (id, disabled) => {
    if (disabled) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const freigeben = () => {
    if (!selectedIds.size) return;
    freigabeMut.mutate([...selectedIds]);
  };

  const resetFilter = () => {
    setFromIso(firstOfMonthIso());
    setToIso(lastOfMonthIso());
    setProjectId('');
    setServiceTypeId('');
    setStatusFilter('');
    if (isAdmin) setEmployeeFilter('');
  };

  const handleExport = () => {
    const header = ['Datum', 'Projekt', 'Leistungsart', 'Beschreibung', 'Stunden', 'Satz', 'Wert', 'Status'];
    const body = entriesAll.map((e) => {
      const h = Number(e.hours_internal ?? 0);
      const r = Number(e.rate_snapshot ?? 0);
      return [
        e.entry_date ?? '',
        e.project?.name ?? '',
        e.service_type?.name ?? '',
        e.description ?? '',
        h.toFixed(2),
        r.toFixed(2),
        (h * r).toFixed(2),
        e.status ?? '',
      ];
    });
    downloadCsv(`meine-rapporte-${fromIso}_${toIso}.csv`, [header, ...body]);
  };

  // --- Render --------------------------------------------------------------
  const subtitle = `${stats.count} Einträge · ${fmt.hours(stats.hours)} Std · CHF ${fmt.chf(stats.chfBillable)} billable`;

  return (
    <div>
      <PanelHeader
        title="Meine Rapporte"
        subtitle={subtitle}
        right={
          isAdmin && employeeFilter && employeeFilter !== meEmployeeId ? (
            <Chip tone="violet">Admin-Ansicht</Chip>
          ) : null
        }
      />

      {/* Filter-Card */}
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1 text-zinc-400">
            <Filter className="w-4 h-4" />
            <span className="text-[10px] uppercase font-semibold tracking-wider">Filter</span>
          </div>

          <Field label="Von">
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <Input
                type="date"
                value={fromIso}
                onChange={(e) => setFromIso(e.target.value)}
                className="!pl-7"
                style={{ minWidth: 150 }}
              />
            </div>
          </Field>

          <Field label="Bis">
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <Input
                type="date"
                value={toIso}
                onChange={(e) => setToIso(e.target.value)}
                className="!pl-7"
                style={{ minWidth: 150 }}
              />
            </div>
          </Field>

          <div style={{ minWidth: 180 }}>
            <Field label="Projekt">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Alle</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.customer?.company_name ? ` · ${p.customer.company_name}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div style={{ minWidth: 160 }}>
            <Field label="Leistungsart">
              <Select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
                <option value="">Alle</option>
                {serviceTypes.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div style={{ minWidth: 140 }}>
            <Field label="Status">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Alle</option>
                <option value="erfasst">erfasst</option>
                <option value="freigegeben">freigegeben</option>
                <option value="verrechnet">verrechnet</option>
                <option value="storniert">storniert</option>
              </Select>
            </Field>
          </div>

          {isAdmin && (
            <div style={{ minWidth: 180 }}>
              <Field label="Mitarbeiter">
                <Select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                  <option value="">Ich</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <button
            type="button"
            className={artisBtn.ghost}
            style={artisGhostStyle}
            onClick={resetFilter}
          >
            Zurücksetzen
          </button>
        </div>
      </Card>

      {/* Aktionen-Bar */}
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelectable}
              onChange={toggleAll}
              disabled={selectableEntries.length === 0}
              style={{ accentColor: '#7a9b7f' }}
            />
            <span>Alle auswählen</span>
          </label>

          <button
            type="button"
            onClick={freigeben}
            disabled={!selectedIds.size || freigabeMut.isPending}
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: (!selectedIds.size || freigabeMut.isPending) ? 0.45 : 1 }}
          >
            <CheckSquare className="w-4 h-4" />
            {selectedIds.size} ausgewählt · Freigeben
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              {entriesAll.length} Einträge
              {truncated && <> · zeige nur {MAX_ROWS}</>}
            </span>
            <button
              type="button"
              onClick={handleExport}
              className={artisBtn.ghost}
              style={artisGhostStyle}
              disabled={entriesAll.length === 0}
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>
      </Card>

      {/* Haupt-Bereich: Tabelle + Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <Card>
            {loading ? (
              <PanelLoader />
            ) : entries.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                Keine Einträge im gewählten Zeitraum.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ background: '#f7f9f7', borderBottom: '1px solid #e4e7e4' }}>
                    <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left font-semibold w-24">Datum</th>
                      <th className="px-2 py-2 text-left font-semibold">Projekt</th>
                      <th className="px-2 py-2 text-left font-semibold">Leistungsart</th>
                      <th className="px-2 py-2 text-left font-semibold">Beschreibung</th>
                      <th className="px-2 py-2 text-right font-semibold w-16">Std.</th>
                      <th className="px-2 py-2 text-right font-semibold w-20">Satz</th>
                      <th className="px-2 py-2 text-right font-semibold w-24">Wert</th>
                      <th className="px-2 py-2 text-left font-semibold w-24">Status</th>
                      <th className="px-2 py-2 text-right font-semibold w-20">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const h = Number(e.hours_internal ?? 0);
                      const rate = Number(e.rate_snapshot ?? 0);
                      const wert = h * rate;
                      const statusInfo = STATUS_CHIP[e.status] ?? STATUS_CHIP.erfasst;
                      const selectDisabled = e.status === 'verrechnet' || e.status === 'storniert';
                      const removeAllowed = e.status === 'erfasst';
                      const rowDimmed = e.status === 'verrechnet';
                      const selected = selectedIds.has(e.id);
                      return (
                        <tr
                          key={e.id}
                          className="border-t hover:bg-zinc-50"
                          style={{
                            borderColor: '#eef1ee',
                            opacity: rowDimmed ? 0.55 : 1,
                            background: selected ? '#f0f5f0' : undefined,
                          }}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={selectDisabled}
                              onChange={() => toggleOne(e.id, selectDisabled)}
                              style={{ accentColor: '#7a9b7f' }}
                            />
                          </td>
                          <td className="px-2 py-2 tabular-nums text-zinc-700">{fmt.date(e.entry_date)}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-zinc-800">{e.project?.name ?? '—'}</div>
                          </td>
                          <td className="px-2 py-2 text-zinc-600">{e.service_type?.name ?? '—'}</td>
                          <td className="px-2 py-2 text-zinc-600 max-w-xs truncate" title={e.description ?? ''}>
                            {e.description || <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmt.hours(h)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(rate)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium">{fmt.chf(wert)}</td>
                          <td className="px-2 py-2">
                            <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <IconBtn
                                title="Bearbeiten (Tagesansicht)"
                                onClick={() => toast.info('Bearbeiten folgt – bitte aktuell über Tagesansicht.')}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </IconBtn>
                              {removeAllowed ? (
                                <IconBtn
                                  title="Löschen"
                                  danger
                                  onClick={() => {
                                    if (window.confirm('Eintrag wirklich löschen?')) removeMut.mutate(e.id);
                                  }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </IconBtn>
                              ) : (
                                <span className="w-7 h-7 inline-block" />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {truncated && (
                  <div className="px-3 py-2 text-[11px] text-zinc-500 border-t" style={{ borderColor: '#eef1ee', background: '#fafbf9' }}>
                    … es werden nur die ersten {MAX_ROWS} von {entriesAll.length} Einträgen angezeigt. Bitte Filter einschränken.
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Summary</div>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Summe Std.</span>
                <span className="text-lg font-semibold tabular-nums">{fmt.hours(stats.hours)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Billable CHF</span>
                <span className="text-lg font-semibold tabular-nums" style={{ color: '#2d5a2d' }}>
                  {fmt.chf(stats.chfBillable)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Intern CHF</span>
                <span className="text-sm font-medium tabular-nums text-zinc-600">
                  {fmt.chf(stats.chfIntern)}
                </span>
              </div>
              <div className="flex items-baseline justify-between pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
                <span className="text-xs text-zinc-500">Einträge</span>
                <span className="text-sm font-medium">{stats.count}</span>
              </div>
              <div className="pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Zeitraum</div>
                <div className="text-xs text-zinc-700">{fmt.date(fromIso)} – {fmt.date(toIso)}</div>
              </div>
              {selectedIds.size > 0 && (
                <div className="pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
                  <Chip tone="green">
                    <Check className="w-3 h-3 mr-1" />
                    {selectedIds.size} selektiert
                  </Chip>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
