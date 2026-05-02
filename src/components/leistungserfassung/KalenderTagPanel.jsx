// Leistungserfassung · Kalender-Tagesansicht
// =====================================================================
// Tag-Kalender als Haupt-Erfassungsmaske.
//   - Layer 1 (hinten): Outlook-Termine fein/transparent
//   - Layer 2 (vorne):  eigene Rapporte als bunte Boxen
//   - Klick auf leeren Slot → Modal mit Default-Zeit (30 Min)
//   - Klick auf Rapport-Box → Modal im Edit-Modus
//   - Klick auf Outlook-Termin → Modal mit Daten aus Termin vorbefüllt
//   - Überlappungen erlaubt: parallele Rapporte werden nebeneinander gerendert.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, CalendarDays, RefreshCw, Calendar, Plus,
} from 'lucide-react';
import {
  leTimeEntry, leProject, leServiceType, leEmployee, currentEmployee,
  leRateGroupRate, leServiceRateHistory, leMs365Day,
} from '@/lib/leApi';
import {
  Card, Chip, IconBtn, Select, PanelLoader, PanelError, fmt,
  artisBtn, artisGhostStyle,
} from './shared';
import RapportEditDialog from './RapportEditDialog';

// --- Konstanten -----------------------------------------------------------

const HOUR_START = 6;       // Kalender beginnt 06:00
const HOUR_END = 22;        // Kalender endet 22:00
const PX_PER_HOUR = 60;     // 60px = 1 Stunde
const PX_PER_MIN = PX_PER_HOUR / 60;
const SLOT_GRID_MIN = 15;   // 15-Minuten-Klick-Raster
const DEFAULT_DURATION_MIN = 30; // Klick erzeugt 30-Min-Default

// Farb-Pool für Rapport-Boxen (deterministisch je Projekt-ID)
const PROJECT_COLORS = [
  { bg: '#e6ede6', border: '#bfd3bf', text: '#2d5a2d' }, // Artis grün
  { bg: '#e3eaf5', border: '#b8c9e0', text: '#2e4a7d' }, // Blau
  { bg: '#fff4e0', border: '#f3d9a4', text: '#8a5a00' }, // Orange
  { bg: '#ede3f7', border: '#c9b8e0', text: '#4d2995' }, // Violet
  { bg: '#e0f0e8', border: '#b4d8c5', text: '#2d6a4f' }, // Mint
  { bg: '#fce4e4', border: '#e8b4b4', text: '#8a2d2d' }, // Rot (sparsam)
];

// --- Helpers --------------------------------------------------------------

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDaysIso = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};
const minutesFromHHMM = (s) => {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};
const minutesToHHMM = (mins) => {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const timeFromIso = (iso) => {
  if (!iso) return null;
  const s = String(iso);
  return s.includes('T') ? s.slice(11, 16) : s.slice(0, 5);
};

// Hash-Function für deterministische Farb-Auswahl pro Projekt
const colorForProject = (projectId) => {
  if (!projectId) return PROJECT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = ((hash << 5) - hash + projectId.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
};

// Y-Position aus HH:MM
const yFromTime = (hhmm) => {
  const m = minutesFromHHMM(hhmm);
  if (m == null) return 0;
  return Math.max(0, (m - HOUR_START * 60) * PX_PER_MIN);
};

// Höhe aus Differenz (Minuten)
const heightFromDuration = (fromHhmm, toHhmm, fallbackMin = 30) => {
  const a = minutesFromHHMM(fromHhmm);
  const b = minutesFromHHMM(toHhmm);
  if (a == null || b == null) return fallbackMin * PX_PER_MIN;
  return Math.max(20, (b - a) * PX_PER_MIN);
};

// Y-Pixel → HH:MM (15-min-Raster)
const timeFromY = (y) => {
  const totalMin = Math.round((y / PX_PER_MIN) / SLOT_GRID_MIN) * SLOT_GRID_MIN + HOUR_START * 60;
  return minutesToHHMM(Math.max(HOUR_START * 60, Math.min((HOUR_END - 1) * 60 + 45, totalMin)));
};

// Überlappungs-Layout: Einträge mit gleichen Zeitfenstern werden in
// nebeneinanderliegende Spalten verteilt.
function computeLanes(items) {
  // items: [{ id, fromMin, toMin, ...}]
  const sorted = [...items].sort((a, b) => a.fromMin - b.fromMin);
  const lanes = []; // each lane: [{toMin}]
  for (const it of sorted) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].toMin <= it.fromMin) {
        it.lane = i;
        lanes[i].toMin = it.toMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      it.lane = lanes.length;
      lanes.push({ toMin: it.toMin });
    }
  }
  // Jede Gruppe von überlappenden Items teilt sich die Spalten gleichmäßig
  // Wir berechnen pro Item die maximale Lanes-Anzahl im Cluster
  for (const it of sorted) {
    let cluster = [it];
    for (const other of sorted) {
      if (other === it) continue;
      if (other.fromMin < it.toMin && other.toMin > it.fromMin) cluster.push(other);
    }
    it.totalLanes = Math.max(...cluster.map((c) => (c.lane ?? 0))) + 1;
  }
  return sorted;
}

