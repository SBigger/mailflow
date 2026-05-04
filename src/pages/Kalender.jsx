import React, { useState, useContext, useMemo } from 'react';
import { supabase, entities, functions, auth } from '@/api/supabaseClient';
import { ThemeContext } from '@/Layout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, Video,
  RefreshCw, List, Grid3X3, ExternalLink, Users, X, Building2,
  AlertCircle, CheckCircle2, HelpCircle, XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays,
  isSameDay, isToday, parseISO, addMonths, subMonths,
} from 'date-fns';
import { de } from 'date-fns/locale';

// ── Hilfsfunktionen ──────────────────────────────────────────────────

const RESPONSE_CONFIG = {
  accepted:            { label: 'Zugesagt',   color: '#22c55e', icon: CheckCircle2 },
  tentativelyAccepted: { label: 'Tentativ',   color: '#f59e0b', icon: HelpCircle },
  declined:            { label: 'Abgesagt',   color: '#ef4444', icon: XCircle },
  none:                { label: 'Offen',      color: '#6366f1', icon: Calendar },
  notResponded:        { label: 'Ausstehend', color: '#71717a', icon: AlertCircle },
};

function getResponseConfig(status) {
  return RESPONSE_CONFIG[status] || RESPONSE_CONFIG.none;
}

function formatTime(dt, isAllDay) {
  if (!dt) return '';
  if (isAllDay) return 'Ganztägig';
  try { return format(parseISO(dt), 'HH:mm'); } catch { return ''; }
}

function formatDateRange(start, end, isAllDay) {
  if (!start) return '';
  try {
    const s = parseISO(start);
    if (isAllDay) return format(s, 'dd.MM.yyyy', { locale: de });
    const e = end ? parseISO(end) : null;
    if (e && !isSameDay(s, e)) {
      return `${format(s, 'dd.MM. HH:mm', { locale: de })} – ${format(e, 'dd.MM. HH:mm', { locale: de })}`;
    }
    return `${format(s, 'HH:mm')}${e ? ' – ' + format(e, 'HH:mm') : ''}`;
  } catch { return ''; }
}

// ── Wochen-Raster Hilfsfunktionen ────────────────────────────────────

const HOUR_START = 7;
const HOUR_END   = 21;
const HOUR_COUNT = HOUR_END - HOUR_START;
const SLOT_PX    = 60; // px pro Stunde

function eventTopPx(startTime) {
  if (!startTime) return 0;
  try {
    const d = parseISO(startTime);
    const h = d.getHours() + d.getMinutes() / 60;
    return Math.max(0, (h - HOUR_START) * SLOT_PX);
  } catch { return 0; }
}

function eventHeightPx(startTime, endTime) {
  if (!startTime || !endTime) return SLOT_PX;
  try {
    const s = parseISO(startTime);
    const e = parseISO(endTime);
    const diffH = (e - s) / 3600000;
    return Math.max(20, diffH * SLOT_PX);
  } catch { return SLOT_PX; }
}

// Berechnet Spalten-Layout für überlappende Events (wie Google Calendar)
function computeEventLayout(events) {
  const sorted = [...events].sort((a, b) =>
    new Date(a.start_time) - new Date(b.start_time)
  );
  const colEnds = []; // colEnds[i] = Endzeit der letzten Belegung in Spalte i
  const layout = new Map(); // id → { col }

  for (const ev of sorted) {
    const start = new Date(ev.start_time).getTime();
    const end   = new Date(ev.end_time || ev.start_time).getTime();
    let col = 0;
    while (col < colEnds.length && colEnds[col] > start) col++;
    colEnds[col] = end;
    layout.set(ev.id, { col });
  }

  // Für jedes Event: wieviele Spalten braucht die Überlappungsgruppe?
  for (const ev of sorted) {
    const start = new Date(ev.start_time).getTime();
    const end   = new Date(ev.end_time || ev.start_time).getTime();
    let maxCol = layout.get(ev.id).col;
    for (const other of sorted) {
      if (other.id === ev.id) continue;
      const os = new Date(other.start_time).getTime();
      const oe = new Date(other.end_time || other.start_time).getTime();
      if (os < end && oe > start) maxCol = Math.max(maxCol, layout.get(other.id).col);
    }
    layout.get(ev.id).totalCols = maxCol + 1;
  }
  return layout;
}

// ── Haupt-Komponente ─────────────────────────────────────────────────

