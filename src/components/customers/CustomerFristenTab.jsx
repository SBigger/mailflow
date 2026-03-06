import React, { useState, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Plus, Check, Pencil, Trash2, RefreshCw, CalendarClock, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format, parseISO, differenceInDays, isToday, isPast } from "date-fns";
import AddFristDialog from "@/components/fristen/AddFristDialog";
import GenerateFristenDialog from "@/components/fristen/GenerateFristenDialog";

const CATEGORY_COLORS = {
  "MWST":               { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  "Steuererklärung":    { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  "Lohnabrechnung":     { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  "AHV / IV / ALV":    { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  "Jahresabschluss":    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  "Pensionskasse":      { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  "Unfallversicherung": { bg: "#ffedd5", text: "#9a3412", border: "#fdba74" },
  "Behörden":           { bg: "#f0fdf4", text: "#14532d", border: "#86efac" },
  "Verschiedenes":      { bg: "#f4f4f5", text: "#52525b", border: "#d4d4d8" },
};

function getDueDateColor(dueDateStr, status) {
  if (status === "erledigt") return "#71717a";
  const diff = differenceInDays(parseISO(dueDateStr), new Date());
  if (diff < 0)   return "#ef4444";
  if (diff === 0) return "#f97316";
  if (diff <= 7)  return "#eab308";
  if (diff <= 30) return "#6366f1";
  return "#71717a";
}

export default function CustomerFristenTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const queryClient = useQueryClient();

  const [showAdd,      setShowAdd]      = useState(false);
  const [editFrist,    setEditFrist]    = useState(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.6)";
  const cardBorder= isArtis ? "#d4e0d4" : isLight ? "#d4d4e8" : "#3f3f46";
  const accentBg  = isArtis ? "#7a9b7f" : "#7c3aed";

  // Load all fristen, filter client-side by customer_id
  const { data: allFristen = [], isLoading } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
  });

  const fristen = allFristen.filter(f => f.customer_id === customer.id);
  const open    = fristen.filter(f => f.status === "offen").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done    = fristen.filter(f => f.status === "erledigt");

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Frist.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fristen"] }),
    onError: e => toast.error("Fehler: " + e.message),
  });

  const createMutation = useMutation({
    mutationFn: data => entities.Frist.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fristen"] }); toast.success("Frist erstellt"); },
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
    if (newStatus === "erledigt") toast.success("Erledigt ✓");
  };

  const handleSave = (data) => {
    if (editFrist?.id) {
      updateMutation.mutate({ id: editFrist.id, data });
      toast.success("Frist aktualisiert");
    } else {
      createMutation.mutate({ ...data, customer_id: customer.id });
    }
    setEditFrist(null);
  };

  const handleDelete = (id) => {
    if (window.confirm("Frist wirklich löschen?")) deleteMutation.mutate(id);
  };

  const handleNew = () => {
    setEditFrist({ customer_id: customer.id });
    setShowAdd(true);
  };

  const handleEdit = (frist) => {
    setEditFrist(frist);
    setShowAdd(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: textMuted }}>
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Laden...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: textMuted }}>
          {fristen.length === 0 ? "Keine Fristen" : `${open.length} offen, ${done.length} erledigt`}
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowGenerate(true)}
            className="h-7 gap-1.5 text-xs border-violet-300 text-violet-600 hover:bg-violet-50"
            title="Fristen automatisch generieren"
          >
            <Wand2 className="h-3.5 w-3.5" /> Generieren
          </Button>
          <Button size="sm" onClick={handleNew} className="h-7 gap-1.5 text-xs" style={{ backgroundColor: accentBg, color: "#fff" }}>
            <Plus className="h-3.5 w-3.5" /> Neue Frist
          </Button>
        </div>
      </div>

      {fristen.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: textMuted }}>
          <CalendarClock className="h-10 w-10 opacity-30" />
          <p className="text-sm">Noch keine Fristen für diesen Kunden.</p>
          <Button size="sm" onClick={handleNew} style={{ backgroundColor: accentBg, color: "#fff" }}>
            <Plus className="h-4 w-4 mr-1" /> Erste Frist anlegen
          </Button>
        </div>
      ) : (
        <>
          {/* Open fristen */}
          {open.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: textMuted }}>Offen</div>
              {open.map(frist => (
                <FristRow key={frist.id} frist={frist} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete}
                  cardBg={cardBg} cardBorder={cardBorder} textMain={textMain} textMuted={textMuted} isArtis={isArtis} isLight={isLight} />
              ))}
            </div>
          )}

          {/* Done fristen */}
          {done.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: textMuted }}>Erledigt ({done.length})</div>
              {done.map(frist => (
                <FristRow key={frist.id} frist={frist} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete}
                  cardBg={cardBg} cardBorder={cardBorder} textMain={textMain} textMuted={textMuted} isArtis={isArtis} isLight={isLight} />
              ))}
            </div>
          )}
        </>
      )}

      <AddFristDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditFrist(null); }}
        onSave={handleSave}
        initial={editFrist}
      />
      <GenerateFristenDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        customers={[]}
        existingFristen={allFristen}
        singleCustomer={customer}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["fristen"] });
          setShowGenerate(false);
        }}
      />
    </div>
  );
}

function FristRow({ frist, onToggle, onEdit, onDelete, cardBg, cardBorder, textMain, textMuted, isArtis, isLight }) {
  const catColor  = CATEGORY_COLORS[frist.category] || CATEGORY_COLORS["Verschiedenes"];
  const dueDateColor = getDueDateColor(frist.due_date, frist.status);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all hover:shadow-sm group"
      style={{ backgroundColor: cardBg, borderColor: cardBorder }}
    >
      {/* Toggle */}
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

      {/* Category */}
      <span
        className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full border"
        style={{ backgroundColor: catColor.bg, color: catColor.text, borderColor: catColor.border }}
      >
        {frist.category}
      </span>

      {/* Jahr badge */}
      {frist.jahr && (
        <span
          className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded border"
          style={{ backgroundColor: isArtis ? "#e6ede6" : isLight ? "#ede9fe" : "rgba(99,102,241,0.12)", color: isArtis ? "#4a5e4a" : isLight ? "#4c1d95" : "#818cf8", borderColor: isArtis ? "#bfcfbf" : isLight ? "#c4b5fd" : "rgba(99,102,241,0.3)" }}
        >
          {frist.jahr}
        </span>
      )}

      {/* Title */}
      <span
        className={`flex-1 text-sm font-medium min-w-0 truncate ${frist.status === "erledigt" ? "line-through opacity-50" : ""}`}
        style={{ color: textMain }}
      >
        {frist.title}
      </span>

      {/* Due date */}
      <span className="flex-shrink-0 text-xs whitespace-nowrap" style={{ color: dueDateColor }}>
        {format(parseISO(frist.due_date), "dd.MM.yyyy")}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
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
