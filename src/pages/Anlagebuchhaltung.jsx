import React, { useState, useContext, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  Building2, FileSpreadsheet, Upload, Download, Plus, Trash2,
  ArrowRight, Calculator, Layers, Settings as SettingsIcon, Search,
  TrendingUp, TrendingDown, AlertCircle, ChevronDown, ChevronUp, ChevronRight, Wrench,
} from "lucide-react";

// ── Default-Kategorien CH-Treuhand (werden pro Mandant beim ersten Mal angelegt) ──
const DEFAULT_KATEGORIEN = [
  { name: "Mobiliar",      reihenfolge: 10, default_anbu_nutzungsdauer_j: 10, default_fibu_abschreibung_pct: 25 },
  { name: "Maschinen",     reihenfolge: 20, default_anbu_nutzungsdauer_j: 8,  default_fibu_abschreibung_pct: 30 },
  { name: "Werkzeuge",     reihenfolge: 30, default_anbu_nutzungsdauer_j: 5,  default_fibu_abschreibung_pct: 45 },
  { name: "Fahrzeuge",     reihenfolge: 40, default_anbu_nutzungsdauer_j: 5,  default_fibu_abschreibung_pct: 40 },
  { name: "EDV",           reihenfolge: 50, default_anbu_nutzungsdauer_j: 3,  default_fibu_abschreibung_pct: 40 },
  { name: "Einrichtungen", reihenfolge: 60, default_anbu_nutzungsdauer_j: 10, default_fibu_abschreibung_pct: 25 },
  { name: "Immobilien",    reihenfolge: 70, default_anbu_nutzungsdauer_j: 50, default_fibu_abschreibung_pct: 3  },
];