// --- Panel ----------------------------------------------------------------

export default function KalenderTagPanel() {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(() => todayIso());
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);
  const [dialogState, setDialogState] = useState(null); // null | { initial }

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
  const projectsQ        = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const serviceTypesQ    = useQuery({ queryKey: ['le', 'service_type'], queryFn: () => leServiceType.list() });
  const employeesQ       = useQuery({ queryKey: ['le', 'employee'], queryFn: () => leEmployee.list() });
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
  const ms365 = ms365Q.data ?? { calendar: [], sent: [] };

  const selectedEmployee = employees.find((e) => e.id === currentEmployeeId);

  // Mutations
  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'time_entry', currentDate, currentEmployeeId] });

  const createMut = useMutation({
    mutationFn: (payload) => leTimeEntry.create(payload),
    onSuccess: () => { toast.success('Rapport erfasst'); invalidate(); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leTimeEntry.update(id, patch),
    onSuccess: () => { toast.success('Rapport gespeichert'); invalidate(); },
  });
  const removeMut = useMutation({
    mutationFn: (id) => leTimeEntry.remove(id),
    onSuccess: () => { toast.success('Rapport gelöscht'); invalidate(); },
  });

  // --- Loading / Error ---
  if (!employeeResolved) return <PanelLoader />;
  const anyError = projectsQ.error || serviceTypesQ.error || entriesQ.error || employeesQ.error;
  if (anyError) return <PanelError error={anyError} onRetry={() => { entriesQ.refetch(); }} />;

  const noMasterData = projects.length === 0 || serviceTypes.length === 0;

  // --- Layer-Daten ---

  // Rapport-Boxen mit Lane-Berechnung
  const rapportItems = useMemo(() => {
    const items = entries.map((e) => {
      const fromHM = timeFromIso(e.time_from);
      const toHM = timeFromIso(e.time_to);
      const fromMin = minutesFromHHMM(fromHM);
      const toMin = minutesFromHHMM(toHM);
      // Wenn keine Zeit gesetzt: vom Start ab 06:00 zeigen wir nicht im Kalender
      if (fromMin == null || toMin == null) return null;
      return {
        id: e.id,
        fromMin, toMin,
        entry: e,
        color: colorForProject(e.project_id),
      };
    }).filter(Boolean);
    return computeLanes(items);
  }, [entries]);

  // Outlook-Termine
  const outlookItems = useMemo(() => {
    return (ms365.calendar ?? []).filter((c) => !c.isCancelled && !c.isAllDay).map((c) => {
      const from = timeFromIso(c.start);
      const to = timeFromIso(c.end);
      const fromMin = minutesFromHHMM(from);
      const toMin = minutesFromHHMM(to);
      return { ...c, fromMin, toMin };
    }).filter((c) => c.fromMin != null && c.toMin != null);
  }, [ms365.calendar]);

  // --- Tages-Summary ---
  const summary = useMemo(() => {
    let hours = 0; let chf = 0;
    for (const e of entries) {
      const h = Number(e.hours_internal ?? 0);
      hours += h;
      const billable = e.service_type?.billable !== false;
      if (billable) chf += h * Number(e.rate_snapshot ?? 0);
    }
    return { hours, chf, count: entries.length };
  }, [entries]);

  // --- Klick-Handler ---

  // Klick auf leeren Slot: Modal mit time_from = HH:MM, time_to = +30 Min
  const handleSlotClick = (e) => {
    if (!currentEmployeeId) {
      toast.error('Bitte zuerst Mitarbeiter auswählen.');
      return;
    }
    if (noMasterData) {
      toast.error('Bitte zuerst Projekt + Leistungsart anlegen.');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const fromHM = timeFromY(y);
    const fromMin = minutesFromHHMM(fromHM);
    const toMin = fromMin != null ? fromMin + DEFAULT_DURATION_MIN : null;
    const toHM = toMin != null ? minutesToHHMM(toMin) : '';
    setDialogState({
      initial: { time_from: fromHM, time_to: toHM },
    });
  };

  const handleEntryClick = (entry, e) => {
    e.stopPropagation();
    setDialogState({ initial: entry });
  };

  const handleOutlookClick = (cal, e) => {
    e.stopPropagation();
    if (noMasterData) {
      toast.error('Bitte zuerst Projekt + Leistungsart anlegen.');
      return;
    }
    // Pre-Match: Customer aus suggestion
    const matched = cal.suggestedProjects?.[0];
    const project = matched ? projects.find((p) => p.id === matched.id) : null;
    setDialogState({
      initial: {
        time_from: timeFromIso(cal.start) ?? '',
        time_to: timeFromIso(cal.end) ?? '',
        project_id: project?.id ?? '',
        description: cal.subject ?? '',
      },
    });
  };

  const handleSave = async (payload) => {
    if (payload.id) {
      const { id, ...patch } = payload;
      await updateMut.mutateAsync({ id, patch });
    } else {
      await createMut.mutateAsync({
        ...payload,
        entry_date: currentDate,
        employee_id: currentEmployeeId,
        status: 'erfasst',
      });
    }
  };

  // --- Render ---

  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

  // "Jetzt"-Linie
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine = currentDate === todayIso() && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60;
  const nowY = (nowMin - HOUR_START * 60) * PX_PER_MIN;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <Card className="px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <IconBtn onClick={() => setCurrentDate(addDaysIso(currentDate, -1))} title="Vortag">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button type="button" className={artisBtn.ghost} style={artisGhostStyle} onClick={() => setCurrentDate(todayIso())}>
            Heute
          </button>
          <IconBtn onClick={() => setCurrentDate(addDaysIso(currentDate, 1))} title="Folgetag">
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
          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs text-zinc-500">
              <span className="text-[10px] uppercase tracking-wider mr-1">Total</span>
              <span className="font-semibold tabular-nums" style={{ color: '#2d5a2d' }}>
                {fmt.hours(summary.hours)} h · CHF {fmt.chf(summary.chf)}
              </span>
            </div>
            <Select
              value={currentEmployeeId ?? ''}
              onChange={(e) => setCurrentEmployeeId(e.target.value || null)}
              style={{ minWidth: 200, fontWeight: 600, color: '#2d5a2d', borderColor: '#bfd3bf', background: '#f5faf5' }}
            >
              <option value="">– MA auswählen –</option>
              {employees.filter((emp) => emp.active !== false).map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
              ))}
            </Select>
            <button
              onClick={() => ms365Q.refetch()}
              className="text-zinc-400 hover:text-zinc-700"
              title="Outlook aktualisieren"
            >
              <RefreshCw className={`w-4 h-4 ${ms365Q.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </Card>

      {/* Hint, falls Stammdaten fehlen */}
      {noMasterData && (
        <div className="rounded-lg border p-4 flex items-start gap-2 text-sm" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
          <Calendar className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Zuerst Stammdaten anlegen</div>
            <div className="text-xs mt-0.5">Bitte zuerst im Tab <b>Stammdaten</b> mindestens ein Projekt und eine Leistungsart erfassen.</div>
          </div>
        </div>
      )}

      {/* Kalender */}
      <Card className="overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between text-xs" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }}>
          <div className="flex items-center gap-3 text-zinc-600">
            <span className="font-semibold uppercase tracking-wider">Tageskalender</span>
            <span className="text-zinc-400">Klick auf Zeitspalte → Rapport erfassen</span>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: '#e6ede6', border: '1px solid #bfd3bf' }} />
              Eigene Rapporte
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded opacity-30" style={{ background: '#cbd5e0', border: '1px dashed #94a3b8' }} />
              Outlook (Hintergrund)
            </span>
          </div>
        </div>

        <div className="flex" style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}>
          {/* Stunden-Beschriftung links */}
          <div className="w-12 flex-shrink-0 border-r overflow-hidden" style={{ borderColor: '#eef1ee' }}>
            <div style={{ height: totalHeight, position: 'relative' }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[10px] text-zinc-400 -translate-y-1/2"
                  style={{ top: (h - HOUR_START) * PX_PER_HOUR }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Kalender-Hauptspalte */}
          <div className="flex-1 overflow-auto relative">
            <div
              className="relative cursor-crosshair"
              style={{
                height: totalHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR/2 - 0.5}px, #f7f8f7 ${PX_PER_HOUR/2 - 0.5}px, #f7f8f7 ${PX_PER_HOUR/2}px)`,
              }}
              onClick={handleSlotClick}
            >
              {/* Layer 1: Outlook im Hintergrund (transparent, dashed) */}
              {outlookItems.map((cal) => {
                const top = (cal.fromMin - HOUR_START * 60) * PX_PER_MIN;
                const height = Math.max(20, (cal.toMin - cal.fromMin) * PX_PER_MIN);
                return (
                  <div
                    key={`out-${cal.id}`}
                    onClick={(e) => handleOutlookClick(cal, e)}
                    className="absolute left-1 right-1 rounded text-[10px] cursor-pointer hover:opacity-60 transition-opacity"
                    style={{
                      top, height,
                      background: 'rgba(99, 132, 180, 0.10)',
                      border: '1px dashed #94a3b8',
                      color: '#475569',
                      padding: '2px 6px',
                      overflow: 'hidden',
                      zIndex: 1,
                    }}
                    title={`Outlook: ${cal.subject}${cal.customer?.company_name ? ' · ' + cal.customer.company_name : ''} (Klick übernimmt)`}
                  >
                    <div className="truncate italic">{cal.subject}</div>
                    {cal.customer?.company_name && (
                      <div className="truncate text-[9px] opacity-75">{cal.customer.company_name}</div>
                    )}
                  </div>
                );
              })}

              {/* Layer 2: Rapporte (vorne, mit Lane-Layout für Überlappungen) */}
              {rapportItems.map((it) => {
                const top = (it.fromMin - HOUR_START * 60) * PX_PER_MIN;
                const height = Math.max(22, (it.toMin - it.fromMin) * PX_PER_MIN);
                const lanes = it.totalLanes || 1;
                const lane = it.lane || 0;
                const widthPct = 100 / lanes;
                const e = it.entry;
                const customerName = e.project?.customer?.company_name ?? e.project?.name;
                return (
                  <div
                    key={`rap-${it.id}`}
                    onClick={(ev) => handleEntryClick(e, ev)}
                    className="absolute rounded shadow-sm hover:shadow-md transition-shadow cursor-pointer text-[10px]"
                    style={{
                      top,
                      height,
                      left: `calc(${widthPct * lane}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      background: it.color.bg,
                      border: `1.5px solid ${it.color.border}`,
                      color: it.color.text,
                      padding: '3px 6px',
                      overflow: 'hidden',
                      zIndex: 5,
                    }}
                    title={`${customerName ?? ''} · ${e.description ?? ''} · ${fmt.hours(e.hours_internal)}h`}
                  >
                    <div className="font-semibold truncate">{customerName || '—'}</div>
                    {e.description && height >= 30 && (
                      <div className="truncate text-[9px] opacity-90">{e.description}</div>
                    )}
                    {height >= 50 && (
                      <div className="truncate text-[9px] opacity-75">
                        {timeFromIso(e.time_from)?.slice(0,5)}–{timeFromIso(e.time_to)?.slice(0,5)} · {fmt.hours(e.hours_internal)}h
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Jetzt-Linie */}
              {showNowLine && (
                <div
                  className="absolute left-0 right-0 pointer-events-none flex items-center"
                  style={{ top: nowY, zIndex: 10 }}
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 h-px bg-red-500" />
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Modal */}
      <RapportEditDialog
        open={!!dialogState}
        onClose={() => setDialogState(null)}
        onSave={handleSave}
        onDelete={(id) => removeMut.mutateAsync(id)}
        initial={dialogState?.initial}
        employee={selectedEmployee}
        projects={projects}
        serviceTypes={serviceTypes}
        rateGroupRates={rateGroupRates}
        serviceRateHistory={serviceRateHistory}
        currentDate={currentDate}
      />
    </div>
  );
}
