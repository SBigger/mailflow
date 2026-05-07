// Leistungserfassung · Tagesansicht V2 (3-Spalten-Layout)
// =====================================================================
// Links:  Outlook-Kalender mit Zeitleiste 7-19 Uhr, Termine als Boxen
// Mitte:  Schnell-Rapport (Tab: Von → Bis → Projekt → Leistungsart →
//         Beschreibung → ENTER) + Tabelle der Tageseinträge
// Rechts: Gesendete Mails des Tages (mit Customer-Match) + Tages-Summary
//
// Fokus: schnelle Tastatureingabe, Enter speichert + Fokus zurück auf
// "Von"-Zeit. Stunden auto-berechnet aus Von/Bis (15-Min-Raster).

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
  Chip, Card, IconBtn, Input, Select, Combobox, PanelLoader, PanelError, PanelHeader,
  fmt, artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Helpers ---------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

const STATUS_CHIP = {
  erfasst:     { tone: 'neutral', label: 'erfasst' },
  freigegeben: { tone: 'green',   label: 'freigegeben' },
  verrechnet:  { tone: 'blue',    label: 'verrechnet' },
  storniert:   { tone: 'red',     label: 'storniert' },
};

// Kalender-Zeitleiste: 7-19 Uhr (Pixel pro Stunde = 40)
const CAL_START_HOUR = 7;
const CAL_END_HOUR = 19;
const PX_PER_HOUR = 40;
const PX_PER_MIN = PX_PER_HOUR / 60;

const calTopFromTime = (timeIso) => {
  if (!timeIso) return 0;
  // timeIso kann ISO-Datetime sein "2026-04-30T08:00:00" oder reine Zeit "08:00"
  const t = String(timeIso);
  const hhmm = t.includes('T') ? t.slice(11, 16) : t.slice(0, 5);
  const mins = toMin(hhmm);
  if (mins == null) return 0;
  return Math.max(0, (mins - CAL_START_HOUR * 60) * PX_PER_MIN);
};

const calHeightFromTimes = (startIso, endIso) => {
  const a = toMin(String(startIso || '').slice(11, 16));
  const b = toMin(String(endIso || '').slice(11, 16));
  if (a == null || b == null) return 30;
  return Math.max(20, (b - a) * PX_PER_MIN);
};

const timeFromIso = (iso) => {
  if (!iso) return null;
  return String(iso).includes('T') ? String(iso).slice(11, 16) : String(iso).slice(0, 5);
};

// 15-Minuten-Runden für UX
const roundTo15 = (hhmm) => {
  if (!hhmm) return hhmm;
  const m = toMin(hhmm);
  if (m == null) return hhmm;
  const rounded = Math.round(m / 15) * 15;
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};

// --- Panel -----------------------------------------------------------------

