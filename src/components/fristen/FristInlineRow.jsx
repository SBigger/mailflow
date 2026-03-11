import React, { useState, useEffect, useContext, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, Eye, EyeOff, ChevronDown, X, ArrowUp, ArrowDown, ArrowUpDown, KeyRound, MessageSquare, Copy, Globe } from "lucide-react";
import { ThemeContext } from "@/Layout";
import { supabase } from "@/api/supabaseClient";

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

function useCopyFeedback() {
  const [copied, setCopied] = React.useState(null);
  const copy = (key, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    }).catch(() => {});
  };
  return { copied, copy };
}
const inputCls  = "rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400";

// ── Spaltenbreiten (persistent via localStorage) ──────────────
const LS_KEY = "artis_fristen_col_widths";

export const DEFAULT_COL_WIDTHS = {
  name:        165,
  kanton:       92,
  spJahr:       84,
  fristBis:    130,
  unterlagen:  132,
  hDom:         74,
  portalLogin: 110,
  portalUid:    90,
  portalPw:     90,
};

export const COLS = [
  { key: "name",        label: "Kunde" },
  { key: "kanton",      label: "Kanton" },
  { key: "spJahr",      label: "SP Jahr" },
  { key: "fristBis",    label: "Frist bis" },
  { key: "unterlagen",  label: "Unterlagen erhalten" },
  { key: "hDom",        label: "H-Dom" },
  { key: "portalLogin", label: "Portal Login" },
  { key: "portalUid",   label: "UID" },
  { key: "portalPw",    label: "Passwort" },
];

function toGridCols(w, showName = true) {
  const cols = [];
  if (showName) cols.push(`${w.name}px`);
  cols.push(
    `${w.kanton}px`, `${w.spJahr}px`, `${w.fristBis}px`,
    `${w.unterlagen}px`, `${w.hDom}px`,
    `${w.portalLogin}px`, `${w.portalUid}px`, `${w.portalPw}px`,
  );
  return cols.join(" ");
}

export const ColWidthContext = React.createContext(null);

export function ColWidthProvider({ children }) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) } : { ...DEFAULT_COL_WIDTHS };
    } catch {
      return { ...DEFAULT_COL_WIDTHS };
    }
  });

  // Debounce-Timer für Supabase-Save
  const saveTimerRef = useRef(null);

  // Beim Mount: Spaltenbreiten aus Supabase laden (geräteübergreifend)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from("user_preferences")
          .select("col_widths")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled || !data?.col_widths) return;
        const merged = { ...DEFAULT_COL_WIDTHS, ...data.col_widths };
        setWidths(merged);
        try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch {}
      } catch {
        // Kein Problem – localStorage-Wert bleibt
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hilfsfunktion: Spaltenbreiten in Supabase speichern (upsert)
  const saveToSupabase = useCallback(async (newWidths) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_preferences").upsert(
        { user_id: user.id, col_widths: newWidths, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    } catch {
      // Fehler ignorieren – localStorage-Version bleibt erhalten
    }
  }, []);

  const updateWidth = useCallback((col, newWidth) => {
    setWidths(prev => {
      const next = { ...prev, [col]: Math.max(40, Math.round(newWidth)) };
      // Sofort in localStorage speichern (kein Flicker)
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      // Debounced in Supabase speichern (800ms nach letzter Änderung)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveToSupabase(next), 800);
      return next;
    });
  }, [saveToSupabase]);

  return (
    <ColWidthContext.Provider value={{ widths, updateWidth }}>
      {children}
    </ColWidthContext.Provider>
  );
}