const TABS = [
  { id: "anlagekartei",  label: "Anlagekartei (ANBU)", icon: Layers },
  { id: "fibu",          label: "FIBU Abschreibungen", icon: Calculator },
  { id: "zusammenfassung", label: "Zusammenfassung & Reserven", icon: TrendingUp },
  { id: "kategorien",    label: "Kategorien",          icon: SettingsIcon },
];

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function fmtCHF(val, digits = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("de-CH", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function evalExpr(str) {
  if (str === null || str === undefined || str === "") return null;
  const s = String(str).replace(/\s+/g, "").replace(/'/g, "").replace(/,/g, ".");
  if (!/^[-+*/.()\d]+$/.test(s)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const r = new Function("return (" + s + ")")();
    return typeof r === "number" && isFinite(r) ? Math.round(r * 100) / 100 : null;
  } catch { return null; }
}

function currentYear() { return new Date().getFullYear(); }

// ── Auto-Mapping FIBU-Kontonummer → Kategorie-Name (CH Swiss KMU + BlueOffice) ─
// Pro Bilanzkonto-Bereich die passende Default-Kategorie
const KONTO_RANGE_MAP = [
  // Liegenschaften / Immobilien
  { from: 1100, to: 1199, kategorie: "Immobilien" },
  // Maschinen (incl. Werkzeuge, einzelne Maschinen)
  { from: 1200, to: 1229, kategorie: "Maschinen" },
  // Werkzeuge
  { from: 1230, to: 1259, kategorie: "Werkzeuge" },
  // Mobiliar / Einrichtungen
  { from: 1260, to: 1269, kategorie: "Mobiliar" },
  // EDV
  { from: 1270, to: 1279, kategorie: "EDV" },
  // Einrichtungen
  { from: 1280, to: 1299, kategorie: "Einrichtungen" },
  // Fahrzeuge
  { from: 1300, to: 1399, kategorie: "Fahrzeuge" },
  // Immaterielles + sonstiges
  { from: 1400, to: 1499, kategorie: "EDV" },
];
function autoMapKontoToKategorie(kontonummer) {
  const nr = parseInt(kontonummer);
  if (!nr) return null;
  return KONTO_RANGE_MAP.find(r => nr >= r.from && nr <= r.to)?.kategorie || null;
}

// CHF-Number-Parser: "1'234.56" / "-1'234.56" / "1234,56" → 1234.56
function parseChNum(s) {
  if (s == null || s === "") return null;
  const cleaned = String(s).replace(/[' ]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── Mandanten-Dropdown (identisch zu Abschlussdokumentation) ─────────────────
function MandantDropdown({ kunden, selectedCid, onChange, panelBg, panelBdr, headingC, subC, accent, withAnbuSet }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

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
    if (!open) { setSearch(""); setHighlightIdx(-1); return; }
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
  const flatList = [...unternehmen, ...privatpersonen];

  const handleKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(i => { const next = Math.min(i + 1, flatList.length - 1); scrollToItem(next); return next; });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => { const next = Math.max(i - 1, 0); scrollToItem(next); return next; });
    } else if (e.key === "Enter" && highlightIdx >= 0 && flatList[highlightIdx]) {
      onChange(flatList[highlightIdx].id); setOpen(false);
    }
  };
  const scrollToItem = (idx) => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  const renderRow = (c, globalIdx) => {
    const hasAnbu = withAnbuSet?.has(c.id);
    const isActive = c.id === selectedCid;
    const isHighlighted = globalIdx === highlightIdx;
    return (
      <div key={c.id}
        data-idx={globalIdx}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => { onChange(c.id); setOpen(false); }}
        onMouseEnter={() => setHighlightIdx(globalIdx)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", cursor: "pointer", fontSize: 13, color: headingC,
          backgroundColor: isHighlighted ? accent + "20" : isActive ? accent + "14" : "transparent",
        }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          backgroundColor: hasAnbu ? "#22c55e" : "transparent",
          border: hasAnbu ? "none" : `1.5px solid ${panelBdr}`,
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
        <input ref={inputRef} value={search}
          onChange={e => { setSearch(e.target.value); setHighlightIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Mandant suchen…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: headingC }} />
        {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 16, padding: 0 }}>&times;</button>}
      </div>
      <div ref={listRef} style={{ maxHeight: 300, overflowY: "auto" }}>
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
            {unternehmen.map((c, i) => renderRow(c, i))}
          </>
        )}
        {privatpersonen.length > 0 && (
          <>
            <div style={{ padding: "5px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: subC, borderTop: `1px solid ${panelBdr}`, textTransform: "uppercase" }}>Privatpersonen</div>
            {privatpersonen.map((c, i) => renderRow(c, unternehmen.length + i))}
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
        style={{ backgroundColor: panelBg, borderColor: open ? accent : panelBdr, color: headingC, cursor: "pointer", transition: "border-color 0.15s", height: 36 }}>
        {selected && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            backgroundColor: withAnbuSet?.has(selectedCid) ? "#22c55e" : "transparent",
            border: withAnbuSet?.has(selectedCid) ? "none" : `1.5px solid ${panelBdr}`,
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

// ANBU linear: Beschaffungskosten / Nutzungsdauer (gleichbleibend bis Buchwert = 0)
function calcAnbuAbschreibungLinear({ beschaffungskosten_netto, anbu_nutzungsdauer_j, anbu_buchwert_anfang }) {
  if (!anbu_nutzungsdauer_j || anbu_nutzungsdauer_j <= 0) return 0;
  const linear = (parseFloat(beschaffungskosten_netto) || 0) / anbu_nutzungsdauer_j;
  // Nicht mehr abschreiben als Buchwert vorhanden (Restbetrag im letzten Jahr)
  const cap = Math.max(0, parseFloat(anbu_buchwert_anfang) || 0);
  return Math.round(Math.min(linear, cap) * 100) / 100;
}

// FIBU degressiv: Buchwert × %  (typisch CH-Tax: 3%, 8%, 20%, 30%, 40%)
function calcFibuAbschreibungDegressiv({ fibu_buchwert_anfang, fibu_abschreibung_pct }) {
  const pct = parseFloat(fibu_abschreibung_pct) || 0;
  const bw  = parseFloat(fibu_buchwert_anfang) || 0;
  return Math.round(bw * pct / 100 * 100) / 100;
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Anlagebuchhaltung() {
  const navigate = useNavigate();
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  // Farbpalette identisch zu Abschlussdokumentation (Artis-grün)
  const pageBg   = isLight ? "#f4f4f8" : isArtis ? "#f2f5f2" : "#2a2a2f";
  const panelBg  = isLight ? "#ffffff" : isArtis ? "#ffffff" : "#27272a";
  const panelBdr = isLight ? "#e2e2ec" : isArtis ? "#ccd8cc" : "#3f3f46";
  const headingC = isLight ? "#1e293b" : isArtis ? "#1a3a1a" : "#e4e4e7";
  const subC     = isLight ? "#64748b" : isArtis ? "#4a6a4a" : "#a1a1aa";
  const accent   = isArtis ? "#5b8a5b" : isLight ? "#3b6a8a" : "#3b82f6";
  const accentL  = isArtis ? "#7a9b7a" : isLight ? "#5b8aaa" : "#60a5fa";
  const rowHover = isLight ? "#f8f8fc" : isArtis ? "#f0f5f0" : "#2f2f35";
  const tableBdr = isLight ? "#e8e8f0" : isArtis ? "#d4e4d4" : "#3f3f46";

  const [selectedCid, setSelectedCid] = useState("");
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [activeTab, setActiveTab] = useState("anlagekartei");
  const [importDialog, setImportDialog] = useState(null); // { rows, mapping, filename }
  const fileRef = useRef(null);

  // ── Kunden laden ────────────────────────────────────────────────────────────
  const { data: allKunden = [] } = useQuery({
    queryKey: ["kunden_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers")
        .select("id, company_name, person_type, anrede, vorname, nachname")
        .order("company_name");
      if (error) throw new Error(error.message);
      return data || [];
    },
  });
  const unternehmen   = allKunden.filter(c => c.person_type !== "privatperson");
  const privatpersonen = allKunden.filter(c => c.person_type === "privatperson");
  const sortedKunden  = [...unternehmen, ...privatpersonen];

  const selectedCustomer = allKunden.find(c => c.id === selectedCid);
  const customerName = selectedCustomer
    ? (selectedCustomer.person_type === "privatperson"
        ? [selectedCustomer.anrede, selectedCustomer.nachname, selectedCustomer.vorname].filter(Boolean).join(" ")
        : selectedCustomer.company_name)
    : "";

  // ── Welche Kunden haben bereits ANBU? ──────────────────────────────────────
  const { data: existingAnbuCids = [] } = useQuery({
    queryKey: ["anbu_cids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("anbu_jahresabschluss").select("customer_id");
      if (error) throw new Error(error.message);
      return [...new Set((data || []).map(r => r.customer_id))];
    },
  });
  const withAnbuSet = new Set(existingAnbuCids);

  // ── Jahresabschluss laden / erstellen ───────────────────────────────────────
  const { data: abschluss, isLoading: abschlussLoading } = useQuery({
    queryKey: ["anbu_abschluss", selectedCid, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anbu_jahresabschluss")
        .select("*")
        .eq("customer_id", selectedCid)
        .eq("geschaeftsjahr", selectedYear)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!selectedCid,
  });

  const createAbschlussMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("anbu_jahresabschluss")
        .insert({ customer_id: selectedCid, geschaeftsjahr: selectedYear })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["anbu_abschluss", selectedCid, selectedYear] });
      qc.invalidateQueries({ queryKey: ["anbu_cids"] });
      qc.invalidateQueries({ queryKey: ["anbu_jahre", selectedCid] });
      toast.success(`Geschäftsjahr ${selectedYear} eröffnet`);
    },
    onError: (e) => toast.error("Fehler: " + e.message),
  });

  const abschlussId = abschluss?.id;

  // Liste aller bereits eröffneten Jahre für diesen Mandanten
  const { data: vorhandeneJahre = [] } = useQuery({
    queryKey: ["anbu_jahre", selectedCid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anbu_jahresabschluss")
        .select("geschaeftsjahr")
        .eq("customer_id", selectedCid)
        .order("geschaeftsjahr");
      if (error) throw new Error(error.message);
      return (data || []).map(r => r.geschaeftsjahr);
    },
    enabled: !!selectedCid,
  });

  // ── Kategorien laden + Default-Seed ─────────────────────────────────────────
  const { data: kategorien = [] } = useQuery({
    queryKey: ["anbu_kategorien", selectedCid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anbu_kategorie").select("*")
        .eq("customer_id", selectedCid)
        .order("reihenfolge");
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedCid,
  });

  const seedKategorienMut = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_KATEGORIEN.map(k => ({ ...k, customer_id: selectedCid }));
      const { error } = await supabase.from("anbu_kategorie").insert(rows);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] }),
    onError: (e) => toast.error("Kategorien-Seed: " + e.message),
  });

  // Auto-seed beim allerersten Mandanten-Öffnen
  useEffect(() => {
    if (selectedCid && kategorien.length === 0 && !seedKategorienMut.isPending) {
      seedKategorienMut.mutate();
    }
  }, [selectedCid, kategorien.length]);

  // ── Anlagen laden ────────────────────────────────────────────────────────────
  const { data: anlagen = [], isLoading: anlagenLoading } = useQuery({
    queryKey: ["anbu_anlagen", abschlussId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anbu_anlage").select("*")
        .eq("abschluss_id", abschlussId)
        .order("kategorie_id").order("sortierung").order("created_at");
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!abschlussId,
  });

  // ── Anlage Update / Insert / Delete ─────────────────────────────────────────
  const updateAnlageMut = useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const { error } = await supabase.from("anbu_anlage").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_anlagen", abschlussId] }),
    onError: (e) => toast.error(e.message),
  });

  const insertAnlageMut = useMutation({
    mutationFn: async (row) => {
      const { error } = await supabase.from("anbu_anlage").insert({ ...row, abschluss_id: abschlussId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["anbu_anlagen", abschlussId] });
      toast.success("Anlage hinzugefügt");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAnlageMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("anbu_anlage").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_anlagen", abschlussId] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Kategorie CRUD ──────────────────────────────────────────────────────────
  const updateKategorieMut = useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const { error } = await supabase.from("anbu_kategorie").update(fields).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] }),
    onError: (e) => toast.error(e.message),
  });

  const insertKategorieMut = useMutation({
    mutationFn: async (row) => {
      const { error } = await supabase.from("anbu_kategorie").insert({ ...row, customer_id: selectedCid });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] }),
    onError: (e) => toast.error(e.message),
  });

  const deleteKategorieMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("anbu_kategorie").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] }),
    onError: (e) => toast.error(e.message),
  });

  // ── Jahreswechsel ──────────────────────────────────────────────────────────
  const jahreswechselMut = useMutation({
    mutationFn: async () => {
      const newYear = selectedYear + 1;
      // 1. Neuen Jahresabschluss anlegen
      const { data: newAbs, error: e1 } = await supabase
        .from("anbu_jahresabschluss")
        .insert({ customer_id: selectedCid, geschaeftsjahr: newYear })
        .select().single();
      if (e1) throw new Error(e1.message);
      // 2. Anlagen kopieren: Buchwert Ende → Buchwert Anfang, Abschr. = 0, Korrektur = 0
      const neueAnlagen = anlagen.map(a => ({
        abschluss_id: newAbs.id,
        inv_nr: a.inv_nr,
        beschreibung: a.beschreibung,
        lieferant: a.lieferant,
        typ: a.typ,
        menge: a.menge,
        aktiviert: a.aktiviert,
        beschaffung_monat: a.beschaffung_monat,
        beschaffung_jahr: a.beschaffung_jahr,
        beschaffungskosten_netto: a.beschaffungskosten_netto,
        fibu_konto: a.fibu_konto,
        kategorie_id: a.kategorie_id,
        sub_kategorie: a.sub_kategorie,
        notiz: a.notiz,
        anbu_nutzungsdauer_j: a.anbu_nutzungsdauer_j,
        anbu_buchwert_anfang: a.anbu_buchwert_ende,
        anbu_abschreibung_gj: 0,
        anbu_korrektur: 0,
        anbu_buchwert_ende: a.anbu_buchwert_ende,
        fibu_abschreibung_pct: a.fibu_abschreibung_pct,
        fibu_buchwert_anfang: a.fibu_buchwert_ende,
        fibu_abschreibung_gj: 0,
        fibu_korrektur: 0,
        fibu_buchwert_ende: a.fibu_buchwert_ende,
        sortierung: a.sortierung,
      }));
      if (neueAnlagen.length > 0) {
        for (let i = 0; i < neueAnlagen.length; i += 100) {
          const { error } = await supabase.from("anbu_anlage").insert(neueAnlagen.slice(i, i + 100));
          if (error) throw new Error(error.message);
        }
      }
      return newYear;
    },
    onSuccess: (newYear) => {
      qc.invalidateQueries({ queryKey: ["anbu_cids"] });
      qc.invalidateQueries({ queryKey: ["anbu_abschluss"] });
      qc.invalidateQueries({ queryKey: ["anbu_anlagen"] });
      qc.invalidateQueries({ queryKey: ["anbu_jahre", selectedCid] });
      toast.success(`Jahreswechsel auf ${newYear} durchgeführt`);
      setSelectedYear(newYear);
    },
    onError: (e) => toast.error("Jahreswechsel: " + e.message),
  });

  // ── PDF-Vorschau editieren (manuelle Anpassungen vor Import) ────────────────
  const updatePdfRow = (idx, field, value) => {
    setImportDialog(d => {
      if (!d || d.mode !== "pdf") return d;
      const rows = [...d.pdfAnlagen];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...d, pdfAnlagen: rows };
    });
  };
  const removePdfRow = (idx) => {
    setImportDialog(d => {
      if (!d || d.mode !== "pdf") return d;
      return { ...d, pdfAnlagen: d.pdfAnlagen.filter((_, i) => i !== idx) };
    });
  };
  const addPdfRow = () => {
    setImportDialog(d => {
      if (!d || d.mode !== "pdf") return d;
      return {
        ...d, pdfAnlagen: [...d.pdfAnlagen, {
          kontonummer: "", beschreibung: "", kategorie_name: null, sub_kategorie: "",
          saldovortrag: 0, saldoEnde: 0, abschrPct: null, abschrSumme: 0,
          korrekturSumme: 0, zugaenge: 0, abgaenge: 0, beschaffungskosten: 0,
          beschaffungJahr: selectedYear, beschaffungMonat: null,
          lieferant: null, buchungsTexte: [],
        }],
      };
    });
  };

  // ── PDF-Import: BlueOffice Kontoblatt-Format ────────────────────────────────
  async function handlePdfImport(file) {
    if (!abschlussId) { toast.error("Erst Mandant und Jahr wählen"); return; }
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.js", import.meta.url
    ).toString();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    // Volltext: Items pro Seite gruppieren nach y-Position (Zeilen)
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str }));
      const lines = [];
      for (const item of items) {
        const y = Math.round(item.y);
        let line = lines.find(l => Math.abs(l.y - y) < 3);
        if (!line) { line = { y, parts: [] }; lines.push(line); }
        line.parts.push(item);
      }
      lines.sort((a, b) => b.y - a.y);
      for (const line of lines) {
        line.parts.sort((a, b) => a.x - b.x);
        fullText += line.parts.map(p => p.text).join(" ") + "\n";
      }
    }

    // Sections pro Bilanzkonto trennen
    // Pattern: "1230 Werkzeuge CHF" – Start einer Section
    const sectionRe = /^\s*(1[0-9]{3})\s+([A-ZÄÖÜa-zäöü][^\n]{2,80}?)\s+CHF\s*$/gm;
    const sections = [];
    let m;
    const text = fullText;
    const matches = [...text.matchAll(sectionRe)];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
      const body = text.slice(start, end);
      sections.push({ kontonummer: matches[i][1], beschreibung: matches[i][2].trim(), body });
    }
    if (sections.length === 0) {
      toast.error("Keine Bilanzkonten erkannt — ist das ein BlueOffice-Kontoblatt-PDF?");
      return;
    }

    // Pro Section: Daten extrahieren
    const anlagen = [];
    for (const s of sections) {
      const lines = s.body.split("\n");
      let saldovortrag = null;
      let saldoEnde = null;
      let abschrPct = null;
      let abschrSumme = 0;
      let korrekturSumme = 0;
      let zugaenge = 0;     // Soll-Buchungen ohne Saldovortrag
      let abgaenge = 0;     // Haben-Buchungen ohne Abschreibung/Überabschreibung
      let lieferanten = [];
      let buchungsTexte = [];
      let buchungsJahr = null;
      let buchungsMonat = null;

      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        // Saldovortrag
        const sv = l.match(/Saldovortrag\s+([-]?[\d'.]+)\s*$/);
        if (sv) { saldovortrag = parseChNum(sv[1]); continue; }
        // Saldo am Ende
        const se = l.match(/^Saldo\s+([-]?[\d'.]+)\s*$/);
        if (se) { saldoEnde = parseChNum(se[1]); continue; }
        // Abschr. X%
        const ab = l.match(/Abschr\.\s*(\d+(?:[.,]\d+)?)\s*%\s+([-]?[\d'.]+)\s+([-]?[\d'.]+)\s*$/);
        if (ab) {
          abschrPct = parseFloat(String(ab[1]).replace(",", "."));
          abschrSumme += parseChNum(ab[2]) || 0;
          continue;
        }
        // Überabschreibung
        const ueb = l.match(/Überabschreibung\s+([-]?[\d'.]+)\s+([-]?[\d'.]+)\s*$/);
        if (ueb) {
          korrekturSumme += parseChNum(ueb[1]) || 0;
          continue;
        }
        // Buchungs-Zeile: DD.MM.YYYY ... Soll Haben Saldo
        // Format: "06.03.2024 H 2721 3552 2000  E.... Gama AG Photovoltaik 14'736.49 ... 959'936.49"
        const bu = l.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+[HS]\s+\d+\s+\d+\s+\d+\s+(.+?)\s+([-]?[\d'.]+)\s+([-]?[\d'.]+)\s*$/);
        if (bu) {
          const dd = parseInt(bu[1]), mm = parseInt(bu[2]), yyyy = parseInt(bu[3]);
          const txt = bu[4].trim();
          const v1 = parseChNum(bu[5]) || 0;
          // bu[6] ist Saldo – nicht weiter benötigt
          if (txt.match(/Abschr|Überabschreibung|Umbuchung|Umb\./i)) {
            // Bei Umbuchung kann es ein Verkauf/Entnahme sein (Haben)
            if (txt.match(/Verkauf|Entnahme/i)) abgaenge += v1;
          } else {
            // Echter Zugang / Aktivierung (Soll-Buchung)
            zugaenge += v1;
            if (!buchungsJahr) { buchungsJahr = yyyy; buchungsMonat = mm; }
            // Lieferant aus Text: nach "E.YYYYNNNNN " kommt der Lieferant
            const lf = txt.match(/^E\.\d+\s+(.+)$/);
            const lieferant = lf ? lf[1].trim() : txt;
            lieferanten.push(lieferant);
            buchungsTexte.push(`${bu[1]}.${bu[2]}.${bu[3]}: ${lieferant} CHF ${bu[5]}`);
          }
          continue;
        }
        // Buchungs-Zeile mit nur Saldo (Verkäufe etc.)
        const bu2 = l.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+[HS]\s+\d+\s+\d+\s+\d+\s+(.+?)\s+([-]?[\d'.]+)\s*$/);
        if (bu2 && bu2[4].match(/Verkauf|Entnahme/i)) {
          abgaenge += parseChNum(bu2[5]) || 0;
        }
      }

      // Beschaffungskosten = aktueller Buchwert Anfang + Zugänge im Jahr
      // (echte Anschaffungskosten unbekannt aus PDF, Saldovortrag ist beste Approximation)
      const beschaffungskosten = (saldovortrag || 0) + zugaenge;

      anlagen.push({
        kontonummer: s.kontonummer,
        beschreibung: s.beschreibung,
        kategorie_name: autoMapKontoToKategorie(s.kontonummer),
        sub_kategorie: s.beschreibung,
        saldovortrag: saldovortrag || 0,
        saldoEnde: saldoEnde || 0,
        abschrPct,
        abschrSumme,
        korrekturSumme,
        zugaenge,
        abgaenge,
        beschaffungskosten,
        beschaffungJahr: buchungsJahr,
        beschaffungMonat: buchungsMonat,
        lieferant: lieferanten[0] || null,
        buchungsTexte,
      });
    }

    // Nur Konten mit irgendeinem Wert importieren
    const filtered = anlagen.filter(a =>
      Math.abs(a.saldovortrag) > 0.01 || Math.abs(a.saldoEnde) > 0.01 || a.zugaenge > 0
    );

    if (filtered.length === 0) {
      toast.error("Keine Konten mit Bewegung gefunden");
      return;
    }

    setImportDialog({
      filename: file.name,
      sheetName: "PDF-Kontoblatt",
      mode: "pdf",
      pdfAnlagen: filtered,
    });
  }

  // PDF-Import-Mutation
  const importPdfMut = useMutation({
    mutationFn: async (pdfAnlagen) => {
      // Kategorien auflösen
      const kategorieMap = new Map(kategorien.map(k => [k.name.toLowerCase(), k.id]));
      const neueKat = new Set();
      for (const a of pdfAnlagen) {
        if (a.kategorie_name && !kategorieMap.has(a.kategorie_name.toLowerCase())) neueKat.add(a.kategorie_name);
      }
      if (neueKat.size > 0) {
        const start = (Math.max(0, ...kategorien.map(k => k.reihenfolge)) || 0) + 10;
        const newKats = Array.from(neueKat).map((name, i) => ({
          customer_id: selectedCid, name, reihenfolge: start + i * 10,
        }));
        const { data: inserted, error } = await supabase.from("anbu_kategorie").insert(newKats).select();
        if (error) throw new Error(error.message);
        for (const k of inserted || []) kategorieMap.set(k.name.toLowerCase(), k.id);
      }
      const rows = pdfAnlagen.map((a, idx) => ({
        abschluss_id: abschlussId,
        beschreibung: a.beschreibung,
        lieferant: a.lieferant,
        typ: "Kauf",
        menge: 1,
        aktiviert: true,
        beschaffung_monat: a.beschaffungMonat,
        beschaffung_jahr: a.beschaffungJahr,
        beschaffungskosten_netto: a.beschaffungskosten,
        fibu_konto: a.kontonummer,
        kategorie_id: a.kategorie_name ? kategorieMap.get(a.kategorie_name.toLowerCase()) : null,
        sub_kategorie: a.sub_kategorie,
        notiz: a.buchungsTexte.length > 0 ? a.buchungsTexte.join("\n") : null,
        // ANBU: gleicher Buchwert wie FIBU (User passt später an)
        anbu_nutzungsdauer_j: null,
        anbu_buchwert_anfang: a.saldovortrag,
        anbu_abschreibung_gj: 0,
        anbu_korrektur: 0,
        anbu_buchwert_ende: a.saldovortrag,
        // FIBU aus PDF
        fibu_abschreibung_pct: a.abschrPct,
        fibu_buchwert_anfang: a.saldovortrag,
        fibu_abschreibung_gj: a.abschrSumme,
        fibu_korrektur: a.korrekturSumme,
        fibu_buchwert_ende: a.saldoEnde,
        sortierung: idx,
      }));
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase.from("anbu_anlage").insert(rows.slice(i, i + 50));
        if (error) throw new Error(error.message);
      }
      return rows.length;
    },
    onSuccess: (cnt) => {
      qc.invalidateQueries({ queryKey: ["anbu_anlagen", abschlussId] });
      qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] });
      toast.success(`${cnt} Konten aus PDF importiert`);
      setImportDialog(null);
    },
    onError: (e) => toast.error("PDF-Import: " + e.message),
  });

  // ── Excel-Import: Anlagekartei-Format einlesen ──────────────────────────────
  async function handleExcelImport(file) {
    if (!abschlussId) { toast.error("Erst Mandant und Jahr wählen"); return; }
    const XLSX = await import("xlsx");
    const data = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(data, { type: "array" });
    // Erste Sheet "Anlagekartei" oder ähnliches bevorzugen
    const sheet = wb.Sheets[wb.SheetNames.find(n => /anlage|fibu/i.test(n)) || wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // Header-Zeile finden (enthält "Beschreibung", "Kategorie", "Beschaffungskosten")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i].map(c => String(c).toLowerCase());
      if (r.some(c => c.includes("beschreibung")) && r.some(c => c.includes("kategorie"))) {
        headerIdx = i; break;
      }
    }
    if (headerIdx < 0) { toast.error("Header-Zeile nicht erkannt (Beschreibung + Kategorie erforderlich)"); return; }
    const headers = rows[headerIdx].map(c => String(c).trim());
    // Spalten-Mapping auto-erkennen
    const find = (patterns) => headers.findIndex(h => patterns.some(p => new RegExp(p, "i").test(h)));
    const cols = {
      beschreibung: find(["beschreibung", "bezeichnung"]),
      lieferant:    find(["lieferant"]),
      typ:          find(["^typ"]),
      menge:        find(["menge"]),
      aktiviert:    find(["aktiviert"]),
      fibu_konto:   find(["fibu.*konto", "^konto"]),
      kategorie:    find(["^kategorie"]),
      monat:        find(["b-mt", "monat"]),
      jahr:         find(["b-jahr", "^jahr"]),
      sub:          find(["sub.*kategorie"]),
      kosten:       find(["beschaffungs.*kosten", "anschaffung", "^netto"]),
      nutzungsdauer: find(["abschreibungs.*dauer", "nutzungs"]),
      bw_anfang:    find(["buchwert.*anfang", "bw.*anf"]),
      abschr_gj:    find(["abschreibung gj", "abschr.*gj"]),
      bw_ende:      find(["buchwert.*ende", "bw.*ende"]),
      fibu_pct:     find(["abschreibung %", "abschr.*%", "fibu.*%"]),
    };
    const dataRows = rows.slice(headerIdx + 1).filter(r =>
      r.some(c => String(c).trim()) && r[cols.beschreibung] && String(r[cols.beschreibung]).trim()
    );
    if (dataRows.length === 0) { toast.error("Keine Datenzeilen gefunden"); return; }
    setImportDialog({ rows: dataRows, cols, filename: file.name, sheetName: wb.SheetNames[0] });
  }

  const importMut = useMutation({
    mutationFn: async ({ rows, cols }) => {
      const num = (v) => {
        if (v === "" || v == null) return 0;
        const n = parseFloat(String(v).replace(/'/g, "").replace(/,/g, "."));
        return isNaN(n) ? 0 : Math.round(n * 100) / 100;
      };
      const kategorieMap = new Map(kategorien.map(k => [k.name.toLowerCase(), k.id]));
      // Neue Kategorien sammeln, die noch nicht existieren
      const neueKat = new Set();
      for (const r of rows) {
        const katName = String(r[cols.kategorie] || "").trim();
        if (katName && !kategorieMap.has(katName.toLowerCase())) neueKat.add(katName);
      }
      // Neue Kategorien anlegen
      if (neueKat.size > 0) {
        const start = (Math.max(0, ...kategorien.map(k => k.reihenfolge)) || 0) + 10;
        const newKats = Array.from(neueKat).map((name, i) => ({
          customer_id: selectedCid, name, reihenfolge: start + i * 10,
        }));
        const { data: inserted, error } = await supabase.from("anbu_kategorie").insert(newKats).select();
        if (error) throw new Error(error.message);
        for (const k of inserted || []) kategorieMap.set(k.name.toLowerCase(), k.id);
      }
      // Anlagen einfügen
      const toInsert = rows.map((r, idx) => {
        const beschaffung = num(r[cols.kosten]);
        const nutz = parseInt(r[cols.nutzungsdauer]) || null;
        const bwAnfang = cols.bw_anfang >= 0 ? num(r[cols.bw_anfang]) : beschaffung;
        const abschrGj = cols.abschr_gj >= 0 ? num(r[cols.abschr_gj])
          : (nutz ? calcAnbuAbschreibungLinear({ beschaffungskosten_netto: beschaffung, anbu_nutzungsdauer_j: nutz, anbu_buchwert_anfang: bwAnfang }) : 0);
        const bwEnde = cols.bw_ende >= 0 ? num(r[cols.bw_ende]) : Math.max(0, bwAnfang - abschrGj);
        const fibuPct = cols.fibu_pct >= 0 ? (parseFloat(String(r[cols.fibu_pct]).replace(",", ".")) || null) : null;
        const katName = String(r[cols.kategorie] || "").trim();
        const katId = katName ? kategorieMap.get(katName.toLowerCase()) : null;
        return {
          abschluss_id: abschlussId,
          beschreibung: String(r[cols.beschreibung] || "").trim(),
          lieferant: cols.lieferant >= 0 ? (String(r[cols.lieferant] || "").trim() || null) : null,
          typ: cols.typ >= 0 ? (String(r[cols.typ] || "Kauf").trim() || "Kauf") : "Kauf",
          menge: cols.menge >= 0 ? (parseFloat(r[cols.menge]) || 1) : 1,
          aktiviert: cols.aktiviert >= 0 ? /ja|true|1/i.test(String(r[cols.aktiviert])) : true,
          beschaffung_monat: cols.monat >= 0 ? (parseInt(r[cols.monat]) || null) : null,
          beschaffung_jahr: cols.jahr >= 0 ? (parseInt(r[cols.jahr]) || null) : null,
          beschaffungskosten_netto: beschaffung,
          fibu_konto: cols.fibu_konto >= 0 ? (String(r[cols.fibu_konto] || "").trim() || null) : null,
          kategorie_id: katId,
          sub_kategorie: cols.sub >= 0 ? (String(r[cols.sub] || "").trim() || null) : null,
          anbu_nutzungsdauer_j: nutz,
          anbu_buchwert_anfang: bwAnfang,
          anbu_abschreibung_gj: abschrGj,
          anbu_korrektur: 0,
          anbu_buchwert_ende: bwEnde,
          fibu_abschreibung_pct: fibuPct,
          fibu_buchwert_anfang: bwAnfang,
          fibu_abschreibung_gj: 0,
          fibu_korrektur: 0,
          fibu_buchwert_ende: bwAnfang,
          sortierung: idx,
        };
      });
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from("anbu_anlage").insert(toInsert.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }
      return toInsert.length;
    },
    onSuccess: (cnt) => {
      qc.invalidateQueries({ queryKey: ["anbu_anlagen", abschlussId] });
      qc.invalidateQueries({ queryKey: ["anbu_kategorien", selectedCid] });
      toast.success(`${cnt} Anlagen importiert`);
      setImportDialog(null);
    },
    onError: (e) => toast.error("Import-Fehler: " + e.message),
  });

  // ── Excel-Export ────────────────────────────────────────────────────────────
  async function handleExcelExport() {
    if (anlagen.length === 0) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const katMap = new Map(kategorien.map(k => [k.id, k.name]));

    // Sheet 1: Anlagekartei (ANBU)
    const sortByKat = (arr) => [...arr].sort((a, b) => {
      const ka = kategorien.find(k => k.id === a.kategorie_id)?.reihenfolge ?? 9999;
      const kb = kategorien.find(k => k.id === b.kategorie_id)?.reihenfolge ?? 9999;
      return ka - kb || (a.sortierung || 0) - (b.sortierung || 0);
    });
    const anbuRows = [
      ["Beschreibung", "Lieferant", "Typ", "Menge", "Aktiviert", "FIBU Konto", "Kategorie",
       "B-MT", "B-Jahr", "Sub-Kategorie", "Beschaffungskosten",
       "Nutzungsdauer (Jahre)", "BW Anfang GJ", "Abschreibung GJ", "Korrektur", "BW Ende GJ"],
      ...sortByKat(anlagen).map(a => [
        a.beschreibung, a.lieferant || "", a.typ || "Kauf", a.menge || 1,
        a.aktiviert ? "ja" : "nein", a.fibu_konto || "",
        katMap.get(a.kategorie_id) || "", a.beschaffung_monat || "", a.beschaffung_jahr || "",
        a.sub_kategorie || "", a.beschaffungskosten_netto || 0,
        a.anbu_nutzungsdauer_j || "", a.anbu_buchwert_anfang || 0, a.anbu_abschreibung_gj || 0,
        a.anbu_korrektur || 0, a.anbu_buchwert_ende || 0,
      ]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(anbuRows);
    ws1["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 11 },
      { wch: 18 }, { wch: 6 }, { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 11 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Anlagekartei ANBU");

    // Sheet 2: FIBU
    const fibuRows = [
      ["Beschreibung", "Lieferant", "FIBU Konto", "Kategorie", "B-MT", "B-Jahr",
       "Beschaffungskosten", "Abschreibung %", "BW Anfang GJ", "Abschreibung GJ", "Korrektur", "BW Ende GJ"],
      ...sortByKat(anlagen).map(a => [
        a.beschreibung, a.lieferant || "", a.fibu_konto || "", katMap.get(a.kategorie_id) || "",
        a.beschaffung_monat || "", a.beschaffung_jahr || "", a.beschaffungskosten_netto || 0,
        a.fibu_abschreibung_pct || "", a.fibu_buchwert_anfang || 0, a.fibu_abschreibung_gj || 0,
        a.fibu_korrektur || 0, a.fibu_buchwert_ende || 0,
      ]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(fibuRows);
    ws2["!cols"] = [{ wch: 32 }, { wch: 20 }, { wch: 11 }, { wch: 18 }, { wch: 6 }, { wch: 8 },
      { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, "FIBU Abschreibungen");

    // Sheet 3: Zusammenfassung
    const sumHead = ["Kategorie", "FIBU Kto", "Bezeichnung",
      "Bestand FIBU Anfang", "Zugang", "Bestand ANBU Anfang", "Stille Reserven Anfang",
      "Abschr. FIBU", "Abschr. ANBU",
      "Bestand FIBU Ende", "Bestand ANBU Ende", "Stille Reserven Ende", "Veränderung stille Reserven"];
    const summary = {};
    for (const a of sortByKat(anlagen)) {
      const kn = katMap.get(a.kategorie_id) || "Ohne Kategorie";
      const kt = a.fibu_konto || "—";
      const key = kn + "||" + kt;
      if (!summary[key]) summary[key] = {
        kategorie: kn, fibu_konto: kt, beschreibung: a.sub_kategorie || a.beschreibung,
        bf_a: 0, bf_e: 0, ba_a: 0, ba_e: 0, abf: 0, aba: 0, zu: 0,
      };
      const s = summary[key];
      s.bf_a += parseFloat(a.fibu_buchwert_anfang) || 0;
      s.bf_e += parseFloat(a.fibu_buchwert_ende) || 0;
      s.ba_a += parseFloat(a.anbu_buchwert_anfang) || 0;
      s.ba_e += parseFloat(a.anbu_buchwert_ende) || 0;
      s.abf  += parseFloat(a.fibu_abschreibung_gj) || 0;
      s.aba  += parseFloat(a.anbu_abschreibung_gj) || 0;
      if (a.beschaffung_jahr === selectedYear) s.zu += parseFloat(a.beschaffungskosten_netto) || 0;
    }
    const sumRows = [sumHead, ...Object.values(summary).map(s => {
      const stilleA = s.ba_a - s.bf_a, stilleE = s.ba_e - s.bf_e;
      return [s.kategorie, s.fibu_konto, s.beschreibung,
        s.bf_a, s.zu, s.ba_a, stilleA, s.abf, s.aba,
        s.bf_e, s.ba_e, stilleE, stilleE - stilleA];
    })];
    const ws3 = XLSX.utils.aoa_to_sheet(sumRows);
    ws3["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Zusammenfassung");

    const fname = `Anlagebuchhaltung_${(customerName || "Mandant").replace(/[^a-zA-Z0-9]/g, "_")}_${selectedYear}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success("Excel-Export erstellt");
  }

  // ── Gemeinsame Props für Tabs ───────────────────────────────────────────────
  const tabProps = {
    anlagen, kategorien, abschlussId, selectedYear, customerName,
    onUpdateAnlage: (id, fields) => updateAnlageMut.mutate({ id, ...fields }),
    onAddAnlage: (row) => insertAnlageMut.mutate(row),
    onDeleteAnlage: (id) => deleteAnlageMut.mutate(id),
    accent, theme, headingC, subC, panelBg, panelBdr, tableBdr, rowHover,
  };

  // Years for selector: vorhandene Jahre + ein paar zukünftige
  const yearOptions = useMemo(() => {
    const y = currentYear();
    const base = new Set([y - 2, y - 1, y, y + 1]);
    vorhandeneJahre.forEach(j => base.add(j));
    return Array.from(base).sort((a, b) => b - a);
  }, [vorhandeneJahre]);
  const isOpen = vorhandeneJahre.includes(selectedYear);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: pageBg }}>
      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${panelBdr}`, backgroundColor: panelBg }}>
        <Wrench className="w-4 h-4" style={{ color: accentL }} />
        <button onClick={() => navigate("/ArtisTools")} className="text-sm hover:underline"
          style={{ color: subC, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          Artis Tools
        </button>
        <ChevronRight className="w-3 h-3" style={{ color: subC }} />
        <Building2 className="w-4 h-4" style={{ color: accent }} />
        <span className="text-sm font-semibold" style={{ color: headingC }}>Anlagebuchhaltung</span>
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
              withAnbuSet={withAnbuSet}
            />
          </div>

          {/* Geschäftsjahr */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
              Geschäftsjahr
            </label>
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              style={{
                height: 36, padding: "0 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC,
                outline: "none", cursor: "pointer", minWidth: 90,
              }}>
              {yearOptions.map(y => (
                <option key={y} value={y}>
                  {vorhandeneJahre.includes(y) ? "● " : "○ "}{y}
                </option>
              ))}
            </select>
          </div>

          {/* Jahreswechsel - nur wenn Folgejahr noch NICHT eröffnet ist */}
          {abschlussId && anlagen.length > 0 && !vorhandeneJahre.includes(selectedYear + 1) && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: subC }}>
                &nbsp;
              </label>
              <button
                disabled={jahreswechselMut.isPending}
                onClick={() => {
                  if (window.confirm(`Jahreswechsel: Anlagen werden in Geschäftsjahr ${selectedYear + 1} kopiert (Buchwert Ende → Buchwert Anfang).\n\nFortfahren?`)) {
                    jahreswechselMut.mutate();
                  }
                }}
                title="Anlagen ins nächste Geschäftsjahr übernehmen"
                style={{ display: "flex", alignItems: "center", gap: 6, height: 36, fontSize: 12, fontWeight: 600,
                  padding: "0 12px", borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${accent}40`, color: accent, backgroundColor: accent + "10" }}>
                <ArrowRight className="w-3.5 h-3.5" />
                Jahreswechsel → {selectedYear + 1}
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Toolbar rechts */}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" style={{ display: "none" }}
              onChange={e => {
                const f = e.target.files[0];
                if (!f) return;
                if (f.name.toLowerCase().endsWith(".pdf")) handlePdfImport(f);
                else handleExcelImport(f);
                e.target.value = "";
              }} />
            <button disabled={!abschlussId}
              onClick={() => fileRef.current?.click()}
              title="Excel (.xlsx) oder PDF (BlueOffice Kontoblatt)"
              style={{ display: "flex", alignItems: "center", gap: 6, height: 36, fontSize: 13, fontWeight: 600,
                padding: "0 14px", borderRadius: 8, cursor: abschlussId ? "pointer" : "not-allowed",
                backgroundColor: accent + "14", color: accent, border: `1px solid ${accent}40`,
                opacity: abschlussId ? 1 : 0.4 }}>
              <Upload className="w-3.5 h-3.5" /> Import (Excel/PDF)
            </button>
            <button disabled={anlagen.length === 0}
              onClick={handleExcelExport}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 36, fontSize: 13, fontWeight: 600,
                padding: "0 14px", borderRadius: 8, cursor: anlagen.length > 0 ? "pointer" : "not-allowed",
                backgroundColor: accent, color: "#fff", border: "none",
                opacity: anlagen.length > 0 ? 1 : 0.4 }}>
              <Download className="w-3.5 h-3.5" /> Excel-Export
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedCid ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Building2 className="w-14 h-14 mb-4" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
            <div className="text-lg font-semibold mb-2" style={{ color: headingC }}>Mandant auswählen</div>
            <div className="text-sm" style={{ color: subC }}>
              Wählen Sie einen Mandanten und ein Geschäftsjahr aus, um die Anlagebuchhaltung anzuzeigen.
            </div>
          </div>
        ) : abschlussLoading ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: subC }}>Wird geladen…</div>
        ) : !abschluss ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Building2 className="w-14 h-14 mb-4" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
            <div className="text-lg font-semibold mb-2" style={{ color: headingC }}>
              Geschäftsjahr {selectedYear} noch nicht eröffnet
            </div>
            <div className="text-sm mb-5" style={{ color: subC, maxWidth: 480 }}>
              Für <strong style={{ color: headingC }}>{customerName}</strong> ist das Geschäftsjahr {selectedYear} noch nicht eröffnet.
              {vorhandeneJahre.length > 0 && (
                <> Vorhandene Jahre: {vorhandeneJahre.join(", ")}.</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={createAbschlussMut.isPending}
                onClick={() => createAbschlussMut.mutate()}
                style={{ display: "flex", alignItems: "center", gap: 6, height: 38, fontSize: 13, fontWeight: 700,
                  padding: "0 18px", borderRadius: 8, cursor: "pointer", border: "none",
                  backgroundColor: accent, color: "#fff",
                  opacity: createAbschlussMut.isPending ? 0.6 : 1 }}>
                <Plus className="w-4 h-4" />
                Geschäftsjahr {selectedYear} eröffnen
              </button>
              {/* Wenn Vorjahr existiert → Jahreswechsel direkt anbieten */}
              {vorhandeneJahre.includes(selectedYear - 1) && (
                <button
                  disabled={jahreswechselMut.isPending}
                  onClick={async () => {
                    if (window.confirm(`${selectedYear} als Folgejahr aus ${selectedYear - 1} eröffnen?\n\nBuchwerte Ende ${selectedYear - 1} → Anfang ${selectedYear}, Abschr./Korr. = 0.`)) {
                      setSelectedYear(selectedYear - 1);
                      // Kurze Verzögerung damit anlagen geladen sind
                      setTimeout(() => jahreswechselMut.mutate(), 300);
                    }
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 6, height: 38, fontSize: 13, fontWeight: 600,
                    padding: "0 14px", borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${accent}40`, color: accent, backgroundColor: accent + "10" }}>
                  <ArrowRight className="w-3.5 h-3.5" />
                  Aus {selectedYear - 1} übernehmen
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="px-6 pt-4 flex items-center gap-1 border-b" style={{ borderColor: panelBdr }}>
              {TABS.map(t => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
                      fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
                      backgroundColor: "transparent", color: active ? accent : subC,
                      borderBottom: `2px solid ${active ? accent : "transparent"}`,
                      marginBottom: -1 }}>
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-6">
              {anlagenLoading ? (
                <div style={{ padding: "60px 0", textAlign: "center", color: subC }}>Wird geladen…</div>
              ) : (
                <>
                  {activeTab === "anlagekartei" && <AnlagekarteiTab {...tabProps} />}
                  {activeTab === "fibu" && <FibuTab {...tabProps} />}
                  {activeTab === "zusammenfassung" && <ZusammenfassungTab {...tabProps} />}
                  {activeTab === "kategorien" && (
                    <KategorienTab
                      kategorien={kategorien}
                      anlagen={anlagen}
                      onUpdate={(id, fields) => updateKategorieMut.mutate({ id, ...fields })}
                      onAdd={(row) => insertKategorieMut.mutate(row)}
                      onDelete={(id) => deleteKategorieMut.mutate(id)}
                      accent={accent} headingC={headingC} subC={subC}
                      panelBg={panelBg} panelBdr={panelBdr} tableBdr={tableBdr}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Import-Dialog ───────────────────────────────────────────────────── */}
      {importDialog && (
        <div onClick={() => setImportDialog(null)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ backgroundColor: panelBg, borderRadius: 14, maxWidth: 820, width: "100%",
              maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${panelBdr}`,
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: headingC }}>
                  {importDialog.mode === "pdf" ? "PDF-Kontoblatt Import" : "Excel-Import vorschauen"}
                </div>
                <div style={{ fontSize: 11, color: subC, marginTop: 2 }}>
                  {importDialog.filename} ·{" "}
                  {importDialog.mode === "pdf"
                    ? `${importDialog.pdfAnlagen.length} Bilanzkonten mit Bewegung erkannt`
                    : `${importDialog.rows.length} Zeilen erkannt · Blatt: ${importDialog.sheetName}`}
                </div>
              </div>
              <button onClick={() => setImportDialog(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 22 }}>×</button>
            </div>
            <div style={{ overflow: "auto", padding: "10px 18px" }}>
              {importDialog.mode === "pdf" ? (
                <>
                  <div style={{ fontSize: 11, color: subC, marginBottom: 8, fontStyle: "italic" }}>
                    Tipp: alle Felder können vor dem Import angepasst werden (Kategorie, Werte, Abschr.%).
                    Eine zusätzliche leere Zeile am Ende für manuelle Ergänzungen.
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ backgroundColor: accent + "08" }}>
                        <th style={pdfHdr(subC, panelBdr, "left", 55)}>Kto</th>
                        <th style={pdfHdr(subC, panelBdr, "left", 0)}>Beschreibung</th>
                        <th style={pdfHdr(subC, panelBdr, "left", 110)}>Kategorie</th>
                        <th style={pdfHdr(subC, panelBdr, "right", 95)}>BW Anf.</th>
                        <th style={pdfHdr(subC, panelBdr, "right", 95)}>Zugang</th>
                        <th style={pdfHdr(subC, panelBdr, "center", 70)}>Abschr%</th>
                        <th style={pdfHdr(subC, panelBdr, "right", 95)}>BW Ende</th>
                        <th style={pdfHdr(subC, panelBdr, "center", 30)}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importDialog.pdfAnlagen.map((a, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${panelBdr}50` }}>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.kontonummer || ""}
                              onChange={e => updatePdfRow(i, "kontonummer", e.target.value)}
                              style={inpStyle("right", panelBdr, headingC, panelBg, true)} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.beschreibung || ""}
                              onChange={e => updatePdfRow(i, "beschreibung", e.target.value)}
                              style={inpStyle("left", panelBdr, headingC, panelBg)} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <select value={a.kategorie_name || ""}
                              onChange={e => updatePdfRow(i, "kategorie_name", e.target.value || null)}
                              style={{ ...inpStyle("left", panelBdr, a.kategorie_name ? accent : "#dc2626", panelBg), padding: "3px 4px" }}>
                              <option value="">— wählen —</option>
                              {[...new Set([...kategorien.map(k => k.name), ...DEFAULT_KATEGORIEN.map(k => k.name)])].map(n =>
                                <option key={n} value={n}>{n}</option>
                              )}
                            </select>
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.saldovortrag ?? ""} type="number" step="0.01"
                              onChange={e => updatePdfRow(i, "saldovortrag", parseFloat(e.target.value) || 0)}
                              style={inpStyle("right", panelBdr, headingC, panelBg, true)} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.zugaenge ?? ""} type="number" step="0.01"
                              onChange={e => updatePdfRow(i, "zugaenge", parseFloat(e.target.value) || 0)}
                              style={inpStyle("right", panelBdr, a.zugaenge > 0 ? "#16a34a" : headingC, panelBg, true)} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.abschrPct ?? ""} type="number" step="0.01"
                              onChange={e => updatePdfRow(i, "abschrPct", parseFloat(e.target.value) || null)}
                              style={inpStyle("center", panelBdr, headingC, panelBg, true)} />
                          </td>
                          <td style={{ padding: "3px 4px" }}>
                            <input value={a.saldoEnde ?? ""} type="number" step="0.01"
                              onChange={e => updatePdfRow(i, "saldoEnde", parseFloat(e.target.value) || 0)}
                              style={inpStyle("right", panelBdr, headingC, panelBg, true)} />
                          </td>
                          <td style={{ padding: "3px 4px", textAlign: "center" }}>
                            <button onClick={() => removePdfRow(i)} title="Zeile entfernen"
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 14, lineHeight: 1, opacity: 0.5 }}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={addPdfRow}
                    style={{ marginTop: 8, fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6,
                      cursor: "pointer", border: `1px dashed ${accent}50`, color: accent, backgroundColor: accent + "08" }}>
                    + Zeile manuell hinzufügen
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: subC, marginBottom: 8 }}>
                    Erkannte Spalten:&nbsp;
                    {Object.entries(importDialog.cols).filter(([_, v]) => v >= 0)
                      .map(([k, v]) => `${k}=${String.fromCharCode(65 + v)}`).join(" · ") || "—"}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ backgroundColor: accent + "08" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: subC, fontWeight: 700, borderBottom: `1px solid ${panelBdr}` }}>Beschreibung</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: subC, fontWeight: 700, borderBottom: `1px solid ${panelBdr}` }}>Kategorie</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: subC, fontWeight: 700, borderBottom: `1px solid ${panelBdr}` }}>Kosten</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: subC, fontWeight: 700, borderBottom: `1px solid ${panelBdr}` }}>ND</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importDialog.rows.slice(0, 10).map((r, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${panelBdr}50` }}>
                          <td style={{ padding: "5px 8px", color: headingC }}>{String(r[importDialog.cols.beschreibung] || "").trim().slice(0, 40)}</td>
                          <td style={{ padding: "5px 8px", color: subC }}>{String(r[importDialog.cols.kategorie] || "").trim()}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: headingC }}>
                            {fmtCHF(parseFloat(String(r[importDialog.cols.kosten] || "0").replace(/'/g, "").replace(/,/g, ".")))}
                          </td>
                          <td style={{ padding: "5px 8px", textAlign: "right", color: subC }}>{r[importDialog.cols.nutzungsdauer] || "—"}</td>
                        </tr>
                      ))}
                      {importDialog.rows.length > 10 && (
                        <tr><td colSpan={4} style={{ padding: "8px", textAlign: "center", color: subC, fontSize: 10, fontStyle: "italic" }}>
                          … und {importDialog.rows.length - 10} weitere Zeilen
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${panelBdr}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setImportDialog(null)}
                style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                  border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC, cursor: "pointer" }}>
                Abbrechen
              </button>
              {importDialog.mode === "pdf" ? (
                <button disabled={importPdfMut.isPending}
                  onClick={() => importPdfMut.mutate(importDialog.pdfAnlagen)}
                  style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none",
                    backgroundColor: accent, color: "#fff", cursor: "pointer", opacity: importPdfMut.isPending ? 0.6 : 1 }}>
                  {importPdfMut.isPending ? "Importiere…" : `${importDialog.pdfAnlagen.length} Konten importieren`}
                </button>
              ) : (
                <button disabled={importMut.isPending}
                  onClick={() => importMut.mutate({ rows: importDialog.rows, cols: importDialog.cols })}
                  style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none",
                    backgroundColor: accent, color: "#fff", cursor: "pointer", opacity: importMut.isPending ? 0.6 : 1 }}>
                  {importMut.isPending ? "Importiere…" : `${importDialog.rows.length} Anlagen importieren`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Anlagekartei-Tab (ANBU, linear) ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
function AnlagekarteiTab({ anlagen, kategorien, onUpdateAnlage, onAddAnlage, onDeleteAnlage,
                          accent, headingC, subC, panelBg, panelBdr, tableBdr, rowHover, theme }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const [editCell, setEditCell] = useState(null); // { id, field, val }
  const [newRow, setNewRow] = useState({
    beschreibung: "", lieferant: "", beschaffung_monat: "", beschaffung_jahr: currentYear(),
    fibu_konto: "", kategorie_id: "", sub_kategorie: "",
    beschaffungskosten_netto: "", anbu_nutzungsdauer_j: "",
    anbu_buchwert_anfang: "", anbu_buchwert_ende: "",
  });

  // Gruppieren nach Kategorie, dann nach FIBU-Konto
  const grouped = useMemo(() => {
    const g = {};
    for (const a of anlagen) {
      const kid = a.kategorie_id || "__none__";
      if (!g[kid]) g[kid] = [];
      g[kid].push(a);
    }
    return g;
  }, [anlagen]);

  const submitNewRow = () => {
    if (!newRow.beschreibung.trim()) { toast.error("Beschreibung erforderlich"); return; }
    const kost = evalExpr(newRow.beschaffungskosten_netto) ?? 0;
    const nutz = parseInt(newRow.anbu_nutzungsdauer_j) || null;
    const bw   = evalExpr(newRow.anbu_buchwert_anfang) ?? kost;
    const kat  = kategorien.find(k => k.id === newRow.kategorie_id);
    const abschr = nutz ? calcAnbuAbschreibungLinear({
      beschaffungskosten_netto: kost, anbu_nutzungsdauer_j: nutz, anbu_buchwert_anfang: bw
    }) : 0;
    onAddAnlage({
      beschreibung: newRow.beschreibung.trim(),
      lieferant: newRow.lieferant.trim() || null,
      beschaffung_monat: parseInt(newRow.beschaffung_monat) || null,
      beschaffung_jahr: parseInt(newRow.beschaffung_jahr) || null,
      fibu_konto: newRow.fibu_konto.trim() || null,
      kategorie_id: newRow.kategorie_id || null,
      sub_kategorie: newRow.sub_kategorie.trim() || null,
      beschaffungskosten_netto: kost,
      anbu_nutzungsdauer_j: nutz || (kat?.default_anbu_nutzungsdauer_j ?? null),
      anbu_buchwert_anfang: bw,
      anbu_abschreibung_gj: abschr,
      anbu_korrektur: 0,
      anbu_buchwert_ende: Math.max(0, bw - abschr),
      fibu_abschreibung_pct: kat?.default_fibu_abschreibung_pct ?? null,
      fibu_buchwert_anfang: bw,
      fibu_abschreibung_gj: 0,
      fibu_korrektur: 0,
      fibu_buchwert_ende: bw,
    });
    setNewRow({
      beschreibung: "", lieferant: "", beschaffung_monat: "", beschaffung_jahr: currentYear(),
      fibu_konto: "", kategorie_id: newRow.kategorie_id, sub_kategorie: "",
      beschaffungskosten_netto: "", anbu_nutzungsdauer_j: "",
      anbu_buchwert_anfang: "", anbu_buchwert_ende: "",
    });
  };

  // Inline-Edit für Saldofelder mit Formel-Support
  const startEdit = (id, field, val) => setEditCell({ id, field, val: String(val ?? "") });
  const commitEdit = () => {
    if (!editCell) return;
    const a = anlagen.find(x => x.id === editCell.id);
    if (!a) { setEditCell(null); return; }
    const raw = editCell.val.replace(/[\r\n]+/g, "").trim();
    let v;
    if (["beschreibung", "lieferant", "fibu_konto", "sub_kategorie", "inv_nr", "notiz"].includes(editCell.field)) {
      v = raw || null;
    } else if (["beschaffung_monat", "beschaffung_jahr", "anbu_nutzungsdauer_j"].includes(editCell.field)) {
      v = parseInt(raw) || null;
    } else {
      v = evalExpr(raw) ?? 0;
    }
    const patch = { [editCell.field]: v };
    // Bei Änderung Beschaffungskosten / Nutzungsdauer / Buchwert: Abschreibung neu rechnen
    if (["beschaffungskosten_netto", "anbu_nutzungsdauer_j", "anbu_buchwert_anfang"].includes(editCell.field)) {
      const updated = { ...a, ...patch };
      const abschr = calcAnbuAbschreibungLinear({
        beschaffungskosten_netto: updated.beschaffungskosten_netto,
        anbu_nutzungsdauer_j: updated.anbu_nutzungsdauer_j,
        anbu_buchwert_anfang: updated.anbu_buchwert_anfang,
      });
      patch.anbu_abschreibung_gj = abschr;
      patch.anbu_buchwert_ende = Math.max(0, (parseFloat(updated.anbu_buchwert_anfang) || 0) - abschr - (parseFloat(updated.anbu_korrektur) || 0));
    }
    if (["anbu_abschreibung_gj", "anbu_korrektur"].includes(editCell.field)) {
      const updated = { ...a, ...patch };
      patch.anbu_buchwert_ende = Math.max(0, (parseFloat(updated.anbu_buchwert_anfang) || 0)
        - (parseFloat(updated.anbu_abschreibung_gj) || 0) - (parseFloat(updated.anbu_korrektur) || 0));
    }
    onUpdateAnlage(editCell.id, patch);
    setEditCell(null);
  };

  if (anlagen.length === 0) {
    return (
      <div>
        <NewRowBar newRow={newRow} setNewRow={setNewRow} kategorien={kategorien} onSubmit={submitNewRow}
          accent={accent} headingC={headingC} subC={subC} panelBg={panelBg} panelBdr={panelBdr} />
        <div className="flex flex-col items-center justify-center py-20 text-center mt-6">
          <Building2 className="w-12 h-12 mb-3" style={{ color: isArtis ? "#ccd8cc" : "#d1d5db" }} />
          <div className="text-base font-medium mb-1" style={{ color: headingC }}>Noch keine Anlagen erfasst</div>
          <div className="text-sm" style={{ color: subC }}>Füge oben eine Anlage hinzu oder importiere eine Excel-Datei.</div>
        </div>
      </div>
    );
  }

  // ── Sortier-Reihenfolge der Gruppen ──
  const orderedKidList = [
    ...kategorien.map(k => k.id),
    ...(grouped["__none__"] ? ["__none__"] : []),
  ];

  return (
    <div>
      <NewRowBar newRow={newRow} setNewRow={setNewRow} kategorien={kategorien} onSubmit={submitNewRow}
        accent={accent} headingC={headingC} subC={subC} panelBg={panelBg} panelBdr={panelBdr} />

      <div style={{ marginTop: 12, border: `1px solid ${panelBdr}`, borderRadius: 12, overflow: "hidden", backgroundColor: panelBg }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
              {[
                ["Beschreibung", "left", 220],
                ["Lieferant", "left", 130],
                ["Datum", "center", 70],
                ["FIBU-Kto", "left", 75],
                ["Sub-Kategorie", "left", 150],
                ["Beschaffung netto", "right", 110],
                ["Nutzungs-\ndauer (J)", "center", 70],
                ["BW Anfang", "right", 105],
                ["Abschr. GJ", "right", 105],
                ["Korrektur", "right", 90],
                ["BW Ende", "right", 105],
                ["", "center", 35],
              ].map(([h, ta, w]) => (
                <th key={h+w} style={{ padding: "8px 10px", textAlign: ta, color: subC,
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                  borderBottom: `2px solid ${tableBdr}`, whiteSpace: "pre-line", width: w }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedKidList.map(kid => {
              const rows = grouped[kid];
              if (!rows || rows.length === 0) return null;
              const kat = kategorien.find(k => k.id === kid);
              const isNone = kid === "__none__";
              const totBeschaffung = rows.reduce((s, r) => s + (parseFloat(r.beschaffungskosten_netto) || 0), 0);
              const totBwAnfang  = rows.reduce((s, r) => s + (parseFloat(r.anbu_buchwert_anfang) || 0), 0);
              const totAbschr    = rows.reduce((s, r) => s + (parseFloat(r.anbu_abschreibung_gj) || 0), 0);
              const totKorr      = rows.reduce((s, r) => s + (parseFloat(r.anbu_korrektur) || 0), 0);
              const totBwEnde    = rows.reduce((s, r) => s + (parseFloat(r.anbu_buchwert_ende) || 0), 0);
              return (
                <React.Fragment key={kid}>
                  <tr style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32", borderTop: `2px solid ${tableBdr}` }}>
                    <td colSpan={12} style={{ padding: "8px 12px", fontWeight: 700, fontSize: 12, color: isNone ? "#dc2626" : accent, letterSpacing: "0.04em" }}>
                      {isNone ? "Ohne Kategorie" : kat?.name || "—"}
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: subC }}>
                        ({rows.length} {rows.length === 1 ? "Anlage" : "Anlagen"}
                        {!isNone && kat?.default_anbu_nutzungsdauer_j ? ` · linear ${kat.default_anbu_nutzungsdauer_j}J` : ""})
                      </span>
                    </td>
                  </tr>
                  {rows.map(a => (
                    <AnlageRow key={a.id} a={a} kategorien={kategorien}
                      editCell={editCell} startEdit={startEdit} commitEdit={commitEdit}
                      setEditCell={setEditCell} onUpdateAnlage={onUpdateAnlage} onDeleteAnlage={onDeleteAnlage}
                      accent={accent} headingC={headingC} subC={subC} tableBdr={tableBdr} rowHover={rowHover}
                    />
                  ))}
                  <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2c2c32", borderBottom: `2px solid ${tableBdr}` }}>
                    <td colSpan={5} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, color: subC, textAlign: "right" }}>
                      Total {isNone ? "Ohne Kategorie" : kat?.name}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: headingC }}>{fmtCHF(totBeschaffung)}</td>
                    <td />
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: headingC }}>{fmtCHF(totBwAnfang)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: "#dc2626" }}>{fmtCHF(totAbschr)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: subC }}>{fmtCHF(totKorr)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: headingC }}>{fmtCHF(totBwEnde)}</td>
                    <td />
                  </tr>
                </React.Fragment>
              );
            })}
            {/* GESAMT-TOTAL */}
            {anlagen.length > 0 && (() => {
              const tB = anlagen.reduce((s, r) => s + (parseFloat(r.beschaffungskosten_netto) || 0), 0);
              const tBwA = anlagen.reduce((s, r) => s + (parseFloat(r.anbu_buchwert_anfang) || 0), 0);
              const tAb = anlagen.reduce((s, r) => s + (parseFloat(r.anbu_abschreibung_gj) || 0), 0);
              const tKo = anlagen.reduce((s, r) => s + (parseFloat(r.anbu_korrektur) || 0), 0);
              const tBwE = anlagen.reduce((s, r) => s + (parseFloat(r.anbu_buchwert_ende) || 0), 0);
              return (
                <tr style={{ backgroundColor: accent + "12", borderTop: `2px solid ${accent}` }}>
                  <td colSpan={5} style={{ padding: "10px 12px", fontSize: 12, fontWeight: 800, color: accent, textAlign: "right", letterSpacing: "0.04em" }}>
                    GESAMT-TOTAL ANBU
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tB)}</td>
                  <td />
                  <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tBwA)}</td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: "#dc2626" }}>{fmtCHF(tAb)}</td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: subC }}>{fmtCHF(tKo)}</td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tBwE)}</td>
                  <td />
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Eingabezeile für neue Anlage ─────────────────────────────────────────────
function NewRowBar({ newRow, setNewRow, kategorien, onSubmit, accent, headingC, subC, panelBg, panelBdr }) {
  const inp = (key, w, ph, type = "text") => (
    <input
      type={type}
      value={newRow[key]}
      onChange={e => setNewRow(v => ({ ...v, [key]: e.target.value }))}
      onKeyDown={e => { if (e.key === "Enter") onSubmit(); }}
      placeholder={ph}
      style={{ width: w, padding: "6px 8px", fontSize: 12, borderRadius: 6,
        border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC, outline: "none" }} />
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px",
      border: `1px dashed ${accent}50`, borderRadius: 10, backgroundColor: accent + "08", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: accent, marginRight: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Neue Anlage</span>
      {inp("beschreibung", 200, "Beschreibung *")}
      {inp("lieferant", 130, "Lieferant")}
      {inp("beschaffung_monat", 45, "MM", "number")}
      {inp("beschaffung_jahr", 65, "JJJJ", "number")}
      {inp("fibu_konto", 70, "FIBU-Kto")}
      <select value={newRow.kategorie_id}
        onChange={e => setNewRow(v => ({ ...v, kategorie_id: e.target.value }))}
        style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: `1px solid ${panelBdr}`,
          backgroundColor: panelBg, color: headingC, minWidth: 140 }}>
        <option value="">Kategorie wählen…</option>
        {kategorien.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
      {inp("sub_kategorie", 130, "Sub-Kategorie")}
      {inp("beschaffungskosten_netto", 110, "Kosten netto", "text")}
      {inp("anbu_nutzungsdauer_j", 55, "ND J", "number")}
      {inp("anbu_buchwert_anfang", 110, "BW Anfang (opt.)", "text")}
      <button onClick={onSubmit}
        style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, borderRadius: 6,
          border: "none", cursor: "pointer", backgroundColor: accent, color: "#fff" }}>
        Hinzufügen
      </button>
    </div>
  );
}

// ── Einzelne Anlagezeile ────────────────────────────────────────────────────
function AnlageRow({ a, kategorien, editCell, startEdit, commitEdit, setEditCell, onUpdateAnlage,
                    onDeleteAnlage, accent, headingC, subC, tableBdr, rowHover }) {
  const renderCell = (field, value, opts = {}) => {
    const isEditing = editCell?.id === a.id && editCell?.field === field;
    const display = opts.format ? opts.format(value) : (value ?? (opts.placeholder || "—"));
    return isEditing ? (
      <input autoFocus value={editCell.val}
        onChange={e => setEditCell(v => ({ ...v, val: e.target.value }))}
        onKeyDown={e => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") setEditCell(null);
        }}
        onBlur={commitEdit}
        style={{ width: "100%", padding: "3px 6px", fontSize: 12,
          border: `1.5px solid ${accent}`, borderRadius: 4, outline: "none",
          textAlign: opts.align || "left", fontFamily: opts.mono ? "monospace" : "inherit",
          backgroundColor: accent + "10" }} />
    ) : (
      <span onDoubleClick={() => startEdit(a.id, field, value)}
        title="Doppelklick zum Bearbeiten"
        style={{ cursor: "default", display: "block", textAlign: opts.align || "left",
          fontFamily: opts.mono ? "monospace" : "inherit", color: value == null ? subC : headingC,
          fontStyle: value == null ? "italic" : "normal" }}>
        {display}
      </span>
    );
  };

  const td = { padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, verticalAlign: "middle" };

  return (
    <tr onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
      <td style={{ ...td }}>{renderCell("beschreibung", a.beschreibung)}</td>
      <td style={{ ...td }}>{renderCell("lieferant", a.lieferant, { placeholder: "—" })}</td>
      <td style={{ ...td, textAlign: "center", fontSize: 11, color: subC, whiteSpace: "nowrap" }}>
        {a.beschaffung_monat ? String(a.beschaffung_monat).padStart(2, "0") + "." : ""}{a.beschaffung_jahr || "—"}
      </td>
      <td style={{ ...td }}>{renderCell("fibu_konto", a.fibu_konto, { placeholder: "—" })}</td>
      <td style={{ ...td }}>{renderCell("sub_kategorie", a.sub_kategorie, { placeholder: "—" })}</td>
      <td style={{ ...td }}>{renderCell("beschaffungskosten_netto", a.beschaffungskosten_netto, { align: "right", mono: true, format: fmtCHF })}</td>
      <td style={{ ...td, textAlign: "center" }}>
        {renderCell("anbu_nutzungsdauer_j", a.anbu_nutzungsdauer_j, { align: "center" })}
      </td>
      <td style={{ ...td }}>{renderCell("anbu_buchwert_anfang", a.anbu_buchwert_anfang, { align: "right", mono: true, format: fmtCHF })}</td>
      <td style={{ ...td }}>
        <span onDoubleClick={() => startEdit(a.id, "anbu_abschreibung_gj", a.anbu_abschreibung_gj)}
          title="Doppelklick zum Bearbeiten (auto = lineare Berechnung)"
          style={{ display: "block", textAlign: "right", fontFamily: "monospace", color: "#dc2626" }}>
          {editCell?.id === a.id && editCell?.field === "anbu_abschreibung_gj" ? (
            <input autoFocus value={editCell.val}
              onChange={e => setEditCell(v => ({ ...v, val: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
              onBlur={commitEdit}
              style={{ width: "100%", padding: "3px 6px", fontSize: 12, textAlign: "right",
                fontFamily: "monospace", border: `1.5px solid #dc2626`, borderRadius: 4,
                outline: "none", backgroundColor: "#fef2f2" }} />
          ) : fmtCHF(a.anbu_abschreibung_gj)}
        </span>
      </td>
      <td style={{ ...td }}>{renderCell("anbu_korrektur", a.anbu_korrektur, { align: "right", mono: true, format: fmtCHF })}</td>
      <td style={{ ...td, fontFamily: "monospace", textAlign: "right", fontWeight: 600, color: headingC }}>
        {fmtCHF(a.anbu_buchwert_ende)}
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <button onClick={() => { if (window.confirm(`Anlage "${a.beschreibung}" wirklich löschen?`)) onDeleteAnlage(a.id); }}
          title="Löschen" style={{ background: "none", border: "none", cursor: "pointer", color: subC, opacity: 0.5 }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── FIBU-Tab (degressiv %) ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
function FibuTab({ anlagen, kategorien, onUpdateAnlage, accent, headingC, subC, panelBg, panelBdr, tableBdr, rowHover, theme }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const [editCell, setEditCell] = useState(null);

  const grouped = useMemo(() => {
    const g = {};
    for (const a of anlagen) {
      const kid = a.kategorie_id || "__none__";
      if (!g[kid]) g[kid] = [];
      g[kid].push(a);
    }
    return g;
  }, [anlagen]);

  const startEdit = (id, field, val) => setEditCell({ id, field, val: String(val ?? "") });
  const commitEdit = () => {
    if (!editCell) return;
    const a = anlagen.find(x => x.id === editCell.id);
    if (!a) { setEditCell(null); return; }
    const raw = editCell.val.replace(/[\r\n]+/g, "").trim();
    const v = evalExpr(raw) ?? 0;
    const patch = { [editCell.field]: v };
    if (["fibu_buchwert_anfang", "fibu_abschreibung_pct"].includes(editCell.field)) {
      const upd = { ...a, ...patch };
      const abschr = calcFibuAbschreibungDegressiv({
        fibu_buchwert_anfang: upd.fibu_buchwert_anfang,
        fibu_abschreibung_pct: upd.fibu_abschreibung_pct,
      });
      patch.fibu_abschreibung_gj = abschr;
      patch.fibu_buchwert_ende = Math.max(0, (parseFloat(upd.fibu_buchwert_anfang) || 0) - abschr - (parseFloat(upd.fibu_korrektur) || 0));
    }
    if (["fibu_abschreibung_gj", "fibu_korrektur"].includes(editCell.field)) {
      const upd = { ...a, ...patch };
      patch.fibu_buchwert_ende = Math.max(0, (parseFloat(upd.fibu_buchwert_anfang) || 0)
        - (parseFloat(upd.fibu_abschreibung_gj) || 0) - (parseFloat(upd.fibu_korrektur) || 0));
    }
    onUpdateAnlage(editCell.id, patch);
    setEditCell(null);
  };

  if (anlagen.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", color: subC }}>Keine Anlagen — Anlagekartei zuerst befüllen.</div>;
  }

  const orderedKidList = [...kategorien.map(k => k.id), ...(grouped["__none__"] ? ["__none__"] : [])];

  const inlineNum = (a, field, color = headingC, bg = accent + "10") => {
    const isE = editCell?.id === a.id && editCell?.field === field;
    return isE ? (
      <input autoFocus value={editCell.val}
        onChange={e => setEditCell(v => ({ ...v, val: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
        onBlur={commitEdit}
        style={{ width: "100%", padding: "3px 6px", fontSize: 12, textAlign: "right", fontFamily: "monospace",
          border: `1.5px solid ${accent}`, borderRadius: 4, outline: "none", backgroundColor: bg }} />
    ) : (
      <span onDoubleClick={() => startEdit(a.id, field, a[field])}
        style={{ display: "block", textAlign: "right", fontFamily: "monospace", color, cursor: "default" }}>
        {fmtCHF(a[field])}
      </span>
    );
  };

  const inlinePct = (a) => {
    const isE = editCell?.id === a.id && editCell?.field === "fibu_abschreibung_pct";
    return isE ? (
      <input autoFocus value={editCell.val}
        onChange={e => setEditCell(v => ({ ...v, val: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
        onBlur={commitEdit}
        style={{ width: "100%", padding: "3px 6px", fontSize: 12, textAlign: "right", fontFamily: "monospace",
          border: `1.5px solid ${accent}`, borderRadius: 4, outline: "none", backgroundColor: accent + "10" }} />
    ) : (
      <span onDoubleClick={() => startEdit(a.id, "fibu_abschreibung_pct", a.fibu_abschreibung_pct)}
        style={{ display: "block", textAlign: "center", fontFamily: "monospace", color: headingC, cursor: "default" }}>
        {a.fibu_abschreibung_pct != null ? a.fibu_abschreibung_pct + " %" : <span style={{ color: subC }}>—</span>}
      </span>
    );
  };

  return (
    <div style={{ border: `1px solid ${panelBdr}`, borderRadius: 12, overflow: "hidden", backgroundColor: panelBg }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
            {[
              ["Beschreibung", "left", 240],
              ["Datum", "center", 70],
              ["FIBU-Kto", "left", 75],
              ["Beschaffung netto", "right", 110],
              ["Abschr. %", "center", 75],
              ["BW Anfang", "right", 110],
              ["Abschr. GJ", "right", 110],
              ["Korrektur", "right", 100],
              ["BW Ende", "right", 110],
            ].map(([h, ta, w]) => (
              <th key={h+w} style={{ padding: "8px 10px", textAlign: ta, color: subC, fontSize: 10,
                fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                borderBottom: `2px solid ${tableBdr}`, width: w }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedKidList.map(kid => {
            const rows = grouped[kid];
            if (!rows || rows.length === 0) return null;
            const kat = kategorien.find(k => k.id === kid);
            const isNone = kid === "__none__";
            const tB = rows.reduce((s, r) => s + (parseFloat(r.beschaffungskosten_netto) || 0), 0);
            const tBwA = rows.reduce((s, r) => s + (parseFloat(r.fibu_buchwert_anfang) || 0), 0);
            const tAb = rows.reduce((s, r) => s + (parseFloat(r.fibu_abschreibung_gj) || 0), 0);
            const tKo = rows.reduce((s, r) => s + (parseFloat(r.fibu_korrektur) || 0), 0);
            const tBwE = rows.reduce((s, r) => s + (parseFloat(r.fibu_buchwert_ende) || 0), 0);
            return (
              <React.Fragment key={kid}>
                <tr style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32", borderTop: `2px solid ${tableBdr}` }}>
                  <td colSpan={9} style={{ padding: "8px 12px", fontWeight: 700, fontSize: 12, color: isNone ? "#dc2626" : accent }}>
                    {isNone ? "Ohne Kategorie" : kat?.name}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: subC }}>
                      ({rows.length} Anlagen{!isNone && kat?.default_fibu_abschreibung_pct ? ` · degressiv ${kat.default_fibu_abschreibung_pct}%` : ""})
                    </span>
                  </td>
                </tr>
                {rows.map(a => (
                  <tr key={a.id} onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, color: headingC }}>
                      {a.beschreibung}
                      {a.lieferant && <span style={{ color: subC, marginLeft: 6, fontSize: 11 }}>· {a.lieferant}</span>}
                    </td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, textAlign: "center", fontSize: 11, color: subC }}>
                      {a.beschaffung_monat ? String(a.beschaffung_monat).padStart(2, "0") + "." : ""}{a.beschaffung_jahr || "—"}
                    </td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, color: headingC }}>{a.fibu_konto || "—"}</td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, textAlign: "right", fontFamily: "monospace", color: subC }}>
                      {fmtCHF(a.beschaffungskosten_netto)}
                    </td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80` }}>{inlinePct(a)}</td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80` }}>{inlineNum(a, "fibu_buchwert_anfang")}</td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80` }}>{inlineNum(a, "fibu_abschreibung_gj", "#dc2626", "#fef2f2")}</td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80` }}>{inlineNum(a, "fibu_korrektur", subC)}</td>
                    <td style={{ padding: "5px 10px", borderBottom: `1px solid ${tableBdr}80`, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: headingC }}>
                      {fmtCHF(a.fibu_buchwert_ende)}
                    </td>
                  </tr>
                ))}
                <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2c2c32", borderBottom: `2px solid ${tableBdr}` }}>
                  <td colSpan={3} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, color: subC, textAlign: "right" }}>
                    Total {isNone ? "Ohne Kategorie" : kat?.name}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: subC }}>{fmtCHF(tB)}</td>
                  <td />
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: headingC }}>{fmtCHF(tBwA)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: "#dc2626" }}>{fmtCHF(tAb)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: subC }}>{fmtCHF(tKo)}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, fontFamily: "monospace", color: headingC }}>{fmtCHF(tBwE)}</td>
                </tr>
              </React.Fragment>
            );
          })}
          {(() => {
            const tB = anlagen.reduce((s, r) => s + (parseFloat(r.beschaffungskosten_netto) || 0), 0);
            const tBwA = anlagen.reduce((s, r) => s + (parseFloat(r.fibu_buchwert_anfang) || 0), 0);
            const tAb = anlagen.reduce((s, r) => s + (parseFloat(r.fibu_abschreibung_gj) || 0), 0);
            const tKo = anlagen.reduce((s, r) => s + (parseFloat(r.fibu_korrektur) || 0), 0);
            const tBwE = anlagen.reduce((s, r) => s + (parseFloat(r.fibu_buchwert_ende) || 0), 0);
            return (
              <tr style={{ backgroundColor: accent + "12", borderTop: `2px solid ${accent}` }}>
                <td colSpan={3} style={{ padding: "10px 12px", fontWeight: 800, color: accent, textAlign: "right" }}>GESAMT-TOTAL FIBU</td>
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tB)}</td>
                <td />
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tBwA)}</td>
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: "#dc2626" }}>{fmtCHF(tAb)}</td>
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: subC }}>{fmtCHF(tKo)}</td>
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 800, fontFamily: "monospace", color: accent }}>{fmtCHF(tBwE)}</td>
              </tr>
            );
          })()}
        </tbody>
      </table>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Zusammenfassungs-Tab (Stille Reserven pro FIBU-Konto) ──────────────────
