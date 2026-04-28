// Leistungserfassung · Abwesenheiten
// Antrag erfassen, eigene Liste, Saldo (Ferien-Anspruch vs. bezogen), Approval (Admin).
// Mini-Kalender für Monatsübersicht. Kategorien: Ferien, Krankheit, Unfall, Militär,
// Mutterschaft/Vaterschaft, Weiterbildung, Unbezahlt, Kompensation, Kurzabsenz, Feiertag.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays, CalendarPlus, CalendarCheck, CalendarX,
  Heart, Plane, GraduationCap, ShieldCheck, Baby, Pause,
  Plus, Check, X, Trash2, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, Upload, Filter,
} from 'lucide-react';
import {
  leAbsence, leSollzeitProfile, leEmployee, currentEmployee,
} from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';
import {
  Card, Chip, IconBtn, Input, Select, Field,
  PanelLoader, PanelError, PanelHeader,
  artisBtn, artisPrimaryStyle, artisGhostStyle, fmt,
} from './shared';

// --- Konstanten ------------------------------------------------------------

const CATEGORY_META = {
  ferien:        { label: 'Ferien',          tone: 'green',   icon: Plane },
  krankheit:     { label: 'Krankheit',       tone: 'red',     icon: Heart },
  unfall:        { label: 'Unfall',          tone: 'red',     icon: Heart },
  militaer:      { label: 'Militär',         tone: 'blue',    icon: ShieldCheck },
  mutterschaft:  { label: 'Mutterschaft',    tone: 'violet',  icon: Baby },
  vaterschaft:   { label: 'Vaterschaft',     tone: 'violet',  icon: Baby },
  weiterbildung: { label: 'Weiterbildung',   tone: 'blue',    icon: GraduationCap },
  unbezahlt:     { label: 'Unbezahlt',       tone: 'orange',  icon: Pause },
  kurzabsenz:    { label: 'Kurzabsenz',      tone: 'orange',  icon: Pause },
  kompensation:  { label: 'Kompensation',    tone: 'neutral', icon: CalendarCheck },
  feiertag:      { label: 'Feiertag',        tone: 'neutral', icon: CalendarDays },
};

const STATUS_META = {
  beantragt:  { label: 'beantragt',  tone: 'orange' },
  genehmigt:  { label: 'genehmigt',  tone: 'green' },
  abgelehnt:  { label: 'abgelehnt',  tone: 'red' },
  storniert:  { label: 'storniert',  tone: 'neutral' },
};

const CATEGORY_DOT = {
  ferien:        '#7a9b7f',
  krankheit:     '#b0524d',
  unfall:        '#b0524d',
  militaer:      '#5a7ab0',
  mutterschaft:  '#8a64c4',
  vaterschaft:   '#8a64c4',
  weiterbildung: '#5a7ab0',
  unbezahlt:     '#c48a4a',
  kurzabsenz:    '#c4a64a',
  kompensation:  '#9a9a9a',
  feiertag:      '#bdbdbd',
};

// --- Helpers ---------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());

const countWorkDays = (fromIso, toIso) => {
  if (!fromIso || !toIso) return 0;
  let count = 0;
  const d = new Date(fromIso);
  const end = new Date(toIso);
  if (end < d) return 0;
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
};

const calcAbsenceDays = (a) => {
  let days = countWorkDays(a.date_from, a.date_to);
  if (a.half_day_from) days -= 0.5;
  if (a.half_day_to) days -= 0.5;
  return Math.max(0, days);
};

const calcVacationBalance = (profile, absences, year) => {
  const anspruch = Number(profile?.vacation_days ?? 25);
  const filtered = absences
    .filter((a) => a.category === 'ferien')
    .filter((a) => a.status === 'genehmigt' || a.status === 'beantragt')
    .filter((a) => new Date(a.date_from).getFullYear() === year);
  const bezogenGenehmigt = filtered
    .filter((a) => a.status === 'genehmigt')
    .reduce((s, a) => s + calcAbsenceDays(a), 0);
  const bezogenBeantragt = filtered
    .filter((a) => a.status === 'beantragt')
    .reduce((s, a) => s + calcAbsenceDays(a), 0);
  return {
    anspruch,
    bezogenGenehmigt,
    bezogenBeantragt,
    bezogen: bezogenGenehmigt + bezogenBeantragt,
    rest: anspruch - bezogenGenehmigt - bezogenBeantragt,
  };
};

