import React, { useState, useEffect, useContext, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, Eye, EyeOff, ChevronDown, ChevronUp, KeyRound, X } from "lucide-react";
import { ThemeContext } from "@/Layout";

// ── CH Kantone ────────────────────────────────────────────────
const CH_KANTONE = [
  "AG","AI","AR","BE","BL","BS","FR","GE","GL","GR",
  "JU","LU","NE","NW","OW","SG","SH","SO","SZ","TG",
  "TI","UR","VD","VS","ZG","ZH",
];

// ── Kategorien ────────────────────────────────────────────────
export const INLINE_CATEGORIES = [
  "Steuererklärung",
  "MWST",
  "Lohnabrechnung",
  "AHV / IV / ALV",
  "Jahresabschluss",
  "Pensionskasse",
  "Unfallversicherung",
  "Behörden",
  "Verschiedenes",
];

const currentYear = new Date().getFullYear();
export const YEARS = Array.from({ length: 8 }, (_, i) => currentYear - 3 + i);

// ── Shared style helpers ──────────────────────────────────────
function useRowStyles(isArtis, isLight) {
  const cardBg     = isArtis ? "#ffffff"           : isLight ? "#ffffff"           : "rgba(39,39,42,0.7)";
  const cardBorder = isArtis ? "#d4e0d4"           : isLight ? "#d4d4e8"           : "#3f3f46";
  const expandBg   = isArtis ? "#f5f8f5"           : isLight ? "#f7f7fc"           : "rgba(24,24,27,0.9)";
  const inputBg    = isArtis ? "#ffffff"           : isLight ? "#ffffff"           : "rgba(24,24,27,0.8)";
  const inputBorder= isArtis ? "#bfcfbf"           : isLight ? "#c8c8dc"           : "#3f3f46";
  const textMain   = isArtis ? "#2d3a2d"           : isLight ? "#1a1a2e"           : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b"           : isLight ? "#7a7a9a"           : "#71717a";
  const accentBg   = isArtis ? "#7a9b7f"           : "#6366f1";
  const divider    = isArtis ? "#d4e0d4"           : isLight ? "#d4d4e8"           : "#3f3f46";
  const checkBg    = isArtis ? "rgba(122,155,127,0.15)" : isLight ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.15)";
  return { cardBg, cardBorder, expandBg, inputBg, inputBorder, textMain, textMuted, accentBg, divider, checkBg };
}

const selectCls = "rounded border px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer";
const inputCls  = "rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400";

