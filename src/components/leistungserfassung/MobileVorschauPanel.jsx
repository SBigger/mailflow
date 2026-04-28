// Leistungserfassung · Mobile-Vorschau
// Reine Demo: zeigt das geplante Mobile-UI in einem iPhone/Pixel-Frame.
// Lädt echte Daten (Tageseinträge + eigene Spesen) – keine Schreib-Aktionen.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Smartphone, Plus, Camera, Receipt, Clock, Calendar,
  MoreHorizontal, ChevronRight, LogOut, Info, FileText, Settings, AlertCircle,
} from 'lucide-react';
import {
  leTimeEntry, leExpense, leProject, currentEmployee,
} from '@/lib/leApi';
import {
  Card, PanelHeader, Chip, fmt, artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

// --- Frame-Presets ---------------------------------------------------------

const DEVICES = {
  'iphone14': { label: 'iPhone 14', w: 360, h: 720, radius: 40, notch: 'notch' },
  'iphone15': { label: 'iPhone 15 Pro', w: 360, h: 740, radius: 44, notch: 'island' },
  'pixel8':   { label: 'Pixel 8',   w: 360, h: 720, radius: 32, notch: 'punch' },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// --- Smartphone Frame ------------------------------------------------------

function StatusBar({ notch }) {
  return (
    <div className="relative h-7 flex items-center justify-between px-6 text-[11px] font-semibold text-zinc-700 select-none" style={{ background: '#fff' }}>
      <span>9:41</span>
      <span className="flex items-center gap-1 text-[10px]">
        <span>•••</span><span>WiFi</span><span>100%</span>
      </span>
      {notch === 'notch' && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-32 h-5 rounded-b-2xl" style={{ background: '#0a0a0a' }} />
      )}
      {notch === 'island' && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-24 h-6 rounded-full" style={{ background: '#0a0a0a' }} />
      )}
      {notch === 'punch' && (
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ background: '#0a0a0a' }} />
      )}
    </div>
  );
}

function PhoneFrame({ device, children }) {
  const d = DEVICES[device];
  return (
    <div
      className="mx-auto shadow-2xl"
      style={{
        background: '#0a0a0a',
        padding: 12,
        borderRadius: d.radius,
        width: d.w + 24,
      }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: d.w,
          height: d.h,
          background: '#f5f6f5',
          borderRadius: d.radius - 8,
        }}
      >
        <StatusBar notch={d.notch} />
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>
    </div>
  );
}

// --- Bottom-Tabs -----------------------------------------------------------

