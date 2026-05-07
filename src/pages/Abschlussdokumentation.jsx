import React, { useState, useContext, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  BookCheck, FileSpreadsheet, Upload, Download, ChevronRight, Wrench,
  Lock, Unlock, CheckCircle2, AlertCircle, TrendingUp, TrendingDown,
  Search, ChevronDown, ChevronUp, X, FileText, BarChart2, RotateCcw,
} from "lucide-react";

// ── Swiss Kontenrahmen KMU ────────────────────────────────────────────────────
const KONTENRAHMEN_POSITIONEN = [
  // BILANZ – AKTIVEN
  { id: "UV_FLUESSIG",      label: "Flüssige Mittel",                  typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1000, bis: 1059, level: 2 },
  { id: "UV_WERTSCHRIFTEN", label: "Wertschriften UV",                 typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1060, bis: 1099, level: 2 },
  { id: "UV_FORD_LL",       label: "Forderungen aus L+L",              typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1100, bis: 1109, level: 2 },
  { id: "UV_FORD_SONST",    label: "Übrige Forderungen",               typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1110, bis: 1179, level: 2 },
  { id: "UV_VORRAETE",      label: "Warenvorräte",                     typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1200, bis: 1269, level: 2 },
  { id: "UV_ABGRENZUNG",    label: "Aktive Rechnungsabgrenzung",       typ: "bilanz", seite: "aktiven",  gruppe: "Umlaufvermögen",    von: 1300, bis: 1309, level: 2 },
  { id: "AV_FINANZ",        label: "Finanzanlagen",                    typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1400, bis: 1479, level: 2 },
  { id: "AV_MOBIL",         label: "Mobile Sachanlagen",               typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1500, bis: 1599, level: 2 },
  { id: "AV_IMMOBIL",       label: "Immobile Sachanlagen",             typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1600, bis: 1699, level: 2 },
  { id: "AV_IMMATERIELL",   label: "Immaterielle Werte",               typ: "bilanz", seite: "aktiven",  gruppe: "Anlagevermögen",    von: 1700, bis: 1799, level: 2 },
  // BILANZ – PASSIVEN
  { id: "FK_KURZ_LL",         label: "Verbindlichkeiten aus L+L",          typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",   von: 2000, bis: 2009, level: 2 },
  { id: "FK_KURZ_BANK",       label: "Kurzfristige Bankverbindlichkeiten", typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",   von: 2010, bis: 2069, level: 2 },
  { id: "FK_KURZ_SONST",      label: "Übrige kurzfristige Verbindlichkeiten", typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK", von: 2070, bis: 2299, level: 2 },
  { id: "FK_KURZ_ABGRENZUNG", label: "Passive Rechnungsabgrenzung",        typ: "bilanz", seite: "passiven", gruppe: "Kurzfristiges FK",   von: 2300, bis: 2399, level: 2 },
  { id: "FK_LANG_BANK",        label: "Langfristige Bankverbindlichkeiten", typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",   von: 2400, bis: 2499, level: 2 },
  { id: "FK_LANG_SONST",       label: "Übrige langfristige Verbindlichkeiten", typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK", von: 2500, bis: 2599, level: 2 },
  { id: "FK_RUECKSTELLUNGEN",  label: "Rückstellungen",                     typ: "bilanz", seite: "passiven", gruppe: "Langfristiges FK",   von: 2600, bis: 2799, level: 2 },
  { id: "EK_KAPITAL",          label: "Grund-/Stammkapital",                typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital",       von: 2800, bis: 2819, level: 2 },
  { id: "EK_RESERVEN",         label: "Reserven & Gewinnvortrag",           typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital",       von: 2820, bis: 2889, level: 2 },
  { id: "EK_JAHRESERGEBNIS",   label: "Jahresergebnis",                     typ: "bilanz", seite: "passiven", gruppe: "Eigenkapital",       von: 2890, bis: 2999, level: 2 },
  // ERFOLGSRECHNUNG
  { id: "ER_UMSATZ",          label: "Nettoumsatzerlöse",               typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3000, bis: 3699, level: 2 },
  { id: "ER_EIGENLEISTUNG",   label: "Eigenleistungen",                 typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3700, bis: 3799, level: 2 },
  { id: "ER_BESTAND",         label: "Bestandesveränderungen",          typ: "er", seite: "ertrag",  gruppe: "Betriebsertrag",   von: 3800, bis: 3999, level: 2 },
  { id: "ER_MATERIAL",        label: "Materialaufwand",                 typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 4000, bis: 4799, level: 2 },
  { id: "ER_PERSONAL",        label: "Personalaufwand",                 typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 5000, bis: 5999, level: 2 },
  { id: "ER_BETRIEB",         label: "Übriger Betriebsaufwand",         typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 6000, bis: 6699, level: 2 },
  { id: "ER_ABSCHR",          label: "Abschreibungen",                  typ: "er", seite: "aufwand", gruppe: "Betriebsaufwand",  von: 6700, bis: 6899, level: 2 },
  { id: "ER_FINANZ_ERTRAG",   label: "Finanzertrag",                    typ: "er", seite: "ertrag",  gruppe: "Finanzergebnis",   von: 7000, bis: 7099, level: 2 },
  { id: "ER_FINANZ_AUFW",     label: "Finanzaufwand",                   typ: "er", seite: "aufwand", gruppe: "Finanzergebnis",   von: 7100, bis: 7499, level: 2 },
  { id: "ER_LIEGENSCHAFTEN",  label: "Liegenschaftsertrag/-aufwand",    typ: "er", seite: "ertrag",  gruppe: "Finanzergebnis",   von: 7500, bis: 7999, level: 2 },
  { id: "ER_FREMD_ERTRAG",    label: "Betriebsfremder Ertrag",          typ: "er", seite: "ertrag",  gruppe: "Betriebsfremd",    von: 8000, bis: 8099, level: 2 },
  { id: "ER_FREMD_AUFW",      label: "Betriebsfremder Aufwand",         typ: "er", seite: "aufwand", gruppe: "Betriebsfremd",    von: 8100, bis: 8499, level: 2 },
  { id: "ER_AO_ERTRAG",       label: "Ausserordentlicher Ertrag",       typ: "er", seite: "ertrag",  gruppe: "Ausserordentlich", von: 8500, bis: 8599, level: 2 },
  { id: "ER_AO_AUFW",         label: "Ausserordentlicher Aufwand",      typ: "er", seite: "aufwand", gruppe: "Ausserordentlich", von: 8600, bis: 8899, level: 2 },
  { id: "ER_STEUERN",         label: "Ertragssteuern",                  typ: "er", seite: "aufwand", gruppe: "Steuern",          von: 8900, bis: 8999, level: 2 },
  { id: "ABSCHLUSS",          label: "Abschlusskonten",                 typ: "er", seite: "aufwand", gruppe: "Abschluss",        von: 9000, bis: 9999, level: 2 },
];

// Lookup-Map für schnellen Zugriff
const POSITION_MAP = Object.fromEntries(KONTENRAHMEN_POSITIONEN.map(p => [p.id, p]));

// ── Auto-Mapping Funktion ─────────────────────────────────────────────────────
function autoMapKonto(kontonummer) {
  const nr = parseInt(kontonummer);
  if (isNaN(nr)) return null;
  return KONTENRAHMEN_POSITIONEN.find(p => nr >= p.von && nr <= p.bis)?.id || null;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function fmtCHF(val, digits = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCHFshort(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return "CHF\u00a0" + fmtCHF(val);
}

function todayStr() {
  return new Date().toLocaleDateString("de-CH");
}

function currentYear() {
  return new Date().getFullYear();
}

const YEARS = Array.from({ length: 11 }, (_, i) => 2020 + i);

const STATUS_CONFIG = {
  in_arbeit:    { label: "In Arbeit",    bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" },
  abgeschlossen:{ label: "Abgeschlossen",bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  genehmigt:    { label: "Genehmigt",   bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
};

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportKontenCSV(konten, customerName, jahr) {
  const headers = ["Konto-Nr", "Kontoname", "Position", "Saldo IST", "Saldo VJ", "Notiz"];
  const rows = konten.map(k => {
    const pos = k.position_id;
    const posLabel = pos ? (POSITION_MAP[pos]?.label || pos) : "—";
    return [
      k.kontonummer, k.kontoname, posLabel,
      k.saldo_ist ?? "", k.saldo_vorjahr ?? "", k.notiz ?? "",
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  });
  const bom = "\uFEFF";
  const csv = bom + [
    `"Abschlussdokumentation – ${customerName} – ${jahr}"`,
    `"Erstellt am: ${todayStr()}"`,
    "",
    headers.map(h => `"${h}"`).join(";"),
    ...rows,
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Abschluss_${customerName.replace(/[^a-zA-Z0-9]/g, "_")}_${jahr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Mandanten-Dropdown (wiederverwendet aus Fahrzeugliste-Pattern) ────────────
function MandantDropdown({ kunden, selectedCid, onChange, panelBg, panelBdr, headingC, subC, accent, withAbschlussSet }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const inputRef = useRef(null);

  const getLabel = (c) => c.person_type === "privatperson"
    ? [c.anrede, c.nachname, c.vorname].filter(Boolean).join(" ") + (c.ort ? ` · ${c.ort}` : "")
    : c.company_name + (c.ort ? ` · ${c.ort}` : "");

  const selected = kunden.find(c => c.id === selectedCid);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 320 ? rect.bottom + 4 : rect.top - 320 - 4;
    setDropPos({ top, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    calcPos();
    setTimeout(() => inputRef.current?.focus(), 30);
    const onClose = (e) => { if (!triggerRef.current?.contains(e.target)) setOpen(false); };
    const onScroll = () => calcPos();
    document.addEventListener("mousedown", onClose);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", calcPos);
    return () => {
      document.removeEventListener("mousedown", onClose);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", calcPos);
    };
  }, [open, calcPos]);

  const q = search.trim().toLowerCase();
  const filtered = kunden.filter(c => !q || getLabel(c).toLowerCase().includes(q));
  const unternehmen = filtered.filter(c => c.person_type !== "privatperson");
  const privatpersonen = filtered.filter(c => c.person_type === "privatperson");

  const renderRow = (c) => {
    const hasAbschluss = withAbschlussSet?.has(c.id);
    const isActive = c.id === selectedCid;
    return (
      <div key={c.id}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => { onChange(c.id); setOpen(false); }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", cursor: "pointer", fontSize: 13,
          backgroundColor: isActive ? accent + "20" : "transparent", color: headingC,
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = accent + "12"; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isActive ? accent + "20" : "transparent"; }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          backgroundColor: hasAbschluss ? "#22c55e" : "transparent",
          border: hasAbschluss ? "none" : `1.5px solid ${panelBdr}`,
          display: "inline-block",
        }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getLabel(c)}</span>
      </div>
    );
  };

  const dropdown = open && createPortal(
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
      backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 10,
      boxShadow: "0 8px 28px rgba(0,0,0,0.16)", zIndex: 999999, overflow: "hidden",
    }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 6 }}>
        <Search size={13} style={{ color: subC, flexShrink: 0 }} />
        <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
          placeholder="Mandant suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: headingC }} />
        {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 16, padding: 0 }}>&times;</button>}
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {!q && (
          <div onClick={() => { onChange(""); setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13, color: subC }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "14"}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
            <span style={{ width: 8, height: 8, display: "inline-block" }} />
            – Mandant auswählen –
          </div>
        )}
        {unternehmen.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Unternehmen</div>
            {unternehmen.map(renderRow)}
          </>
        )}
        {privatpersonen.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Privatpersonen</div>
            {privatpersonen.map(renderRow)}
          </>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: subC, textAlign: "center" }}>Keine Treffer</div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ flex: 1, maxWidth: 380 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full rounded-lg border text-sm px-3 py-2 focus:outline-none text-left"
        style={{ backgroundColor: panelBg, borderColor: open ? accent : panelBdr, color: headingC, cursor: "pointer", transition: "border-color 0.15s" }}>
        {selected && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            backgroundColor: withAbschlussSet?.has(selectedCid) ? "#22c55e" : "transparent",
            border: withAbschlussSet?.has(selectedCid) ? "none" : `1.5px solid ${panelBdr}`,
            display: "inline-block",
          }} />
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? getLabel(selected) : "– Mandant auswählen –"}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, color: subC, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ── Positions-Badge ───────────────────────────────────────────────────────────
const POSITION_BADGE_COLORS = {
  aktiven:  { bg: "#dbeafe", text: "#1d4ed8" },
  passiven: { bg: "#fce7f3", text: "#9d174d" },
  ertrag:   { bg: "#dcfce7", text: "#15803d" },
  aufwand:  { bg: "#fef3c7", text: "#92400e" },
};

function PositionBadge({ posId }) {
  if (!posId) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—</span>;
  const pos = POSITION_MAP[posId];
  if (!pos) return <span style={{ fontSize: 11, color: "#9ca3af" }}>{posId}</span>;
  const colors = POSITION_BADGE_COLORS[pos.seite] || { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{
      display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 7px",
      borderRadius: 5, backgroundColor: colors.bg, color: colors.text,
      whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
    }} title={pos.label}>
      {pos.label}
    </span>
  );
}

// ── Inline-Positions-Selector ─────────────────────────────────────────────────
function PositionSelector({ value, onChange, subC, panelBg, panelBdr, headingC, accent }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 260 });
  const triggerRef = useRef(null);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 300 ? rect.bottom + 2 : rect.top - 300 - 2;
    setDropPos({ top, left: rect.left, width: Math.max(rect.width, 260) });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    calcPos();
    const onClose = (e) => { if (!triggerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClose);
    return () => document.removeEventListener("mousedown", onClose);
  }, [open, calcPos]);

  const filtered = KONTENRAHMEN_POSITIONEN.filter(p =>
    !search.trim() || p.label.toLowerCase().includes(search.trim().toLowerCase()) || p.id.toLowerCase().includes(search.trim().toLowerCase())
  );

  const dropdown = open && createPortal(
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
      backgroundColor: panelBg, border: `1px solid ${panelBdr}`, borderRadius: 8,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 999999, overflow: "hidden",
    }}>
      <div style={{ padding: "6px 8px", borderBottom: `1px solid ${panelBdr}`, display: "flex", alignItems: "center", gap: 5 }}>
        <Search size={11} style={{ color: subC }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          autoFocus placeholder="Position suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 12, background: "transparent", color: headingC }} />
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        <div onClick={() => { onChange(null); setOpen(false); }}
          style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12, color: subC }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = accent + "14"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
          — Keine Position —
        </div>
        {filtered.map(p => {
          const colors = POSITION_BADGE_COLORS[p.seite] || { bg: "#f3f4f6", text: "#374151" };
          return (
            <div key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                backgroundColor: p.id === value ? accent + "18" : "transparent", color: headingC,
              }}
              onMouseEnter={e => { if (p.id !== value) e.currentTarget.style.backgroundColor = accent + "10"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = p.id === value ? accent + "18" : "transparent"; }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, flexShrink: 0, backgroundColor: colors.bg, border: `1px solid ${colors.text}40` }} />
              <span style={{ flex: 1 }}>{p.label}</span>
              <span style={{ fontSize: 10, color: subC }}>{p.von}–{p.bis}</span>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ display: "inline-block" }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); calcPos(); setOpen(o => !o); }}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <PositionBadge posId={value} />
      </button>
      {dropdown}
    </div>
  );
}