export default function Kalender() {
  const { theme } = useContext(ThemeContext);
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState('woche');    // 'woche' | 'liste'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterStatus, setFilterStatus] = useState('');  // '' | 'accepted' | 'tentativelyAccepted' | 'declined'

  // ── Theme-Variablen ──
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isDark   = !isLight && !isArtis;

  const pageBg      = isDark ? '#2a2a2f' : isArtis ? '#f2f5f2' : '#f2f2f7';
  const cardBg      = isDark ? 'rgba(24,24,27,0.6)' : '#ffffff';
  const cardBorder  = isDark ? 'rgba(63,63,70,0.6)' : isArtis ? '#ccd8cc' : '#d4d4e8';
  const headingColor = isDark ? '#e4e4e7' : isArtis ? '#2d3a2d' : '#1a1a2e';
  const textMuted   = isDark ? '#a1a1aa' : isArtis ? '#6b826b' : '#7a7a9a';
  const rowBg       = isDark ? 'rgba(24,24,27,0.4)' : isArtis ? '#f5f8f5' : '#f7f7fc';
  const rowBorder   = isDark ? '#3f3f46' : isArtis ? '#ccd8cc' : '#d4d4e8';
  const gridLine    = isDark ? 'rgba(63,63,70,0.4)' : isArtis ? '#dce8dc' : '#e4e4f0';
  const todayBg     = isDark ? 'rgba(99,102,241,0.08)' : isArtis ? 'rgba(122,155,127,0.08)' : 'rgba(99,102,241,0.06)';
  const accentColor = isArtis ? '#7a9b7f' : '#6366f1';

  // ── Daten laden ──
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendarEvents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => entities.Customer.list('company_name'),
  });

  const customerMap = useMemo(() => {
    const m = new Map();
    for (const c of customers) m.set(c.id, c.company_name);
    return m;
  }, [customers]);

  // ── Filtern ──
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (filterStatus && e.response_status !== filterStatus) return false;
      if (filterCustomer && e.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [events, filterStatus, filterCustomer]);

  // ── Wochen-Navigation ──
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // ── Liste: Tage-Gruppen ──
  const listGroups = useMemo(() => {
    const groups = new Map();
    for (const e of filteredEvents) {
      if (!e.start_time) continue;
      try {
        const key = format(parseISO(e.start_time), 'yyyy-MM-dd');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      } catch { /* skip */ }
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, evts]) => ({ date: parseISO(key), events: evts }));
  }, [filteredEvents]);

  // ── Events für einen Tag im Wochen-Raster ──
  function eventsForDay(day) {
    return filteredEvents.filter(e => {
      if (!e.start_time) return false;
      try { return isSameDay(parseISO(e.start_time), day); } catch { return false; }
    });
  }

  // ── Kalender-Sync ──
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const { data } = await functions.invoke('sync-outlook-calendar', {});
      const result = data?.results?.[0];
      if (result?.error) {
        toast.error('Sync: ' + result.error);
      } else {
        toast.success(`${result?.inserted || 0} neue Events, ${result?.updated || 0} aktualisiert`);
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      }
    } catch (e) {
      toast.error('Fehler: ' + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Kunden-Zuweisung (manuell) ──
  const assignCustomerMutation = useMutation({
    mutationFn: ({ id, customer_id }) =>
      supabase.from('calendar_events').update({ customer_id }).eq('id', id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
      if (selectedEvent) {
        setSelectedEvent(prev => ({ ...prev, customer_id: prev._newCustomerId }));
      }
      toast.success('Kunde zugewiesen');
    },
  });

  // ── Event-Karte (Wochen-Raster) ──
  function EventBlock({ event, compact = false }) {
    const cfg = getResponseConfig(event.response_status);
    const cancelled = event.is_cancelled;
    return (
      <div
        onClick={() => setSelectedEvent(event)}
        className="cursor-pointer rounded px-1.5 py-0.5 text-xs border-l-2 truncate hover:opacity-90 transition-opacity"
        style={{
          backgroundColor: isDark ? `${cfg.color}18` : `${cfg.color}15`,
          borderLeftColor: cfg.color,
          color: isDark ? '#e4e4e7' : '#1a1a2e',
          textDecoration: cancelled ? 'line-through' : 'none',
          opacity: cancelled ? 0.6 : 1,
        }}
        title={event.subject}
      >
        {!event.is_all_day && (
          <span className="opacity-70 mr-1">{formatTime(event.start_time, false)}</span>
        )}
        {event.subject}
      </div>
    );
  }

  // ── Event-Detail-Panel ──────────────────────────────────────────────
  function EventDetail({ event, onClose }) {
    const cfg = getResponseConfig(event.response_status);
    const StatusIcon = cfg.icon;
    const [localCustomer, setLocalCustomer] = useState(event.customer_id || '');

    return (
      <div
        className="flex flex-col h-full border-l overflow-y-auto"
        style={{ backgroundColor: cardBg, borderColor: cardBorder, minWidth: 320, maxWidth: 380 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 pb-3 border-b" style={{ borderColor: cardBorder }}>
          <div className="flex-1 pr-2">
            <h3
              className="font-semibold text-sm leading-snug"
              style={{
                color: headingColor,
                textDecoration: event.is_cancelled ? 'line-through' : 'none',
              }}
            >
              {event.subject}
            </h3>
            {event.is_cancelled && (
              <span className="text-xs text-red-400 mt-0.5 block">Abgesagt</span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusIcon className="h-4 w-4 flex-shrink-0" style={{ color: cfg.color }} />
            <span className="text-sm" style={{ color: cfg.color }}>{cfg.label}</span>
          </div>

          {/* Zeit */}
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: textMuted }} />
            <div>
              <p className="text-sm" style={{ color: headingColor }}>
                {formatDateRange(event.start_time, event.end_time, event.is_all_day)}
              </p>
              {event.is_all_day && (
                <p className="text-xs" style={{ color: textMuted }}>Ganztägig</p>
              )}
            </div>
          </div>

          {/* Ort */}
          {event.location && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: textMuted }} />
              <p className="text-sm" style={{ color: headingColor }}>{event.location}</p>
            </div>
          )}

          {/* Online-Meeting */}
          {event.online_meeting_url && (
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 flex-shrink-0" style={{ color: textMuted }} />
              <a
                href={event.online_meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm flex items-center gap-1 hover:underline"
                style={{ color: accentColor }}
              >
                Meeting beitreten <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Organisator */}
          {event.organizer_name && (
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: textMuted }} />
              <div>
                <p className="text-sm" style={{ color: headingColor }}>{event.organizer_name}</p>
                {event.organizer_email && (
                  <p className="text-xs" style={{ color: textMuted }}>{event.organizer_email}</p>
                )}
              </div>
            </div>
          )}

          {/* Vorschau */}
          {event.body_preview && (
            <div
              className="rounded-lg p-3 text-xs leading-relaxed"
              style={{ backgroundColor: rowBg, borderColor: rowBorder, color: textMuted, border: '1px solid' }}
            >
              {event.body_preview}
            </div>
          )}

          {/* Kunden-Zuordnung */}
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: textMuted }}>
              <Building2 className="h-3.5 w-3.5 inline mr-1" />
              Kunde zuordnen
            </label>
            <div className="flex gap-2">
              <select
                value={localCustomer}
                onChange={e => setLocalCustomer(e.target.value)}
                className="flex-1 text-xs rounded border px-2 py-1.5"
                style={{
                  backgroundColor: isDark ? 'rgba(24,24,27,0.8)' : '#fff',
                  borderColor: rowBorder,
                  color: headingColor,
                }}
              >
                <option value="">– kein Kunde –</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => assignCustomerMutation.mutate({ id: event.id, customer_id: localCustomer || null })}
                className="text-xs"
                style={{ backgroundColor: accentColor }}
              >
                OK
              </Button>
            </div>
            {event.customer_id && customerMap.get(event.customer_id) && (
              <p className="text-xs mt-1" style={{ color: accentColor }}>
                Aktuell: {customerMap.get(event.customer_id)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Wochen-Ansicht ─────────────────────────────────────────────────
  function WeekView() {
    const hours = Array.from({ length: HOUR_COUNT }, (_, i) => HOUR_START + i);
    const allDayEvents = weekDays.map(day =>
      eventsForDay(day).filter(e => e.is_all_day)
    );
    const hasAllDay = allDayEvents.some(a => a.length > 0);

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Spalten-Header */}
        <div className="flex border-b flex-shrink-0" style={{ borderColor: gridLine }}>
          <div style={{ width: 52, minWidth: 52 }} />
          {weekDays.map((day, i) => (
            <div
              key={i}
              className="flex-1 text-center py-2 text-xs font-medium border-l"
              style={{
                borderColor: gridLine,
                color: isToday(day) ? accentColor : textMuted,
                backgroundColor: isToday(day) ? todayBg : 'transparent',
              }}
            >
              <div>{format(day, 'EEE', { locale: de })}</div>
              <div
                className={`w-6 h-6 mx-auto mt-0.5 flex items-center justify-center rounded-full text-xs ${isToday(day) ? 'font-bold' : ''}`}
                style={{
                  backgroundColor: isToday(day) ? accentColor : 'transparent',
                  color: isToday(day) ? '#fff' : headingColor,
                }}
              >
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>

        {/* Ganztägige Events */}
        {hasAllDay && (
          <div className="flex border-b flex-shrink-0" style={{ borderColor: gridLine, minHeight: 32 }}>
            <div className="flex items-center justify-end pr-2 text-xs" style={{ width: 52, color: textMuted }}>
              ganzt.
            </div>
            {weekDays.map((day, i) => (
              <div
                key={i}
                className="flex-1 border-l p-0.5 flex flex-col gap-0.5"
                style={{ borderColor: gridLine, backgroundColor: isToday(day) ? todayBg : 'transparent' }}
              >
                {eventsForDay(day).filter(e => e.is_all_day).map(e => (
                  <EventBlock key={e.id} event={e} />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Scroll-Bereich Stunden */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex" style={{ height: HOUR_COUNT * SLOT_PX }}>
            {/* Stundenmarkierungen */}
            <div style={{ width: 52, minWidth: 52, position: 'relative' }}>
              {hours.map(h => (
                <div
                  key={h}
                  className="absolute right-2 text-xs"
                  style={{ top: (h - HOUR_START) * SLOT_PX - 7, color: textMuted }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Tages-Spalten */}
            {weekDays.map((day, di) => {
              const dayEvents = eventsForDay(day).filter(e => !e.is_all_day);
              return (
                <div
                  key={di}
                  className="flex-1 border-l relative"
                  style={{ borderColor: gridLine, backgroundColor: isToday(day) ? todayBg : 'transparent' }}
                >
                  {/* Stunden-Linien */}
                  {hours.map(h => (
                    <div
                      key={h}
                      className="absolute w-full border-t"
                      style={{ top: (h - HOUR_START) * SLOT_PX, borderColor: gridLine }}
                    />
                  ))}

                  {/* Events */}
                  {(() => {
                    const evLayout = computeEventLayout(dayEvents);
                    return dayEvents.map(event => {
                    const top = eventTopPx(event.start_time);
                    const height = eventHeightPx(event.start_time, event.end_time);
                    const cfg = getResponseConfig(event.response_status);
                    const { col, totalCols = 1 } = evLayout.get(event.id) || {};
                    const leftPct  = (col / totalCols) * 100;
                    const widthPct = (1 / totalCols) * 100;
                    return (
                      <div
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className="absolute rounded border-l-2 px-1 py-0.5 cursor-pointer hover:opacity-90 overflow-hidden"
                        style={{
                          top,
                          height: Math.max(height, 18),
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: isDark ? `${cfg.color}20` : `${cfg.color}18`,
                          borderLeftColor: cfg.color,
                          zIndex: 1,
                        }}
                        title={event.subject}
                      >
                        <p
                          className="text-xs font-medium leading-tight truncate"
                          style={{
                            color: headingColor,
                            textDecoration: event.is_cancelled ? 'line-through' : 'none',
                            opacity: event.is_cancelled ? 0.6 : 1,
                          }}
                        >
                          {event.subject}
                        </p>
                        {height > 30 && (
                          <p className="text-xs opacity-60 truncate" style={{ color: textMuted }}>
                            {formatTime(event.start_time, false)}
                            {event.location ? ` · ${event.location}` : ''}
                          </p>
                        )}
                      </div>
                    );
                  });
                })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Listen-Ansicht ─────────────────────────────────────────────────
  function ListView() {
    if (listGroups.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Calendar className="h-10 w-10 opacity-30" style={{ color: textMuted }} />
          <p className="text-sm" style={{ color: textMuted }}>
            {events.length === 0
              ? 'Noch keine Kalender-Events. Bitte synchronisieren.'
              : 'Keine Events mit diesem Filter.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {listGroups.map(({ date, events: dayEvents }) => (
          <div key={date.toISOString()}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="text-xs font-semibold px-2 py-0.5 rounded"
                style={{
                  backgroundColor: isToday(date) ? accentColor : 'transparent',
                  color: isToday(date) ? '#fff' : textMuted,
                }}
              >
                {isToday(date) ? 'Heute' : format(date, 'EEEE, dd. MMMM yyyy', { locale: de })}
              </div>
              <div className="flex-1 border-t" style={{ borderColor: gridLine }} />
            </div>

            <div className="space-y-1.5">
              {dayEvents.map(event => {
                const cfg = getResponseConfig(event.response_status);
                const StatusIcon = cfg.icon;
                return (
                  <div
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className="flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-pointer border hover:opacity-90 transition-opacity"
                    style={{
                      backgroundColor: rowBg,
                      borderColor: rowBorder,
                      opacity: event.is_cancelled ? 0.6 : 1,
                    }}
                  >
                    {/* Farbindikator */}
                    <div
                      className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: cfg.color, minWidth: 4 }}
                    />

                    {/* Zeit */}
                    <div className="text-xs w-14 flex-shrink-0 pt-0.5" style={{ color: textMuted }}>
                      {event.is_all_day ? 'ganzt.' : formatTime(event.start_time, false)}
                      {!event.is_all_day && event.end_time && (
                        <div>{formatTime(event.end_time, false)}</div>
                      )}
                    </div>

                    {/* Inhalt */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{
                          color: headingColor,
                          textDecoration: event.is_cancelled ? 'line-through' : 'none',
                        }}
                      >
                        {event.subject}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {event.location && (
                          <span className="text-xs flex items-center gap-1" style={{ color: textMuted }}>
                            <MapPin className="h-3 w-3" /> {event.location}
                          </span>
                        )}
                        {event.customer_id && customerMap.get(event.customer_id) && (
                          <span className="text-xs flex items-center gap-1" style={{ color: accentColor }}>
                            <Building2 className="h-3 w-3" /> {customerMap.get(event.customer_id)}
                          </span>
                        )}
                        {event.online_meeting_url && (
                          <span className="text-xs flex items-center gap-1" style={{ color: textMuted }}>
                            <Video className="h-3 w-3" /> Online
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <StatusIcon className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: pageBg }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0 flex-wrap"
        style={{ borderColor: cardBorder, backgroundColor: cardBg }}
      >
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => viewMode === 'woche' ? setCurrentDate(d => subWeeks(d, 1)) : setCurrentDate(d => subMonths(d, 1))}
            style={{ color: textMuted }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrentDate(new Date())}
            className="text-xs px-3"
            style={{ color: headingColor }}
          >
            Heute
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => viewMode === 'woche' ? setCurrentDate(d => addWeeks(d, 1)) : setCurrentDate(d => addMonths(d, 1))}
            style={{ color: textMuted }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Aktueller Zeitraum */}
        <h2 className="font-semibold text-sm flex-1" style={{ color: headingColor }}>
          {viewMode === 'woche'
            ? `${format(weekStart, 'd. MMM', { locale: de })} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd. MMM yyyy', { locale: de })}`
            : format(currentDate, 'MMMM yyyy', { locale: de })}
        </h2>

        {/* Filter Kunde */}
        <select
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          className="text-xs rounded border px-2 py-1.5"
          style={{
            backgroundColor: isDark ? 'rgba(24,24,27,0.8)' : '#fff',
            borderColor: cardBorder,
            color: headingColor,
          }}
        >
          <option value="">Alle Kunden</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>

        {/* Filter Status */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-xs rounded border px-2 py-1.5"
          style={{
            backgroundColor: isDark ? 'rgba(24,24,27,0.8)' : '#fff',
            borderColor: cardBorder,
            color: headingColor,
          }}
        >
          <option value="">Alle Status</option>
          {Object.entries(RESPONSE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* View Toggle */}
        <div className="flex rounded border overflow-hidden" style={{ borderColor: cardBorder }}>
          {[
            { key: 'woche', icon: Grid3X3, label: 'Woche' },
            { key: 'liste', icon: List,    label: 'Liste' },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className="px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: viewMode === key ? accentColor : 'transparent',
                color: viewMode === key ? '#fff' : textMuted,
              }}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Sync */}
        <Button
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          style={{ backgroundColor: accentColor, color: '#fff' }}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Sync...' : 'Sync'}
        </Button>
      </div>

      {/* Hauptbereich */}
      <div className="flex flex-1 overflow-hidden">
        {/* Kalender-Inhalt */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="h-6 w-6 animate-spin" style={{ color: textMuted }} />
            </div>
          ) : viewMode === 'woche' ? (
            <WeekView />
          ) : (
            <ListView />
          )}
        </div>

        {/* Detail-Panel */}
        {selectedEvent && (
          <EventDetail
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </div>

      {/* Event-Zähler */}
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-t text-xs flex-shrink-0"
        style={{ borderColor: cardBorder, color: textMuted, backgroundColor: cardBg }}
      >
        <span>{filteredEvents.length} von {events.length} Events</span>
        {events.length === 0 && (
          <span className="text-yellow-400">
            Noch keine Events – bitte in Einstellungen → Outlook → Kalender synchronisieren.
          </span>
        )}
      </div>
    </div>
  );
}