function BottomTabs({ active, onChange }) {
  const tabs = [
    { id: 'heute',  label: 'Heute',  icon: Clock },
    { id: 'spesen', label: 'Spesen', icon: Receipt },
    { id: 'mehr',   label: 'Mehr',   icon: MoreHorizontal },
  ];
  return (
    <div className="border-t flex" style={{ borderColor: '#e4e7e4', background: '#fff' }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className="flex-1 flex flex-col items-center justify-center py-2 transition-colors"
            style={{ minHeight: 56, color: isActive ? '#7a9b7f' : '#9ca59c' }}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 font-medium">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- App-Header ------------------------------------------------------------

function AppHeader({ title }) {
  return (
    <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#e4e7e4', background: '#fff' }}>
      <h3 className="text-base font-semibold text-zinc-800">{title}</h3>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: '#7a9b7f' }}>
        SB
      </div>
    </div>
  );
}

// --- Heute-View ------------------------------------------------------------

function HeuteView({ employeeId }) {
  const [open, setOpen] = useState(false);

  const projectsQ = useQuery({
    queryKey: ['mobile-vorschau-projects'],
    queryFn: () => leProject.list({ status: 'offen' }),
    staleTime: 60_000,
  });

  const entriesQ = useQuery({
    queryKey: ['mobile-vorschau-entries', employeeId, todayIso()],
    queryFn: () => leTimeEntry.listForDate(todayIso(), { employeeId }),
    enabled: !!employeeId,
  });

  const entries = entriesQ.data ?? [];
  const totalH = entries.reduce((acc, e) => acc + (Number(e.hours) || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#f5f6f5' }}>
      {/* Big Quick-Rapport-Button */}
      <div className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full rounded-xl flex items-center justify-center gap-2 text-white font-semibold shadow-sm"
          style={{ background: '#7a9b7f', minHeight: 56 }}
        >
          <Plus className="w-5 h-5" />
          Schnell-Rapport
        </button>

        {open && (
          <Card className="mt-3 p-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Projekt</label>
              <select className="w-full mt-1 border rounded-lg px-2 text-sm bg-white" style={{ borderColor: '#d9dfd9', minHeight: 44 }}>
                <option value="">— Projekt wählen —</option>
                {(projectsQ.data ?? []).slice(0, 12).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Stunden</label>
                <input type="text" placeholder="1.50" className="w-full mt-1 border rounded-lg px-2 text-sm" style={{ borderColor: '#d9dfd9', minHeight: 44 }} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Datum</label>
                <input type="text" defaultValue={fmt.date(todayIso())} className="w-full mt-1 border rounded-lg px-2 text-sm" style={{ borderColor: '#d9dfd9', minHeight: 44 }} readOnly />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Beschreibung</label>
              <textarea rows={2} placeholder="Was wurde gemacht?" className="w-full mt-1 border rounded-lg px-2 py-1.5 text-sm" style={{ borderColor: '#d9dfd9' }} />
            </div>
            <button
              type="button"
              disabled
              title="Demo – speichert nichts"
              className="w-full rounded-lg text-white font-semibold opacity-70"
              style={{ background: '#7a9b7f', minHeight: 44 }}
            >
              Speichern
            </button>
          </Card>
        )}
      </div>

      {/* Heute-Header */}
      <div className="px-4 pt-2 pb-1 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-semibold text-zinc-500">Heute</span>
        <span className="text-xs text-zinc-500">{fmt.hours(totalH)} h</span>
      </div>

      <div className="px-3 pb-3 space-y-2">
        {entriesQ.isLoading && (
          <Card className="p-3 text-xs text-zinc-400">Lade Einträge…</Card>
        )}
        {entriesQ.isError && (
          <Card className="p-3 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Fehler beim Laden.
          </Card>
        )}
        {!entriesQ.isLoading && entries.length === 0 && (
          <Card className="p-4 text-center text-xs text-zinc-500">
            Noch keine Einträge heute. Tippe oben auf <b>Schnell-Rapport</b>.
          </Card>
        )}
        {entries.map((e) => (
          <Card key={e.id} className="p-3 flex items-center justify-between" style={{ minHeight: 56 }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-800 truncate">
                {e.project?.name || '—'}
              </div>
              <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                {e.description || e.service_type?.name || 'Leistung'}
              </div>
            </div>
            <div className="ml-2 text-right">
              <div className="text-sm font-semibold" style={{ color: '#3d4a3d' }}>
                {fmt.hours(e.hours)} h
              </div>
              <Chip tone={e.status === 'freigegeben' ? 'green' : 'neutral'} className="mt-1">
                {e.status || 'erfasst'}
              </Chip>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Spesen-View -----------------------------------------------------------

function SpesenView({ employeeId }) {
  const expensesQ = useQuery({
    queryKey: ['mobile-vorschau-expenses', employeeId],
    queryFn: () => leExpense.list({ employeeId, status: 'entwurf' }),
    enabled: !!employeeId,
  });
  const items = expensesQ.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#f5f6f5' }}>
      <div className="p-3">
        <button
          type="button"
          className="w-full rounded-xl flex flex-col items-center justify-center gap-1 text-white shadow-sm"
          style={{ background: '#7a9b7f', minHeight: 110 }}
        >
          <Camera className="w-8 h-8" />
          <span className="font-semibold">Beleg fotografieren</span>
          <span className="text-[10px] opacity-80">Spesen mit Foto erfassen</span>
        </button>
      </div>

      <div className="px-4 pt-1 pb-1 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-semibold text-zinc-500">Meine Entwürfe</span>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>

      <div className="px-3 pb-3 space-y-2">
        {expensesQ.isLoading && <Card className="p-3 text-xs text-zinc-400">Lade Spesen…</Card>}
        {expensesQ.isError && (
          <Card className="p-3 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Fehler beim Laden.
          </Card>
        )}
        {!expensesQ.isLoading && items.length === 0 && (
          <Card className="p-4 text-center text-xs text-zinc-500">
            Keine offenen Spesen-Entwürfe.
          </Card>
        )}
        {items.map((x) => (
          <Card key={x.id} className="p-3 flex items-center gap-2" style={{ minHeight: 56 }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#f1f1ef' }}>
              <Receipt className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-zinc-800 truncate">
                {x.description || x.category || 'Spese'}
              </div>
              <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                {fmt.date(x.expense_date)} · {x.project?.name || '—'}
              </div>
            </div>
            <div className="text-sm font-semibold text-zinc-800">
              {fmt.chf(x.amount)}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Mehr-View -------------------------------------------------------------

function MehrView() {
  const items = [
    { icon: Calendar,  label: 'Mein Wochenrapport' },
    { icon: FileText,  label: 'Meine Rapporte' },
    { icon: Receipt,   label: 'Meine Spesen' },
    { icon: Settings,  label: 'Einstellungen' },
    { icon: LogOut,    label: 'Logout', danger: true },
  ];
  return (
    <div className="flex-1 overflow-y-auto p-3" style={{ background: '#f5f6f5' }}>
      <Card className="overflow-hidden">
        {items.map((it, idx) => {
          const Icon = it.icon;
          return (
            <button
              key={idx}
              type="button"
              className="w-full flex items-center gap-3 px-3 border-b last:border-b-0 hover:bg-zinc-50 transition-colors"
              style={{ borderColor: '#eef0ee', minHeight: 52 }}
            >
              <Icon className="w-4 h-4" style={{ color: it.danger ? '#8a2d2d' : '#7a9b7f' }} />
              <span className="flex-1 text-left text-sm" style={{ color: it.danger ? '#8a2d2d' : '#3d4a3d' }}>
                {it.label}
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
          );
        })}
      </Card>
      <div className="text-[10px] text-zinc-400 text-center mt-3">
        Artis Leistungserfassung · Mobile (Vorschau)
      </div>
    </div>
  );
}

// --- Panel -----------------------------------------------------------------

export default function MobileVorschauPanel() {
  const [device, setDevice] = useState('iphone15');
  const [tab, setTab] = useState('heute');
  const [employeeId, setEmployeeId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await currentEmployee();
        if (!cancelled && me?.id) setEmployeeId(me.id);
      } catch { /* noop – Demo */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const headerTitle = useMemo(() => ({
    heute: 'Leistungserfassung',
    spesen: 'Spesen',
    mehr: 'Mehr',
  }[tab]), [tab]);

  return (
    <div>
      <PanelHeader
        title="Mobile-Vorschau"
        subtitle="So sieht die Leistungserfassung auf dem Smartphone aus (geplant)"
        right={
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <Smartphone className="w-4 h-4" /> Demo
          </span>
        }
      />

      {/* Demo-Notice */}
      <div
        className="rounded-lg border p-3 mb-4 flex items-start gap-2 text-xs"
        style={{ borderColor: '#b8c9e0', background: '#f4f7fb', color: '#2e4a7d' }}
      >
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          Diese Vorschau zeigt das geplante Mobile-UI. Tatsächlich wird die App
          responsive gebaut – mit dieser Vorschau testen wir die wichtigsten
          mobilen Flows (Schnell-Rapport, Spesen-Foto, Tagesübersicht).
        </div>
      </div>

      {/* Device-Toolbar */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">
          Gerät
        </span>
        {Object.entries(DEVICES).map(([key, d]) => {
          const isActive = device === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDevice(key)}
              className={artisBtn.ghost}
              style={isActive
                ? { background: '#7a9b7f', borderColor: '#7a9b7f', color: '#fff' }
                : artisGhostStyle}
            >
              <Smartphone className="w-3.5 h-3.5" />
              {d.label}
            </button>
          );
        })}
      </div>

      {/* Phone-Frame zentriert */}
      <div
        className="flex justify-center py-6 rounded-xl border"
        style={{ borderColor: '#e4e7e4', background: 'linear-gradient(180deg, #fafbfa 0%, #eef1ee 100%)' }}
      >
        <PhoneFrame device={device}>
          <AppHeader title={headerTitle} />
          {tab === 'heute' && <HeuteView employeeId={employeeId} />}
          {tab === 'spesen' && <SpesenView employeeId={employeeId} />}
          {tab === 'mehr' && <MehrView />}
          <BottomTabs active={tab} onChange={setTab} />
        </PhoneFrame>
      </div>

      <div className="text-[11px] text-zinc-400 mt-4 text-center">
        Daten sind echt (eingeloggter Mitarbeiter) – Aktionen sind in der Vorschau deaktiviert.
      </div>
    </div>
  );
}