const dailyHoursFromProfile = (profile, dateIso) => {
  if (!profile) return 8;
  const day = new Date(dateIso).getDay(); // 0=So..6=Sa
  const map = ['hours_so','hours_mo','hours_di','hours_mi','hours_do','hours_fr','hours_sa'];
  const v = Number(profile[map[day]] ?? 0);
  return v || 0;
};

const calcHoursTotal = (profile, fromIso, toIso, halfFrom, halfTo) => {
  if (!fromIso || !toIso) return 0;
  let total = 0;
  const d = new Date(fromIso);
  const end = new Date(toIso);
  if (end < d) return 0;
  // Standard-Tagesstunden falls kein Profil oder Wochenenden 0
  const fallback = profile ? null : 8;
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const h = fallback ?? dailyHoursFromProfile(profile, isoDate(d));
      total += h;
    }
    d.setDate(d.getDate() + 1);
  }
  if (halfFrom) total -= (profile ? dailyHoursFromProfile(profile, fromIso) / 2 : 4);
  if (halfTo && fromIso !== toIso) total -= (profile ? dailyHoursFromProfile(profile, toIso) / 2 : 4);
  return Math.max(0, Number(total.toFixed(2)));
};

// --- KPI-Kachel ------------------------------------------------------------

const KpiTile = ({ label, value, hint, tone = 'neutral', icon: Icon }) => {
  const colors = {
    neutral: { bg: '#f7f9f7', col: '#3d4a3d', accent: '#7a9b7f' },
    green:   { bg: '#eef5ee', col: '#2d5a2d', accent: '#5a8a5a' },
    yellow:  { bg: '#fff8e6', col: '#8a5a00', accent: '#c4a64a' },
    red:     { bg: '#fff0f0', col: '#8a2d2d', accent: '#b0524d' },
    blue:    { bg: '#eef2f8', col: '#2e4a7d', accent: '#5a7ab0' },
  }[tone] ?? { bg: '#f7f9f7', col: '#3d4a3d', accent: '#7a9b7f' };
  return (
    <Card className="p-4" style={{ background: colors.bg, borderColor: '#e4e7e4' }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">{label}</div>
          <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: colors.col }}>{value}</div>
          {hint && <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#fff', color: colors.accent, border: `1px solid ${colors.accent}33` }}>
            <Icon className="w-4.5 h-4.5" />
          </div>
        )}
      </div>
    </Card>
  );
};

// --- Mini-Kalender ---------------------------------------------------------