// ── Multi-Kanton-Select ───────────────────────────────────────
// value: kommagetrennte Kantone z.B. "ZH,TI,BE"
// onChange: (newValue: string) => void
// Dropdown via Portal → escapes overflow:hidden auf Parent-Containern
function KantonMultiSelect({ value, onChange, disabled, inStyle, s }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const selected = value ? value.split(",").filter(Boolean) : [];

  // Schliessen bei Klick ausserhalb (Button UND Portal-Dropdown prüfen)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inBtn  = btnRef.current  && btnRef.current.contains(e.target);
      const inDrop = dropRef.current && dropRef.current.contains(e.target);
      if (!inBtn && !inDrop) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(v => !v);
  };

  const toggle = (kt) => {
    const next = selected.includes(kt)
      ? selected.filter(k => k !== kt)
      : [...selected, kt];
    onChange(next.join(","));
  };

  const label =
    selected.length === 0 ? "KT"
    : selected.length === 1 ? selected[0]
    : selected.length === 2 ? selected.join(", ")
    : `${selected[0]} +${selected.length - 1}`;

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 flex items-center gap-1"
        style={{ ...inStyle, minWidth: "72px", maxWidth: "100px" }}
        title={selected.length > 0 ? selected.join(", ") : "Kanton(e) wählen"}
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            zIndex: 9999,
            backgroundColor: inStyle.backgroundColor,
            border: `1px solid ${inStyle.borderColor}`,
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            maxHeight: 260,
            overflowY: "auto",
            minWidth: 100,
          }}
        >
          {CH_KANTONE.map(kt => (
            <label
              key={kt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 12px",
                cursor: "pointer",
                fontSize: 12,
                color: inStyle.color,
                backgroundColor: selected.includes(kt) ? s.checkBg : "transparent",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(kt)}
                onChange={() => toggle(kt)}
                style={{ accentColor: s.accentBg, cursor: "pointer" }}
              />
              <span style={{ fontWeight: selected.includes(kt) ? 600 : 400 }}>{kt}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FristInlineRow – bestehende Frist direkt inline bearbeiten
// ─────────────────────────────────────────────────────────────
export function FristInlineRow({ frist, onUpdate, onDelete, onToggle, customerName }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = useRowStyles(isArtis, isLight);

  const [expanded,        setExpanded]        = useState(false);
  const [kanton,          setKanton]          = useState(frist.kanton             || "");
  const [jahr,            setJahr]            = useState(frist.jahr               || currentYear);
  const [dueDate,         setDueDate]         = useState(frist.due_date           || "");
  const [category,        setCategory]        = useState(frist.category           || "Steuererklärung");
  const [hauptdomizil,    setHauptdomizil]    = useState(frist.ist_hauptsteuerdomizil !== false);
  const [portalLogin,     setPortalLogin]     = useState(frist.portal_login       || "");
  const [portalPassword,  setPortalPassword]  = useState(frist.portal_password    || "");
  const [showPw,          setShowPw]          = useState(false);

  useEffect(() => {
    setKanton(frist.kanton             || "");
    setJahr(frist.jahr                 || currentYear);
    setDueDate(frist.due_date          || "");
    setCategory(frist.category         || "Steuererklärung");
    setHauptdomizil(frist.ist_hauptsteuerdomizil !== false);
    setPortalLogin(frist.portal_login  || "");
    setPortalPassword(frist.portal_password || "");
  }, [frist.id]);

  const buildTitle = (cat, kt, yr) =>
    [cat, kt ? kt.replace(/,/g, "/") : "", yr].filter(Boolean).join(" ");

  const save = (patch) => {
    const cat = patch.category ?? category;
    const kt  = patch.kanton   ?? kanton;
    const yr  = patch.jahr     ?? jahr;
    onUpdate(frist.id, { title: buildTitle(cat, kt, yr), ...patch });
  };

  const isDone = frist.status === "erledigt";
  const inStyle = { backgroundColor: s.inputBg, borderColor: s.inputBorder, color: s.textMain };

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: s.cardBorder }}>

      {/* ── Main row ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 group"
        style={{ backgroundColor: s.cardBg, opacity: isDone ? 0.65 : 1 }}
      >
        {/* Done toggle */}
        <button
          onClick={() => onToggle(frist)}
          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            isDone ? "bg-green-500 border-green-500 text-white" : "border-zinc-400 hover:border-green-500 hover:bg-green-500/10"
          }`}
        >
          {isDone && <Check className="h-3 w-3" />}
        </button>

        {/* ── Datenfelder ── */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Kanton(e) – Multi-Select */}
          <KantonMultiSelect
            value={kanton}
            onChange={v => { setKanton(v); save({ kanton: v }); }}
            disabled={isDone}
            inStyle={inStyle}
            s={s}
          />

          {/* Jahr */}
          <select
            value={String(jahr)}
            onChange={e => { const y = parseInt(e.target.value); setJahr(y); save({ jahr: y }); }}
            className={selectCls}
            style={{ ...inStyle, width: "66px", flexShrink: 0 }}
            disabled={isDone}
            title="Jahr"
          >
            {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>

          {/* Frist erhalten bis */}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            onBlur={e => save({ due_date: e.target.value || null })}
            className={inputCls}
            style={{ ...inStyle, width: "130px", flexShrink: 0 }}
            disabled={isDone}
            title="Frist erhalten bis"
          />

          {/* Art / Kategorie */}
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); save({ category: e.target.value }); }}
            className={selectCls}
            style={{ ...inStyle, flex: 1, minWidth: "110px" }}
            disabled={isDone}
            title="Art der Frist"
          >
            {INLINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Hauptsteuerdomizil */}
          <label
            className="flex-shrink-0 flex items-center gap-1 cursor-pointer select-none"
            title="Hauptsteuerdomizil"
            style={{ color: hauptdomizil ? s.accentBg : s.textMuted }}
          >
            <input
              type="checkbox"
              checked={hauptdomizil}
              onChange={e => {
                setHauptdomizil(e.target.checked);
                save({ ist_hauptsteuerdomizil: e.target.checked });
              }}
              disabled={isDone}
              style={{ accentColor: s.accentBg, cursor: "pointer" }}
            />
            <span className="text-xs font-medium">HKT</span>
          </label>
        </div>

        {/* ── Aktions-Bereich ── */}
        <div
          className="flex-shrink-0 flex items-center gap-1 pl-2 ml-1"
          style={{ borderLeft: `1px solid ${s.divider}` }}
        >
          {/* Kundenname (nur globale Ansicht) */}
          {customerName && (
            <span
              className="text-xs px-1.5 py-0.5 rounded border hidden md:inline truncate max-w-[110px]"
              style={{ backgroundColor: s.expandBg, borderColor: s.cardBorder, color: s.textMuted }}
              title={customerName}
            >
              {customerName}
            </span>
          )}

          {/* Expand Login/PW */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded hover:bg-black/5 transition-colors"
            style={{ color: expanded ? s.accentBg : s.textMuted }}
            title={expanded ? "Login/Passwort ausblenden" : "Login/Passwort anzeigen"}
          >
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(frist.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Löschen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Expanded: Login + Passwort ── */}
      {expanded && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-t"
          style={{ backgroundColor: s.expandBg, borderColor: s.cardBorder }}
        >
          <KeyRound className="h-3.5 w-3.5 flex-shrink-0" style={{ color: s.textMuted }} />
          <input
            placeholder="Portal-Login"
            value={portalLogin}
            onChange={e => setPortalLogin(e.target.value)}
            onBlur={e => save({ portal_login: e.target.value || null })}
            className={inputCls}
            style={{ ...inStyle, flex: 1 }}
            disabled={isDone}
          />
          <input
            type={showPw ? "text" : "password"}
            placeholder="Passwort"
            value={portalPassword}
            onChange={e => setPortalPassword(e.target.value)}
            onBlur={e => save({ portal_password: e.target.value || null })}
            className={inputCls}
            style={{ ...inStyle, flex: 1 }}
            disabled={isDone}
            autoComplete="new-password"
          />
          <button
            onClick={() => setShowPw(v => !v)}
            className="flex-shrink-0 p-1 rounded hover:bg-black/5"
            style={{ color: s.textMuted }}
            title={showPw ? "Verbergen" : "Anzeigen"}
          >
            {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NewFristRow – neue Frist inline anlegen
// ─────────────────────────────────────────────────────────────
export function NewFristRow({ onSave, onCancel, customerId }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = useRowStyles(isArtis, isLight);

  const [kanton,        setKanton]        = useState("");
  const [jahr,          setJahr]          = useState(currentYear);
  const [dueDate,       setDueDate]       = useState("");
  const [category,      setCategory]      = useState("Steuererklärung");
  const [hauptdomizil,  setHauptdomizil]  = useState(true);
  const [portalLogin,   setPortalLogin]   = useState("");
  const [portalPassword,setPortalPassword]= useState("");
  const [showPw,        setShowPw]        = useState(false);

  const inStyle = { backgroundColor: s.inputBg, borderColor: s.inputBorder, color: s.textMain };

  const handleSave = () => {
    const title = [category, kanton ? kanton.replace(/,/g, "/") : "", String(jahr)]
      .filter(Boolean).join(" ");
    onSave({
      title,
      kanton:                  kanton  || null,
      jahr,
      due_date:                dueDate || null,
      category,
      is_recurring:            false,
      ist_hauptsteuerdomizil:  hauptdomizil,
      portal_login:            portalLogin    || null,
      portal_password:         portalPassword || null,
      customer_id:             customerId,
      status:                  "offen",
    });
  };

  return (
    <div
      className="rounded-lg border-2 overflow-hidden"
      style={{ borderColor: s.accentBg }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: s.cardBg }}>
        {/* Placeholder circle */}
        <div
          className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-dashed"
          style={{ borderColor: s.textMuted }}
        />

        {/* ── Datenfelder ── */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Kanton(e) – Multi-Select */}
          <KantonMultiSelect
            value={kanton}
            onChange={setKanton}
            inStyle={inStyle}
            s={s}
          />

          {/* Jahr */}
          <select
            value={String(jahr)}
            onChange={e => setJahr(parseInt(e.target.value))}
            className={selectCls}
            style={{ ...inStyle, width: "66px", flexShrink: 0 }}
          >
            {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>

          {/* Frist erhalten bis (optional) */}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            className={inputCls}
            style={{ ...inStyle, width: "130px", flexShrink: 0 }}
            title="Frist erhalten bis (optional)"
          />

          {/* Art */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={selectCls}
            style={{ ...inStyle, flex: 1, minWidth: "110px" }}
            autoFocus
          >
            {INLINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Hauptsteuerdomizil */}
          <label
            className="flex-shrink-0 flex items-center gap-1 cursor-pointer select-none"
            title="Hauptsteuerdomizil"
            style={{ color: hauptdomizil ? s.accentBg : s.textMuted }}
          >
            <input
              type="checkbox"
              checked={hauptdomizil}
              onChange={e => setHauptdomizil(e.target.checked)}
              style={{ accentColor: s.accentBg, cursor: "pointer" }}
            />
            <span className="text-xs font-medium">HKT</span>
          </label>
        </div>

        {/* ── Aktions-Buttons ── */}
        <div
          className="flex-shrink-0 flex items-center gap-1 pl-2 ml-1"
          style={{ borderLeft: `1px solid ${s.divider}` }}
        >
          {/* Save – immer aktiv */}
          <button
            onClick={handleSave}
            className="p-1.5 rounded bg-green-500/20 text-green-600 hover:bg-green-500/30 transition-colors"
            title="Speichern"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          {/* Cancel */}
          <button
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-red-500/10 text-red-400 transition-colors"
            title="Abbrechen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Login / Passwort – immer sichtbar bei neuer Frist */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-t"
        style={{ backgroundColor: s.expandBg, borderColor: s.inputBorder }}
      >
        <KeyRound className="h-3.5 w-3.5 flex-shrink-0" style={{ color: s.textMuted }} />
        <input
          placeholder="Portal-Login (optional)"
          value={portalLogin}
          onChange={e => setPortalLogin(e.target.value)}
          className={inputCls}
          style={{ ...inStyle, flex: 1 }}
        />
        <input
          type={showPw ? "text" : "password"}
          placeholder="Passwort (optional)"
          value={portalPassword}
          onChange={e => setPortalPassword(e.target.value)}
          className={inputCls}
          style={{ ...inStyle, flex: 1 }}
          autoComplete="new-password"
        />
        <button
          onClick={() => setShowPw(v => !v)}
          className="flex-shrink-0 p-1 rounded hover:bg-black/5"
          style={{ color: s.textMuted }}
        >
          {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