// ════════════════════════════════════════════════════════════════════════════
function ZusammenfassungTab({ anlagen, kategorien, selectedYear, accent, headingC, subC, panelBg, panelBdr, tableBdr, theme }) {
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  // Gruppieren nach Kategorie → dann pro FIBU-Konto
  const summary = useMemo(() => {
    const byKat = {};
    for (const a of anlagen) {
      const kid = a.kategorie_id || "__none__";
      const kto = a.fibu_konto || "—";
      if (!byKat[kid]) byKat[kid] = {};
      if (!byKat[kid][kto]) byKat[kid][kto] = {
        fibu_konto: kto,
        beschreibung: a.sub_kategorie || a.beschreibung,
        bestand_fibu_anfang: 0, bestand_fibu_ende: 0,
        bestand_anbu_anfang: 0, bestand_anbu_ende: 0,
        abschreibung_fibu: 0, abschreibung_anbu: 0,
        korrektur_fibu: 0, korrektur_anbu: 0,
        zugang: 0,
        anlagen: [],
      };
      const row = byKat[kid][kto];
      row.bestand_fibu_anfang += parseFloat(a.fibu_buchwert_anfang) || 0;
      row.bestand_fibu_ende   += parseFloat(a.fibu_buchwert_ende) || 0;
      row.bestand_anbu_anfang += parseFloat(a.anbu_buchwert_anfang) || 0;
      row.bestand_anbu_ende   += parseFloat(a.anbu_buchwert_ende) || 0;
      row.abschreibung_fibu   += parseFloat(a.fibu_abschreibung_gj) || 0;
      row.abschreibung_anbu   += parseFloat(a.anbu_abschreibung_gj) || 0;
      row.korrektur_fibu      += parseFloat(a.fibu_korrektur) || 0;
      row.korrektur_anbu      += parseFloat(a.anbu_korrektur) || 0;
      if (a.beschaffung_jahr === selectedYear) {
        row.zugang += parseFloat(a.beschaffungskosten_netto) || 0;
      }
      row.anlagen.push(a);
    }
    return byKat;
  }, [anlagen, selectedYear]);

  if (anlagen.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", color: subC }}>Keine Anlagen — Anlagekartei zuerst befüllen.</div>;
  }

  // Gesamttotals
  let gTotal = { bf_a: 0, bf_e: 0, ba_a: 0, ba_e: 0, abf: 0, aba: 0, zu: 0 };

  return (
    <div style={{ border: `1px solid ${panelBdr}`, borderRadius: 12, overflow: "hidden", backgroundColor: panelBg }}>
      {/* Legende */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${panelBdr}`, backgroundColor: accent + "08",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: accent }}>Zusammenfassung & Stille Reserven · GJ {selectedYear}</div>
          <div style={{ fontSize: 11, color: subC, marginTop: 2 }}>
            Stille Reserven = Bestand ANBU − Bestand FIBU · Überbewertung = negativ (FIBU &gt; ANBU)
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ color: "#16a34a" }}>● Stille Reserve</span>
          <span style={{ color: "#dc2626" }}>● Überbewertung</span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2f2f35" }}>
              <th style={hdrStyle(subC, tableBdr, "left", 60)}>FIBU Kto</th>
              <th style={hdrStyle(subC, tableBdr, "left", 200)}>Bezeichnung</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Bestand FIBU\nAnfang</th>
              <th style={hdrStyle(subC, tableBdr, "right", 70)}>Zugang</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Bestand ANBU\nAnfang</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Stille Res.\nAnfang</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Abschr.\nFIBU</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Abschr.\nANBU</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Bestand FIBU\nEnde</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Bestand ANBU\nEnde</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Stille Res.\nEnde</th>
              <th style={hdrStyle(subC, tableBdr, "right", 95)}>Veränderung\nstille Res.</th>
            </tr>
          </thead>
          <tbody>
            {[...kategorien.map(k => k.id), "__none__"].map(kid => {
              const kontenObj = summary[kid];
              if (!kontenObj) return null;
              const konten = Object.values(kontenObj).sort((a, b) => String(a.fibu_konto).localeCompare(String(b.fibu_konto)));
              const kat = kategorien.find(k => k.id === kid);
              const isNone = kid === "__none__";

              // Kategorie-Totals
              const kT = konten.reduce((s, r) => ({
                bf_a: s.bf_a + r.bestand_fibu_anfang,
                bf_e: s.bf_e + r.bestand_fibu_ende,
                ba_a: s.ba_a + r.bestand_anbu_anfang,
                ba_e: s.ba_e + r.bestand_anbu_ende,
                abf:  s.abf  + r.abschreibung_fibu,
                aba:  s.aba  + r.abschreibung_anbu,
                zu:   s.zu   + r.zugang,
              }), { bf_a: 0, bf_e: 0, ba_a: 0, ba_e: 0, abf: 0, aba: 0, zu: 0 });
              gTotal = {
                bf_a: gTotal.bf_a + kT.bf_a, bf_e: gTotal.bf_e + kT.bf_e,
                ba_a: gTotal.ba_a + kT.ba_a, ba_e: gTotal.ba_e + kT.ba_e,
                abf:  gTotal.abf  + kT.abf,  aba:  gTotal.aba  + kT.aba,
                zu:   gTotal.zu   + kT.zu,
              };

              return (
                <React.Fragment key={kid}>
                  <tr style={{ backgroundColor: isArtis ? "#f0f5f0" : isLight ? "#f8fafc" : "#2c2c32", borderTop: `2px solid ${tableBdr}` }}>
                    <td colSpan={12} style={{ padding: "7px 12px", fontWeight: 700, fontSize: 11, color: isNone ? "#dc2626" : accent, letterSpacing: "0.04em" }}>
                      {isNone ? "Ohne Kategorie" : kat?.name}
                    </td>
                  </tr>
                  {konten.map((k, i) => {
                    const stilleA = k.bestand_anbu_anfang - k.bestand_fibu_anfang;
                    const stilleE = k.bestand_anbu_ende - k.bestand_fibu_ende;
                    const veraend = stilleE - stilleA;
                    return (
                      <tr key={kid + "_" + k.fibu_konto + "_" + i}>
                        <td style={cellStyle(tableBdr)}>{k.fibu_konto}</td>
                        <td style={cellStyle(tableBdr)}>{k.beschreibung}</td>
                        <td style={numCell(tableBdr)}>{fmtCHF(k.bestand_fibu_anfang)}</td>
                        <td style={{ ...numCell(tableBdr), color: k.zugang > 0 ? "#16a34a" : subC }}>{k.zugang > 0 ? fmtCHF(k.zugang) : "—"}</td>
                        <td style={numCell(tableBdr)}>{fmtCHF(k.bestand_anbu_anfang)}</td>
                        <td style={{ ...numCell(tableBdr), color: stilleA > 0 ? "#16a34a" : stilleA < 0 ? "#dc2626" : subC, fontWeight: 600 }}>
                          {fmtCHF(stilleA)}
                        </td>
                        <td style={{ ...numCell(tableBdr), color: "#dc2626" }}>{fmtCHF(k.abschreibung_fibu)}</td>
                        <td style={{ ...numCell(tableBdr), color: "#dc2626" }}>{fmtCHF(k.abschreibung_anbu)}</td>
                        <td style={numCell(tableBdr)}>{fmtCHF(k.bestand_fibu_ende)}</td>
                        <td style={numCell(tableBdr)}>{fmtCHF(k.bestand_anbu_ende)}</td>
                        <td style={{ ...numCell(tableBdr), color: stilleE > 0 ? "#16a34a" : stilleE < 0 ? "#dc2626" : subC, fontWeight: 700 }}>
                          {fmtCHF(stilleE)}
                        </td>
                        <td style={{ ...numCell(tableBdr), color: veraend > 0 ? "#16a34a" : veraend < 0 ? "#dc2626" : subC }}>
                          {veraend !== 0 ? (veraend > 0 ? "+" : "") + fmtCHF(veraend) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Kategorie-Total */}
                  <tr style={{ backgroundColor: isArtis ? "#e8f2e8" : isLight ? "#f1f5f9" : "#2c2c32" }}>
                    <td colSpan={2} style={{ padding: "7px 10px", fontWeight: 700, fontSize: 11, color: subC, textAlign: "right", borderBottom: `1px solid ${tableBdr}` }}>
                      Total {isNone ? "Ohne Kategorie" : kat?.name}
                    </td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700 }}>{fmtCHF(kT.bf_a)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: kT.zu > 0 ? "#16a34a" : subC }}>{kT.zu > 0 ? fmtCHF(kT.zu) : "—"}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700 }}>{fmtCHF(kT.ba_a)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: (kT.ba_a - kT.bf_a) > 0 ? "#16a34a" : "#dc2626" }}>{fmtCHF(kT.ba_a - kT.bf_a)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: "#dc2626" }}>{fmtCHF(kT.abf)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: "#dc2626" }}>{fmtCHF(kT.aba)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700 }}>{fmtCHF(kT.bf_e)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700 }}>{fmtCHF(kT.ba_e)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: (kT.ba_e - kT.bf_e) > 0 ? "#16a34a" : "#dc2626" }}>{fmtCHF(kT.ba_e - kT.bf_e)}</td>
                    <td style={{ ...numCell(tableBdr), fontWeight: 700, color: ((kT.ba_e - kT.bf_e) - (kT.ba_a - kT.bf_a)) > 0 ? "#16a34a" : "#dc2626" }}>
                      {fmtCHF((kT.ba_e - kT.bf_e) - (kT.ba_a - kT.bf_a))}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
            {/* Gesamt-Total */}
            <tr style={{ backgroundColor: accent + "14", borderTop: `3px solid ${accent}` }}>
              <td colSpan={2} style={{ padding: "12px 10px", fontWeight: 800, fontSize: 12, color: accent, textAlign: "right", letterSpacing: "0.04em" }}>
                TOTAL ANLAGEN
              </td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: accent }}>{fmtCHF(gTotal.bf_a)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: gTotal.zu > 0 ? "#16a34a" : subC }}>{gTotal.zu > 0 ? fmtCHF(gTotal.zu) : "—"}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: accent }}>{fmtCHF(gTotal.ba_a)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: (gTotal.ba_a - gTotal.bf_a) > 0 ? "#16a34a" : "#dc2626" }}>{fmtCHF(gTotal.ba_a - gTotal.bf_a)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: "#dc2626" }}>{fmtCHF(gTotal.abf)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: "#dc2626" }}>{fmtCHF(gTotal.aba)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: accent }}>{fmtCHF(gTotal.bf_e)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: accent }}>{fmtCHF(gTotal.ba_e)}</td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: (gTotal.ba_e - gTotal.bf_e) > 0 ? "#16a34a" : "#dc2626" }}>
                {fmtCHF(gTotal.ba_e - gTotal.bf_e)}
              </td>
              <td style={{ ...numCell(tableBdr), fontWeight: 800, color: ((gTotal.ba_e - gTotal.bf_e) - (gTotal.ba_a - gTotal.bf_a)) > 0 ? "#16a34a" : "#dc2626" }}>
                {fmtCHF((gTotal.ba_e - gTotal.bf_e) - (gTotal.ba_a - gTotal.bf_a))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// PDF-Vorschau Helper-Styles
const pdfHdr = (subC, panelBdr, ta, w) => ({
  padding: "6px 8px", textAlign: ta, color: subC, fontSize: 10, fontWeight: 700,
  borderBottom: `1px solid ${panelBdr}`, ...(w ? { width: w } : {}),
  textTransform: "uppercase", letterSpacing: "0.04em",
});
const inpStyle = (ta, panelBdr, color, panelBg, mono) => ({
  width: "100%", padding: "3px 6px", fontSize: 11,
  border: `1px solid ${panelBdr}`, borderRadius: 4, outline: "none",
  textAlign: ta, color, backgroundColor: panelBg,
  fontFamily: mono ? "monospace" : "inherit",
});

const hdrStyle = (subC, tableBdr, ta, w) => ({
  padding: "8px 8px", textAlign: ta, color: subC, fontSize: 9, fontWeight: 700,
  letterSpacing: "0.04em", textTransform: "uppercase", borderBottom: `2px solid ${tableBdr}`,
  whiteSpace: "pre-line", width: w,
});
const cellStyle = (tableBdr) => ({
  padding: "5px 8px", borderBottom: `1px solid ${tableBdr}80`, fontSize: 11,
});
const numCell = (tableBdr) => ({
  ...cellStyle(tableBdr), textAlign: "right", fontFamily: "monospace",
});

// ════════════════════════════════════════════════════════════════════════════
// ── Kategorien-Tab ──────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
function KategorienTab({ kategorien, anlagen, onUpdate, onAdd, onDelete,
                         accent, headingC, subC, panelBg, panelBdr, tableBdr }) {
  const [newName, setNewName] = useState("");
  const [newNutz, setNewNutz] = useState("");
  const [newPct,  setNewPct]  = useState("");
  const [editId, setEditId] = useState(null);
  const [editFields, setEditFields] = useState({});

  const startEdit = (k) => {
    setEditId(k.id);
    setEditFields({
      name: k.name, reihenfolge: k.reihenfolge,
      default_anbu_nutzungsdauer_j: k.default_anbu_nutzungsdauer_j ?? "",
      default_fibu_abschreibung_pct: k.default_fibu_abschreibung_pct ?? "",
    });
  };
  const commitEdit = () => {
    onUpdate(editId, {
      name: editFields.name.trim(),
      reihenfolge: parseInt(editFields.reihenfolge) || 0,
      default_anbu_nutzungsdauer_j: parseInt(editFields.default_anbu_nutzungsdauer_j) || null,
      default_fibu_abschreibung_pct: parseFloat(editFields.default_fibu_abschreibung_pct) || null,
    });
    setEditId(null);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* Neue Kategorie */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
        border: `1px dashed ${accent}50`, borderRadius: 10, backgroundColor: accent + "08", marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Neue Kategorie</span>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name (z.B. Skipisten)"
          style={{ flex: 1, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC }} />
        <input value={newNutz} onChange={e => setNewNutz(e.target.value)} placeholder="ND Jahre" type="number"
          style={{ width: 90, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC, textAlign: "right" }} />
        <input value={newPct} onChange={e => setNewPct(e.target.value)} placeholder="FIBU %" type="number"
          style={{ width: 80, padding: "6px 10px", fontSize: 13, borderRadius: 6, border: `1px solid ${panelBdr}`, backgroundColor: panelBg, color: headingC, textAlign: "right" }} />
        <button disabled={!newName.trim()}
          onClick={() => {
            onAdd({
              name: newName.trim(),
              reihenfolge: (Math.max(0, ...kategorien.map(k => k.reihenfolge)) || 0) + 10,
              default_anbu_nutzungsdauer_j: parseInt(newNutz) || null,
              default_fibu_abschreibung_pct: parseFloat(newPct) || null,
            });
            setNewName(""); setNewNutz(""); setNewPct("");
          }}
          style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, borderRadius: 6, border: "none",
            cursor: newName.trim() ? "pointer" : "not-allowed", backgroundColor: accent, color: "#fff",
            opacity: newName.trim() ? 1 : 0.4 }}>
          Hinzufügen
        </button>
      </div>

      {/* Liste */}
      <div style={{ border: `1px solid ${panelBdr}`, borderRadius: 12, overflow: "hidden", backgroundColor: panelBg }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: "#f0f5f0" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `2px solid ${tableBdr}`, width: 60 }}>Pos.</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `2px solid ${tableBdr}` }}>Kategorie</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `2px solid ${tableBdr}`, width: 110 }}>ND Jahre (linear)</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `2px solid ${tableBdr}`, width: 110 }}>FIBU % (degressiv)</th>
              <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: subC, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `2px solid ${tableBdr}`, width: 90 }}>Anlagen</th>
              <th style={{ width: 60, borderBottom: `2px solid ${tableBdr}` }} />
            </tr>
          </thead>
          <tbody>
            {kategorien.map(k => {
              const isE = editId === k.id;
              const usage = anlagen.filter(a => a.kategorie_id === k.id).length;
              return (
                <tr key={k.id} style={{ borderBottom: `1px solid ${tableBdr}80` }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: subC }}>
                    {isE ? <input type="number" value={editFields.reihenfolge}
                      onChange={e => setEditFields(v => ({ ...v, reihenfolge: e.target.value }))}
                      style={{ width: 50, padding: "3px 6px", fontSize: 12, borderRadius: 4, border: `1px solid ${panelBdr}` }} />
                    : k.reihenfolge}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: headingC }}>
                    {isE ? <input value={editFields.name}
                      onChange={e => setEditFields(v => ({ ...v, name: e.target.value }))}
                      style={{ width: "100%", padding: "3px 8px", fontSize: 12, borderRadius: 4, border: `1px solid ${panelBdr}` }} />
                    : k.name}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: headingC }}>
                    {isE ? <input type="number" value={editFields.default_anbu_nutzungsdauer_j}
                      onChange={e => setEditFields(v => ({ ...v, default_anbu_nutzungsdauer_j: e.target.value }))}
                      style={{ width: 80, padding: "3px 6px", fontSize: 12, textAlign: "right", borderRadius: 4, border: `1px solid ${panelBdr}` }} />
                    : (k.default_anbu_nutzungsdauer_j ?? "—")}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: headingC }}>
                    {isE ? <input type="number" step="0.01" value={editFields.default_fibu_abschreibung_pct}
                      onChange={e => setEditFields(v => ({ ...v, default_fibu_abschreibung_pct: e.target.value }))}
                      style={{ width: 80, padding: "3px 6px", fontSize: 12, textAlign: "right", borderRadius: 4, border: `1px solid ${panelBdr}` }} />
                    : (k.default_fibu_abschreibung_pct != null ? k.default_fibu_abschreibung_pct + " %" : "—")}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: subC }}>{usage}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {isE ? (
                      <>
                        <button onClick={commitEdit} style={{ background: "none", border: "none", cursor: "pointer", color: "#16a34a", fontSize: 18, fontWeight: 700 }}>✓</button>
                        <button onClick={() => setEditId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: subC, fontSize: 14 }}>×</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(k)} style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 12, fontWeight: 600 }}>Bearb.</button>
                        <button
                          disabled={usage > 0}
                          onClick={() => { if (window.confirm(`Kategorie "${k.name}" löschen?`)) onDelete(k.id); }}
                          title={usage > 0 ? `${usage} Anlagen nutzen diese Kategorie — Löschen blockiert` : "Löschen"}
                          style={{ background: "none", border: "none", cursor: usage > 0 ? "not-allowed" : "pointer", color: "#dc2626", opacity: usage > 0 ? 0.3 : 1, marginLeft: 6 }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
