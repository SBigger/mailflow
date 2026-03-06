import React, { useState, useEffect, useContext } from "react";
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
  const cardBg     = isArtis ? "#ffffff"              : isLight ? "#ffffff"              : "rgba(39,39,42,0.7)";
  const cardBorder = isArtis ? "#d4e0d4"              : isLight ? "#d4d4e8"              : "#3f3f46";
  const expandBg   = isArtis ? "#f5f8f5"              : isLight ? "#f7f7fc"              : "rgba(24,24,27,0.9)";
  const inputBg    = isArtis ? "#ffffff"              : isLight ? "#ffffff"              : "rgba(24,24,27,0.8)";
  const inputBorder= isArtis ? "#bfcfbf"              : isLight ? "#c8c8dc"              : "#3f3f46";
  const textMain   = isArtis ? "#2d3a2d"              : isLight ? "#1a1a2e"              : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b"              : isLight ? "#7a7a9a"              : "#71717a";
  const accentBg   = isArtis ? "#7a9b7f"              : "#6366f1";
  return { cardBg, cardBorder, expandBg, inputBg, inputBorder, textMain, textMuted, accentBg };
}

const selectCls = "rounded border px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer";
const inputCls  = "rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400";

// ─────────────────────────────────────────────────────────────
// FristInlineRow – bestehende Frist direkt inline bearbeiten
// Optionales `customerName` prop zeigt Kundenbadge (für globale Ansicht)
// ─────────────────────────────────────────────────────────────
export function FristInlineRow({ frist, onUpdate, onDelete, onToggle, customerName }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = useRowStyles(isArtis, isLight);

  const [expanded, setExpanded] = useState(false);
  const [kanton,        setKanton]        = useState(frist.kanton        || "");
  const [jahr,          setJahr]          = useState(frist.jahr          || currentYear);
  const [dueDate,       setDueDate]       = useState(frist.due_date      || "");
  const [category,      setCategory]      = useState(frist.category      || "Steuererklärung");
  const [portalLogin,   setPortalLogin]   = useState(frist.portal_login  || "");
  const [portalPassword,setPortalPassword]= useState(frist.portal_password || "");
  const [showPw,        setShowPw]        = useState(false);

  useEffect(() => {
    setKanton(frist.kanton         || "");
    setJahr(frist.jahr             || currentYear);
    setDueDate(frist.due_date      || "");
    setCategory(frist.category     || "Steuererklärung");
    setPortalLogin(frist.portal_login   || "");
    setPortalPassword(frist.portal_password || "");
  }, [frist.id]);

  const buildTitle = (cat, kt, yr) =>
    [cat, kt, yr].filter(Boolean).join(" ");

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
        className="flex items-center gap-1.5 px-2 py-2 group"
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

        {/* Kanton */}
        <select
          value={kanton}
          onChange={e => { setKanton(e.target.value); save({ kanton: e.target.value }); }}
          className={selectCls}
          style={{ ...inStyle, width: "54px" }}
          disabled={isDone}
          title="Kanton"
        >
          <option value="">KT</option>
          {CH_KANTONE.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        {/* Jahr */}
        <select
          value={String(jahr)}
          onChange={e => { const y = parseInt(e.target.value); setJahr(y); save({ jahr: y }); }}
          className={selectCls}
          style={{ ...inStyle, width: "62px" }}
          disabled={isDone}
          title="Jahr"
        >
          {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
        </select>

        {/* Frist erhalten bis (due_date) */}
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          onBlur={e => { if (e.target.value) save({ due_date: e.target.value }); }}
          className={inputCls}
          style={{ ...inStyle, width: "132px" }}
          disabled={isDone}
          title="Frist erhalten bis"
        />

        {/* Art / Kategorie */}
        <select
          value={category}
          onChange={e => { setCategory(e.target.value); save({ category: e.target.value }); }}
          className={selectCls}
          style={{ ...inStyle, flex: 1, minWidth: "100px" }}
          disabled={isDone}
          title="Art der Frist"
        >
          {INLINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Kundenname (nur globale Ansicht) */}
        {customerName && (
          <span
            className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded border hidden md:inline truncate max-w-[120px]"
            style={{ backgroundColor: s.expandBg, borderColor: s.cardBorder, color: s.textMuted }}
            title={customerName}
          >
            {customerName}
          </span>
        )}

        {/* Expand Login/PW */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex-shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
          style={{ color: expanded ? s.accentBg : s.textMuted }}
          title={expanded ? "Login/Passwort ausblenden" : "Login/Passwort anzeigen"}
        >
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* Delete (on hover) */}
        <button
          onClick={() => onDelete(frist.id)}
          className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
// NewFristRow – neue Frist inline anlegen (kein Dialog)
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
  const [portalLogin,   setPortalLogin]   = useState("");
  const [portalPassword,setPortalPassword]= useState("");
  const [showPw,        setShowPw]        = useState(false);

  const inStyle = { backgroundColor: s.inputBg, borderColor: s.inputBorder, color: s.textMain };

  const handleSave = () => {
    if (!dueDate) return;
    const title = [category, kanton, String(jahr)].filter(Boolean).join(" ");
    onSave({
      title,
      kanton:          kanton || null,
      jahr,
      due_date:        dueDate,
      category,
      portal_login:    portalLogin  || null,
      portal_password: portalPassword || null,
      customer_id:     customerId,
      status:          "offen",
    });
  };

  return (
    <div
      className="rounded-lg border-2 overflow-hidden"
      style={{ borderColor: s.accentBg }}
    >
      {/* Main row */}
      <div className="flex items-center gap-1.5 px-2 py-2" style={{ backgroundColor: s.cardBg }}>
        {/* Placeholder circle */}
        <div
          className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-dashed"
          style={{ borderColor: s.textMuted }}
        />

        {/* Kanton */}
        <select
          value={kanton}
          onChange={e => setKanton(e.target.value)}
          className={selectCls}
          style={{ ...inStyle, width: "54px" }}
          autoFocus
        >
          <option value="">KT</option>
          {CH_KANTONE.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        {/* Jahr */}
        <select
          value={String(jahr)}
          onChange={e => setJahr(parseInt(e.target.value))}
          className={selectCls}
          style={{ ...inStyle, width: "62px" }}
        >
          {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
        </select>

        {/* Frist erhalten bis */}
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          className={inputCls}
          style={{ ...inStyle, width: "132px" }}
          placeholder="Datum *"
        />

        {/* Art */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className={selectCls}
          style={{ ...inStyle, flex: 1, minWidth: "100px" }}
        >
          {INLINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!dueDate}
          className="flex-shrink-0 p-1.5 rounded bg-green-500/20 text-green-600 hover:bg-green-500/30 disabled:opacity-30 transition-colors"
          title="Speichern"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        {/* Cancel */}
        <button
          onClick={onCancel}
          className="flex-shrink-0 p-1.5 rounded hover:bg-red-500/10 text-red-400 transition-colors"
          title="Abbrechen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
