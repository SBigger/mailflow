import React, { useState, useContext, useMemo, useRef } from "react";
import { entities, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, Plus, Trash2, Search, X,
  RefreshCw, ChevronDown, ChevronRight, AlertTriangle,
  Calendar, Clock, CheckCircle2, Filter, Users, PlayCircle,
  MapPin, FileCheck, SendHorizontal, Download, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import AddFristDialog from "@/components/fristen/AddFristDialog";
import FristenEinreichenDialog from "@/components/fristen/FristenEinreichenDialog";
import FristenlaufDialog from "@/components/fristen/FristenlaufDialog";
import { FristInlineRow, FristenColumnHeader, ColWidthProvider } from "@/components/fristen/FristInlineRow";
import { isToday, isPast, parseISO } from "date-fns";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const TABS = [
  { key: "offen",   label: "Offen",   icon: Clock },
  { key: "faellig", label: "Fällig",  icon: AlertTriangle },
  { key: "alle",    label: "Alle",    icon: CalendarClock },
  { key: "erledigt",label: "Erledigt",icon: CheckCircle2 },
];


function groupByPersonType(list, customers, preserveOrder = false) {
  const sortByName = (a, b) => {
    const ca = customers.find(c => c.id === a.customer_id);
    const cb = customers.find(c => c.id === b.customer_id);
    return (ca?.company_name || "").localeCompare(cb?.company_name || "", "de");
  };
  const jur = list.filter(f => {
    const c = customers.find(c => c.id === f.customer_id);
    return !c || c.person_type !== "privatperson";
  });
  const nat = list.filter(f => {
    const c = customers.find(c => c.id === f.customer_id);
    return c?.person_type === "privatperson";
  });
  if (!preserveOrder) {
    jur.sort(sortByName);
    nat.sort(sortByName);
  }
  return {
    juristische: { label: "🏢 Juristische Personen", items: jur, color: "#7c3aed", personType: "unternehmen" },
    natuerliche:  { label: "👤 Natürliche Personen",  items: nat, color: "#0ea5e9", personType: "privatperson" },
  };
}

// ──────────────────────────────────────────────────────────────
// Jahr-Untergruppe
// ──────────────────────────────────────────────────────────────
function FristenYearGroup({ year, items, customers, onToggle, onUpdate, onDelete, personType, color, sortCol, sortDir, onSort, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="mb-2 ml-5">
      <button
        className="flex items-center gap-2 mb-1 text-xs font-semibold w-full text-left py-0.5"
        style={{ color }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>{year}</span>
        <span className="ml-1 font-normal opacity-60">({items.length})</span>
      </button>
      {open && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: "max-content", paddingLeft: "4px" }}>
            <FristenColumnHeader personType={personType} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <div className="space-y-1.5">
              {items.map(f => {
                const customer = customers.find(c => c.id === f.customer_id);
                return (
                  <FristInlineRow
                    key={f.id}
                    frist={f}
                    onToggle={onToggle}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    customerName={customer?.company_name}
                    personType={personType}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Group Section – mit Jahr-Untergruppen
// ──────────────────────────────────────────────────────────────
function FristenGroup({ label, color, items, customers, onToggle, onUpdate, onDelete, defaultOpen = true, personType = "unternehmen", sortCol, sortDir, onSort }) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  // Nach Jahr gruppieren, absteigend sortieren (neuestes zuerst)
  const byYear = {};
  items.forEach(f => {
    const y = f.jahr ? String(f.jahr) : "–";
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(f);
  });
  const sortedYears = Object.keys(byYear).sort((a, b) => {
    if (a === "–") return 1;
    if (b === "–") return -1;
    return Number(b) - Number(a);
  });
  const currentYear = String(new Date().getFullYear());

  return (
    <div className="mb-4">
      <button
        className="flex items-center gap-2 mb-2 text-sm font-semibold w-full text-left"
        style={{ color }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {label}
        <span className="ml-1 text-xs font-normal opacity-70">({items.length})</span>
      </button>
      {open && (
        <div>
          {sortedYears.map(year => (
            <FristenYearGroup
              key={year}
              year={year}
              items={byYear[year]}
              customers={customers}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onDelete={onDelete}
              personType={personType}
              color={color}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={onSort}
              defaultOpen={year === currentYear}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────
export default function Fristen() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const queryClient = useQueryClient();

  const [activeTab,       setActiveTab]       = useState("offen");
  const [search,          setSearch]          = useState("");
  const [filterCategory,   setFilterCategory]   = useState("alle");
  const [filterKundenTyp,  setFilterKundenTyp]  = useState("alle"); // 'alle' | 'privatperson' | 'unternehmen'
  const [filterJahr,       setFilterJahr]       = useState("alle");
  const [filterKanton,     setFilterKanton]     = useState("alle");
  const [filterUnterlagen, setFilterUnterlagen] = useState("alle"); // 'alle' | 'erhalten' | 'ausstehend'
  const [showAdd,          setShowAdd]          = useState(false);
  const [editFrist,        setEditFrist]        = useState(null);
  const [showFristenlauf,  setShowFristenlauf]  = useState(false);
  const [showFristenlaufLoeschen, setShowFristenlaufLoeschen] = useState(false);
  const [showEinreichen,          setShowEinreichen]          = useState(false);
  const [sortCol,          setSortCol]          = useState(null);   // null = Standardsortierung
  const restoreInputRef = useRef(null);
  const [sortDir,          setSortDir]          = useState("asc");

  // ── Data ──────────────────────────────────────────────────
  const { data: fristen = [], isLoading } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  // ── Mutations ─────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: data => entities.Frist.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fristen"] }); toast.success("Frist erstellt"); },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Frist.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fristen"] }); },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: id => entities.Frist.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fristen"] }); toast.success("Frist gelöscht"); },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const handleToggle = (frist) => {
    const newStatus = frist.status === "erledigt" ? "offen" : "erledigt";
    updateMutation.mutate({ id: frist.id, data: { status: newStatus } });
    if (newStatus === "erledigt") toast.success("Frist als erledigt markiert ✓");
  };

  const handleSave = (data) => {
    if (editFrist) {
      updateMutation.mutate({ id: editFrist.id, data });
      toast.success("Frist aktualisiert");
    } else {
      createMutation.mutate(data);
    }
    setEditFrist(null);
  };

  const handleUpdate = (id, patch) => {
    updateMutation.mutate({ id, data: patch });
  };

  const handleDelete = (id) => {
    if (window.confirm("Frist wirklich löschen?")) deleteMutation.mutate(id);
  };

  // ── Backup / Restore ──────────────────────────────────────
  const handleFristenSichern = () => {
    try {
      const backup = {
        version: "1.0",
        type: "fristen-backup",
        created_at: new Date().toISOString(),
        fristen: fristen,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fristen-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${fristen.length} Fristen gesichert`);
    } catch (e) {
      toast.error("Sichern fehlgeschlagen: " + e.message);
    }
  };

  const handleFristenZurueckladen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const items = Array.isArray(data) ? data : (data.fristen || []);
        if (!Array.isArray(items) || items.length === 0) {
          toast.error("Ungültiges Backup-Format oder keine Fristen gefunden");
          return;
        }
        if (!window.confirm(`${items.length} Fristen zurückladen? Bestehende Einträge mit gleicher ID werden überschrieben.`)) return;
        const { error } = await supabase.from("fristen").upsert(items, { onConflict: "id" });
        if (error) throw new Error(error.message);
        queryClient.invalidateQueries({ queryKey: ["fristen"] });
        toast.success(`${items.length} Fristen erfolgreich zurückgeladen`);
      } catch (err) {
        toast.error("Zurückladen fehlgeschlagen: " + err.message);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  // ── Filtering ─────────────────────────────────────────────
  const categories = useMemo(() => [...new Set(fristen.map(f => f.category).filter(Boolean))], [fristen]);
  const years      = useMemo(() => [...new Set(fristen.map(f => f.jahr).filter(Boolean))].sort(), [fristen]);
  const kantons    = useMemo(() => {
    const set = new Set();
    fristen.forEach(f => { if (f.kanton) f.kanton.split(",").forEach(k => k.trim() && set.add(k.trim())); });
    return [...set].sort();
  }, [fristen]);

  const filtered = useMemo(() => {
    let list = fristen;

    // Tab filter
    if (activeTab === "offen")    list = list.filter(f => f.status === "offen");
    if (activeTab === "erledigt") list = list.filter(f => f.status === "erledigt");
    if (activeTab === "faellig")  list = list.filter(f => f.status === "offen" && f.due_date && (isPast(parseISO(f.due_date)) || isToday(parseISO(f.due_date))));

    // Category filter
    if (filterCategory !== "alle") list = list.filter(f => f.category === filterCategory);

    // Jahr filter
    if (filterJahr !== "alle") list = list.filter(f => f.jahr === parseInt(filterJahr, 10));

    // Kunden-Typ filter
    if (filterKundenTyp !== "alle") {
      list = list.filter(f => {
        const cust = customers.find(c => c.id === f.customer_id);
        if (filterKundenTyp === "privatperson") return cust?.person_type === "privatperson";
        if (filterKundenTyp === "unternehmen")  return !cust || cust.person_type !== "privatperson";
        return true;
      });
    }

    // Kanton filter (Feld kann kommagetrennte Werte enthalten, z.B. "ZH,TI")
    if (filterKanton !== "alle") {
      list = list.filter(f => f.kanton && f.kanton.split(",").map(k => k.trim()).includes(filterKanton));
    }

    // Unterlagen erhalten filter
    if (filterUnterlagen === "erhalten")   list = list.filter(f =>  f.unterlagen_datum);
    if (filterUnterlagen === "ausstehend") list = list.filter(f => !f.unterlagen_datum);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(f =>
        f.title?.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.category?.toLowerCase().includes(q) ||
        customers.find(c => c.id === f.customer_id)?.company_name.toLowerCase().includes(q)
      );
    }

    return list;
  }, [fristen, activeTab, filterCategory, filterJahr, filterKundenTyp, filterKanton, filterUnterlagen, search, customers]);

  // ── Sortierung ────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedFiltered = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let aVal = "", bVal = "";
      const custA = customers.find(c => c.id === a.customer_id);
      const custB = customers.find(c => c.id === b.customer_id);
      switch (sortCol) {
        case "name":
          aVal = custA?.company_name || "";
          bVal = custB?.company_name || "";
          break;
        case "kanton":
          aVal = a.kanton || "";
          bVal = b.kanton || "";
          break;
        case "spJahr": {
          const diff = (a.jahr || 0) - (b.jahr || 0);
          return sortDir === "asc" ? diff : -diff;
        }
        case "fristBis":
          aVal = a.due_date || "";
          bVal = b.due_date || "";
          break;
        case "unterlagen":
          // Privatperson: unterlagen_datum; Juristisch: abschluss_vorbereitet
          aVal = a.unterlagen_datum || (a.abschluss_vorbereitet ? "z" : "");
          bVal = b.unterlagen_datum || (b.abschluss_vorbereitet ? "z" : "");
          break;
        case "hDom":
          aVal = a.ist_hauptsteuerdomizil ? "z" : "";
          bVal = b.ist_hauptsteuerdomizil ? "z" : "";
          break;
        case "portalLogin":
          aVal = a.portal_login || "";
          bVal = b.portal_login || "";
          break;
        case "portalPw":
          aVal = a.portal_password ? "z" : "";
          bVal = b.portal_password ? "z" : "";
          break;
        default:
          return 0;
      }
      const cmp = String(aVal).localeCompare(String(bVal), "de", { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir, customers]);

  const groups = useMemo(() => groupByPersonType(sortedFiltered, customers, !!sortCol), [sortedFiltered, customers, sortCol]);

  // ── Stats (top bar badges) ────────────────────────────────
  const overdueCount = fristen.filter(f => f.status === "offen" && f.due_date && isPast(parseISO(f.due_date)) && !isToday(parseISO(f.due_date))).length;
  const todayCount   = fristen.filter(f => f.status === "offen" && f.due_date && isToday(parseISO(f.due_date))).length;

  // ── Theme colors ──────────────────────────────────────────
  const pageBg     = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#1a1a1f";
  const topBarBg   = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#1c1c21";
  const borderColor= isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const inputBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.7)";
  const inputBorder= isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46";
  const textMain   = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const activeTabBg= isArtis ? "#7a9b7f" : "#7c3aed";
  const contentBg  = isArtis ? "#f8faf8" : isLight ? "#f4f4f8" : "#18181b";

  return (
    <ColWidthProvider>
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Top Bar ─────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b px-4 md:px-6 pt-3 pb-2" style={{ backgroundColor: topBarBg, borderColor }}>

        {/* Zeile 1: Tabs + Aktions-Buttons */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-black/5 rounded-xl p-1" style={{ backgroundColor: isArtis ? "rgba(0,0,0,0.04)" : isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)" }}>
            {TABS.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key;
              const badge = key === "faellig" ? overdueCount + todayCount : 0;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    backgroundColor: isActive ? activeTabBg : "transparent",
                    color: isActive ? "#ffffff" : textMuted,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {badge > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Aktions-Buttons (Search, Refresh, Fristenlauf, etc.) */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: textMuted }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Suchen..."
                style={{ backgroundColor: inputBg, borderColor: inputBorder, color: textMain }}
                className="pl-8 pr-7 py-1.5 text-sm border rounded-lg focus:outline-none w-36 h-8"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: textMuted }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Refresh */}
            <Button variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["fristen"] })}
              style={{ color: textMuted }}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>

            {/* Fristenlauf */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFristenlauf(true)}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isArtis ? "#4a5e4a" : "#7c3aed" }}
              title="Fristenlauf – Fristen für alle Kunden erstellen"
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Fristenlauf
            </Button>

            {/* Fristenlauf Löschen */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFristenlaufLoeschen(true)}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: "#fca5a5", color: "#dc2626" }}
              title="Fristen löschen – Fristen für alle Kunden entfernen"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Löschen
            </Button>

            {/* Fristen einreichen */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEinreichen(true)}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isArtis ? "#4a5e4a" : "#0ea5e9" }}
              title="Fristen online einreichen – Fristgesuche automatisch auf Kantonsportalen einreichen"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
              Einreichen
            </Button>

            {/* Fristen Sichern */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleFristenSichern}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: isArtis ? "#bfcfbf" : "#6ee7b7", color: isArtis ? "#4a5e4a" : "#059669" }}
              title="Alle Fristen als JSON-Datei herunterladen"
            >
              <Download className="h-3.5 w-3.5" />
              Sichern
            </Button>

            {/* Fristen Zurückladen */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => restoreInputRef.current?.click()}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: isArtis ? "#bfcfbf" : "#fcd34d", color: isArtis ? "#4a5e4a" : "#d97706" }}
              title="Fristen aus JSON-Backup wiederherstellen"
            >
              <Upload className="h-3.5 w-3.5" />
              Zurückladen
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFristenZurueckladen}
            />

            {/* New */}
            <Button
              onClick={() => { setEditFrist(null); setShowAdd(true); }}
              size="sm"
              className="h-8 gap-1.5"
              style={{ backgroundColor: activeTabBg, color: "#fff" }}
            >
              <Plus className="h-4 w-4" />
              Neue Frist
            </Button>
          </div>
        </div>

        {/* Zeile 2: Filter-Chips */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {/* Category filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
                style={{
                  backgroundColor: filterCategory !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg,
                  borderColor:     filterCategory !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder,
                  color:           filterCategory !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain,
                }}>
                <Filter className="h-3 w-3" />
                {filterCategory === "alle" ? "Kategorie" : filterCategory}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: isArtis ? "#f8faf8" : isLight ? "#fff" : "#18181b", borderColor }}>
              <DropdownMenuItem onClick={() => setFilterCategory("alle")} style={{ color: textMain }}>Alle Kategorien</DropdownMenuItem>
              <DropdownMenuSeparator />
              {categories.map(cat => (
                <DropdownMenuItem key={cat} onClick={() => setFilterCategory(cat)} style={{ color: textMain }}>{cat}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Jahr filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
                style={{ backgroundColor: filterJahr !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg, borderColor: filterJahr !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder, color: filterJahr !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain }}>
                <Calendar className="h-3 w-3" />
                {filterJahr === "alle" ? "Jahr" : filterJahr}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: isArtis ? "#f8faf8" : isLight ? "#fff" : "#18181b", borderColor }}>
              <DropdownMenuItem onClick={() => setFilterJahr("alle")} style={{ color: textMain }}>Alle Jahre</DropdownMenuItem>
              <DropdownMenuSeparator />
              {years.map(y => (
                <DropdownMenuItem key={y} onClick={() => setFilterJahr(String(y))} style={{ color: textMain }}>{y}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Kunden-Typ filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
                style={{
                  backgroundColor: filterKundenTyp !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg,
                  borderColor:     filterKundenTyp !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder,
                  color:           filterKundenTyp !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain,
                }}>
                <Users className="h-3 w-3" />
                {filterKundenTyp === "alle" ? "Kunden" : filterKundenTyp === "privatperson" ? "Natürl. Personen" : "Jurist. Personen"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: isArtis ? "#f8faf8" : isLight ? "#fff" : "#18181b", borderColor }}>
              <DropdownMenuItem onClick={() => setFilterKundenTyp("alle")} style={{ color: textMain }}>Alle Kunden</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterKundenTyp("privatperson")} style={{ color: textMain }}>👤 Natürliche Personen</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterKundenTyp("unternehmen")} style={{ color: textMain }}>🏢 Juristische Personen</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Kanton filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
                style={{
                  backgroundColor: filterKanton !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg,
                  borderColor:     filterKanton !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder,
                  color:           filterKanton !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain,
                }}>
                <MapPin className="h-3 w-3" />
                {filterKanton === "alle" ? "Kanton" : filterKanton}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: isArtis ? "#f8faf8" : isLight ? "#fff" : "#18181b", borderColor, maxHeight: 260, overflowY: "auto" }}>
              <DropdownMenuItem onClick={() => setFilterKanton("alle")} style={{ color: textMain }}>Alle Kantone</DropdownMenuItem>
              <DropdownMenuSeparator />
              {kantons.map(kt => (
                <DropdownMenuItem key={kt} onClick={() => setFilterKanton(kt)} style={{ color: textMain }}>{kt}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Unterlagen filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
                style={{
                  backgroundColor: filterUnterlagen !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg,
                  borderColor:     filterUnterlagen !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder,
                  color:           filterUnterlagen !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain,
                }}>
                <FileCheck className="h-3 w-3" />
                {filterUnterlagen === "alle" ? "Unterlagen" : filterUnterlagen === "erhalten" ? "Erhalten ✓" : "Ausstehend"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: isArtis ? "#f8faf8" : isLight ? "#fff" : "#18181b", borderColor }}>
              <DropdownMenuItem onClick={() => setFilterUnterlagen("alle")} style={{ color: textMain }}>Alle</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterUnterlagen("erhalten")} style={{ color: textMain }}>✓ Unterlagen erhalten</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterUnterlagen("ausstehend")} style={{ color: textMain }}>○ Unterlagen ausstehend</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: contentBg }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-32" style={{ color: textMuted }}>
            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Laden...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: textMuted }}>
            <CalendarClock className="h-12 w-12 opacity-30" />
            <p className="text-sm">
              {activeTab === "erledigt" ? "Noch keine erledigten Fristen." :
               activeTab === "faellig"  ? "Keine fälligen Fristen – alles im Griff! 🎉" :
               "Keine Fristen vorhanden."}
            </p>
            <Button size="sm" onClick={() => { setEditFrist(null); setShowAdd(true); }}
              style={{ backgroundColor: activeTabBg, color: "#fff" }}>
              <Plus className="h-4 w-4 mr-1" /> Erste Frist erstellen
            </Button>

          </div>
        ) : activeTab === "erledigt" ? (
          /* Erledigt – nach Personentyp gruppiert */
          <div className="w-full">
            {Object.values(groups).map(group => (
              <FristenGroup key={group.label} {...group} customers={customers}
                onToggle={handleToggle} onUpdate={handleUpdate} onDelete={handleDelete}
                defaultOpen={true} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
            ))}
          </div>
        ) : (
          /* Offen / Fällig / Alle – nach Personentyp gruppiert */
          <div className="w-full">
            {Object.values(groups).every(g => g.items.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: textMuted }}>
                <CheckCircle2 className="h-12 w-12 opacity-30" />
                <p className="text-sm">
                  {activeTab === "faellig" ? "Keine fälligen Fristen – alles im Griff! 🎉" : "Keine Fristen in diesem Bereich."}
                </p>
              </div>
            ) : (
              Object.values(groups).map(group => (
                <FristenGroup key={group.label} {...group} customers={customers}
                  onToggle={handleToggle} onUpdate={handleUpdate} onDelete={handleDelete}
                  defaultOpen={true} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────── */}
      <AddFristDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditFrist(null); }}
        onSave={handleSave}
        initial={editFrist}
      />
      <FristenlaufDialog
        open={showFristenlauf}
        onClose={() => setShowFristenlauf(false)}
        customers={customers}
        existingFristen={fristen}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["fristen"] });
        }}
      />

      <FristenlaufDialog
        mode="delete"
        open={showFristenlaufLoeschen}
        onClose={() => setShowFristenlaufLoeschen(false)}
        customers={customers}
        existingFristen={fristen}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["fristen"] });
        }}
      />
      <FristenEinreichenDialog
        open={showEinreichen}
        onClose={() => setShowEinreichen(false)}
        fristen={fristen}
        customers={customers}
        onAutomationStart={async (params) => {
          // User-Email aus Profil holen für Ablehnungs-Benachrichtigungen
          let userEmail = null;
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("email")
                .eq("id", user.id)
                .single();
              userEmail = profile?.email || user.email || null;
            }
          } catch (e) {
            console.warn("User-Email konnte nicht geladen werden:", e);
          }

          // Callbacks global speichern – Claude greift via javascript_tool darauf zu
          window.__fristenAutomation = {
            ...params,
            supabaseUrl: "https://uawgpxcihixqxqxxbjak.supabase.co",
            anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            userEmail,
          };
          toast.info(`Automation bereit – Claude übernimmt jetzt die Steuerung für ${params.items.length} Fristen`);
        }}
      />
    </div>
    </ColWidthProvider>
  );
}
