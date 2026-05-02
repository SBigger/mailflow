// Leistungserfassung · Kalender-Wochenansicht
// =====================================================================
// Wochenansicht (Mo–So) mit denselben Layern wie KalenderTagPanel:
//   - Outlook-Termine fein im Hintergrund
//   - Rapporte als bunte Boxen vorne
//   - Klick auf Zeitslot in einer Tagesspalte → Modal vorbefüllt mit Datum + Zeit
//   - Klick auf bestehenden Rapport → Modal Edit
//
// Wegen Performance-Aspekt: nur 7 leTimeEntry.listForDate-Calls (pro Tag),
// kein Range-Call. (listForRange wäre cleaner – wenn nötig später migrieren.)

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, CalendarDays, RefreshCw, Calendar,
} from 'lucide-react';
import {
  leTimeEntry, leProject, leServiceType, leEmployee, currentEmployee,
  leRateGroupRate, leServiceRateHistory, leMs365Day,
} from '@/lib/leApi';
import {
  Card, IconBtn, Select, PanelLoader, PanelError, fmt,
  artisBtn, artisGhostStyle,
} from './shared';
import RapportEditDialog from './RapportEditDialog';

// Konstanten wie Tagesansicht (kompakter Skalierung)
const HOUR_START = 6;
const HOUR_END = 22;
const PX_PER_HOUR = 36;
const PX_PER_MIN = PX_PER_HOUR / 60;
const SLOT_GRID_MIN = 15;
const DEFAULT_DURATION_MIN = 30;

// Alle Rapporte einheitlich violett – Outlook ist blau, Rapport ist lila
const RAPPORT_COLOR = { bg: '#ede3f7', border: '#c9b8e0', text: '#4d2995' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDaysIso = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0=So..6=Sa
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};
const minutesFromHHMM = (s) => {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};
const minutesToHHMM = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const timeFromIso = (iso) => {
  if (!iso) return null;
  const s = String(iso);
  return s.includes('T') ? s.slice(11, 16) : s.slice(0, 5);
};
const colorForProject = () => RAPPORT_COLOR;
const timeFromY = (y) => {
  const totalMin = Math.round((y / PX_PER_MIN) / SLOT_GRID_MIN) * SLOT_GRID_MIN + HOUR_START * 60;
  return minutesToHHMM(Math.max(HOUR_START * 60, Math.min((HOUR_END - 1) * 60 + 45, totalMin)));
};

const isoWeek = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

// Lane-Berechnung pro Tag (sehr ähnlich zu Tag-Panel)
function computeLanes(items) {
  const sorted = [...items].sort((a, b) => a.fromMin - b.fromMin);
  const lanes = [];
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
  for (const it of sorted) {
    let max = it.lane;
    for (const o of sorted) {
      if (o === it) continue;
      if (o.fromMin < it.toMin && o.toMin > it.fromMin) max = Math.max(max, o.lane);
    }
    it.totalLanes = max + 1;
  }
  return sorted;
}

