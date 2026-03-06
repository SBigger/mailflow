import React, { useState, useContext, useMemo } from "react";
import { entities, functions, auth, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, Plus, Check, Pencil, Trash2, Search, X,
  RefreshCw, ChevronDown, ChevronRight, AlertTriangle,
  Calendar, Clock, CheckCircle2, Filter, Users, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import AddFristDialog from "@/components/fristen/AddFristDialog";
import GenerateFristenDialog from "@/components/fristen/GenerateFristenDialog";
import { format, differenceInDays, isToday, isTomorrow, isPast, isThisWeek, addDays, parseISO } from "date-fns";
import { de } from "date-fns/locale";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const TABS = [
  { key: "offen",   label: "Offen",   icon: Clock },
  { key: "faellig", label: "Fällig",  icon: AlertTriangle },
  { key: "alle",    label: "Alle",    icon: CalendarClock },
  { key: "erledigt",label: "Erledigt",icon: CheckCircle2 },
];

const CATEGORY_COLORS = {
  "MWST":              { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  "Steuererklärung":   { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  "Lohnabrechnung":    { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  "AHV / IV / ALV":   { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  "Jahresabschluss":   { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  "Pensionskasse":     { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  "Unfallversicherung":{ bg: "#ffedd5", text: "#9a3412", border: "#fdba74" },
  "Behörden":          { bg: "#f0fdf4", text: "#14532d", border: "#86efac" },
  "Verschiedenes":     { bg: "#f4f4f5", text: "#52525b", border: "#d4d4d8" },
};

function getDaysLabel(dueDateStr) {
  const due = parseISO(dueDateStr);
  const diff = differenceInDays(due, new Date());
  if (isToday(due))    return { label: "Heute",     color: "#f97316" };
  if (isTomorrow(due)) return { label: "Morgen",    color: "#eab308" };
  if (diff < 0)        return { label: `${Math.abs(diff)} Tage überfällig`, color: "#ef4444" };
  if (diff <= 7)       return { label: `in ${diff} Tagen`, color: "#eab308" };
  if (diff <= 30)      return { label: `in ${diff} Tagen`, color: "#6366f1" };
  return               { label: `in ${diff} Tagen`, color: "#71717a" };
}

function groupFristen(list) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const groups = {
    overdue:   { label: "⚠ Überfällig",     items: [], color: "#ef4444" },
    today:     { label: "📅 Heute fällig",   items: [], color: "#f97316" },
    thisWeek:  { label: "📆 Diese Woche",    items: [], color: "#eab308" },
    thisMonth: { label: "📋 Nächste 30 Tage",items: [], color: "#6366f1" },
    later:     { label: "🗓 Später",          items: [], color: "#71717a" },
  };

  for (const f of list) {
    const due = parseISO(f.due_date);
    due.setHours(0, 0, 0, 0);
    const diff = differenceInDays(due, now);
    if (diff < 0)       groups.overdue.items.push(f);
    else if (diff === 0) groups.today.items.push(f);
    else if (diff <= 7)  groups.thisWeek.items.push(f);
    else if (diff <= 30) groups.thisMonth.items.push(f);
    else                 groups.later.items.push(f);
  }
  return groups;
}

// ──────────────────────────────────────────────────────────────
// Frist Row Component
// ──────────────────────────────────────────────────────────────
function FristRow({ frist, customers, users, onToggle, onEdit, onDelete, isArtis, isLight }) {
  const customer = customers.find(c => c.id === frist.customer_id);
  const user     = users.find(u => u.email === frist.assignee);
  const catColor = CATEGORY_COLORS[frist.category] || CATEGORY_COLORS["Verschiedenes"];
  const daysInfo = frist.status === "erledigt" ? null : getDaysLabel(frist.due_date);

  const cardBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.6)";
  const cardBorder = isArtis ? "#d4e0d4" : isLight ? "#d4d4e8" : "#3f3f46";
  const textMain   = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm group"
      style={{ backgroundColor: cardBg, borderColor: cardBorder }}
    >
      {/* Done toggle */}
      <button
        onClick={() => onToggle(frist)}
        className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          frist.status === "erledigt"
            ? "bg-green-500 border-green-500 text-white"
            : "border-zinc-400 hover:border-green-500 hover:bg-green-500/10"
        }`}
      >
        {frist.status === "erledigt" && <Check className="h-3 w-3" />}
      </button>

      {/* Category badge */}
      <span
        className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border hidden sm:inline"
        style={{ backgroundColor: catColor.bg, color: catColor.text, borderColor: catColor.border }}
      >
        {frist.category}
      </span>

      {/* Jahr badge */}
      {frist.jahr && (
        <span
          className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border hidden sm:inline"
          style={{ backgroundColor: isArtis ? "#e6ede6" : isLight ? "#ede9fe" : "rgba(99,102,241,0.12)", color: isArtis ? "#4a5e4a" : isLight ? "#4c1d95" : "#818cf8", borderColor: isArtis ? "#bfcfbf" : isLight ? "#c4b5fd" : "rgba(99,102,241,0.3)" }}
        >
          {frist.jahr}
        </span>
      )}

      {/* Title + customer */}
      <div className="flex-1 min-w-0">
        <span
          className={`text-sm font-medium ${frist.status === "erledigt" ? "line-through opacity-50" : ""}`}
          style={{ color: textMain }}
        >
          {frist.title}
        </span>
        {(customer || frist.description) && (
          <div className="flex items-center gap-2 mt-0.5">
            {customer && (
              <span className="text-xs truncate" style={{ color: textMuted }}>
                {customer.company_name}
              </span>
            )}
            {frist.description && (
              <span className="text-xs italic truncate" style={{ color: textMuted }}>
                {frist.description}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Recurring indicator */}
      {frist.is_recurring && (
        <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" style={{ color: textMuted }} title="Wiederkehrend" />
      )}

      {/* Assignee */}
      {user && (
        <span
          className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full hidden md:inline"
          style={{ backgroundColor: isArtis ? "#e6ede6" : isLight ? "#ede9fe" : "rgba(124,58,237,0.15)", color: isArtis ? "#4a5e4a" : "#7c3aed" }}
        >
          {user.full_name?.split(" ")[0] || user.email.split("@")[0]}
        </span>
      )}

      {/* Due date */}
      {frist.status !== "erledigt" && daysInfo && (
        <span className="flex-shrink-0 text-xs font-medium whitespace-nowrap" style={{ color: daysInfo.color }}>
          {daysInfo.label}
        </span>
      )}
      {frist.status === "erledigt" && (
        <span className="flex-shrink-0 text-xs" style={{ color: textMuted }}>
          {format(parseISO(frist.due_date), "dd.MM.yyyy")}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(frist)} className="p-1 rounded hover:bg-zinc-500/10" style={{ color: textMuted }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onDelete(frist.id)} className="p-1 rounded hover:bg-red-500/10 text-red-400">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Group Section
// ──────────────────────────────────────────────────────────────
function FristenGroup({ label, color, items, customers, users, onToggle, onEdit, onDelete, isArtis, isLight, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;
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
        <div className="space-y-1.5 pl-1">
          {items.map(f => (
            <FristRow
              key={f.id}
              frist={f}
              customers={customers}
              users={users}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              isArtis={isArtis}
              isLight={isLight}
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

  const [activeTab,      setActiveTab]      = useState("offen");
  const [search,         setSearch]         = useState("");
  const [filterCategory, setFilterCategory] = useState("alle");
  const [filterAssignee, setFilterAssignee] = useState("alle");
  const [filterJahr,     setFilterJahr]     = useState("alle");
  const [showAdd,        setShowAdd]        = useState(false);
  const [editFrist,      setEditFrist]      = useState(null);
  const [showGenerate,   setShowGenerate]   = useState(false);

  // ── Data ──────────────────────────────────────────────────
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: fristen = [], isLoading } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["allUsers-fristen"],
    queryFn: async () => {
      const res = await functions.invoke("getAllUsers");
      return res.data?.users || [];
    },
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

  const handleDelete = (id) => {
    if (window.confirm("Frist wirklich löschen?")) deleteMutation.mutate(id);
  };

  // ── Filtering ─────────────────────────────────────────────
  const categories = useMemo(() => [...new Set(fristen.map(f => f.category).filter(Boolean))], [fristen]);
  const years      = useMemo(() => [...new Set(fristen.map(f => f.jahr).filter(Boolean))].sort(), [fristen]);

  const filtered = useMemo(() => {
    let list = fristen;

    // Tab filter
    if (activeTab === "offen")    list = list.filter(f => f.status === "offen");
    if (activeTab === "erledigt") list = list.filter(f => f.status === "erledigt");
    if (activeTab === "faellig")  list = list.filter(f => f.status === "offen" && (isPast(parseISO(f.due_date)) || isToday(parseISO(f.due_date))));

    // Category filter
    if (filterCategory !== "alle") list = list.filter(f => f.category === filterCategory);

    // Jahr filter
    if (filterJahr !== "alle") list = list.filter(f => f.jahr === parseInt(filterJahr, 10));

    // Assignee filter
    if (filterAssignee === "me") {
      list = list.filter(f => f.assignee === currentUser?.email || f.created_by === currentUser?.id);
    } else if (filterAssignee !== "alle") {
      list = list.filter(f => f.assignee === filterAssignee);
    }

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
  }, [fristen, activeTab, filterCategory, filterJahr, filterAssignee, search, currentUser, customers]);

  const groups = useMemo(() => groupFristen(filtered.filter(f => f.status === "offen")), [filtered]);

  // ── Stats (top bar badges) ────────────────────────────────
  const overdueCount = fristen.filter(f => f.status === "offen" && isPast(parseISO(f.due_date)) && !isToday(parseISO(f.due_date))).length;
  const todayCount   = fristen.filter(f => f.status === "offen" && isToday(parseISO(f.due_date))).length;

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
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Top Bar ─────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b px-4 md:px-6 py-3" style={{ backgroundColor: topBarBg, borderColor }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">

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

          {/* Right side: filters + new button */}
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

            {/* Category filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs"
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: textMain }}>
                  <Filter className="h-3.5 w-3.5" />
                  {filterCategory === "alle" ? "Kategorie" : filterCategory}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent style={{ backgroundColor: isLight ? "#fff" : "#18181b", borderColor }}>
                <DropdownMenuItem onClick={() => setFilterCategory("alle")} style={{ color: textMain }}>
                  Alle Kategorien
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {categories.map(cat => (
                  <DropdownMenuItem key={cat} onClick={() => setFilterCategory(cat)} style={{ color: textMain }}>
                    {cat}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Jahr filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs"
                  style={{ backgroundColor: filterJahr !== "alle" ? (isArtis ? "#e6ede6" : "rgba(99,102,241,0.15)") : inputBg, borderColor: filterJahr !== "alle" ? (isArtis ? "#7a9b7f" : "#7c3aed") : inputBorder, color: filterJahr !== "alle" ? (isArtis ? "#4a5e4a" : "#7c3aed") : textMain }}>
                  <Calendar className="h-3.5 w-3.5" />
                  {filterJahr === "alle" ? "Jahr" : filterJahr}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent style={{ backgroundColor: isLight ? "#fff" : isArtis ? "#f8faf8" : "#18181b", borderColor }}>
                <DropdownMenuItem onClick={() => setFilterJahr("alle")} style={{ color: textMain }}>
                  Alle Jahre
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {years.map(y => (
                  <DropdownMenuItem key={y} onClick={() => setFilterJahr(String(y))} style={{ color: textMain }}>
                    {y}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Assignee filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs"
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: textMain }}>
                  <Users className="h-3.5 w-3.5" />
                  {filterAssignee === "alle" ? "Person" : filterAssignee === "me" ? "Meine" : users.find(u => u.email === filterAssignee)?.full_name?.split(" ")[0] || "Person"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent style={{ backgroundColor: isLight ? "#fff" : "#18181b", borderColor }}>
                <DropdownMenuItem onClick={() => setFilterAssignee("alle")} style={{ color: textMain }}>Alle</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilterAssignee("me")}   style={{ color: textMain }}>Meine Fristen</DropdownMenuItem>
                <DropdownMenuSeparator />
                {users.map(u => (
                  <DropdownMenuItem key={u.id} onClick={() => setFilterAssignee(u.email)} style={{ color: textMain }}>
                    {u.full_name || u.email}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Refresh */}
            <Button variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["fristen"] })}
              style={{ color: textMuted }}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>

            {/* Generate */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGenerate(true)}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isArtis ? "#4a5e4a" : "#7c3aed" }}
              title="Fristen automatisch generieren"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Generieren
            </Button>

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
          /* Erledigt view – flat list */
          <div className="space-y-1.5 max-w-3xl">
            {filtered.map(f => (
              <FristRow key={f.id} frist={f} customers={customers} users={users}
                onToggle={handleToggle} onEdit={f => { setEditFrist(f); setShowAdd(true); }}
                onDelete={handleDelete} isArtis={isArtis} isLight={isLight} />
            ))}
          </div>
        ) : activeTab === "alle" ? (
          /* Alle – show both open (grouped) + done */
          <div className="max-w-3xl space-y-1">
            {/* Open grouped */}
            {Object.values(groups).map(group => (
              <FristenGroup key={group.label} {...group} customers={customers} users={users}
                onToggle={handleToggle}
                onEdit={f => { setEditFrist(f); setShowAdd(true); }}
                onDelete={handleDelete} isArtis={isArtis} isLight={isLight} defaultOpen={true} />
            ))}
            {/* Done section */}
            {fristen.filter(f => f.status === "erledigt").length > 0 && (
              <FristenGroup
                label="✓ Erledigt" color={textMuted}
                items={fristen.filter(f => f.status === "erledigt").slice(0, 20)}
                customers={customers} users={users}
                onToggle={handleToggle}
                onEdit={f => { setEditFrist(f); setShowAdd(true); }}
                onDelete={handleDelete} isArtis={isArtis} isLight={isLight} defaultOpen={false}
              />
            )}
          </div>
        ) : (
          /* Offen / Fällig – grouped */
          <div className="max-w-3xl">
            {Object.values(groups).every(g => g.items.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: textMuted }}>
                <CheckCircle2 className="h-12 w-12 opacity-30" />
                <p className="text-sm">Keine offenen Fristen in diesem Bereich.</p>
              </div>
            ) : (
              Object.values(groups).map(group => (
                <FristenGroup key={group.label} {...group} customers={customers} users={users}
                  onToggle={handleToggle}
                  onEdit={f => { setEditFrist(f); setShowAdd(true); }}
                  onDelete={handleDelete} isArtis={isArtis} isLight={isLight}
                  defaultOpen={group.label.includes("Überfällig") || group.label.includes("Heute") || group.label.includes("Woche")}
                />
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
      <GenerateFristenDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        customers={customers}
        existingFristen={fristen}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["fristen"] });
          setShowGenerate(false);
        }}
      />
    </div>
  );
}