export default function TagesansichtPanel() {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(() => todayIso());
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);

  // Quick-Form-State (für Inline-Befüllung von Calendar/Mail-Übernahme)
  const [prefill, setPrefill] = useState(null); // { time_from, time_to, project_id, service_type_id, description, ... }

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

  // Queries
  const projectsQ        = useQuery({ queryKey: ['le', 'project'],         queryFn: () => leProject.list() });
  const serviceTypesQ    = useQuery({ queryKey: ['le', 'service_type'],    queryFn: () => leServiceType.list() });
  const employeesQ       = useQuery({ queryKey: ['le', 'employee'],        queryFn: () => leEmployee.list() });
  const rateGroupRatesQ  = useQuery({ queryKey: ['le', 'rate_group_rate', 'all'], queryFn: () => leRateGroupRate.listAll() });
  const rateHistoryQ     = useQuery({ queryKey: ['le', 'service_rate_history', 'all'], queryFn: () => leServiceRateHistory.listAll() });

  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', currentDate, currentEmployeeId],
    queryFn: () => leTimeEntry.listForDate(currentDate, { employeeId: currentEmployeeId }),
    enabled: !!currentEmployeeId,
  });

  const ms365Q = useQuery({
    queryKey: ['le', 'ms365-day', currentDate],
    queryFn: () => leMs365Day(currentDate),
    enabled: !!currentEmployeeId,
    staleTime: 60_000,
    retry: false,
  });

  const projects = projectsQ.data ?? [];
  const serviceTypes = serviceTypesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const entries = entriesQ.data ?? [];
  const rateGroupRates = rateGroupRatesQ.data ?? [];
  const serviceRateHistory = rateHistoryQ.data ?? [];
  const ms365Data = ms365Q.data ?? { calendar: [], sent: [], notConnected: false };

  // Mutations
  const invalidateEntries = () => qc.invalidateQueries({ queryKey: ['le', 'time_entry', currentDate, currentEmployeeId] });

  const createMut = useMutation({
    mutationFn: (payload) => leTimeEntry.create(payload),
    onSuccess: () => { toast.success('Eintrag erfasst'); invalidateEntries(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leTimeEntry.update(id, patch),
    onSuccess: () => { toast.success('Gespeichert'); invalidateEntries(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leTimeEntry.remove(id),
    onSuccess: () => { toast.success('Gelöscht'); invalidateEntries(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // Summary (vor early-returns – Hook-Rules)
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

  const anyError = projectsQ.error || serviceTypesQ.error || entriesQ.error || employeesQ.error;
  if (!employeeResolved) return <PanelLoader />;
  if (anyError) return <PanelError error={anyError} onRetry={() => { projectsQ.refetch(); serviceTypesQ.refetch(); entriesQ.refetch(); employeesQ.refetch(); }} />;

  const loading = projectsQ.isLoading || serviceTypesQ.isLoading || (currentEmployeeId && entriesQ.isLoading);
  const noMasterData = !loading && (projects.length === 0 || serviceTypes.length === 0);

  // Calendar/Mail-Übernahme → fülle Quick-Form vor
  const adoptFromCalendar = (cal) => {
    const project = pickProject(cal, projects);
    const serviceType = pickDefaultServiceType(serviceTypes);
    const fromT = roundTo15(timeFromIso(cal.start) || '');
    const toT   = roundTo15(timeFromIso(cal.end) || '');
    setPrefill({
      time_from: fromT,
      time_to: toT,
      project_id: project?.id ?? '',
      service_type_id: serviceType?.id ?? '',
      description: cal.subject || '',
    });
    toast.info('Übernommen – ENTER zum Speichern');
  };

  const adoptFromMail = (m) => {
    const project = pickProject(m, projects);
    const serviceType = pickDefaultServiceType(serviceTypes);
    const sentTime = timeFromIso(m.sentDateTime) || '';
    // Default 15 Min ab Sendezeit
    const sentMin = toMin(sentTime);
    const endMin = sentMin != null ? sentMin + 15 : null;
    const toT = endMin != null ? `${String(Math.floor(endMin / 60)).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}` : '';
    setPrefill({
      time_from: sentTime,
      time_to: toT,
      project_id: project?.id ?? '',
      service_type_id: serviceType?.id ?? '',
      description: `Mail: ${m.subject || ''}`,
    });
    toast.info('Übernommen – ENTER zum Speichern');
  };

  return (
    <div className="space-y-3">
      {/* Datum-Navigation + MA-Selector (integriert) */}
      <Card className="px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <IconBtn onClick={() => setCurrentDate(addDays(currentDate, -1))} title="Vortag">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button type="button" className={artisBtn.ghost} style={artisGhostStyle} onClick={() => setCurrentDate(todayIso())}>
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
          <div className="text-sm font-medium text-zinc-700 capitalize ml-2">
            {weekdayLabel(currentDate)}
          </div>
          {/* MA-Selector ganz rechts – Klick auf Namen wechselt MA */}
          <div className="ml-auto">
            <Select
              value={currentEmployeeId ?? ''}
              onChange={(e) => setCurrentEmployeeId(e.target.value || null)}
              style={{ minWidth: 200, fontWeight: 600, color: '#2d5a2d', borderColor: '#bfd3bf', background: '#f5faf5' }}
              title="Mitarbeiter wechseln"
            >
              <option value="">– MA auswählen –</option>
              {employees
                .filter((emp) => emp.active !== false)
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
                ))}
            </Select>
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

      {/* ZEILE 1: Schnell-Erfassung volle Breite */}
      {!noMasterData && currentEmployeeId && (
        <QuickEntryCard
          projects={projects}
          serviceTypes={serviceTypes}
          rateGroupRates={rateGroupRates}
          serviceRateHistory={serviceRateHistory}
          currentDate={currentDate}
          prefill={prefill}
          employee={employees.find((e) => e.id === currentEmployeeId)}
          onConsumePrefill={() => setPrefill(null)}
          onCreate={(payload) => createMut.mutateAsync({
            entry_date: currentDate,
            employee_id: currentEmployeeId,
            status: 'erfasst',
            ...payload, // payload.status kann 'kulant' überschreiben
          })}
        />
      )}

      {/* ZEILE 2: Tageseinträge volle Breite mit inline-Summary */}
      <Card>
        <div className="px-4 py-2 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: '#e4e7e4' }}>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Einträge des Tages ({entries.length})
          </div>
          <div className="flex items-center gap-4 text-xs">
            <SummaryStat label="Total Zeit" value={`${fmt.hours(summary.hours)} h`} />
            <SummaryStat label="Total CHF" value={fmt.chf(summary.chf)} accent />
          </div>
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

      {/* ZEILE 3: Kalender + Mails nebeneinander */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-6">
          <CalendarColumn
            calendar={ms365Data.calendar}
            notConnected={ms365Data.notConnected}
            hint={ms365Data.hint}
            calendarError={ms365Data.calendarError}
            loading={ms365Q.isLoading}
            error={ms365Q.error}
            onRefresh={() => ms365Q.refetch()}
            onAdopt={adoptFromCalendar}
          />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <SentMailsCard
            sent={ms365Data.sent}
            notConnected={ms365Data.notConnected}
            hint={ms365Data.hint}
            sentError={ms365Data.sentError}
            loading={ms365Q.isLoading}
            onAdopt={adoptFromMail}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Kalender-Spalte (links)
// ============================================================================
function CalendarColumn({ calendar, notConnected, hint, calendarError, loading, error, onRefresh, onAdopt }) {
  const totalHours = CAL_END_HOUR - CAL_START_HOUR;
  const hours = Array.from({ length: totalHours + 1 }, (_, i) => CAL_START_HOUR + i);

  // Aktuelle Zeit-Linie
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMins >= CAL_START_HOUR * 60 && nowMins <= CAL_END_HOUR * 60;
  const nowTop = (nowMins - CAL_START_HOUR * 60) * PX_PER_MIN;

  return (
    <Card className="overflow-hidden flex flex-col" style={{ height: 540 }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
          <Calendar className="w-3.5 h-3.5" /> Outlook-Kalender
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400">{calendar.length} Termine</span>
          <button onClick={onRefresh} className="text-zinc-400 hover:text-zinc-700" title="Aktualisieren">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-xs text-zinc-400">Lade Outlook-Kalender…</div>
      ) : error ? (
        <div className="p-4 text-xs text-orange-700">{String(error?.message ?? error)}</div>
      ) : notConnected ? (
        <div className="p-4 text-xs text-zinc-600">
          {hint || 'Outlook nicht verbunden. Verbinde im Posteingang um Kalender + Mails zu sehen.'}
        </div>
      ) : calendarError ? (
        <div className="p-4 text-xs text-orange-700">
          <div className="font-semibold">Kalender konnte nicht geladen werden:</div>
          <div className="mt-1">{calendarError}</div>
          <div className="mt-2 text-zinc-500">Tipp: Im Posteingang Outlook trennen + neu verbinden, damit Calendar-Scope freigegeben wird.</div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto relative">
          <div className="flex">
            {/* Stunden-Beschriftungen */}
            <div className="w-10 text-[10px] text-zinc-400 text-right pr-2 pt-1 border-r flex-shrink-0" style={{ borderColor: '#eef1ee' }}>
              {hours.map(h => (
                <div key={h} style={{ height: PX_PER_HOUR }}>{String(h).padStart(2, '0')}</div>
              ))}
            </div>

            {/* Termin-Spalte */}
            <div className="flex-1 relative" style={{
              height: totalHours * PX_PER_HOUR,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR}px)`,
            }}>
              {/* Aktuelle Zeit-Linie */}
              {showNowLine && (
                <div className="absolute left-0 right-0 flex items-center pointer-events-none z-10" style={{ top: nowTop }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                  <div className="flex-1 h-px bg-red-500"></div>
                </div>
              )}

              {/* Termine */}
              {calendar.map((c) => {
                const top = calTopFromTime(c.start);
                const height = calHeightFromTimes(c.start, c.end);
                const isAllDay = c.isAllDay;
                if (isAllDay) return null; // separate Liste oben wäre besser, hier ausblenden
                return <CalendarEvent key={c.id} event={c} top={top} height={height} onAdopt={onAdopt} />;
              })}
            </div>
          </div>
        </div>
      )}

      <div className="px-3 py-2 border-t flex items-center gap-2 text-[10px] text-zinc-500" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
        <span className="inline-block w-2 h-2 rounded" style={{ background: '#e3eaf5', border: '1px solid #b8c9e0' }}></span>Outlook
        <span className="text-zinc-400 ml-auto">Klick auf Termin → Übernehmen</span>
      </div>
    </Card>
  );
}

function CalendarEvent({ event, top, height, onAdopt }) {
  const start = timeFromIso(event.start);
  const end = timeFromIso(event.end);
  const matched = !!event.customer;
  return (
    <div
      onClick={() => onAdopt(event)}
      className="absolute left-1 right-1 border rounded p-1 text-[10px] cursor-pointer hover:shadow group transition-shadow"
      style={{
        top, height,
        background: matched ? '#e3eaf5' : '#f1f1ef',
        borderColor: matched ? '#b8c9e0' : '#dcdcd4',
        color: matched ? '#2e4a7d' : '#4a4a4a',
        overflow: 'hidden',
      }}
      title={`${event.subject || ''} ${matched ? '· ' + event.customer.company_name : ''}`}
    >
      <div className="font-semibold truncate">{event.subject || '(ohne Titel)'}</div>
      <div className="text-[9px] opacity-75 truncate">
        {start && end ? `${start}–${end}` : ''}
        {event.customer?.company_name ? ` · ${event.customer.company_name}` : ''}
      </div>
      <button
        className="hidden group-hover:flex absolute right-1 top-1 px-1.5 py-0.5 text-[9px] rounded items-center gap-0.5"
        style={{ background: '#7a9b7f', color: '#fff' }}
      >
        <Plus className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

// ============================================================================
// Schnell-Rapport (Mitte, oben)
// ============================================================================

function QuickEntryCard({
  projects, serviceTypes, rateGroupRates, serviceRateHistory,
  currentDate, prefill, onConsumePrefill, onCreate, employee,
}) {
  const fromRef = useRef(null);
  const hoursRef = useRef(null);
  const projectRef = useRef(null);
  const [row, setRow] = useState(() => emptyRow());

  // Modus: Von/Bis-Zeit erfassen (true) oder direkt Stunden (false)
  // Persistiert pro User in localStorage.
  const [useTimeRange, setUseTimeRange] = useState(() => {
    try {
      const v = localStorage.getItem('le.quickEntry.useTimeRange');
      return v === null ? true : v === 'true';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('le.quickEntry.useTimeRange', String(useTimeRange)); } catch {}
  }, [useTimeRange]);

  function emptyRow() {
    return {
      time_from: '', time_to: '',
      project_id: '', service_type_id: '',
      hours_internal: '', description: '',
      rate_snapshot: '', status: 'erfasst',
      rate_touched: false, hours_touched: false,
    };
  }

  // Prefill aus Kalender/Mail-Übernahme einspielen
  useEffect(() => {
    if (!prefill) return;
    setRow((prev) => ({
      ...prev,
      ...prefill,
      rate_touched: false,
    }));
    // Fokus auf Beschreibung damit User direkt anpassen kann
    setTimeout(() => {
      const el = document.querySelector('[data-quick-desc]');
      el?.focus();
    }, 50);
    onConsumePrefill?.();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = projects.find((p) => p.id === row.project_id);

  // Auto-Satz wenn Projekt/Leistungsart wechselt – nutzt rate_mode des Projekts
  useEffect(() => {
    if (row.rate_touched) return;
    if (!project) return;
    const r = resolveRateFor({
      project,
      employee,
      serviceTypeId: row.service_type_id,
      rateGroupId: project?.rate_group_id ?? null,
      date: currentDate,
      rateGroupRates,
      serviceRateHistory,
    });
    if (r > 0) setRow((prev) => ({ ...prev, rate_snapshot: String(r) }));
  }, [row.project_id, row.service_type_id, currentDate, employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stunden auto aus Von/Bis (nur wenn Zeitmodus aktiv und User Stunden NICHT manuell überschrieben)
  useEffect(() => {
    if (!useTimeRange) return;
    if (row.hours_touched) return;
    const h = diffHours(row.time_from, row.time_to);
    if (h != null) setRow((prev) => ({ ...prev, hours_internal: String(h) }));
  }, [row.time_from, row.time_to, useTimeRange]); // eslint-disable-line react-hooks/exhaustive-deps

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
      status: row.status || 'erfasst',
    };
    try {
      await onCreate(payload);
      setRow(emptyRow());
      // Fokus zurück auf Projekt-Feld – User-Wunsch (häufigstes nächstes Feld)
      setTimeout(() => projectRef.current?.focus(), 30);
    } catch { /* toast aus mutation */ }
  };

  const onKeyEnter = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  };

  // Spalten-Templates je nach Modus
  // Reihenfolge: Von | Bis | Projekt | Leistungsart | Zeit | Satz | Wert | Beschreibung | Speichern
  const gridCols = useTimeRange
    ? '60px 60px 2fr 1fr 70px 70px 90px 3fr 40px'
    : '2fr 1fr 70px 70px 90px 3fr 40px';

  return (
    <Card className="overflow-hidden" style={{ borderColor: '#bfd3bf', background: '#f5faf5' }}>
      <div className="px-4 py-2 border-b flex items-center justify-between gap-3"
        style={{ borderColor: '#bfd3bf', color: '#2d5a2d', background: '#e6ede6' }}>
        <div className="text-xs font-semibold uppercase tracking-wider">
          Schnell-Rapport · {useTimeRange
            ? 'Tab: Von → Bis → Projekt → Leistungsart → Zeit → Satz → Beschreibung → ENTER'
            : 'Tab: Projekt → Leistungsart → Zeit → Satz → Beschreibung → ENTER'}
        </div>
        {/* Toggle Modus */}
        <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useTimeRange}
            onChange={(e) => setUseTimeRange(e.target.checked)}
            className="cursor-pointer"
          />
          Von/Bis-Zeit erfassen
        </label>
      </div>
      <div className="p-3">
        {/* Header – Reihenfolge: Von | Bis | Projekt | Leistungsart | Zeit | Satz | Wert | Beschreibung | Speichern */}
        <div className="grid gap-1.5 mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500"
          style={{ gridTemplateColumns: gridCols }}>
          {useTimeRange && <><div>Von</div><div>Bis</div></>}
          <div>Projekt <span className="text-red-500">*</span></div>
          <div>Leistungsart <span className="text-red-500">*</span></div>
          <div className="text-right">Zeit <span className="text-red-500">*</span></div>
          <div className="text-right">Satz</div>
          <div className="text-right">Total</div>
          <div>Beschreibung</div>
          <div></div>
        </div>
        {/* Eingabe-Zeile */}
        <div className="grid gap-1.5 items-center"
          style={{ gridTemplateColumns: gridCols }}>
          {useTimeRange && (
            <>
              <Input
                ref={fromRef}
                tabIndex={1}
                type="time"
                value={row.time_from}
                onChange={(e) => setRow({ ...row, time_from: e.target.value })}
                onKeyDown={onKeyEnter}
              />
              <Input
                tabIndex={2}
                type="time"
                value={row.time_to}
                onChange={(e) => setRow({ ...row, time_to: e.target.value })}
                onKeyDown={onKeyEnter}
              />
            </>
          )}
          <Combobox
            ref={projectRef}
            tabIndex={useTimeRange ? 3 : 1}
            value={row.project_id}
            onChange={(id) => setRow({ ...row, project_id: id })}
            onKeyDown={onKeyEnter}
            placeholder="Projekt suchen…"
            options={projects.map((p) => ({
              id: p.id,
              label: p.name,
              sublabel: p.customer?.company_name,
            }))}
          />
          <Combobox
            tabIndex={useTimeRange ? 4 : 2}
            value={row.service_type_id}
            onChange={(id) => setRow({ ...row, service_type_id: id })}
            onKeyDown={onKeyEnter}
            placeholder="Leistungsart…"
            options={serviceTypes.map((s) => ({
              id: s.id,
              label: s.name,
              sublabel: s.code,
            }))}
          />
          {/* Zeit (Stunden) – immer editierbar, im Zeitmodus auto-berechnet aber überschreibbar */}
          <Input
            ref={hoursRef}
            tabIndex={useTimeRange ? 5 : 3}
            type="number" step="0.25" min="0"
            value={row.hours_internal}
            onChange={(e) => setRow({ ...row, hours_internal: e.target.value, hours_touched: true })}
            onKeyDown={onKeyEnter}
            className="text-right tabular-nums"
            title={useTimeRange ? 'Auto aus Von/Bis – überschreibbar' : 'Stunden direkt eingeben'}
          />
          <Input
            tabIndex={useTimeRange ? 6 : 4}
            type="number" step="1" min="0"
            value={row.rate_snapshot}
            onChange={(e) => setRow({ ...row, rate_snapshot: e.target.value, rate_touched: true })}
            onKeyDown={onKeyEnter}
            className="text-right tabular-nums"
          />
          <div className="text-right tabular-nums text-zinc-700 font-medium">
            {fmt.chf(wert)}
          </div>
          <Input
            tabIndex={useTimeRange ? 7 : 5}
            data-quick-desc
            value={row.description}
            onChange={(e) => setRow({ ...row, description: e.target.value })}
            onKeyDown={onKeyEnter}
            placeholder="Kurzbeschrieb…"
          />
          <button
            tabIndex={useTimeRange ? 8 : 6}
            type="button"
            onClick={save}
            disabled={!canSave}
            title="Eintrag speichern (Enter)"
            className={artisBtn.primary}
            style={{ ...artisPrimaryStyle, opacity: canSave ? 1 : 0.45, padding: '6px 10px' }}
          >
            <CornerDownLeft className="w-4 h-4" />
          </button>
        </div>
        {/* Status-Toggle: Abzurechnen vs Kulant */}
        <div className="mt-2 px-1 flex items-center gap-3 text-[11px]">
          <span className="text-zinc-500 font-medium uppercase tracking-wider text-[10px]">Status:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="quick-status"
              checked={row.status === 'erfasst'}
              onChange={() => setRow({ ...row, status: 'erfasst' })}
            />
            <span className="text-zinc-700">Abzurechnen</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="quick-status"
              checked={row.status === 'kulant'}
              onChange={() => setRow({ ...row, status: 'kulant' })}
            />
            <span style={{ color: '#4d2995' }}>Kulant</span>
            <span className="text-zinc-400 text-[10px]">(nicht abrechnen)</span>
          </label>
          <div className="ml-auto text-[10px] text-zinc-400">
            {useTimeRange
              ? '💡 Stunden auto aus Von/Bis (überschreibbar). Pflicht: Std., Projekt, Leistungsart.'
              : '💡 Stunden direkt eingeben (1.5 = 1h 30min). Pflicht: Std., Projekt, Leistungsart.'}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Gesendete Mails (rechts)
// ============================================================================

function SentMailsCard({ sent, notConnected, hint, sentError, loading, onAdopt }) {
  return (
    <Card className="overflow-hidden flex flex-col" style={{ height: 540 }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
          <Mail className="w-3.5 h-3.5" /> Gesendete Mails
        </div>
        <span className="text-[10px] text-zinc-400">{sent.length}</span>
      </div>
      <div className="flex-1 overflow-auto divide-y" style={{ borderColor: '#eef1ee' }}>
        {loading ? (
          <div className="p-4 text-xs text-zinc-400">Lade Mails…</div>
        ) : notConnected ? (
          <div className="p-4 text-xs text-zinc-600">{hint || 'Outlook nicht verbunden.'}</div>
        ) : sentError ? (
          <div className="p-4 text-xs text-orange-700">
            <div className="font-semibold">Mails konnten nicht geladen werden:</div>
            <div className="mt-1">{sentError}</div>
          </div>
        ) : sent.length === 0 ? (
          <div className="p-4 text-xs text-zinc-400 italic">Keine gesendeten Mails.</div>
        ) : (
          sent.map((m) => (
            <div key={m.id} onClick={() => onAdopt(m)} className="p-2.5 group cursor-pointer hover:bg-zinc-50">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-700 truncate">{m.subject || '(ohne Betreff)'}</div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {m.sentDateTime ? timeFromIso(m.sentDateTime) : ''}
                    {m.to?.[0]?.email ? ` · ${m.to[0].email}` : ''}
                  </div>
                </div>
                <button
                  className="opacity-50 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded border text-[10px] transition-opacity"
                  style={{
                    borderColor: m.customer ? '#bfd3bf' : '#e4e7e4',
                    background: m.customer ? '#e6ede6' : '#fff',
                    color: m.customer ? '#2d5a2d' : '#999',
                  }}
                  title={m.customer ? 'Übernehmen' : 'Übernehmen (Kunde nicht erkannt)'}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              {m.customer && (
                <div className="mt-1 px-1.5 py-0.5 rounded text-[9px] inline-block" style={{ background: '#e6ede6', color: '#2d5a2d' }}>
                  → {m.customer.company_name}
                </div>
              )}
              {!m.customer && (
                <div className="mt-1 px-1.5 py-0.5 rounded text-[9px] inline-block bg-zinc-100 text-zinc-500">
                  Kunde nicht erkannt
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Inline-Summary-Stat (im Header der Einträge-Card)
// ============================================================================

function SummaryStat({ label, value, accent = false }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={accent ? { color: '#2d5a2d' } : undefined}>
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// Tabelle der Tageseinträge (Mitte, unten)
// ============================================================================

function EntriesTable({ entries, projects, serviceTypes, onUpdate, onRemove }) {
  const [editingId, setEditingId] = useState(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
            <th className="text-left font-semibold px-3 py-2 w-32">Zeit</th>
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
              <EditRow key={e.id} entry={e} projects={projects} serviceTypes={serviceTypes}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => { await onUpdate(e.id, patch); setEditingId(null); }} />
            ) : (
              <ReadRow key={e.id} entry={e}
                onEdit={() => setEditingId(e.id)}
                onRemove={async () => { if (window.confirm('Eintrag wirklich löschen?')) await onRemove(e.id); }} />
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
      <td className="px-3 py-2">
        {entry.project?.id ? (
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem('le.fakvor.preselectProject', entry.project.id);
              window.dispatchEvent(new CustomEvent('le-navigate', {
                detail: { primary: 'abrechnen', secondary: 'fakvor' },
              }));
            }}
            className="hover:underline text-left"
            style={{ color: '#2d5a2d', fontWeight: 500 }}
            title="Zum Faktura-Vorschlag (Projekt vorausgewählt)"
          >
            {entry.project.name}
          </button>
        ) : '—'}
      </td>
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
  }, [form.time_from, form.time_to]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <td className="px-2 py-1">
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

// ============================================================================
// Hilfsfunktionen für Vorschlag→Eintrag
// ============================================================================

function pickProject(suggestion, projects) {
  const sp = suggestion.suggestedProjects;
  if (sp?.length === 1) {
    return projects.find(p => p.id === sp[0].id) ?? sp[0];
  }
  if (sp?.length > 1) {
    const bwl = sp.find(p => /BWL/i.test(p.name));
    return projects.find(p => p.id === (bwl ?? sp[0]).id) ?? sp[0];
  }
  return null;
}

function pickDefaultServiceType(serviceTypes) {
  return (
    serviceTypes.find(s => s.code === 'BER') ??
    serviceTypes.find(s => s.billable) ??
    serviceTypes[0] ??
    null
  );
}
