// Leistungserfassung · Tagesansicht
// Schnell-Rapport-Zeile oben (grün) + bestehende Einträge + Tages-Summary.
// Fokus: schnelle Tastatureingabe, Enter speichert, Fokus zurück auf Projekt.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, CalendarDays, CornerDownLeft,
  Pencil, Trash2, Check, X as XIcon, Info, Mail, Calendar, RefreshCw, Plus,
} from 'lucide-react';
import {
  leTimeEntry, leProject, leServiceType, leEmployee, currentEmployee,
  leRateGroupRate, leServiceRateHistory, resolveRateFor, leMs365Day,
} from '@/lib/leApi';
import {
  Chip, Card, IconBtn, Input, Select, PanelLoader, PanelError, PanelHeader,
  fmt, artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Helpers ---------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (iso, days) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const weekdayLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

// HH:MM → minutes
const toMin = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const diffHours = (from, to) => {
  const a = toMin(from); const b = toMin(to);
  if (a == null || b == null) return null;
  const diff = (b - a) / 60;
  return diff > 0 ? Math.round(diff * 100) / 100 : null;
};

// Rate-Ermittlung läuft über resolveRateFor(...) aus leApi.js – braucht
// die preloaded rate_group_rates + service_rate_history (siehe Panel).

const STATUS_CHIP = {
  erfasst:     { tone: 'neutral', label: 'erfasst' },
  freigegeben: { tone: 'green',   label: 'freigegeben' },
  verrechnet:  { tone: 'blue',    label: 'verrechnet' },
  storniert:   { tone: 'red',     label: 'storniert' },
};

// --- Panel -----------------------------------------------------------------

export default function TagesansichtPanel() {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(() => todayIso());
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);

  // Aktuellen MA initial auflösen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const emp = await currentEmployee();
        if (!cancelled) {
          if (emp?.id) setCurrentEmployeeId(emp.id);
          setEmployeeResolved(true);
        }
      } catch {
        if (!cancelled) setEmployeeResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Queries -------------------------------------------------------------
  const projectsQ = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const serviceTypesQ = useQuery({ queryKey: ['le', 'service_type'], queryFn: () => leServiceType.list() });
  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: () => leEmployee.list() });
  const rateGroupRatesQ = useQuery({ queryKey: ['le', 'rate_group_rate', 'all'], queryFn: () => leRateGroupRate.listAll() });
  const rateHistoryQ = useQuery({ queryKey: ['le', 'service_rate_history', 'all'], queryFn: () => leServiceRateHistory.listAll() });

  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', currentDate, currentEmployeeId],
    queryFn: () => leTimeEntry.listForDate(currentDate, { employeeId: currentEmployeeId }),
    enabled: !!currentEmployeeId,
  });

  const projects = projectsQ.data ?? [];
  const serviceTypes = serviceTypesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const rateGroupRates = rateGroupRatesQ.data ?? [];
  const serviceRateHistory = rateHistoryQ.data ?? [];

  // --- Mutations -----------------------------------------------------------
  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'time_entry', currentDate, currentEmployeeId] });

  const createMut = useMutation({
    mutationFn: (payload) => leTimeEntry.create(payload),
    onSuccess: () => { toast.success('Eintrag erfasst'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

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

  // --- Summary (muss VOR allen Early-Returns stehen – Hook-Rules) ----------
  const summary = useMemo(() => {
    let hours = 0; let chf = 0; let allFreigegeben = entries.length > 0;
    for (const e of entries) {
      const h = Number(e.hours_internal ?? 0);
      hours += h;
      const billable = e.service_type?.billable !== false;
      if (billable) chf += h * Number(e.rate_snapshot ?? 0);
      if (e.status !== 'freigegeben' && e.status !== 'verrechnet') allFreigegeben = false;
    }
    return { hours, chf, count: entries.length, allFreigegeben };
  }, [entries]);

  // --- Loading / Error -----------------------------------------------------
  const anyError = projectsQ.error || serviceTypesQ.error || entriesQ.error || employeesQ.error;
  if (!employeeResolved) return <PanelLoader />;
  if (anyError) return <PanelError error={anyError} onRetry={() => { projectsQ.refetch(); serviceTypesQ.refetch(); entriesQ.refetch(); employeesQ.refetch(); }} />;

  const loading = projectsQ.isLoading || serviceTypesQ.isLoading || (currentEmployeeId && entriesQ.isLoading);
  const noMasterData = !loading && (projects.length === 0 || serviceTypes.length === 0);

  // --- Render --------------------------------------------------------------
  return (
    <div className="space-y-4">
      <PanelHeader
        title="Tagesansicht"
        subtitle="Schnelle Leistungserfassung für den gewählten Tag"
        right={
          <>
            {!currentEmployeeId ? (
              <Select
                value=""
                onChange={(e) => setCurrentEmployeeId(e.target.value || null)}
                style={{ minWidth: 220 }}
              >
                <option value="">MA auswählen…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
                ))}
              </Select>
            ) : (
              <Chip tone="green">
                {employees.find((e) => e.id === currentEmployeeId)?.short_code ?? 'MA'}
              </Chip>
            )}
          </>
        }
      />

      {/* Datum-Navigation */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <IconBtn onClick={() => setCurrentDate(addDays(currentDate, -1))} title="Vortag">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button
            type="button"
            className={artisBtn.ghost}
            style={artisGhostStyle}
            onClick={() => setCurrentDate(todayIso())}
          >
            Heute
          </button>
          <IconBtn onClick={() => setCurrentDate(addDays(currentDate, 1))} title="Folgetag">
            <ChevronRight className="w-4 h-4" />
          </IconBtn>
          <div className="flex items-center gap-2 ml-2">
            <CalendarDays className="w-4 h-4 text-zinc-400" />
            <input
              type="date"
              value={currentDate}
              onChange={(e) => setCurrentDate(e.target.value || todayIso())}
              className="border rounded px-2 py-1.5 text-sm"
              style={{ borderColor: '#d9dfd9' }}
            />
          </div>
          <div className="ml-auto text-sm font-medium text-zinc-700 capitalize">
            {weekdayLabel(currentDate)}
          </div>
        </div>
      </Card>

      {noMasterData && (
        <div className="rounded-lg border p-4 flex items-start gap-2 text-sm" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Zuerst Stammdaten anlegen</div>
            <div className="text-xs mt-0.5">Bitte zuerst im Tab <b>Stammdaten</b> mindestens ein Projekt und eine Leistungsart erfassen.</div>
          </div>
        </div>
      )}

      {/* Schnell-Rapport-Zeile */}
      {!noMasterData && currentEmployeeId && (
        <QuickEntryCard
          projects={projects}
          serviceTypes={serviceTypes}
          rateGroupRates={rateGroupRates}
          serviceRateHistory={serviceRateHistory}
          currentDate={currentDate}
          onCreate={(payload) => createMut.mutateAsync({
            ...payload,
            entry_date: currentDate,
            employee_id: currentEmployeeId,
            status: 'erfasst',
          })}
        />
      )}

      {/* Einträge + Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider text-zinc-500" style={{ borderColor: '#e4e7e4' }}>
              Einträge des Tages
            </div>
            {loading ? (
              <PanelLoader />
            ) : entries.length === 0 ? (
              <div className="p-6 text-sm text-zinc-400 text-center">
                Noch keine Einträge an diesem Tag.
              </div>
            ) : (
              <EntriesTable
                entries={entries}
                projects={projects}
                serviceTypes={serviceTypes}
                onUpdate={(id, patch) => updateMut.mutateAsync({ id, patch })}
                onRemove={(id) => removeMut.mutateAsync(id)}
              />
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <SummaryCard summary={summary} />
          {currentEmployeeId && (
            <Ms365VorschlaegeCard
              date={currentDate}
              projects={projects}
              serviceTypes={serviceTypes}
              rateGroupRates={rateGroupRates}
              serviceRateHistory={serviceRateHistory}
              onCreate={(payload) => createMut.mutateAsync({
                ...payload,
                entry_date: currentDate,
                employee_id: currentEmployeeId,
                status: 'erfasst',
              })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- MS365-Vorschläge ------------------------------------------------------
// Lädt Outlook-Termine + gesendete Mails des Tages und erlaubt 1-Klick-Übernahme.
function Ms365VorschlaegeCard({ date, projects, serviceTypes, rateGroupRates, serviceRateHistory, onCreate }) {
  const dayQ = useQuery({
    queryKey: ['le', 'ms365-day', date],
    queryFn: () => leMs365Day(date),
    staleTime: 60_000,
    retry: false,
  });

  const data = dayQ.data;
  const calendar = data?.calendar ?? [];
  const sent = data?.sent ?? [];
  const notConnected = data?.notConnected;

  // Hilfsfunktion: Eintrag aus Vorschlag bauen
  const buildEntryFromCalendar = (cal) => {
    const project = pickProject(cal, projects);
    const serviceType = pickDefaultServiceType(serviceTypes);
    const hours = computeHours(cal.start, cal.end);
    const rate = resolveRateFor({
      serviceTypeId: serviceType?.id,
      rateGroupId: project?.rate_group_id ?? null,
      date,
      rateGroupRates,
      serviceRateHistory,
    });
    const fromTime = cal.start ? cal.start.slice(11, 16) : null;
    const toTime = cal.end ? cal.end.slice(11, 16) : null;
    return {
      project_id: project?.id ?? null,
      service_type_id: serviceType?.id ?? null,
      time_from: fromTime,
      time_to: toTime,
      hours_internal: hours,
      rate_snapshot: rate || 0,
      description: cal.subject,
    };
  };

  const buildEntryFromMail = (m) => {
    const project = pickProject(m, projects);
    const serviceType = pickDefaultServiceType(serviceTypes);
    const rate = resolveRateFor({
      serviceTypeId: serviceType?.id,
      rateGroupId: project?.rate_group_id ?? null,
      date,
      rateGroupRates,
      serviceRateHistory,
    });
    return {
      project_id: project?.id ?? null,
      service_type_id: serviceType?.id ?? null,
      time_from: m.sentDateTime ? m.sentDateTime.slice(11, 16) : null,
      time_to: null,
      hours_internal: 0.25,
      rate_snapshot: rate || 0,
      description: `Mail: ${m.subject}`,
    };
  };

  const handleAdopt = async (raw) => {
    if (!raw.project_id || !raw.service_type_id) {
      toast.error('Kein Projekt/Leistungsart zuordenbar – bitte manuell erfassen.');
      return;
    }
    try {
      await onCreate(raw);
    } catch { /* toast aus mutation */ }
  };

  return (
    <Card>
      <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4' }}>
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          MS365 · Tagesvorschläge
        </div>
        <button
          onClick={() => dayQ.refetch()}
          className="text-zinc-400 hover:text-zinc-700 transition-colors"
          title="Aktualisieren"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${dayQ.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {dayQ.isLoading ? (
        <div className="p-4 text-xs text-zinc-400">Lade Outlook-Daten…</div>
      ) : dayQ.error ? (
        <div className="p-4 text-xs text-orange-700 bg-orange-50">
          {String(dayQ.error?.message ?? dayQ.error)}
        </div>
      ) : notConnected ? (
        <div className="p-4 text-xs text-zinc-500">
          Outlook nicht verbunden. Verbinde dich im Posteingang mit Microsoft 365, um Vorschläge zu sehen.
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: '#eef1ee' }}>
          {/* Kalender */}
          <div className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600 mb-2">
              <Calendar className="w-3.5 h-3.5" /> Kalender ({calendar.length})
            </div>
            {calendar.length === 0 ? (
              <div className="text-xs text-zinc-400 italic">Keine Termine.</div>
            ) : (
              <ul className="space-y-1.5">
                {calendar.map((c) => (
                  <SuggestionItem
                    key={c.id}
                    title={c.subject || '(ohne Titel)'}
                    subtitle={[
                      c.start && c.end ? `${c.start.slice(11,16)}–${c.end.slice(11,16)}` : null,
                      c.customer?.company_name,
                      c.location,
                    ].filter(Boolean).join(' · ')}
                    customerMatched={!!c.customer}
                    onAdopt={() => handleAdopt(buildEntryFromCalendar(c))}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Sent */}
          <div className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600 mb-2">
              <Mail className="w-3.5 h-3.5" /> Gesendete Mails ({sent.length})
            </div>
            {sent.length === 0 ? (
              <div className="text-xs text-zinc-400 italic">Keine gesendeten Mails.</div>
            ) : (
              <ul className="space-y-1.5">
                {sent.map((m) => (
                  <SuggestionItem
                    key={m.id}
                    title={m.subject || '(ohne Betreff)'}
                    subtitle={[
                      m.sentDateTime ? m.sentDateTime.slice(11,16) : null,
                      m.customer?.company_name,
                      m.to?.[0]?.email,
                    ].filter(Boolean).join(' · ')}
                    customerMatched={!!m.customer}
                    onAdopt={() => handleAdopt(buildEntryFromMail(m))}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SuggestionItem({ title, subtitle, customerMatched, onAdopt }) {
  return (
    <li className="flex items-start gap-2 group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-zinc-700 truncate">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 truncate">{subtitle}</div>}
      </div>
      <button
        onClick={onAdopt}
        title={customerMatched ? 'Übernehmen' : 'Übernehmen (Kunde nicht erkannt)'}
        className="opacity-50 group-hover:opacity-100 transition-opacity flex items-center justify-center w-6 h-6 rounded border"
        style={{
          borderColor: customerMatched ? '#bfd3bf' : '#e4e7e4',
          background: customerMatched ? '#e6ede6' : '#fff',
          color: customerMatched ? '#2d5a2d' : '#999',
        }}
      >
        <Plus className="w-3 h-3" />
      </button>
    </li>
  );
}

// --- Hilfsfunktionen für Vorschlag→Eintrag --------------------------------
function pickProject(suggestion, projects) {
  // 1. Wenn Backend genau 1 Projekt vorschlägt → das nehmen
  const sp = suggestion.suggestedProjects;
  if (sp?.length === 1) {
    return projects.find(p => p.id === sp[0].id) ?? sp[0];
  }
  // 2. Wenn mehrere – das mit "BWL" im Namen bevorzugen
  if (sp?.length > 1) {
    const bwl = sp.find(p => /BWL/i.test(p.name));
    return projects.find(p => p.id === (bwl ?? sp[0]).id) ?? sp[0];
  }
  return null;
}

function pickDefaultServiceType(serviceTypes) {
  // Bevorzugt: Beratung (BER), sonst erste billable
  return (
    serviceTypes.find(s => s.code === 'BER')
    ?? serviceTypes.find(s => s.billable)
    ?? serviceTypes[0]
    ?? null
  );
}

function computeHours(startIso, endIso) {
  if (!startIso || !endIso) return 0.5;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0.5;
  return Math.round((ms / 3600000) * 100) / 100;
}

// --- Schnell-Rapport -------------------------------------------------------

function QuickEntryCard({ projects, serviceTypes, rateGroupRates, serviceRateHistory, currentDate, onCreate }) {
  const projectRef = useRef(null);
  const [row, setRow] = useState(() => emptyRow());

  function emptyRow() {
    return {
      time_from: '',
      time_to: '',
      project_id: '',
      service_type_id: '',
      hours_internal: '',
      description: '',
      rate_snapshot: '',
      rate_touched: false,
    };
  }

  const project = projects.find((p) => p.id === row.project_id);
  const serviceType = serviceTypes.find((s) => s.id === row.service_type_id);

  // Auto-Satz setzen wenn Projekt/Leistungsart wechselt und User Satz nicht manuell geändert hat
  useEffect(() => {
    if (row.rate_touched) return;
    if (!row.service_type_id) return;
    const r = resolveRateFor({
      serviceTypeId: row.service_type_id,
      rateGroupId: project?.rate_group_id ?? null,
      date: currentDate,
      rateGroupRates,
      serviceRateHistory,
    });
    if (r > 0) setRow((prev) => ({ ...prev, rate_snapshot: String(r) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.project_id, row.service_type_id, currentDate]);

  // Stunden automatisch aus von/bis
  useEffect(() => {
    const h = diffHours(row.time_from, row.time_to);
    if (h != null) setRow((prev) => ({ ...prev, hours_internal: String(h) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.time_from, row.time_to]);

  const hoursNum = Number(row.hours_internal || 0);
  const rateNum = Number(row.rate_snapshot || 0);
  const wert = hoursNum * rateNum;

  const canSave = !!row.project_id && !!row.service_type_id && hoursNum > 0;

  const save = async () => {
    if (!canSave) {
      toast.error('Projekt, Leistungsart und Stunden sind Pflicht.');
      return;
    }
    const payload = {
      project_id: row.project_id,
      service_type_id: row.service_type_id,
      time_from: row.time_from || null,
      time_to: row.time_to || null,
      hours_internal: hoursNum,
      rate_snapshot: rateNum || 0,
      description: row.description || null,
    };
    try {
      await onCreate(payload);
      setRow(emptyRow());
      setTimeout(() => projectRef.current?.focus(), 30);
    } catch { /* toast kommt aus mutation */ }
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  };

  return (
    <Card
      className="overflow-hidden"
      style={{ borderColor: '#bfd3bf', background: '#f5faf5' }}
    >
      <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider" style={{ borderColor: '#bfd3bf', color: '#2d5a2d', background: '#e6ede6' }}>
        Schnell-Rapport
      </div>
      <div className="p-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="text-left font-semibold px-1 py-1 w-20">Von</th>
              <th className="text-left font-semibold px-1 py-1 w-20">Bis</th>
              <th className="text-left font-semibold px-1 py-1">Projekt</th>
              <th className="text-left font-semibold px-1 py-1">Leistungsart</th>
              <th className="text-left font-semibold px-1 py-1 w-20">Std.</th>
              <th className="text-left font-semibold px-1 py-1">Beschreibung</th>
              <th className="text-left font-semibold px-1 py-1 w-20">Satz</th>
              <th className="text-right font-semibold px-1 py-1 w-24">Wert</th>
              <th className="px-1 py-1 w-10" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-1 py-1">
                <Input type="time" value={row.time_from} onChange={(e) => setRow({ ...row, time_from: e.target.value })} />
              </td>
              <td className="px-1 py-1">
                <Input type="time" value={row.time_to} onChange={(e) => setRow({ ...row, time_to: e.target.value })} />
              </td>
              <td className="px-1 py-1">
                <Select
                  ref={projectRef}
                  value={row.project_id}
                  onChange={(e) => setRow({ ...row, project_id: e.target.value })}
                >
                  <option value="">– Projekt –</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.customer?.company_name ? ` · ${p.customer.company_name}` : ''}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-1 py-1">
                <Select
                  value={row.service_type_id}
                  onChange={(e) => setRow({ ...row, service_type_id: e.target.value })}
                >
                  <option value="">– Leistungsart –</option>
                  {serviceTypes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </td>
              <td className="px-1 py-1">
                <Input
                  type="number" step="0.25" min="0"
                  value={row.hours_internal}
                  onChange={(e) => setRow({ ...row, hours_internal: e.target.value })}
                  onKeyDown={onKey}
                />
              </td>
              <td className="px-1 py-1">
                <Input
                  value={row.description}
                  onChange={(e) => setRow({ ...row, description: e.target.value })}
                  onKeyDown={onKey}
                  placeholder="Kurzbeschrieb…"
                />
              </td>
              <td className="px-1 py-1">
                <Input
                  type="number" step="1" min="0"
                  value={row.rate_snapshot}
                  onChange={(e) => setRow({ ...row, rate_snapshot: e.target.value, rate_touched: true })}
                />
              </td>
              <td className="px-1 py-1 text-right tabular-nums text-zinc-700">
                {fmt.chf(wert)}
              </td>
              <td className="px-1 py-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave}
                  title="Eintrag speichern (Enter)"
                  className={artisBtn.primary}
                  style={{ ...artisPrimaryStyle, opacity: canSave ? 1 : 0.45, padding: '6px 10px' }}
                >
                  <CornerDownLeft className="w-4 h-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- Einträge-Tabelle ------------------------------------------------------

function EntriesTable({ entries, projects, serviceTypes, onUpdate, onRemove }) {
  const [editingId, setEditingId] = useState(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4' }}>
            <th className="text-left font-semibold px-3 py-2 w-28">Zeit</th>
            <th className="text-left font-semibold px-3 py-2">Projekt</th>
            <th className="text-left font-semibold px-3 py-2">Leistungsart</th>
            <th className="text-left font-semibold px-3 py-2">Beschreibung</th>
            <th className="text-right font-semibold px-3 py-2 w-16">Std.</th>
            <th className="text-right font-semibold px-3 py-2 w-20">Satz</th>
            <th className="text-right font-semibold px-3 py-2 w-24">Wert</th>
            <th className="text-left font-semibold px-3 py-2 w-24">Status</th>
            <th className="text-right font-semibold px-3 py-2 w-24">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            editingId === e.id ? (
              <EditRow
                key={e.id}
                entry={e}
                projects={projects}
                serviceTypes={serviceTypes}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => { await onUpdate(e.id, patch); setEditingId(null); }}
              />
            ) : (
              <ReadRow
                key={e.id}
                entry={e}
                onEdit={() => setEditingId(e.id)}
                onRemove={async () => {
                  if (window.confirm('Eintrag wirklich löschen?')) await onRemove(e.id);
                }}
              />
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadRow({ entry, onEdit, onRemove }) {
  const val = Number(entry.hours_internal ?? 0) * Number(entry.rate_snapshot ?? 0);
  const statusInfo = STATUS_CHIP[entry.status] ?? STATUS_CHIP.erfasst;
  const zeit = entry.time_from && entry.time_to ? `${entry.time_from.slice(0,5)}–${entry.time_to.slice(0,5)}` : '—';
  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: '#eef1ee' }}>
      <td className="px-3 py-2 tabular-nums text-zinc-600">{zeit}</td>
      <td className="px-3 py-2">{entry.project?.name ?? '—'}</td>
      <td className="px-3 py-2">{entry.service_type?.name ?? '—'}</td>
      <td className="px-3 py-2 text-zinc-600">{entry.description || <span className="text-zinc-300">—</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt.hours(entry.hours_internal)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{fmt.chf(entry.rate_snapshot)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt.chf(val)}</td>
      <td className="px-3 py-2"><Chip tone={statusInfo.tone}>{statusInfo.label}</Chip></td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <IconBtn onClick={onEdit} title="Bearbeiten"><Pencil className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn onClick={onRemove} title="Löschen" danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </td>
    </tr>
  );
}

function EditRow({ entry, projects, serviceTypes, onCancel, onSave }) {
  const [form, setForm] = useState({
    time_from: entry.time_from ? entry.time_from.slice(0, 5) : '',
    time_to: entry.time_to ? entry.time_to.slice(0, 5) : '',
    project_id: entry.project_id ?? '',
    service_type_id: entry.service_type_id ?? '',
    hours_internal: entry.hours_internal ?? '',
    description: entry.description ?? '',
    rate_snapshot: entry.rate_snapshot ?? '',
  });

  useEffect(() => {
    const h = diffHours(form.time_from, form.time_to);
    if (h != null) setForm((prev) => ({ ...prev, hours_internal: h }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.time_from, form.time_to]);

  const save = () => {
    onSave({
      time_from: form.time_from || null,
      time_to: form.time_to || null,
      project_id: form.project_id,
      service_type_id: form.service_type_id,
      hours_internal: Number(form.hours_internal || 0),
      description: form.description || null,
      rate_snapshot: Number(form.rate_snapshot || 0),
    });
  };

  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: '#eef1ee', background: '#fafbf9' }}>
      <td className="px-2 py-1">
        <div className="flex gap-1">
          <Input type="time" value={form.time_from} onChange={(e) => setForm({ ...form, time_from: e.target.value })} />
          <Input type="time" value={form.time_to} onChange={(e) => setForm({ ...form, time_to: e.target.value })} />
        </div>
      </td>
      <td className="px-2 py-1" colSpan={1}>
        <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </td>
      <td className="px-2 py-1">
        <Select value={form.service_type_id} onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}>
          {serviceTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </td>
      <td className="px-2 py-1">
        <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </td>
      <td className="px-2 py-1">
        <Input type="number" step="0.25" min="0" value={form.hours_internal} onChange={(e) => setForm({ ...form, hours_internal: e.target.value })} />
      </td>
      <td className="px-2 py-1">
        <Input type="number" step="1" min="0" value={form.rate_snapshot} onChange={(e) => setForm({ ...form, rate_snapshot: e.target.value })} />
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">
        {fmt.chf(Number(form.hours_internal || 0) * Number(form.rate_snapshot || 0))}
      </td>
      <td className="px-2 py-1 text-[10px] text-zinc-400">bearbeiten…</td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-end gap-1">
          <IconBtn onClick={save} title="Speichern"><Check className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn onClick={onCancel} title="Abbrechen"><XIcon className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </td>
    </tr>
  );
}

// --- Summary-Card ----------------------------------------------------------

function SummaryCard({ summary }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Tages-Summary</div>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Summe Std.</span>
          <span className="text-lg font-semibold tabular-nums">{fmt.hours(summary.hours)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Summe CHF (abrechenbar)</span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: '#2d5a2d' }}>
            {fmt.chf(summary.chf)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">Einträge</span>
          <span className="text-sm font-medium">{summary.count}</span>
        </div>
        <div className="pt-2 border-t" style={{ borderColor: '#eef1ee' }}>
          {summary.count === 0 ? (
            <Chip tone="neutral">noch leer</Chip>
          ) : summary.allFreigegeben ? (
            <Chip tone="green">freigegeben</Chip>
          ) : (
            <Chip tone="orange">Freigabe offen</Chip>
          )}
        </div>
      </div>
    </Card>
  );
}