// ── Multi-Kanton-Select ───────────────────────────────────────
// value: kommagetrennte Kantone z.B. "ZH,TI,BE"
// onChange: (newValue: string) => void
// Dropdown via Portal → escapes overflow:hidden auf Parent-Containern
export function KantonMultiSelect({ value, onChange, disabled, inStyle, s }) {
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
    <div style={{ width: "100%" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 flex items-center gap-1 w-full"
        style={{ ...inStyle }}
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
export function FristInlineRow({ frist, onUpdate, onDelete, onToggle, customerName, personType = "unternehmen", showName = true }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = useRowStyles(isArtis, isLight);

  const isPrivat = personType === "privatperson";
  const { copied, copy } = useCopyFeedback();

  const [kanton,          setKanton]          = useState(frist.kanton             || "");
  const [jahr,            setJahr]            = useState(frist.jahr               || currentYear);
  const [dueDate,         setDueDate]         = useState(frist.due_date           || "");
  const [unterlagenDatum, setUnterlagenDatum] = useState(frist.unterlagen_datum   || "");
  const [abschlussVorb,   setAbschlussVorb]   = useState(frist.abschluss_vorbereitet ?? false);
  const [category,        setCategory]        = useState(frist.category           || "Steuererklärung");
  const [hauptdomizil,    setHauptdomizil]    = useState(frist.ist_hauptsteuerdomizil !== false);
  const [portalLogin,     setPortalLogin]     = useState(frist.portal_login       || "");
  const [portalUid,       setPortalUid]       = useState(frist.portal_uid         || "");
  const [portalPassword,  setPortalPassword]  = useState(frist.portal_password    || "");
  const [showPw,          setShowPw]          = useState(false);
  const [showDesc,        setShowDesc]        = useState(false);
  const [description,     setDescription]     = useState(frist.description || "");

  useEffect(() => {
    setKanton(frist.kanton             || "");
    setJahr(frist.jahr                 || currentYear);
    setDueDate(frist.due_date          || "");
    setUnterlagenDatum(frist.unterlagen_datum || "");
    setAbschlussVorb(frist.abschluss_vorbereitet ?? false);
    setCategory(frist.category         || "Steuererklärung");
    setHauptdomizil(frist.ist_hauptsteuerdomizil !== false);
    setPortalLogin(frist.portal_login  || "");
    setPortalUid(frist.portal_uid       || "");
    setPortalPassword(frist.portal_password || "");
    setDescription(frist.description || "");
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
  const { widths = DEFAULT_COL_WIDTHS } = useContext(ColWidthContext) ?? {};

  // ── Abschluss-Hervorhebung (nur juristische Personen) ──────
  const isHighlighted = !isPrivat && abschlussVorb;
  const highlightBg     = isArtis ? "rgba(122,155,127,0.14)" : isLight ? "rgba(99,102,241,0.08)" : "rgba(16,185,129,0.13)";
  const highlightBorder = isArtis ? "#9ab89f"                : isLight ? "#a5b4fc"               : "#34d399";

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor: isHighlighted ? highlightBorder : s.cardBorder,
        borderWidth: isHighlighted ? 2 : 1,
        minWidth: "max-content",
      }}
    >

      {/* ── Main row ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 group"
        style={{ backgroundColor: isHighlighted ? highlightBg : s.cardBg, opacity: isDone ? 0.65 : 1 }}
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

        {/* ── Datenfelder – CSS-Grid für bündige Spalten ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: toGridCols(widths, showName),
            alignItems: "center",
            gap: "10px",
          }}
        >
          {/* Kundenname – nur wenn showName=true */}
          {showName && (
            <span
              className="text-xs font-semibold truncate"
              style={{ color: s.textMain }}
              title={customerName || ""}
            >
              {customerName || ""}
            </span>
          )}

          {/* Kanton(e) – Multi-Select */}
          <KantonMultiSelect
            value={kanton}
            onChange={v => { setKanton(v); save({ kanton: v }); }}
            disabled={isDone}
            inStyle={inStyle}
            s={s}
          />

          {/* Steuerperiode (Jahr) */}
          <div className="flex items-center gap-1" title="Steuerperiode">
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: s.textMuted }}>SP</span>
            <select
              value={String(jahr)}
              onChange={e => { const y = parseInt(e.target.value); setJahr(y); save({ jahr: y }); }}
              className={selectCls}
              style={{ ...inStyle, flex: 1, minWidth: 0 }}
              disabled={isDone}
            >
              {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>

          {/* Frist bis */}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            onBlur={e => save({ due_date: e.target.value || null })}
            className={inputCls}
            style={{ ...inStyle, width: "100%" }}
            disabled={isDone}
            title="Frist bis"
          />

          {/* 5. Spalte: Unterlagen erhalten (Privatperson) ODER Abschluss vorbereitet (Juristisch) */}
          {isPrivat ? (
            <input
              type="date"
              value={unterlagenDatum}
              onChange={e => setUnterlagenDatum(e.target.value)}
              onBlur={e => save({ unterlagen_datum: e.target.value || null })}
              className={inputCls}
              style={{ ...inStyle, width: "100%" }}
              disabled={isDone}
              title="Unterlagen erhalten"
            />
          ) : (
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              title="Abschluss vorbereitet"
              style={{ color: abschlussVorb ? s.accentBg : s.textMuted }}
            >
              <input
                type="checkbox"
                checked={abschlussVorb}
                onChange={e => {
                  setAbschlussVorb(e.target.checked);
                  save({ abschluss_vorbereitet: e.target.checked });
                }}
                disabled={isDone}
                style={{ accentColor: s.accentBg, cursor: "pointer", width: 14, height: 14 }}
              />
              <span className="text-xs font-medium">Abschluss</span>
            </label>
          )}

          {/* Hauptsteuerdomizil */}
          <label
            className="flex items-center gap-1 cursor-pointer select-none"
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
            <span className="text-xs font-medium">H-Dom</span>
          </label>

          {/* Portal Login */}
          <div className="relative flex items-center w-full">
            <input
              type="text"
              value={portalLogin}
              onChange={e => setPortalLogin(e.target.value)}
              onBlur={e => save({ portal_login: e.target.value || null })}
              placeholder="—"
              className={inputCls}
              style={{ ...inStyle, width: "100%", paddingRight: portalLogin ? "20px" : undefined }}
              title="Portal-Login"
            />
            {portalLogin && (
              <button
                type="button"
                onClick={() => copy("login", portalLogin)}
                className="absolute right-1 rounded hover:bg-black/5"
                style={{ color: copied === "login" ? "#22c55e" : s.textMuted }}
                title="Kopieren"
              >
                {copied === "login" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            )}
          </div>

          {/* UID */}
          <div className="relative flex items-center w-full">
            <input
              type="text"
              value={portalUid}
              onChange={e => setPortalUid(e.target.value)}
              onBlur={e => save({ portal_uid: e.target.value || null })}
              placeholder="—"
              className={inputCls}
              style={{ ...inStyle, width: "100%", paddingRight: portalUid ? "20px" : undefined }}
              title="UID"
            />
            {portalUid && (
              <button
                type="button"
                onClick={() => copy("uid", portalUid)}
                className="absolute right-1 rounded hover:bg-black/5"
                style={{ color: copied === "uid" ? "#22c55e" : s.textMuted }}
                title="Kopieren"
              >
                {copied === "uid" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            )}
          </div>

          {/* Passwort */}
          <div className="relative flex items-center w-full">
            <input
              type={showPw ? "text" : "password"}
              value={portalPassword}
              onChange={e => setPortalPassword(e.target.value)}
              onBlur={e => save({ portal_password: e.target.value || null })}
              placeholder="—"
              className={inputCls}
              style={{ ...inStyle, width: "100%", paddingRight: portalPassword ? "38px" : undefined }}
              autoComplete="new-password"
              title="Passwort"
            />
            {portalPassword && (
              <div className="absolute right-1 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => copy("pw", portalPassword)}
                  className="rounded hover:bg-black/5 p-0.5"
                  style={{ color: copied === "pw" ? "#22c55e" : s.textMuted }}
                  title="Kopieren"
                >
                  {copied === "pw" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="rounded hover:bg-black/5 p-0.5"
                  style={{ color: s.textMuted }}
                  title={showPw ? "Verbergen" : "Anzeigen"}
                >
                  {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Aktions-Bereich ── */}
        <div
          className="flex-shrink-0 flex items-center gap-1 pl-2 ml-1"
          style={{ borderLeft: `1px solid ${s.divider}` }}
        >
          {/* Eingereicht-Indikator */}
          {frist.einreichen_datum && (
            <button
              onClick={() => frist.einreichen_screenshot
                ? window.open(frist.einreichen_screenshot, "_blank")
                : null}
              className="p-1.5 rounded"
              style={{ color: "#22c55e" }}
              title={`Eingereicht am ${frist.einreichen_datum}${frist.einreichen_notiz ? " – " + frist.einreichen_notiz : ""}${frist.einreichen_screenshot ? "\nKlicken für Screenshot" : ""}`}
            >
              <Globe className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Bemerkung toggle */}
          <button
            onClick={() => setShowDesc(v => !v)}
            className="p-1.5 rounded hover:bg-blue-500/10 transition-opacity opacity-0 group-hover:opacity-100"
            style={{ color: description ? s.accentBg : s.textMuted }}
            title="Bemerkung"
          >
            <MessageSquare className="h-3.5 w-3.5" />
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

      {/* ── Bemerkung ── */}
      {showDesc && (
        <div
          className="px-3 py-2 border-t flex items-center gap-2"
          style={{ backgroundColor: s.expandBg, borderColor: s.divider }}
        >
          <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" style={{ color: s.textMuted }} />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={e => save({ description: e.target.value || null })}
            placeholder="Bemerkung / Notiz zur Frist..."
            className={inputCls}
            style={{ ...inStyle, flex: 1 }}
            disabled={isDone}
          />
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

          {/* Steuerperiode (Jahr) */}
          <div className="flex items-center gap-1 flex-shrink-0" title="Steuerperiode">
            <span className="text-xs font-semibold" style={{ color: s.textMuted }}>SP</span>
            <select
              value={String(jahr)}
              onChange={e => setJahr(parseInt(e.target.value))}
              className={selectCls}
              style={{ ...inStyle, width: "60px" }}
            >
              {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>

          {/* Frist bis (optional) */}
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            className={inputCls}
            style={{ ...inStyle, width: "130px", flexShrink: 0 }}
            title="Frist bis (optional)"
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
            <span className="text-xs font-medium">H-Dom</span>
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

// ─────────────────────────────────────────────────────────────
// FristenColumnHeader – Spaltentitel mit Drag-Resize-Handles
// ─────────────────────────────────────────────────────────────
export function FristenColumnHeader({ personType = "unternehmen", sortCol, sortDir, onSort }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = useRowStyles(isArtis, isLight);
  const { widths = DEFAULT_COL_WIDTHS, updateWidth = () => {} } =
    useContext(ColWidthContext) ?? {};

  // 5. Spalte: Label je nach Personentyp
  const isPrivat = personType === "privatperson";
  const cols = COLS.map((col, i) =>
    i === 4 ? { ...col, label: isPrivat ? "Unterlagen erhalten" : "Abschluss vorb." } : col
  );

  const startResize = (e, colKey) => {
    e.preventDefault();
    const startX   = e.clientX;
    const startW   = widths[colKey];
    const onMove   = (mv) => updateWidth(colKey, startW + mv.clientX - startX);
    const onUp     = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };

  const handleColor = isArtis ? "#b0c8b0" : isLight ? "#c0c0d8" : "#52525b";

  const SortIcon = ({ colKey }) => {
    if (sortCol !== colKey) return <ArrowUpDown className="h-3 w-3 opacity-25 group-hover:opacity-60 transition-opacity" />;
    return sortDir === "asc"
      ? <ArrowUp   className="h-3 w-3" style={{ color: s.accentBg }} />
      : <ArrowDown className="h-3 w-3" style={{ color: s.accentBg }} />;
  };

  return (
    <div
      className="flex items-center gap-2 px-3 pt-2 pb-1.5 mb-1 select-none"
      style={{ borderBottom: `1px solid ${s.divider}`, minWidth: "max-content" }}
    >
      {/* Spacer: Done-Toggle */}
      <div style={{ width: 20, flexShrink: 0 }} />

      {/* Grid – gleiche Spalten wie FristInlineRow */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: toGridCols(widths),
          gap: "10px",
        }}
      >
        {cols.map((col, i) => (
          <div key={col.key} style={{ position: "relative", overflow: "visible" }}>
            {/* Klickbarer Sort-Button */}
            <button
              type="button"
              onClick={() => onSort && onSort(col.key)}
              className="flex items-center gap-1 group text-left w-full"
              title={`Nach ${col.label} sortieren`}
              style={{ color: sortCol === col.key ? s.accentBg : s.textMuted }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide">
                {col.label}
              </span>
              <SortIcon colKey={col.key} />
            </button>

            {/* Resize-Handle (nicht beim letzten) */}
            {i < cols.length - 1 && (
              <div
                onMouseDown={(e) => { e.stopPropagation(); startResize(e, col.key); }}
                style={{
                  position: "absolute",
                  right: -7,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 12,
                  height: 20,
                  cursor: "col-resize",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 10,
                }}
                title="Spalte ziehen zum Vergrössern"
              >
                <div style={{
                  width: 2,
                  height: 14,
                  backgroundColor: handleColor,
                  borderRadius: 1,
                }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Spacer: Aktions-Bereich */}
      <div style={{ width: 32, flexShrink: 0 }} />
    </div>
  );
}