export default function KalenderWochePanel() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null);
  const [employeeResolved, setEmployeeResolved] = useState(false);
  const [dialogState, setDialogState] = useState(null);

  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));

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

  const projectsQ = useQuery({ queryKey: ['le', 'project'], queryFn: () => leProject.list() });
  const serviceTypesQ = useQuery({ queryKey: ['le', 'service_type'], queryFn: () => leServiceType.list() });
  const employeesQ = useQuery({ queryKey: ['le', 'employee'], queryFn: () => leEmployee.list() });
  const rateGroupRatesQ = useQuery({ queryKey: ['le', 'rate_group_rate', 'all'], queryFn: () => leRateGroupRate.listAll() });
  const rateHistoryQ = useQuery({ queryKey: ['le', 'service_rate_history', 'all'], queryFn: () => leServiceRateHistory.listAll() });

  // Range-Call: alle Einträge der Woche
  const entriesQ = useQuery({
    queryKey: ['le', 'time_entry', 'range', weekStart, currentEmployeeId],
    queryFn: () => leTimeEntry.listForRange(weekStart, addDaysIso(weekStart, 6), { employeeId: currentEmployeeId }),
    enabled: !!currentEmployeeId,
  });

  // Outlook für jeden Tag (Promise.all)
  const outlookByDayQ = useQuery({
    queryKey: ['le', 'ms365-week', weekStart],
    queryFn: async () => {
      const map = {};
      await Promise.all(days.map(async (d) => {
        try {
          const r = await leMs365Day(d);
          map[d] = r?.calendar ?? [];
        } catch {
          map[d] = [];
        }
      }));
      return map;
    },
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
  const outlookByDay = outlookByDayQ.data ?? {};

  const selectedEmployee = employees.find((e) => e.id === currentEmployeeId);
  const noMasterData = projects.length === 0 || serviceTypes.length === 0;

  // Mutations
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['le', 'time_entry', 'range', weekStart, currentEmployeeId] });
    qc.invalidateQueries({ queryKey: ['le', 'time_entry'] });
  };
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

  // --- WICHTIG: Hooks (useMemo) IMMER vor early-returns! ---
  const itemsByDay = useMemo(() => {
    const result = {};
    for (const day of days) {
      const dayEntries = entries.filter((e) => e.entry_date === day);
      const items = dayEntries.map((e) => {
        const fromHM = timeFromIso(e.time_from);
        const toHM = timeFromIso(e.time_to);
        const fromMin = minutesFromHHMM(fromHM);
        const toMin = minutesFromHHMM(toHM);
        if (fromMin == null || toMin == null) return null;
        return { id: e.id, fromMin, toMin, entry: e, color: colorForProject(e.project_id) };
      }).filter(Boolean);
      result[day] = computeLanes(items);
    }
    return result;
  }, [entries, weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    let hours = 0; let chf = 0;
    for (const e of entries) {
      const h = Number(e.hours_internal ?? 0);
      hours += h;
      const billable = e.service_type?.billable !== false;
      if (billable) chf += h * Number(e.rate_snapshot ?? 0);
    }
    return { hours, chf };
  }, [entries]);

  if (!employeeResolved) return <PanelLoader />;
  const anyError = projectsQ.error || serviceTypesQ.error || entriesQ.error;
  if (anyError) return <PanelError error={anyError} onRetry={() => { entriesQ.refetch(); }} />;

  const totalHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

  const handleSlotClick = (day, e) => {
    if (!currentEmployeeId) { toast.error('Bitte zuerst Mitarbeiter auswählen.'); return; }
    if (noMasterData) { toast.error('Bitte zuerst Projekt + Leistungsart anlegen.'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const fromHM = timeFromY(y);
    const fromMin = minutesFromHHMM(fromHM);
    const toMin = fromMin + DEFAULT_DURATION_MIN;
    setDialogState({
      date: day,
      initial: { time_from: fromHM, time_to: minutesToHHMM(toMin) },
    });
  };

  const handleEntryClick = (entry, e) => {
    e.stopPropagation();
    setDialogState({ date: entry.entry_date, initial: entry });
  };

  const handleSave = async (payload) => {
    const { id, ...rest } = payload;
    if (id) {
      await updateMut.mutateAsync({ id, patch: rest });
    } else {
      await createMut.mutateAsync({
        ...rest,
        entry_date: dialogState.date,
        employee_id: currentEmployeeId,
        status: 'erfasst',
      });
    }
  };

  const dayName = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="space-y-3">
      <Card className="px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <IconBtn onClick={() => setWeekStart(addDaysIso(weekStart, -7))} title="Vorwoche">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button type="button" className={artisBtn.ghost} style={artisGhostStyle} onClick={() => setWeekStart(mondayOf(todayIso()))}>
            Aktuelle Woche
          </button>
          <IconBtn onClick={() => setWeekStart(addDaysIso(weekStart, 7))} title="Folgewoche">
            <ChevronRight className="w-4 h-4" />
          </IconBtn>
          <div className="flex items-center gap-2 ml-2">
            <CalendarDays className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-700">
              KW {isoWeek(weekStart)} · {dayName(weekStart)} – {dayName(addDaysIso(weekStart, 6))}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs text-zinc-500">
              <span className="text-[10px] uppercase tracking-wider mr-1">Wochen-Total</span>
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
            <button onClick={() => outlookByDayQ.refetch()} className="text-zinc-400 hover:text-zinc-700" title="Outlook aktualisieren">
              <RefreshCw className={`w-4 h-4 ${outlookByDayQ.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </Card>

      {noMasterData && (
        <div className="rounded-lg border p-4 flex items-start gap-2 text-sm" style={{ borderColor: '#f3d9a4', background: '#fff8e6', color: '#8a5a00' }}>
          <Calendar className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Zuerst Stammdaten anlegen</div>
            <div className="text-xs mt-0.5">Bitte zuerst im Tab <b>Stammdaten</b> mindestens ein Projekt und eine Leistungsart erfassen.</div>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex" style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}>
          {/* Stunden links */}
          <div className="w-12 flex-shrink-0 border-r" style={{ borderColor: '#eef1ee' }}>
            {/* Tag-Header-Höhe Spacer */}
            <div className="h-9 border-b" style={{ borderColor: '#e4e7e4', background: '#fafbf9' }} />
            <div style={{ height: totalHeight, position: 'relative' }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[10px] text-zinc-400 -translate-y-1/2"
                  style={{ top: (h - HOUR_START) * PX_PER_HOUR }}
                >
                  {String(h).padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>

          {/* 7 Tagesspalten */}
          {days.map((day) => {
            const isToday = day === todayIso();
            const isWeekend = (() => {
              const d = new Date(day + 'T00:00:00').getDay();
              return d === 0 || d === 6;
            })();
            const dayItems = itemsByDay[day] ?? [];
            const dayOutlook = (outlookByDay[day] ?? []).filter((c) => !c.isCancelled && !c.isAllDay).map((c) => ({
              ...c,
              fromMin: minutesFromHHMM(timeFromIso(c.start)),
              toMin: minutesFromHHMM(timeFromIso(c.end)),
            })).filter((c) => c.fromMin != null && c.toMin != null);

            // Now-Linie
            const showNow = isToday;
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const nowY = (nowMin - HOUR_START * 60) * PX_PER_MIN;

            return (
              <div key={day} className="flex-1 border-r overflow-hidden" style={{ borderColor: '#eef1ee', minWidth: 90 }}>
                {/* Tag-Header */}
                <div
                  className="h-9 border-b flex flex-col items-center justify-center text-[11px]"
                  style={{
                    borderColor: '#e4e7e4',
                    background: isToday ? '#e6ede6' : (isWeekend ? '#f5f5f4' : '#fafbf9'),
                    color: isToday ? '#2d5a2d' : '#52525b',
                    fontWeight: isToday ? 600 : 500,
                  }}
                >
                  <span className="capitalize">{dayName(day)}</span>
                </div>

                {/* Tag-Spalte */}
                <div
                  className="relative cursor-crosshair"
                  style={{
                    height: totalHeight,
                    background: isWeekend ? '#fafbf9' : '#fff',
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR - 1}px, #eef1ee ${PX_PER_HOUR}px)`,
                  }}
                  onClick={(e) => handleSlotClick(day, e)}
                >
                  {/* Outlook im Hintergrund */}
                  {dayOutlook.map((cal) => {
                    const top = (cal.fromMin - HOUR_START * 60) * PX_PER_MIN;
                    const height = Math.max(14, (cal.toMin - cal.fromMin) * PX_PER_MIN);
                    return (
                      <div
                        key={`out-${cal.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (noMasterData) return;
                          const matched = cal.suggestedProjects?.[0];
                          const project = matched ? projects.find((p) => p.id === matched.id) : null;
                          setDialogState({
                            date: day,
                            initial: {
                              time_from: timeFromIso(cal.start) ?? '',
                              time_to: timeFromIso(cal.end) ?? '',
                              project_id: project?.id ?? '',
                              description: cal.subject ?? '',
                            },
                          });
                        }}
                        className="absolute left-0.5 right-0.5 rounded text-[9px] cursor-pointer hover:opacity-70 transition-opacity"
                        style={{
                          top, height,
                          background: 'rgba(99, 132, 180, 0.10)',
                          border: '1px dashed #94a3b8',
                          color: '#475569',
                          padding: '1px 3px',
                          overflow: 'hidden',
                          zIndex: 1,
                        }}
                        title={`Outlook: ${cal.subject}`}
                      >
                        <div className="truncate italic">{cal.subject}</div>
                      </div>
                    );
                  })}

                  {/* Rapporte */}
                  {dayItems.map((it) => {
                    const top = (it.fromMin - HOUR_START * 60) * PX_PER_MIN;
                    const height = Math.max(16, (it.toMin - it.fromMin) * PX_PER_MIN);
                    const lanes = it.totalLanes || 1;
                    const lane = it.lane || 0;
                    const widthPct = 100 / lanes;
                    const e = it.entry;
                    const customerName = e.project?.customer?.company_name ?? e.project?.name;
                    return (
                      <div
                        key={`rap-${it.id}`}
                        onClick={(ev) => handleEntryClick(e, ev)}
                        className="absolute rounded text-[9px] cursor-pointer hover:shadow transition-shadow"
                        style={{
                          top,
                          height,
                          left: `calc(${widthPct * lane}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: it.color.bg,
                          border: `1px solid ${it.color.border}`,
                          color: it.color.text,
                          padding: '2px 3px',
                          overflow: 'hidden',
                          zIndex: 5,
                        }}
                        title={`${customerName ?? ''} · ${e.description ?? ''} · ${fmt.hours(e.hours_internal)}h`}
                      >
                        <div className="font-semibold truncate leading-tight">{customerName || '—'}</div>
                        {height >= 28 && e.description && (
                          <div className="truncate opacity-90 leading-tight">{e.description}</div>
                        )}
                      </div>
                    );
                  })}

                  {showNow && (
                    <div className="absolute left-0 right-0 pointer-events-none flex items-center" style={{ top: nowY, zIndex: 10 }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-0.5" />
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

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
        currentDate={dialogState?.date ?? todayIso()}
      />
    </div>
  );
}