const MiniCalendar = ({ absences, year, month, onPrev, onNext }) => {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Wochenstart Mo (1): offset = (weekday - 1 + 7) % 7
  const firstWeekday = first.getDay();
  const offset = (firstWeekday + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const absForDate = (d) => {
    const iso = isoDate(d);
    return absences.filter((a) => iso >= a.date_from && iso <= a.date_to && a.status !== 'storniert' && a.status !== 'abgelehnt');
  };

  const monthName = first.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  const today = todayIso();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Kalender</div>
        <div className="flex items-center gap-1">
          <IconBtn title="Vorheriger Monat" onClick={onPrev}><ChevronLeft className="w-3.5 h-3.5" /></IconBtn>
          <div className="text-sm font-medium px-2 capitalize" style={{ minWidth: 130, textAlign: 'center' }}>{monthName}</div>
          <IconBtn title="Nächster Monat" onClick={onNext}><ChevronRight className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase text-zinc-400 font-semibold mb-1">
        {['Mo','Di','Mi','Do','Fr','Sa','So'].map((d) => (
          <div key={d} className="text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="h-12" />;
          const iso = isoDate(c);
          const abs = absForDate(c);
          const weekday = c.getDay();
          const isWeekend = weekday === 0 || weekday === 6;
          const isToday = iso === today;
          const primary = abs[0];
          const cat = primary?.category;
          const dot = cat ? CATEGORY_DOT[cat] : null;
          const beantragt = primary?.status === 'beantragt';
          return (
            <div
              key={i}
              title={abs.map((a) => `${CATEGORY_META[a.category]?.label ?? a.category} (${STATUS_META[a.status]?.label ?? a.status})`).join('\n')}
              className="h-12 rounded border flex flex-col items-center justify-center text-xs relative"
              style={{
                borderColor: isToday ? '#7a9b7f' : '#eef1ee',
                background: isWeekend ? '#fafbf9' : '#fff',
                color: isWeekend ? '#bbb' : '#3d4a3d',
                fontWeight: isToday ? 600 : 400,
              }}
            >
              <div className="tabular-nums">{c.getDate()}</div>
              {dot && (
                <div
                  className="mt-0.5 rounded-full"
                  style={{
                    width: 18, height: 4,
                    background: dot,
                    opacity: beantragt ? 0.5 : 1,
                    border: beantragt ? `1px dashed ${dot}` : 'none',
                  }}
                />
              )}
              {abs.length > 1 && (
                <span className="absolute top-0.5 right-1 text-[8px] text-zinc-400">+{abs.length - 1}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-zinc-500">
        {Object.entries(CATEGORY_DOT).slice(0, 6).map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: c }} />
            {CATEGORY_META[k]?.label ?? k}
          </span>
        ))}
      </div>
    </Card>
  );
};

// --- Antrag erfassen Card --------------------------------------------------

const AntragForm = ({ open, onToggle, profile, onSubmit, busy }) => {
  const [category, setCategory] = useState('ferien');
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [halfFrom, setHalfFrom] = useState(false);
  const [halfTo, setHalfTo] = useState(false);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);

  const days = useMemo(() => {
    let d = countWorkDays(dateFrom, dateTo);
    if (halfFrom) d -= 0.5;
    if (halfTo) d -= 0.5;
    return Math.max(0, d);
  }, [dateFrom, dateTo, halfFrom, halfTo]);

  const hours = useMemo(() => calcHoursTotal(profile, dateFrom, dateTo, halfFrom, halfTo), [profile, dateFrom, dateTo, halfFrom, halfTo]);
  const isMedical = category === 'krankheit' || category === 'unfall';

  const reset = () => {
    setCategory('ferien');
    setDateFrom(todayIso());
    setDateTo(todayIso());
    setHalfFrom(false);
    setHalfTo(false);
    setNotes('');
    setFile(null);
  };

  const submit = async () => {
    if (!dateFrom || !dateTo) {
      toast.error('Bitte Von- und Bis-Datum angeben.');
      return;
    }
    if (dateTo < dateFrom) {
      toast.error('Bis-Datum darf nicht vor Von-Datum liegen.');
      return;
    }
    await onSubmit({
      category, dateFrom, dateTo,
      halfFrom, halfTo,
      hoursTotal: hours,
      notes: notes.trim() || null,
      file,
    });
    reset();
  };

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <CalendarPlus className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-semibold">Abwesenheit beantragen</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: '#eef1ee' }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Field label="Kategorie">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Von">
              <Input type="date" value={dateFrom} onChange={(e) => {
                setDateFrom(e.target.value);
                if (dateTo < e.target.value) setDateTo(e.target.value);
              }} />
            </Field>
            <Field label="Bis">
              <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer select-none mt-5">
              <input type="checkbox" checked={halfFrom} onChange={(e) => setHalfFrom(e.target.checked)} style={{ accentColor: '#7a9b7f' }} />
              Halbtag am Anfang
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer select-none mt-5">
              <input type="checkbox" checked={halfTo} onChange={(e) => setHalfTo(e.target.checked)} style={{ accentColor: '#7a9b7f' }} />
              Halbtag am Ende
            </label>
            <div className="rounded p-2 text-xs" style={{ background: '#f7f9f7', border: '1px solid #e4e7e4' }}>
              <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold mb-1">Berechnung</div>
              <div className="flex items-baseline justify-between">
                <span className="text-zinc-600">Tage</span>
                <span className="tabular-nums font-semibold">{days.toString().replace('.', ',')}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-zinc-600">Stunden</span>
                <span className="tabular-nums font-semibold">{fmt.hours(hours)}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Bemerkung">
              <Input
                placeholder="optional, z.B. Reiseziel oder Begründung"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            {isMedical && (
              <Field label="Beleg / AU-Zeugnis" hint="PDF oder Bild – optional, aber empfohlen">
                <label
                  className="flex items-center gap-2 px-2 py-1.5 border rounded text-sm cursor-pointer hover:bg-zinc-50"
                  style={{ borderColor: '#d9dfd9' }}
                >
                  <Upload className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="truncate">
                    {file ? file.name : 'Datei auswählen…'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </Field>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className={artisBtn.ghost}
              style={artisGhostStyle}
              disabled={busy}
            >
              Zurücksetzen
            </button>
            <button
              type="button"
              onClick={submit}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: busy ? 0.45 : 1 }}
              disabled={busy}
            >
              <Plus className="w-4 h-4" /> Antrag einreichen
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};

// --- Hauptpanel ------------------------------------------------------------

export default function AbwesenheitenPanel() {
  const qc = useQueryClient();

  const [meEmployeeId, setMeEmployeeId] = useState(null);
  const [meResolved, setMeResolved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tab, setTab] = useState('mine'); // mine | team
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState(''); // admin: spezifischer MA in Team-Tab
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [formOpen, setFormOpen] = useState(true);

  // Auth resolve
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
      } catch { /* ignore */ }
      finally { if (!cancelled) setMeResolved(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Queries
  const employeesQ = useQuery({
    queryKey: ['le', 'employee'],
    queryFn: () => leEmployee.list(),
    enabled: isAdmin,
  });

  const sollzeitQ = useQuery({
    queryKey: ['le', 'sollzeit', meEmployeeId],
    queryFn: () => leSollzeitProfile.listForEmployee(meEmployeeId),
    enabled: !!meEmployeeId,
  });

  const showTeam = isAdmin && tab === 'team';
  const queryEmployeeId = showTeam ? (employeeFilter || undefined) : meEmployeeId;

  const absencesQ = useQuery({
    queryKey: ['le', 'absence', { employeeId: queryEmployeeId ?? null, status: statusFilter || null, team: showTeam }],
    queryFn: () => leAbsence.list({
      employeeId: queryEmployeeId,
      status: statusFilter || undefined,
    }),
    enabled: !!meEmployeeId,
  });

  const myAbsencesAllYearsQ = useQuery({
    queryKey: ['le', 'absence', 'mine-all', meEmployeeId],
    queryFn: () => leAbsence.list({ employeeId: meEmployeeId }),
    enabled: !!meEmployeeId,
  });

  const employees = employeesQ.data ?? [];
  const absences = absencesQ.data ?? [];
  const myAbsences = myAbsencesAllYearsQ.data ?? [];
  const activeProfile = (sollzeitQ.data ?? [])[0] ?? null;

  // KPI: Saldo bezieht sich IMMER auf eigene Abwesenheiten im gewählten Jahr
  const balance = useMemo(
    () => calcVacationBalance(activeProfile, myAbsences, year),
    [activeProfile, myAbsences, year]
  );

  // Mutations
  const invalidate = () => qc.invalidateQueries({ queryKey: ['le', 'absence'] });

  const createMut = useMutation({
    mutationFn: async ({ category, dateFrom, dateTo, halfFrom, halfTo, hoursTotal, notes, file }) => {
      let receipt_url = null;
      if (file) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const path = `abwesenheiten/${meEmployeeId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('dokumente').upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from('dokumente').getPublicUrl(path);
        receipt_url = publicUrl;
      }
      return leAbsence.create({
        employee_id: meEmployeeId,
        category,
        date_from: dateFrom,
        date_to: dateTo,
        half_day_from: halfFrom,
        half_day_to: halfTo,
        hours_total: hoursTotal,
        status: 'beantragt',
        notes,
        receipt_url,
      });
    },
    onSuccess: () => { toast.success('Antrag eingereicht'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const approveMut = useMutation({
    mutationFn: (id) => leAbsence.approve(id),
    onSuccess: () => { toast.success('Genehmigt'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const rejectMut = useMutation({
    mutationFn: (id) => leAbsence.reject(id),
    onSuccess: () => { toast.success('Abgelehnt'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => leAbsence.update(id, { status: 'storniert' }),
    onSuccess: () => { toast.success('Storniert'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  const removeMut = useMutation({
    mutationFn: (id) => leAbsence.remove(id),
    onSuccess: () => { toast.success('Gelöscht'); invalidate(); },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  // Loading / Error
  if (!meResolved) return <PanelLoader />;
  if (!meEmployeeId) {
    return (
      <div>
        <PanelHeader title="Abwesenheiten" subtitle="Ferien, Krankheit & Co." />
        <Card className="p-5 text-sm text-zinc-600">
          Kein Mitarbeiter-Profil gefunden. Bitte erst im Tab <b>Stammdaten → Mitarbeiter</b> ein Profil verknüpfen.
        </Card>
      </div>
    );
  }
  const anyError = absencesQ.error || sollzeitQ.error || myAbsencesAllYearsQ.error || (isAdmin && employeesQ.error);
  if (anyError) {
    return (
      <div>
        <PanelHeader title="Abwesenheiten" subtitle="Ferien, Krankheit & Co." />
        <PanelError
          error={anyError}
          onRetry={() => { absencesQ.refetch(); sollzeitQ.refetch(); myAbsencesAllYearsQ.refetch(); if (isAdmin) employeesQ.refetch(); }}
        />
      </div>
    );
  }

  const loading = absencesQ.isLoading || sollzeitQ.isLoading;

  // Tabellen-Daten (nach Filterung)
  const rows = absences;

  // Mini-Kalender: zeige im Mine-Tab eigene, im Team-Tab gefilterte
  const calendarAbsences = showTeam ? rows : myAbsences;

  // Restfarbe
  const restTone = balance.rest > 5 ? 'green' : balance.rest >= 0 ? 'yellow' : 'red';

  // KPI: bezogen-hint
  const bezogenHint = `${balance.bezogenGenehmigt.toString().replace('.', ',')} genehmigt · ${balance.bezogenBeantragt.toString().replace('.', ',')} offen`;

  // Subtitle
  const subtitle = activeProfile
    ? `Pensum ${Number(activeProfile.pensum_pct).toFixed(0)}% · ${Number(activeProfile.vacation_days).toString().replace('.', ',')} Ferientage/Jahr`
    : 'Kein Sollzeit-Profil hinterlegt – Standardwerte werden verwendet';

  // Jahre fürs Saldo-Selector
  const allYears = Array.from(new Set([
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() + 1,
    ...myAbsences.map((a) => new Date(a.date_from).getFullYear()),
  ])).sort((a, b) => b - a);

  const goCal = (delta) => {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  };

  return (
    <div>
      <PanelHeader
        title="Abwesenheiten"
        subtitle={subtitle}
        right={
          <div className="flex items-center gap-2">
            {isAdmin && <Chip tone="violet">Admin</Chip>}
            <Field label="Jahr">
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ minWidth: 90 }}>
                {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
          </div>
        }
      />

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KpiTile
          label={`Ferien-Anspruch ${year}`}
          value={`${balance.anspruch.toString().replace('.', ',')} T`}
          hint={activeProfile ? 'Aus aktivem Sollzeit-Profil' : 'Standardwert (kein Profil)'}
          tone="neutral"
          icon={CalendarDays}
        />
        <KpiTile
          label="Bezogen / beantragt"
          value={`${balance.bezogen.toString().replace('.', ',')} T`}
          hint={bezogenHint}
          tone="blue"
          icon={Plane}
        />
        <KpiTile
          label="Resttage"
          value={`${balance.rest.toString().replace('.', ',')} T`}
          hint={balance.rest < 0 ? 'Achtung: Über-Bezug' : balance.rest < 5 ? 'wenig Rest' : 'gut im Plan'}
          tone={restTone}
          icon={CalendarCheck}
        />
      </div>

      {/* Antrag-Card */}
      <AntragForm
        open={formOpen}
        onToggle={() => setFormOpen((v) => !v)}
        profile={activeProfile}
        onSubmit={(p) => createMut.mutateAsync(p)}
        busy={createMut.isPending}
      />

      {/* Tabs + Filter */}
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1 rounded border" style={{ borderColor: '#e4e7e4' }}>
            <button
              type="button"
              onClick={() => setTab('mine')}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: tab === 'mine' ? '#7a9b7f' : '#fff',
                color: tab === 'mine' ? '#fff' : '#3d4a3d',
                borderRadius: 3,
              }}
            >
              Eigene
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setTab('team')}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  background: tab === 'team' ? '#7a9b7f' : '#fff',
                  color: tab === 'team' ? '#fff' : '#3d4a3d',
                  borderRadius: 3,
                }}
              >
                Team-Übersicht
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 text-zinc-400 ml-2">
            <Filter className="w-4 h-4" />
            <span className="text-[10px] uppercase font-semibold tracking-wider">Filter</span>
          </div>

          <div style={{ minWidth: 150 }}>
            <Field label="Status">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Alle</option>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          {showTeam && (
            <div style={{ minWidth: 200 }}>
              <Field label="Mitarbeiter">
                <Select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                  <option value="">Alle</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.short_code} – {emp.full_name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <div className="ml-auto text-xs text-zinc-400">
            {rows.length} Einträge
          </div>
        </div>
      </Card>

      {/* Tabelle + Mini-Kalender */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            {loading ? (
              <PanelLoader />
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                Keine Abwesenheiten {showTeam ? 'im Team' : 'erfasst'}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ background: '#f7f9f7', borderBottom: '1px solid #e4e7e4' }}>
                    <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
                      <th className="px-2 py-2 text-left font-semibold w-40">Zeitraum</th>
                      {showTeam && <th className="px-2 py-2 text-left font-semibold w-32">Mitarbeiter</th>}
                      <th className="px-2 py-2 text-left font-semibold w-32">Kategorie</th>
                      <th className="px-2 py-2 text-right font-semibold w-16">Tage</th>
                      <th className="px-2 py-2 text-right font-semibold w-16">Std.</th>
                      <th className="px-2 py-2 text-left font-semibold w-24">Status</th>
                      <th className="px-2 py-2 text-left font-semibold">Bemerkung</th>
                      <th className="px-2 py-2 text-right font-semibold w-28">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const meta = CATEGORY_META[a.category] ?? { label: a.category, tone: 'neutral', icon: CalendarDays };
                      const Icon = meta.icon;
                      const status = STATUS_META[a.status] ?? { label: a.status, tone: 'neutral' };
                      const days = calcAbsenceDays(a);
                      const isOwn = a.employee_id === meEmployeeId;

                      const canApprove = isAdmin && a.status === 'beantragt';
                      const canCancel = isOwn && a.status === 'beantragt';
                      const canDelete = isAdmin && (a.status === 'storniert' || a.status === 'abgelehnt');

                      const fromTo = a.date_from === a.date_to
                        ? fmt.date(a.date_from)
                        : `${fmt.date(a.date_from)} – ${fmt.date(a.date_to)}`;

                      return (
                        <tr
                          key={a.id}
                          className="border-t hover:bg-zinc-50"
                          style={{
                            borderColor: '#eef1ee',
                            opacity: (a.status === 'storniert' || a.status === 'abgelehnt') ? 0.55 : 1,
                          }}
                        >
                          <td className="px-2 py-2 tabular-nums text-zinc-700">
                            <div>{fromTo}</div>
                            {(a.half_day_from || a.half_day_to) && (
                              <div className="text-[10px] text-zinc-400 mt-0.5">
                                {a.half_day_from && '½ Anfang'}{a.half_day_from && a.half_day_to && ' · '}{a.half_day_to && '½ Ende'}
                              </div>
                            )}
                          </td>
                          {showTeam && (
                            <td className="px-2 py-2 text-zinc-700">
                              <div className="font-medium">{a.employee?.short_code ?? '—'}</div>
                              <div className="text-[11px] text-zinc-500">{a.employee?.full_name ?? ''}</div>
                            </td>
                          )}
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="w-3.5 h-3.5" style={{ color: CATEGORY_DOT[a.category] }} />
                              <Chip tone={meta.tone}>{meta.label}</Chip>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{days.toString().replace('.', ',')}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-zinc-500">{fmt.hours(a.hours_total)}</td>
                          <td className="px-2 py-2"><Chip tone={status.tone}>{status.label}</Chip></td>
                          <td className="px-2 py-2 text-zinc-600 max-w-xs">
                            <div className="truncate" title={a.notes ?? ''}>
                              {a.notes || <span className="text-zinc-300">—</span>}
                            </div>
                            {a.receipt_url && (
                              <a
                                href={a.receipt_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] underline text-zinc-500 hover:text-zinc-700"
                              >
                                Beleg ansehen
                              </a>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {canApprove && (
                                <>
                                  <IconBtn
                                    title="Genehmigen"
                                    onClick={() => approveMut.mutate(a.id)}
                                  >
                                    <Check className="w-3.5 h-3.5" style={{ color: '#2d5a2d' }} />
                                  </IconBtn>
                                  <IconBtn
                                    title="Ablehnen"
                                    danger
                                    onClick={() => {
                                      if (window.confirm('Antrag wirklich ablehnen?')) rejectMut.mutate(a.id);
                                    }}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </IconBtn>
                                </>
                              )}
                              {canCancel && (
                                <IconBtn
                                  title="Stornieren"
                                  onClick={() => {
                                    if (window.confirm('Antrag wirklich stornieren?')) cancelMut.mutate(a.id);
                                  }}
                                >
                                  <CalendarX className="w-3.5 h-3.5" />
                                </IconBtn>
                              )}
                              {canDelete && (
                                <IconBtn
                                  title="Löschen"
                                  danger
                                  onClick={() => {
                                    if (window.confirm('Eintrag dauerhaft löschen?')) removeMut.mutate(a.id);
                                  }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </IconBtn>
                              )}
                              {!canApprove && !canCancel && !canDelete && <span className="w-7 h-7 inline-block" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1">
          <MiniCalendar
            absences={calendarAbsences}
            year={calYear}
            month={calMonth}
            onPrev={() => goCal(-1)}
            onNext={() => goCal(1)}
          />
        </div>
      </div>
    </div>
  );
}