// ── Import Dialog ─────────────────────────────────────────────────────────────
function ImportDialog({ onClose, onImport, accent, theme }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const panelBg  = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const panelBdr = isArtis ? "#ccd8cc" : isLight ? "#e2e2ec" : "#3f3f46";
  const headingC = isArtis ? "#1a3a1a" : isLight ? "#1e293b" : "#e4e4e7";
  const subC     = isArtis ? "#4a6a4a" : isLight ? "#64748b" : "#a1a1aa";
  const pageBg   = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#2a2a2f";

  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState(null); // { rows, mapping }
  const [colMap, setColMap] = useState({ kontonummer: "", kontoname: "", saldo_ist: "", saldo_vorjahr: "" });
  const [preview, setPreview] = useState([]);
  const [headers, setHeaders] = useState([]);
  const fileRef = useRef(null);

  function detectColumn(headers, patterns) {
    for (const h of headers) {
      const lc = h.toLowerCase().trim();
      if (patterns.some(p => lc.includes(p))) return h;
    }
    return "";
  }

  function parseFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const XLSX = await import('xlsx');
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        processRows(rows, file.name);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        // Detect separator
        const firstLine = text.split("\n")[0];
        const sep = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
        const rows = text.split("\n").map(line =>
          line.replace(/\r$/, "").split(sep).map(cell => cell.replace(/^"(.*)"$/, "$1").replace(/""/g, '"'))
        ).filter(r => r.some(c => c.trim()));
        processRows(rows, file.name);
      };
      reader.readAsText(file, "UTF-8");
    }
  }

  function processRows(rows, filename) {
    if (rows.length < 2) { toast.error("Datei enthält zu wenig Zeilen"); return; }
    const hdrs = rows[0].map(String);
    const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim()));

    const detected = {
      kontonummer:   detectColumn(hdrs, ["konto", "kontonummer", "nummer", "nr."]),
      kontoname:     detectColumn(hdrs, ["bezeichnung", "name", "kontoname", "text", "beschreibung"]),
      saldo_ist:     detectColumn(hdrs, ["saldo", "betrag", "saldo ist", "ist", "aktuell"]),
      saldo_vorjahr: detectColumn(hdrs, ["vorjahr", "saldo vj", "vj", "vorperiode"]),
    };
    setHeaders(hdrs);
    setColMap(detected);
    setParsed({ rows: dataRows, filename });
    // Preview first 5 rows
    setPreview(dataRows.slice(0, 5));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) parseFile(file);
  }

  function doImport() {
    if (!parsed) return;
    const { rows } = parsed;
    const colIdx = (col) => headers.indexOf(col);
    const getCell = (row, col) => {
      const idx = colIdx(col);
      return idx >= 0 ? String(row[idx] ?? "").trim() : "";
    };
    const parseNum = (v) => {
      if (!v) return null;
      // Handle Swiss number format: 1'234.56 or 1.234,56
      const cleaned = v.replace(/'/g, "").replace(/\s/g, "").replace(",", ".");
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    };

    const konten = rows
      .filter(row => getCell(row, colMap.kontonummer))
      .map(row => {
        const nr = getCell(row, colMap.kontonummer);
        return {
          kontonummer: nr,
          kontoname: colMap.kontoname ? getCell(row, colMap.kontoname) : "",
          saldo_ist: colMap.saldo_ist ? (parseNum(getCell(row, colMap.saldo_ist)) ?? 0) : 0,
          saldo_vorjahr: colMap.saldo_vorjahr ? parseNum(getCell(row, colMap.saldo_vorjahr)) : null,
          position_id: autoMapKonto(nr),   // DB-Spalte: auto-gemappte Position
          position_override: false,          // DB-Spalte: BOOLEAN, manuell überschrieben?
          notiz: "",
        };
      });

    if (konten.length === 0) { toast.error("Keine Konten gefunden – Spalten-Zuordnung prüfen"); return; }
    onImport(konten);
  }

  const iStyle = {
    width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 6,
    border: `1px solid ${panelBdr}`, outline: "none", backgroundColor: pageBg, color: headingC,
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{
        backgroundColor: panelBg, border: `1px solid ${panelBdr}`,
        width: 680, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4" style={{ color: accent }} />
            <span className="text-sm font-bold" style={{ color: headingC }}>Kontenplan importieren</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X className="w-4 h-4" style={{ color: subC }} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Drop Zone */}
          {!parsed && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? accent : panelBdr}`,
                borderRadius: 12, padding: "48px 24px", textAlign: "center", cursor: "pointer",
                backgroundColor: dragging ? accent + "0a" : pageBg,
                transition: "all 0.15s",
              }}>
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-3" style={{ color: dragging ? accent : subC }} />
              <div className="text-sm font-semibold mb-1" style={{ color: headingC }}>CSV oder Excel-Datei hier ablegen</div>
              <div className="text-xs" style={{ color: subC }}>oder klicken zum Auswählen · .csv, .xlsx, .xls</div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
            </div>
          )}

          {parsed && (
            <>
              {/* Dateiname */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: accent + "10", border: `1px solid ${accent}30` }}>
                <FileText className="w-4 h-4" style={{ color: accent }} />
                <span className="text-sm font-medium" style={{ color: headingC }}>{parsed.filename}</span>
                <span className="text-xs ml-auto" style={{ color: subC }}>{parsed.rows.length} Zeilen</span>
                <button onClick={() => { setParsed(null); setHeaders([]); setPreview([]); }}
                  className="ml-2 p-0.5 rounded hover:opacity-70"><RotateCcw className="w-3.5 h-3.5" style={{ color: subC }} /></button>
              </div>

              {/* Spalten-Zuordnung */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: subC }}>Spalten-Zuordnung</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "kontonummer",   label: "Kontonummer *" },
                    { key: "kontoname",     label: "Kontoname" },
                    { key: "saldo_ist",     label: "Saldo IST" },
                    { key: "saldo_vorjahr", label: "Saldo Vorjahr" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-xs font-semibold block mb-1" style={{ color: subC }}>{label}</label>
                      <select value={colMap[key]} onChange={e => setColMap(p => ({ ...p, [key]: e.target.value }))} style={iStyle}>
                        <option value="">— nicht zugeordnet —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {preview.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: subC }}>Vorschau (erste 5 Zeilen)</div>
                  <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${panelBdr}` }}>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
                          {headers.slice(0, 6).map(h => (
                            <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: subC, borderBottom: `1px solid ${panelBdr}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${panelBdr}` }}>
                            {row.slice(0, 6).map((cell, j) => (
                              <td key={j} style={{ padding: "5px 10px", color: headingC }}>{String(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${panelBdr}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ color: subC }}>Abbrechen</button>
          <button
            disabled={!parsed || !colMap.kontonummer}
            onClick={doImport}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ backgroundColor: accent, opacity: parsed && colMap.kontonummer ? 1 : 0.4 }}>
            <Upload className="w-3.5 h-3.5" />
            {parsed ? `${parsed.rows.length} Zeilen importieren` : "Importieren"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── MiniExcel (Arbeitspapier pro Konto) ──────────────────────────────────────
const MINI_DEFAULT_COLS = [
  { id: "dc0", label: "Beschreibung", width: 220 },
  { id: "dc1", label: "Betrag CHF",   width: 130 },
  { id: "dc2", label: "Kommentar",    width: 200 },
];

function MiniExcel({ data, onSave, accent, headingC, subC, panelBdr }) {
  const init = data?.columns?.length ? data : { columns: MINI_DEFAULT_COLS, rows: [{ id: "dr0", cells: {} }] };
  const [cols, setCols] = useState(init.columns);
  const [rows, setRows] = useState(init.rows);
  const [editCell, setEditCell] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editColId, setEditColId] = useState(null);
  const [editColLabel, setEditColLabel] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const stRef = useRef({ cols, rows });
  useEffect(() => { stRef.current = { cols, rows }; });

  const save = useCallback((c, r) => onSave({ columns: c, rows: r }), [onSave]);

  // ── Column resize ────────────────────────────────────────────────────────
  const startResize = (e, ci) => {
    e.preventDefault();
    const sx = e.clientX;
    const sw = stRef.current.cols[ci].width;
    const move = (me) => setCols(p => p.map((c, i) => i === ci ? { ...c, width: Math.max(60, sw + me.clientX - sx) } : c));
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      save(stRef.current.cols, stRef.current.rows);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  // ── Cell edit ────────────────────────────────────────────────────────────
  const commitCell = () => {
    if (!editCell) return;
    const newRows = rows.map(r => r.id === editCell.rowId
      ? { ...r, cells: { ...r.cells, [editCell.colId]: editVal } } : r);
    setRows(newRows); setEditCell(null); save(cols, newRows);
  };

  // ── Column label edit ────────────────────────────────────────────────────
  const commitCol = () => {
    if (!editColId) return;
    const newCols = cols.map(c => c.id === editColId ? { ...c, label: editColLabel } : c);
    setCols(newCols); setEditColId(null); save(newCols, rows);
  };

  // ── Add / Delete ─────────────────────────────────────────────────────────
  const addCol = () => {
    const nc = { id: `c${Date.now()}`, label: "Spalte", width: 150 };
    const nc2 = [...cols, nc]; setCols(nc2); save(nc2, rows);
  };
  const delCol = (id) => {
    const nc = cols.filter(c => c.id !== id);
    const nr = rows.map(r => { const cells = { ...r.cells }; delete cells[id]; return { ...r, cells }; });
    setCols(nc); setRows(nr); save(nc, nr);
  };
  const addRow = () => {
    const nr = [...rows, { id: `r${Date.now()}`, cells: {} }];
    setRows(nr); save(cols, nr);
  };
  const delRow = (id) => {
    const nr = rows.filter(r => r.id !== id); setRows(nr); save(cols, nr);
  };

  // ── Row drag-and-drop ────────────────────────────────────────────────────
  const onDrop = (e, ti) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === ti) { setDragIdx(null); setDragOverIdx(null); return; }
    const nr = [...rows];
    const [m] = nr.splice(dragIdx, 1);
    nr.splice(ti, 0, m);
    setRows(nr); setDragIdx(null); setDragOverIdx(null); save(cols, nr);
  };

  const bdr = panelBdr;
  return (
    <div style={{ padding: "0 8px 10px 32px", backgroundColor: accent + "05", borderTop: `1px solid ${bdr}` }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: accent + "14" }}>
              {/* drag-handle column */}
              <th style={{ width: 22, borderRight: `1px solid ${bdr}`, borderBottom: `1px solid ${bdr}` }} />
              {cols.map((col, ci) => (
                <th key={col.id} style={{
                  position: "relative", width: col.width, minWidth: col.width, maxWidth: col.width,
                  padding: "5px 24px 5px 8px", textAlign: "left", fontWeight: 700, color: headingC,
                  borderRight: `1px solid ${bdr}`, borderBottom: `1px solid ${bdr}`, whiteSpace: "nowrap",
                }}>
                  {editColId === col.id
                    ? <input autoFocus value={editColLabel}
                        onChange={e => setEditColLabel(e.target.value)}
                        onBlur={commitCol}
                        onKeyDown={e => { if (e.key === "Enter") commitCol(); if (e.key === "Escape") setEditColId(null); }}
                        style={{ width: "100%", fontSize: 11, fontWeight: 700, padding: "1px 4px", borderRadius: 3, border: `1px solid ${accent}`, outline: "none", color: headingC, backgroundColor: "white" }} />
                    : <span onDoubleClick={() => { setEditColId(col.id); setEditColLabel(col.label); }}
                        title="Doppelklick zum Umbenennen" style={{ cursor: "text" }}>{col.label}</span>
                  }
                  {/* Delete col button */}
                  {cols.length > 1 &&
                    <button onClick={() => delCol(col.id)} title="Spalte löschen"
                      style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 13, lineHeight: 1, opacity: 0.45, padding: 1 }}>×</button>
                  }
                  {/* Resize handle */}
                  <div onMouseDown={e => startResize(e, ci)} style={{
                    position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 2,
                  }} />
                </th>
              ))}
              {/* Add col */}
              <th style={{ width: 30, padding: "4px 6px", textAlign: "center", borderBottom: `1px solid ${bdr}` }}>
                <button onClick={addCol} title="Spalte hinzufügen"
                  style={{ background: "none", border: `1px solid ${accent}60`, borderRadius: 3, cursor: "pointer", color: accent, fontSize: 13, padding: "0 5px", fontWeight: 700, lineHeight: "18px" }}>+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id} draggable
                onDragStart={e => { setDragIdx(ri); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(ri); }}
                onDrop={e => onDrop(e, ri)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                style={{ borderTop: `1px solid ${bdr}`, backgroundColor: dragOverIdx === ri ? accent + "18" : "transparent" }}>
                {/* Drag handle */}
                <td style={{ padding: "2px 4px", cursor: "grab", color: subC, textAlign: "center", borderRight: `1px solid ${bdr}`, userSelect: "none", fontSize: 13 }} title="Zeile verschieben">⠿</td>
                {cols.map(col => {
                  const isEd = editCell?.rowId === row.id && editCell?.colId === col.id;
                  const val = row.cells[col.id] || "";
                  return (
                    <td key={col.id} style={{ padding: "1px 4px", borderRight: `1px solid ${bdr}`, width: col.width, maxWidth: col.width }}
                      onClick={() => !isEd && (setEditCell({ rowId: row.id, colId: col.id }), setEditVal(val))}>
                      {isEd
                        ? <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                            onBlur={commitCell}
                            onKeyDown={e => { if (e.key === "Enter") commitCell(); if (e.key === "Escape") setEditCell(null); if (e.key === "Tab") commitCell(); }}
                            style={{ width: "100%", fontSize: 12, padding: "3px 5px", border: `1px solid ${accent}`, borderRadius: 3, outline: "none", color: "#111" }} />
                        : <span style={{ display: "block", padding: "3px 5px", minHeight: 22, color: val ? headingC : subC + "60", cursor: "text", whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "hidden" }}>
                            {val || "—"}
                          </span>}
                    </td>);
                })}
                {/* Delete row */}
                <td style={{ padding: "2px 4px", textAlign: "center" }}>
                  <button onClick={() => delRow(row.id)} title="Zeile löschen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, opacity: 0.45 }}>×</button>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${bdr}` }}>
              <td colSpan={cols.length + 2} style={{ padding: "4px 10px" }}>
                <button onClick={addRow}
                  style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 12, fontWeight: 600, padding: 0 }}>+ Zeile</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Belege-Verknüpfung pro Konto ─────────────────────────────────────────────
