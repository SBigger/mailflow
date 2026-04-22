import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { isMissingTableError } from '@/lib/leApi';

// Farbchip in Artis-Look
export const Chip = ({ children, tone = 'neutral', className = '' }) => {
  const styles = {
    neutral: { bg: '#f1f1ef', col: '#4a4a4a', bd: '#dcdcd4' },
    green:   { bg: '#e6ede6', col: '#2d5a2d', bd: '#bfd3bf' },
    orange:  { bg: '#fff4e0', col: '#8a5a00', bd: '#f3d9a4' },
    blue:    { bg: '#e3eaf5', col: '#2e4a7d', bd: '#b8c9e0' },
    red:     { bg: '#fce4e4', col: '#8a2d2d', bd: '#e8b4b4' },
    violet:  { bg: '#ede3f7', col: '#4d2995', bd: '#c9b8e0' },
  }[tone] ?? { bg: '#f1f1ef', col: '#4a4a4a', bd: '#dcdcd4' };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${className}`}
      style={{ background: styles.bg, color: styles.col, borderColor: styles.bd }}
    >
      {children}
    </span>
  );
};

// Artis-Card
export const Card = ({ children, className = '', style = {} }) => (
  <div className={`rounded-lg border ${className}`} style={{ borderColor: '#e4e7e4', background: '#fff', ...style }}>
    {children}
  </div>
);

// Artis Button-Styles (light)
export const artisBtn = {
  primary: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium text-white transition-colors',
  ghost:   'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border transition-colors',
};
export const artisPrimaryStyle = { background: '#7a9b7f' };
export const artisGhostStyle = { borderColor: '#d1dcd1', color: '#3d4a3d', background: '#fff' };

// Icon-Button ohne Text
export const IconBtn = ({ children, onClick, title, danger }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="w-7 h-7 flex items-center justify-center rounded border text-zinc-500 hover:bg-zinc-50 transition-colors"
    style={{ borderColor: danger ? '#e8b4b4' : '#e4e7e4', color: danger ? '#8a2d2d' : undefined }}
  >
    {children}
  </button>
);

// Input mit Artis-Optik
export const Input = React.forwardRef(({ className = '', style = {}, ...props }, ref) => (
  <input
    ref={ref}
    className={`w-full border rounded px-2 py-1.5 text-sm ${className}`}
    style={{ borderColor: '#d9dfd9', ...style }}
    {...props}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef(({ className = '', style = {}, children, ...props }, ref) => (
  <select
    ref={ref}
    className={`w-full border rounded px-2 py-1.5 text-sm bg-white ${className}`}
    style={{ borderColor: '#d9dfd9', ...style }}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

// Label über Input
export const Field = ({ label, children, hint }) => (
  <label className="block text-xs">
    <span className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <div className="text-[10px] text-zinc-400 mt-0.5">{hint}</div>}
  </label>
);

// Loader zentriert
export const PanelLoader = () => (
  <div className="flex items-center justify-center py-12 text-zinc-400">
    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Lade…
  </div>
);

// Standardisiertes Error-/Empty-Panel – erkennt fehlende Migration
export const PanelError = ({ error, onRetry }) => {
  const missing = isMissingTableError(error);
  return (
    <div className="rounded-lg border p-5 text-sm" style={{ borderColor: missing ? '#f3d9a4' : '#e8b4b4', background: missing ? '#fff8e6' : '#fff4f4', color: missing ? '#8a5a00' : '#8a2d2d' }}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          {missing ? (
            <>
              <div className="font-semibold">DB-Schema für Leistungserfassung ist noch nicht migriert.</div>
              <div className="mt-1 text-xs">
                Führe <code className="bg-white/70 px-1 rounded">supabase/migrations/le/0001_le_core_schema.sql</code> im
                Supabase-SQL-Editor aus. Danach <b>Seite neu laden</b>.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">Fehler beim Laden</div>
              <div className="mt-1 text-xs break-all">{String(error?.message ?? error)}</div>
            </>
          )}
          {onRetry && (
            <button onClick={onRetry} className="mt-3 text-xs underline">
              Erneut versuchen
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Standard-Header für Panels
export const PanelHeader = ({ title, subtitle, right }) => (
  <div className="flex items-start justify-between gap-4 mb-4">
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2">{right}</div>}
  </div>
);

export const fmt = {
  hours: (h) => (h == null || h === '' ? '—' : Number(h).toFixed(2).replace('.', '.')),
  chf: (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  date: (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('de-CH');
  },
};