const BUCKET = "dokumente";

function BelegeSection({ arbeitspapier, onSave, customerId, selectedYear, accent, headingC, subC, panelBdr }) {
  const belege = arbeitspapier?.belege || [];
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef(null);

  // Schliessen bei Klick ausserhalb
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  // Docs zurücksetzen wenn Jahr/Kunde wechselt → erzwingt Neuladen
  useEffect(() => { setDocs([]); }, [customerId, selectedYear]);

  // Dokumente laden wenn Picker öffnet
  useEffect(() => {
    if (!showPicker || !customerId || docs.length > 0) return;
    setLoading(true);
    let query = supabase.from("dokumente")
      .select("id, name, filename, storage_path, category, year, file_type")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (selectedYear) query = query.eq("year", selectedYear);
    query.then(({ data }) => { setDocs(data || []); setLoading(false); });
  }, [showPicker, customerId, selectedYear]);

  const linkedIds = new Set(belege.map(b => b.id));

  const addBeleg = (doc) => {
    if (linkedIds.has(doc.id)) return;
    const newBelege = [...belege, {
      id: doc.id, name: doc.name, filename: doc.filename,
      storage_path: doc.storage_path, year: doc.year,
      category: doc.category, file_type: doc.file_type,
    }];
    onSave({ ...(arbeitspapier || {}), belege: newBelege });
    setShowPicker(false); setSearch("");
  };

  const removeBeleg = (id) => {
    onSave({ ...(arbeitspapier || {}), belege: belege.filter(b => b.id !== id) });
  };

  const openDoc = async (beleg) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(beleg.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Dokument konnte nicht geöffnet werden");
  };

  const filtered = docs.filter(d => !search ||
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.filename?.toLowerCase().includes(search.toLowerCase())
  );

  const fileLabel = (ft, fn) => {
    if (ft?.includes("pdf")) return { label: "PDF", bg: "#fee2e2", col: "#dc2626" };
    const ext = fn?.split(".").pop()?.toUpperCase() || "DOC";
    return { label: ext, bg: "#dbeafe", col: "#1d4ed8" };
  };

  return (
    <div style={{ padding: "8px 8px 10px 32px", borderTop: `1px dashed ${panelBdr}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: subC, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          📎 Belege
        </span>
        <div ref={pickerRef} style={{ position: "relative" }}>
          <button onClick={() => setShowPicker(v => !v)} style={{
            fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 5, cursor: "pointer",
            backgroundColor: accent + "14", border: `1px solid ${accent}40`, color: accent,
          }}>+ Beleg verknüpfen</button>

          {showPicker && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
              backgroundColor: "white", border: `1px solid ${panelBdr}`, borderRadius: 8,
              boxShadow: "0 8px 28px rgba(0,0,0,0.14)", width: 420, maxHeight: 320,
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ padding: "8px 10px", borderBottom: `1px solid ${panelBdr}` }}>
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Dokument suchen…"
                  style={{ width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 5, border: `1px solid ${panelBdr}`, outline: "none" }} />
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {loading
                  ? <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: subC }}>Lädt…</div>
                  : filtered.length === 0
                    ? <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: subC }}>Keine Dokumente gefunden</div>
                    : filtered.map(doc => {
                        const fl = fileLabel(doc.file_type, doc.filename);
                        const already = linkedIds.has(doc.id);
                        return (
                          <div key={doc.id} onClick={() => addBeleg(doc)} style={{
                            padding: "7px 12px", cursor: already ? "default" : "pointer",
                            opacity: already ? 0.45 : 1, borderBottom: `1px solid ${panelBdr}`,
                            display: "flex", alignItems: "center", gap: 8,
                          }}
                            onMouseEnter={e => { if (!already) e.currentTarget.style.backgroundColor = accent + "10"; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, backgroundColor: fl.bg, color: fl.col, flexShrink: 0 }}>{fl.label}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                              <div style={{ fontSize: 10, color: subC }}>{doc.year}{doc.category ? ` · ${doc.category}` : ""}</div>
                            </div>
                            {already && <span style={{ fontSize: 10, color: subC }}>✓</span>}
                          </div>
                        );
                      })
                }
              </div>
            </div>
          )}
        </div>
      </div>

      {belege.length === 0
        ? <span style={{ fontSize: 11, color: subC, fontStyle: "italic" }}>Noch keine Belege verknüpft</span>
        : <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {belege.map(b => {
              const fl = fileLabel(b.file_type, b.filename);
              return (
                <div key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 5px",
                  borderRadius: 6, backgroundColor: "#f8fafc", border: `1px solid ${panelBdr}`, fontSize: 11,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 4px", borderRadius: 3, backgroundColor: fl.bg, color: fl.col, flexShrink: 0 }}>{fl.label}</span>
                  <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: headingC }} title={b.name}>{b.name}</span>
                  {b.year && <span style={{ color: subC, fontSize: 10, flexShrink: 0 }}>{b.year}</span>}
                  <button onClick={() => openDoc(b)} title="Öffnen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 13, padding: "0 2px", lineHeight: 1 }}>↗</button>
                  <button onClick={() => removeBeleg(b.id)} title="Verknüpfung entfernen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14, padding: "0 1px", opacity: 0.55, lineHeight: 1 }}>×</button>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ── Kontenplan Tab ────────────────────────────────────────────────────────────
function KontenplanTab({ konten, onUpdateKonto, customerId, selectedYear, accent, theme, headingC, subC, panelBg, panelBdr, tableBdr, rowHover }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const [collapsed, setCollapsed] = useState({});
  const [expandedKonten, setExpandedKonten] = useState(new Set());
  const toggleKonto = (id) => setExpandedKonten(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const sortedKonten = useMemo(() =>
    [...konten].sort((a, b) => {
      const na = parseInt(a.kontonummer) || 0;
      const nb = parseInt(b.kontonummer) || 0;
      return na - nb;
    }), [konten]);

  // Group by effective position
  const grouped = useMemo(() => {
    const groups = {};
    for (const k of sortedKonten) {
      const pos = k.position_id;
      const key = pos || "__KEIN_MAPPING__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(k);
    }
    return groups;
  }, [sortedKonten]);

  // Order groups by Kontenrahmen order, unmapped last
  const groupOrder = useMemo(() => {
    const posOrder = KONTENRAHMEN_POSITIONEN.map(p => p.id);
    const keys = Object.keys(grouped);
    return [
      ...posOrder.filter(id => keys.includes(id)),
      ...keys.filter(k => !posOrder.includes(k)),
    ];
  }, [grouped]);

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileSpreadsheet className="w-12 h-12 mb-3" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
        <div className="text-base font-medium mb-1" style={{ color: headingC }}>Noch keine Konten importiert</div>
        <div className="text-sm" style={{ color: subC }}>Verwenden Sie den Import-Button, um einen Kontenplan hochzuladen.</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
          <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
            {["Konto-Nr", "Kontoname", "Saldo IST", "Saldo VJ", "Abw.", "Position", "Notiz"].map(h => (
              <th key={h} style={{
                padding: "9px 12px", textAlign: h === "Saldo IST" || h === "Saldo VJ" || h === "Abw." ? "right" : "left",
                fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                color: subC, borderBottom: `2px solid ${tableBdr}`, whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupOrder.map(groupKey => {
            const rows = grouped[groupKey];
            if (!rows) return null;
            const pos = POSITION_MAP[groupKey];
            const isUnmapped = groupKey === "__KEIN_MAPPING__";
            const isOpen = !collapsed[groupKey];
            const groupTotal = rows.reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);
            const groupTotalVJ = rows.reduce((s, k) => s + (parseFloat(k.saldo_vorjahr) || 0), 0);
            const groupColors = POSITION_BADGE_COLORS[pos?.seite] || { bg: "#f3f4f6", text: "#374151" };

            return (
              <React.Fragment key={groupKey}>
                {/* Group Header */}
                <tr
                  onClick={() => setCollapsed(p => ({ ...p, [groupKey]: !p[groupKey] }))}
                  style={{
                    backgroundColor: isUnmapped ? "#fef2f2" : (isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32"),
                    cursor: "pointer", borderTop: `2px solid ${isUnmapped ? "#fecaca" : tableBdr}`,
                  }}>
                  <td colSpan={2} style={{ padding: "8px 12px" }}>
                    <div className="flex items-center gap-2">
                      {isOpen
                        ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: subC }} />
                        : <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: subC }} />}
                      {isUnmapped
                        ? <span style={{ fontWeight: 700, fontSize: 12, color: "#dc2626" }}>Ohne Mapping ({rows.length} Konten)</span>
                        : (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: groupColors.bg, border: `1px solid ${groupColors.text}40` }} />
                            <span style={{ fontWeight: 700, fontSize: 12, color: headingC }}>{pos?.label}</span>
                            <span style={{ fontSize: 10, color: subC }}>{pos?.von}–{pos?.bis} · {rows.length} Kto.</span>
                          </span>
                        )}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace" }}>
                    {fmtCHF(groupTotal)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace" }}>
                    {fmtCHF(groupTotalVJ)}
                  </td>
                  <td colSpan={3} style={{ padding: "8px 12px" }} />
                </tr>

                {/* Rows */}
                {isOpen && rows.map(konto => {
                  const effectivePos = konto.position_id;
                  const isOverridden = !!konto.position_override;
                  const abw = (parseFloat(konto.saldo_ist) || 0) - (parseFloat(konto.saldo_vorjahr) || 0);
                  const noMapping = !effectivePos && /^[1-8]/.test(String(konto.kontonummer));

                  const isExpanded = expandedKonten.has(konto.id);
                  return (
                    <React.Fragment key={konto.id}>
                    <tr style={{
                      borderBottom: isExpanded ? "none" : `1px solid ${tableBdr}`,
                      backgroundColor: noMapping ? "#fef2f250" : "transparent",
                    }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = noMapping ? "#fef2f2" : rowHover}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = isExpanded ? (accent + "08") : noMapping ? "#fef2f250" : "transparent"}>

                      {/* Konto-Nr + Expand Toggle */}
                      <td style={{ padding: "7px 8px 7px 12px", fontWeight: 600, color: headingC, whiteSpace: "nowrap", width: 90 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button onClick={() => toggleKonto(konto.id)} title={isExpanded ? "Arbeitspapier ausblenden" : "Arbeitspapier einblenden"}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 2px", color: isExpanded ? accent : subC, opacity: isExpanded ? 1 : 0.45, flexShrink: 0, lineHeight: 1, fontSize: 10 }}>
                            {isExpanded ? "▼" : "▶"}
                          </button>
                          {konto.kontonummer}
                        </div>
                      </td>
                      {/* Name */}
                      <td style={{ padding: "7px 12px", color: headingC }}>
                        {konto.kontoname || <span style={{ color: subC, fontStyle: "italic" }}>—</span>}
                      </td>
                      {/* Saldo IST */}
                      <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace", color: headingC, whiteSpace: "nowrap" }}>
                        {fmtCHF(konto.saldo_ist)}
                      </td>
                      {/* Saldo VJ */}
                      <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "monospace", color: subC, whiteSpace: "nowrap" }}>
                        {fmtCHF(konto.saldo_vorjahr)}
                      </td>
                      {/* Abweichung */}
                      <td style={{ padding: "7px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {konto.saldo_ist !== null && konto.saldo_vorjahr !== null ? (
                          <span style={{ color: abw > 0 ? "#16a34a" : abw < 0 ? "#dc2626" : subC, fontSize: 12 }}>
                            {abw > 0 ? "+" : ""}{fmtCHF(abw)}
                          </span>
                        ) : <span style={{ color: subC }}>—</span>}
                      </td>
                      {/* Position */}
                      <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                        <div className="flex items-center gap-1.5">
                          <PositionSelector
                            value={effectivePos}
                            onChange={(newPos) => onUpdateKonto(konto.id, {
                              position_id: newPos,
                              position_override: newPos !== null,
                            })}
                            subC={subC} panelBg={panelBg} panelBdr={panelBdr} headingC={headingC} accent={accent}
                          />
                          {isOverridden && (
                            <button
                              onClick={() => onUpdateKonto(konto.id, {
                                position_id: autoMapKonto(konto.kontonummer),
                                position_override: false,
                              })}
                              title="Manuelle Zuweisung zurücksetzen"
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                              <Lock className="w-3 h-3" style={{ color: accent }} />
                            </button>
                          )}
                        </div>
                      </td>
                      {/* Notiz */}
                      <td style={{ padding: "7px 12px", minWidth: 160 }}>
                        <input
                          value={konto.notiz || ""}
                          onChange={e => onUpdateKonto(konto.id, { notiz: e.target.value })}
                          placeholder="Notiz…"
                          style={{
                            width: "100%", fontSize: 12, padding: "3px 6px", borderRadius: 5,
                            border: `1px solid transparent`, outline: "none",
                            backgroundColor: "transparent", color: headingC,
                          }}
                          onFocus={e => e.target.style.border = `1px solid ${accent}60`}
                          onBlur={e => e.target.style.border = "1px solid transparent"}
                        />
                      </td>
                    </tr>
                    {/* ── Arbeitspapier (MiniExcel) + Belege ── */}
                    {isExpanded && (
                      <tr style={{ borderBottom: `1px solid ${tableBdr}`, backgroundColor: accent + "06" }}>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <MiniExcel
                            data={konto.arbeitspapier}
                            onSave={d => onUpdateKonto(konto.id, { arbeitspapier: { ...(konto.arbeitspapier || {}), ...d } })}
                            accent={accent} headingC={headingC} subC={subC} panelBdr={tableBdr}
                          />
                          <BelegeSection
                            arbeitspapier={konto.arbeitspapier}
                            onSave={d => onUpdateKonto(konto.id, { arbeitspapier: d })}
                            customerId={customerId}
                            selectedYear={selectedYear}
                            accent={accent} headingC={headingC} subC={subC} panelBdr={tableBdr}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}

                {/* Group Total Row */}
                {isOpen && (
                  <tr style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32", borderBottom: `2px solid ${tableBdr}` }}>
                    <td colSpan={2} style={{ padding: "6px 12px 6px 32px", fontSize: 11, fontWeight: 600, color: subC }}>
                      Total {pos?.label || "Ohne Mapping"}
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 700, fontSize: 12, color: headingC, fontFamily: "monospace" }}>
                      {fmtCHF(groupTotal)}
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: subC, fontFamily: "monospace" }}>
                      {fmtCHF(groupTotalVJ)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Bilanz Tab ────────────────────────────────────────────────────────────────
function BilanzkennzahlRow({ label, value, isSubtotal, isTotal, indent, accent, subC, headingC }) {
  const fontW = isTotal ? 800 : isSubtotal ? 700 : 400;
  const borderTop = isTotal ? `2px solid ${accent}40` : isSubtotal ? `1px solid ${accent}20` : "none";
  const bg = isTotal ? accent + "08" : "transparent";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: `${isTotal ? 8 : 5}px ${indent ? 28 : 12}px`, borderTop, backgroundColor: bg }}>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, color: isTotal ? accent : headingC }}>
        {label}
      </span>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, fontFamily: "monospace",
        color: isTotal ? accent : headingC, minWidth: 110, textAlign: "right" }}>
        {value === null ? "—" : fmtCHF(value)}
      </span>
    </div>
  );
}

function BilanzTab({ konten, accent, headingC, subC, panelBg, panelBdr, tableBdr,
                      signFlipPassiven, onFlipPassiven, diffAnpassungen, onSaveDiffAnpassungen }) {
  const [editAnp, setEditAnp] = useState(null); // { idx, bezeichnung, betrag }

  const sumByIds = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);

  const pSign = signFlipPassiven ? -1 : 1;

  const UV_IDS = ["UV_FLUESSIG","UV_WERTSCHRIFTEN","UV_FORD_LL","UV_FORD_SONST","UV_VORRAETE","UV_ABGRENZUNG"];
  const AV_IDS = ["AV_FINANZ","AV_MOBIL","AV_IMMOBIL","AV_IMMATERIELL"];
  const FK_KURZ_IDS = ["FK_KURZ_LL","FK_KURZ_BANK","FK_KURZ_SONST","FK_KURZ_ABGRENZUNG"];
  const FK_LANG_IDS = ["FK_LANG_BANK","FK_LANG_SONST","FK_RUECKSTELLUNGEN"];
  const EK_IDS = ["EK_KAPITAL","EK_RESERVEN","EK_JAHRESERGEBNIS"];

  const uvTotal = sumByIds(UV_IDS);
  const avTotal = sumByIds(AV_IDS);
  const aktivenTotal = uvTotal + avTotal;

  const fkKurzTotal = sumByIds(FK_KURZ_IDS) * pSign;
  const fkLangTotal = sumByIds(FK_LANG_IDS) * pSign;
  const ekTotal = sumByIds(EK_IDS) * pSign;
  const passivenTotal = fkKurzTotal + fkLangTotal + ekTotal;

  const makePos = (id, flip = false) => {
    const pos = POSITION_MAP[id];
    const val = sumByIds([id]) * (flip ? pSign : 1);
    return { label: pos?.label || id, val };
  };

  const diff = aktivenTotal - passivenTotal;
  const anpTotal = (diffAnpassungen || []).reduce((s, a) => s + (parseFloat(a.betrag) || 0), 0);
  const diffNachAnp = diff - anpTotal;
  const balanced = Math.abs(diff) < 0.005;
  const balancedNachAnp = Math.abs(diffNachAnp) < 0.005;

  const flipBtn = (onClick, active) => (
    <button onClick={onClick} title="Vorzeichen umkehren" style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
      backgroundColor: active ? "#9d174d22" : "transparent",
      border: `1px solid ${active ? "#9d174d" : "#9d174d66"}`,
      color: active ? "#9d174d" : "#9d174d99",
    }}>± Vorzeichen</button>
  );

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BarChart2 className="w-12 h-12 mb-3" style={{ color: "#d1d5db" }} />
        <div className="text-sm font-medium" style={{ color: headingC }}>Noch keine Konten importiert</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 1000 }}>
      {/* AKTIVEN */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ padding: "12px 14px", backgroundColor: "#dbeafe", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#1d4ed8", letterSpacing: "0.03em" }}>AKTIVEN</span>
        </div>
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC }}>
          Umlaufvermögen
        </div>
        {UV_IDS.map(id => { const { label, val } = makePos(id); return val !== 0 ? <BilanzkennzahlRow key={id} label={label} value={val} indent headingC={headingC} subC={subC} accent={accent} /> : null; })}
        <BilanzkennzahlRow label="Total Umlaufvermögen" value={uvTotal} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Anlagevermögen
        </div>
        {AV_IDS.map(id => { const { label, val } = makePos(id); return val !== 0 ? <BilanzkennzahlRow key={id} label={label} value={val} indent headingC={headingC} subC={subC} accent={accent} /> : null; })}
        <BilanzkennzahlRow label="Total Anlagevermögen" value={avTotal} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <BilanzkennzahlRow label="TOTAL AKTIVEN" value={aktivenTotal} isTotal headingC={headingC} subC={subC} accent={accent} />
      </div>

      {/* PASSIVEN */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", backgroundColor: "#fce7f3", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#9d174d", letterSpacing: "0.03em" }}>PASSIVEN</span>
          {flipBtn(onFlipPassiven, signFlipPassiven)}
        </div>
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC }}>
          Kurzfristiges Fremdkapital
        </div>
        {FK_KURZ_IDS.map(id => { const { label, val } = makePos(id, true); return val !== 0 ? <BilanzkennzahlRow key={id} label={label} value={val} indent headingC={headingC} subC={subC} accent={accent} /> : null; })}
        <BilanzkennzahlRow label="Total Kurzfristiges FK" value={fkKurzTotal} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Langfristiges Fremdkapital
        </div>
        {FK_LANG_IDS.map(id => { const { label, val } = makePos(id, true); return val !== 0 ? <BilanzkennzahlRow key={id} label={label} value={val} indent headingC={headingC} subC={subC} accent={accent} /> : null; })}
        <BilanzkennzahlRow label="Total Langfristiges FK" value={fkLangTotal} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <div style={{ padding: "8px 12px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: subC, marginTop: 4 }}>
          Eigenkapital
        </div>
        {EK_IDS.map(id => { const { label, val } = makePos(id, true); return val !== 0 ? <BilanzkennzahlRow key={id} label={label} value={val} indent headingC={headingC} subC={subC} accent={accent} /> : null; })}
        <BilanzkennzahlRow label="Total Eigenkapital" value={ekTotal} isSubtotal headingC={headingC} subC={subC} accent={accent} />
        <BilanzkennzahlRow label="TOTAL PASSIVEN" value={passivenTotal} isTotal headingC={headingC} subC={subC} accent={accent} />
      </div>

      {/* Differenz */}
      {!balanced && (
        <div className="col-span-2 rounded-xl overflow-hidden" style={{ border: "1px solid #fecaca", backgroundColor: "#fef2f2" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #fecaca" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle className="w-4 h-4" style={{ color: "#dc2626" }} />
              <span className="text-sm font-semibold" style={{ color: "#dc2626" }}>
                Aktiven ≠ Passiven · Differenz: CHF {fmtCHF(Math.abs(diff))}
              </span>
            </div>
            <button
              onClick={() => {
                const rows = [...(diffAnpassungen || []), { id: crypto.randomUUID(), bezeichnung: "", betrag: 0 }];
                onSaveDiffAnpassungen(rows);
                setEditAnp({ idx: rows.length - 1, bezeichnung: "", betrag: "" });
              }}
              style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, cursor: "pointer", backgroundColor: "#dc262614", border: "1px solid #dc262640", color: "#dc2626" }}>
              + Anpassungszeile
            </button>
          </div>
          {/* Anpassungszeilen */}
          {(diffAnpassungen || []).length > 0 && (
            <div style={{ padding: "8px 14px" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "#dc2626", fontWeight: 700, fontSize: 11 }}>
                    <th style={{ textAlign: "left", padding: "3px 0", width: "60%" }}>Bezeichnung</th>
                    <th style={{ textAlign: "right", padding: "3px 8px", width: "25%" }}>Betrag CHF</th>
                    <th style={{ width: "15%" }} />
                  </tr>
                </thead>
                <tbody>
                  {(diffAnpassungen || []).map((a, idx) => (
                    <tr key={a.id}>
                      <td style={{ padding: "3px 0" }}>
                        {editAnp?.idx === idx ? (
                          <input autoFocus value={editAnp.bezeichnung}
                            onChange={e => setEditAnp(v => ({ ...v, bezeichnung: e.target.value }))}
                            onBlur={() => {
                              const rows = (diffAnpassungen || []).map((r, i) => i === idx ? { ...r, bezeichnung: editAnp.bezeichnung, betrag: parseFloat(editAnp.betrag) || 0 } : r);
                              onSaveDiffAnpassungen(rows);
                              setEditAnp(null);
                            }}
                            style={{ width: "100%", fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid #fca5a5", outline: "none" }} />
                        ) : (
                          <span onClick={() => setEditAnp({ idx, bezeichnung: a.bezeichnung, betrag: String(a.betrag) })}
                            style={{ cursor: "text", color: a.bezeichnung ? "#374151" : "#9ca3af", fontStyle: a.bezeichnung ? "normal" : "italic" }}>
                            {a.bezeichnung || "Bezeichnung eingeben…"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "3px 8px", textAlign: "right" }}>
                        {editAnp?.idx === idx ? (
                          <input value={editAnp.betrag} type="number" step="0.01"
                            onChange={e => setEditAnp(v => ({ ...v, betrag: e.target.value }))}
                            onBlur={() => {
                              const rows = (diffAnpassungen || []).map((r, i) => i === idx ? { ...r, bezeichnung: editAnp.bezeichnung, betrag: parseFloat(editAnp.betrag) || 0 } : r);
                              onSaveDiffAnpassungen(rows);
                              setEditAnp(null);
                            }}
                            style={{ width: 100, fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid #fca5a5", outline: "none", textAlign: "right" }} />
                        ) : (
                          <span onClick={() => setEditAnp({ idx, bezeichnung: a.bezeichnung, betrag: String(a.betrag) })}
                            style={{ cursor: "text", fontFamily: "monospace", color: "#374151" }}>
                            {fmtCHF(a.betrag)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", padding: "3px 0" }}>
                        <button onClick={() => onSaveDiffAnpassungen((diffAnpassungen || []).filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#fca5a5", fontSize: 14, lineHeight: 1 }}>×</button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "1px solid #fecaca", fontWeight: 700 }}>
                    <td style={{ padding: "4px 0", fontSize: 12, color: "#dc2626" }}>Total Anpassungen</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: "#dc2626" }}>{fmtCHF(anpTotal)}</td>
                    <td />
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ padding: "4px 0", fontSize: 12, color: balancedNachAnp ? "#16a34a" : "#dc2626" }}>Verbleibende Differenz</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: balancedNachAnp ? "#16a34a" : "#dc2626" }}>{fmtCHF(Math.abs(diffNachAnp))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {(diffAnpassungen || []).length === 0 && (
            <div style={{ padding: "8px 14px", fontSize: 12, color: "#dc2626aa" }}>
              Konten-Zuweisung prüfen oder Anpassungszeilen erfassen.
            </div>
          )}
        </div>
      )}
      {balanced && konten.length > 0 && (
        <div className="col-span-2 flex items-center gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#16a34a" }} />
          <span className="text-sm font-medium" style={{ color: "#16a34a" }}>Bilanz ausgeglichen</span>
        </div>
      )}
    </div>
  );
}

// ── Erfolgsrechnung Tab ───────────────────────────────────────────────────────
function ERRow({ label, value, isSubtotal, isTotal, isNegative, indent, accent, headingC, subC, highlightGreen }) {
  const fontW = isTotal ? 800 : isSubtotal ? 700 : 400;
  const color = isTotal && highlightGreen ? "#16a34a" : isTotal ? accent : isNegative && value < 0 ? "#dc2626" : headingC;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: `${isTotal ? 9 : 5}px ${indent ? 24 : 12}px`,
      borderTop: isTotal ? `2px solid ${isTotal && highlightGreen ? "#bbf7d0" : accent + "40"}` : "none",
      backgroundColor: isTotal && highlightGreen ? "#f0fdf4" : isTotal ? accent + "06" : "transparent",
      borderRadius: isTotal ? 4 : 0,
    }}>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, color }}>{label}</span>
      <span style={{ fontSize: isTotal ? 13 : 12, fontWeight: fontW, fontFamily: "monospace", color, minWidth: 130, textAlign: "right" }}>
        {value === null ? "—" : fmtCHF(value)}
      </span>
    </div>
  );
}

function ERSeparator({ label, subC }) {
  return (
    <div style={{ padding: "6px 12px 2px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: subC, borderTop: "1px solid #e5e7eb", marginTop: 4 }}>
      {label}
    </div>
  );
}

function ErfolgsrechnungTab({ konten, accent, headingC, subC, panelBg, panelBdr, signFlipER, onFlipER }) {
  const rawSum = (ids) => konten
    .filter(k => ids.includes(k.position_id))
    .reduce((s, k) => s + (parseFloat(k.saldo_ist) || 0), 0);

  const eSign = signFlipER ? -1 : 1;
  const sumByIds = (ids) => rawSum(ids) * eSign;

  if (konten.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <TrendingUp className="w-12 h-12 mb-3" style={{ color: "#d1d5db" }} />
        <div className="text-sm font-medium" style={{ color: headingC }}>Noch keine Konten importiert</div>
      </div>
    );
  }

  const nettoumsatz   = sumByIds(["ER_UMSATZ","ER_EIGENLEISTUNG","ER_BESTAND"]);
  const material      = sumByIds(["ER_MATERIAL"]);
  const bruttogewinn  = nettoumsatz - material;
  const personal      = sumByIds(["ER_PERSONAL"]);
  const betrieb       = sumByIds(["ER_BETRIEB"]);
  const ebitda        = bruttogewinn - personal - betrieb;
  const abschr        = sumByIds(["ER_ABSCHR"]);
  const ebit          = ebitda - abschr;
  const finErtrag     = sumByIds(["ER_FINANZ_ERTRAG","ER_LIEGENSCHAFTEN"]);
  const finAufw       = sumByIds(["ER_FINANZ_AUFW"]);
  const finanzergebnis = finErtrag - finAufw;
  const ebt           = ebit + finanzergebnis;
  const fremdErtrag   = sumByIds(["ER_FREMD_ERTRAG","ER_AO_ERTRAG"]);
  const fremdAufw     = sumByIds(["ER_FREMD_AUFW","ER_AO_AUFW"]);
  const steuern       = sumByIds(["ER_STEUERN"]);
  const jahresergebnis = ebt + fremdErtrag - fremdAufw - steuern;

  const props = { accent, headingC, subC };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", backgroundColor: "#dcfce7", borderBottom: `1px solid ${panelBdr}` }}>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#15803d", letterSpacing: "0.03em" }}>ERFOLGSRECHNUNG</span>
          <button onClick={onFlipER} title="Vorzeichen umkehren" style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
            backgroundColor: signFlipER ? "#15803d22" : "transparent",
            border: `1px solid ${signFlipER ? "#15803d" : "#15803d66"}`,
            color: signFlipER ? "#15803d" : "#15803d99",
          }}>± Vorzeichen</button>
        </div>

        <ERSeparator label="Betriebsertrag" subC={subC} />
        <ERRow label="Nettoumsatzerlöse" value={sumByIds(["ER_UMSATZ"])} indent {...props} />
        <ERRow label="Eigenleistungen" value={sumByIds(["ER_EIGENLEISTUNG"])} indent {...props} />
        <ERRow label="Bestandesveränderungen" value={sumByIds(["ER_BESTAND"])} indent {...props} />
        <ERRow label="Nettoumsatz Total" value={nettoumsatz} isSubtotal {...props} />

        <ERSeparator label="Betriebsaufwand" subC={subC} />
        <ERRow label="− Materialaufwand" value={material} isNegative indent {...props} />
        <ERRow label="= Bruttogewinn (Rohergebnis)" value={bruttogewinn} isTotal
          highlightGreen={bruttogewinn >= 0} {...props} />

        <ERSeparator label="Betriebskosten" subC={subC} />
        <ERRow label="− Personalaufwand" value={personal} isNegative indent {...props} />
        <ERRow label="− Übriger Betriebsaufwand" value={betrieb} isNegative indent {...props} />
        <ERRow label="= EBITDA" value={ebitda} isTotal highlightGreen={ebitda >= 0} {...props} />

        <ERSeparator label="Abschreibungen" subC={subC} />
        <ERRow label="− Abschreibungen" value={abschr} isNegative indent {...props} />
        <ERRow label="= EBIT" value={ebit} isTotal highlightGreen={ebit >= 0} {...props} />

        <ERSeparator label="Finanzergebnis" subC={subC} />
        <ERRow label="+ Finanzertrag" value={finErtrag} indent {...props} />
        <ERRow label="− Finanzaufwand" value={finAufw} isNegative indent {...props} />
        <ERRow label="+/− Finanzergebnis" value={finanzergebnis} isSubtotal {...props} />
        <ERRow label="= EBT (vor Sonderergebnis)" value={ebt} isTotal highlightGreen={ebt >= 0} {...props} />

        <ERSeparator label="Sonderergebnis & Steuern" subC={subC} />
        <ERRow label="+ Betriebsfremder/AO Ertrag" value={fremdErtrag} indent {...props} />
        <ERRow label="− Betriebsfremder/AO Aufwand" value={fremdAufw} isNegative indent {...props} />
        <ERRow label="− Ertragssteuern" value={steuern} isNegative indent {...props} />

        <div style={{ margin: "8px 8px 8px", borderRadius: 8, overflow: "hidden", border: `2px solid ${jahresergebnis >= 0 ? "#bbf7d0" : "#fecaca"}` }}>
          <ERRow label="JAHRESERGEBNIS" value={jahresergebnis} isTotal highlightGreen={jahresergebnis >= 0}
            accent={jahresergebnis >= 0 ? "#16a34a" : "#dc2626"} headingC={headingC} subC={subC} />
        </div>
      </div>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function Abschlussdokumentation() {
  const navigate = useNavigate();
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const pageBg   = isLight ? "#f4f4f8"   : isArtis ? "#f2f5f2"   : "#2a2a2f";
  const panelBg  = isLight ? "#ffffff"   : isArtis ? "#ffffff"   : "#27272a";
  const panelBdr = isLight ? "#e2e2ec"   : isArtis ? "#ccd8cc"   : "#3f3f46";
  const headingC = isLight ? "#1e293b"   : isArtis ? "#1a3a1a"   : "#e4e4e7";
  const subC     = isLight ? "#64748b"   : isArtis ? "#4a6a4a"   : "#a1a1aa";
  const accent   = isArtis ? "#5b8a5b"   : isLight  ? "#3b6a8a"  : "#3b82f6";
  const accentL  = isArtis ? "#7a9b7a"   : isLight  ? "#5b8aaa"  : "#60a5fa";
  const rowHover = isLight ? "#f8f8fc"   : isArtis ? "#f0f5f0"   : "#2f2f35";
  const tableBdr = isLight ? "#e8e8f0"   : isArtis ? "#d4e4d4"   : "#3f3f46";

  const qc = useQueryClient();
  const [selectedCid, setSelectedCid] = useState("");
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [activeTab, setActiveTab] = useState("kontenplan");
  const [showImport, setShowImport] = useState(false);

  // ── Auto-Jahr: letztes Ablagejahr des Mandanten ───────────────────────────
  useEffect(() => {
    if (!selectedCid) return;
    supabase.from("dokumente")
      .select("year")
      .eq("customer_id", selectedCid)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.year) setSelectedYear(data.year);
      });
  }, [selectedCid]);

  // ── Kunden laden ─────────────────────────────────────────────────────────
  const { data: kunden = [] } = useQuery({
    queryKey: ["customers_all"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const allKunden = kunden.filter(c => c.aktiv !== false);
  const unternehmen = allKunden.filter(c => c.person_type !== "privatperson");
  const privatpersonen = allKunden.filter(c => c.person_type === "privatperson");
  const sortedKunden = [...unternehmen, ...privatpersonen];

  const selectedCustomer = kunden.find(c => c.id === selectedCid);
  const customerName = selectedCustomer
    ? (selectedCustomer.person_type === "privatperson"
        ? [selectedCustomer.anrede, selectedCustomer.nachname, selectedCustomer.vorname].filter(Boolean).join(" ")
        : selectedCustomer.company_name)
    : "";

  // Welche Kunden haben bereits Abschlüsse?
  const { data: existingAbschlussIds = [] } = useQuery({
    queryKey: ["abschluss_cids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("abschluss").select("customer_id");
      if (error) throw new Error(error.message);
      return [...new Set((data || []).map(r => r.customer_id))];
    },
  });
  const withAbschlussSet = new Set(existingAbschlussIds);

  // ── Abschluss laden / erstellen ───────────────────────────────────────────
  const { data: abschluss, isLoading: abschlussLoading, refetch: refetchAbschluss } = useQuery({
    queryKey: ["abschluss", selectedCid, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("abschluss")
        .select("*")
        .eq("customer_id", selectedCid)
        .eq("geschaeftsjahr", selectedYear)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data; // null if not exists
    },
    enabled: !!selectedCid,
  });

  // ── Abschluss erstellen falls nicht vorhanden ─────────────────────────────
  const createAbschlussMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("abschluss")
        .insert({ customer_id: selectedCid, geschaeftsjahr: selectedYear, status: "in_arbeit" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss", selectedCid, selectedYear] });
      qc.invalidateQueries({ queryKey: ["abschluss_cids"] });
    },
    onError: (e) => toast.error("Fehler: " + e.message),
  });

  // Auto-create abschluss when customer & year selected but no abschluss exists
  useEffect(() => {
    if (selectedCid && !abschlussLoading && abschluss === null && !createAbschlussMut.isPending) {
      createAbschlussMut.mutate();
    }
  }, [selectedCid, selectedYear, abschluss, abschlussLoading]);

  const abschlussId = abschluss?.id;

  // ── Konten laden ──────────────────────────────────────────────────────────
  const { data: konten = [], isLoading: kontenLoading } = useQuery({
    queryKey: ["abschluss_konten", abschlussId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("abschluss_konten")
        .select("*")
        .eq("abschluss_id", abschlussId)
        .order("kontonummer");
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!abschlussId,
  });

  // ── Einstellungen (sign_flip, diff_anpassungen) ───────────────────────────
  const einstellungen = abschluss?.einstellungen || {};
  const signFlipPassiven = einstellungen.sign_flip_passiven ?? false;
  const signFlipER       = einstellungen.sign_flip_er       ?? false;
  const diffAnpassungen  = einstellungen.differenz_anpassungen ?? [];

  const updateEinstellungenMut = useMutation({
    mutationFn: async (patch) => {
      const merged = { ...(abschluss?.einstellungen || {}), ...patch };
      const { error } = await supabase.from("abschluss").update({ einstellungen: merged }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["abschluss", selectedCid, selectedYear] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Status aktualisieren ──────────────────────────────────────────────────
  const updateStatusMut = useMutation({
    mutationFn: async (newStatus) => {
      const { error } = await supabase.from("abschluss").update({ status: newStatus }).eq("id", abschlussId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss", selectedCid, selectedYear] });
      toast.success("Status aktualisiert");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Konto aktualisieren ───────────────────────────────────────────────────
  const updateKontoMut = useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const { error } = await supabase.from("abschluss_konten").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] }),
    onError: (e) => toast.error(e.message),
  });

  function handleUpdateKonto(id, fields) {
    updateKontoMut.mutate({ id, ...fields });
  }

  // ── Konten importieren ────────────────────────────────────────────────────
  const importKontenMut = useMutation({
    mutationFn: async (newKonten) => {
      // Delete existing konten for this abschluss
      const { error: delErr } = await supabase.from("abschluss_konten").delete().eq("abschluss_id", abschlussId);
      if (delErr) throw new Error(delErr.message);
      // Insert new konten in batches of 100
      const rows = newKonten.map(k => ({ ...k, abschluss_id: abschlussId }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error: insErr } = await supabase.from("abschluss_konten").insert(rows.slice(i, i + 100));
        if (insErr) throw new Error(insErr.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abschluss_konten", abschlussId] });
      toast.success("Kontenplan importiert");
      setShowImport(false);
    },
    onError: (e) => toast.error("Import fehlgeschlagen: " + e.message),
  });

  function handleImport(kontenData) {
    if (!abschlussId) { toast.error("Abschluss nicht bereit"); return; }
    importKontenMut.mutate(kontenData);
  }

  const status = abschluss?.status || "in_arbeit";
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.in_arbeit;

  const tabs = [
    { id: "kontenplan",       label: "Kontenplan",         icon: FileSpreadsheet },
    { id: "bilanz",           label: "Bilanz",             icon: BarChart2 },
    { id: "erfolgsrechnung",  label: "Erfolgsrechnung",    icon: TrendingUp },
  ];

  const tabProps = { konten, accent, headingC, subC, panelBg, panelBdr, tableBdr, rowHover, theme, customerId: selectedCid, selectedYear };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: accentL }} />
        <button onClick={() => navigate("/ArtisTools")} className="text-sm hover:underline"
          style={{ color: subC, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Artis Tools
        </button>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <BookCheck className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Abschlussdokumentation</span>
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-4" style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <div className="flex flex-wrap items-end gap-4">

          {/* Mandant */}
          <div className="flex-1" style={{ minWidth: 260, maxWidth: 380 }}>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Mandant
            </label>
            <MandantDropdown
              kunden={sortedKunden}
              selectedCid={selectedCid}
              onChange={setSelectedCid}
              panelBg={panelBg} panelBdr={panelBdr} headingC={headingC} subC={subC} accent={accent}
              withAbschlussSet={withAbschlussSet}
            />
          </div>

          {/* Jahr */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Geschäftsjahr
            </label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              style={{
                height: 36, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC,
                outline: "none", cursor: "pointer", minWidth: 90,
              }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Status Badge + Changer */}
          {abschluss && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
                Status
              </label>
              <div className="flex items-center gap-1.5">
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  backgroundColor: statusCfg.bg, color: statusCfg.text,
                  border: `1px solid ${statusCfg.border}`,
                }}>
                  {status === "abgeschlossen" && <CheckCircle2 className="w-3 h-3" />}
                  {status === "genehmigt" && <CheckCircle2 className="w-3 h-3" />}
                  {status === "in_arbeit" && <AlertCircle className="w-3 h-3" />}
                  {statusCfg.label}
                </span>
                <select
                  value={status}
                  onChange={e => updateStatusMut.mutate(e.target.value)}
                  style={{
                    height: 30, padding: "0 6px", borderRadius: 6, fontSize: 11,
                    border: `1px solid ${panelBdr}`, backgroundColor: pageBg, color: subC,
                    outline: "none", cursor: "pointer",
                  }}>
                  <option value="in_arbeit">In Arbeit</option>
                  <option value="abgeschlossen">Abgeschlossen</option>
                  <option value="genehmigt">Genehmigt</option>
                </select>
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Buttons */}
          <div className="flex items-end gap-2">
            <button
              disabled={!abschlussId}
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: accent + "14", color: accent,
                border: `1px solid ${accent}40`,
                opacity: abschlussId ? 1 : 0.4, cursor: abschlussId ? "pointer" : "not-allowed",
              }}>
              <Upload className="w-3.5 h-3.5" />
              Importieren
            </button>
            <button
              disabled={konten.length === 0}
              onClick={() => exportKontenCSV(konten, customerName, selectedYear)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: accent, color: "#ffffff",
                opacity: konten.length > 0 ? 1 : 0.4,
                cursor: konten.length > 0 ? "pointer" : "not-allowed",
              }}>
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedCid ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookCheck className="w-14 h-14 mb-4" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
            <div className="text-lg font-semibold mb-2" style={{ color: headingC }}>Mandant auswählen</div>
            <div className="text-sm" style={{ color: subC }}>
              Wählen Sie einen Mandanten und ein Geschäftsjahr aus, um die Abschlussdokumentation anzuzeigen.
            </div>
          </div>
        ) : (
          <>
            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-0 px-6 pt-4 flex-shrink-0 border-b"
              style={{ borderColor: panelBdr, backgroundColor: panelBg }}>
              {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors relative"
                    style={{
                      color: isActive ? accent : subC,
                      background: "none", border: "none", cursor: "pointer",
                      borderBottom: isActive ? `2px solid ${accent}` : "2px solid transparent",
                      marginBottom: -1,
                    }}>
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {id === "kontenplan" && konten.length > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 10,
                        backgroundColor: isActive ? accent : subC + "30",
                        color: isActive ? "#fff" : subC,
                      }}>
                        {konten.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Tab Content ──────────────────────────────────────────────── */}
            <div className="p-6">
              {abschlussLoading || kontenLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin w-6 h-6 rounded-full border-2" style={{ borderColor: accent + "30", borderTopColor: accent }} />
                </div>
              ) : (
                <>
                  {activeTab === "kontenplan" && (
                    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${panelBdr}`, backgroundColor: panelBg, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                      <KontenplanTab {...tabProps} onUpdateKonto={handleUpdateKonto} />
                    </div>
                  )}
                  {activeTab === "bilanz" && (
                    <BilanzTab {...tabProps}
                      signFlipPassiven={signFlipPassiven}
                      onFlipPassiven={() => updateEinstellungenMut.mutate({ sign_flip_passiven: !signFlipPassiven })}
                      diffAnpassungen={diffAnpassungen}
                      onSaveDiffAnpassungen={(rows) => updateEinstellungenMut.mutate({ differenz_anpassungen: rows })}
                    />
                  )}
                  {activeTab === "erfolgsrechnung" && (
                    <ErfolgsrechnungTab {...tabProps}
                      signFlipER={signFlipER}
                      onFlipER={() => updateEinstellungenMut.mutate({ sign_flip_er: !signFlipER })}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Import Dialog ──────────────────────────────────────────────────── */}
      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImport={handleImport}
          accent={accent}
          theme={theme}
        />
      )}
    </div>
  );
}
