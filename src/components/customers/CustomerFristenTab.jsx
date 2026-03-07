import React, { useState, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Plus, RefreshCw, CalendarClock, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FristInlineRow, NewFristRow } from "@/components/fristen/FristInlineRow";
import GenerateFristenDialog from "@/components/fristen/GenerateFristenDialog";

export default function CustomerFristenTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const queryClient = useQueryClient();

  const [showNewRow,   setShowNewRow]   = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const textMuted = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const accentBg  = isArtis ? "#7a9b7f" : "#7c3aed";

  // ── Queries ──────────────────────────────────────────────────
  const { data: allFristen = [], isLoading } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
  });

  const fristen = allFristen.filter(f => f.customer_id === customer.id);
  const open    = fristen.filter(f => f.status !== "erledigt").sort((a, b) => a.due_date?.localeCompare(b.due_date));
  const done    = fristen.filter(f => f.status === "erledigt");

  // ── Mutations ─────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Frist.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fristen"] }),
    onError:   e => toast.error("Fehler: " + e.message),
  });

  const createMutation = useMutation({
    mutationFn: data => entities.Frist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fristen"] });
      toast.success("Frist erstellt");
      setShowNewRow(false);
    },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: id => entities.Frist.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fristen"] });
      toast.success("Frist gelöscht");
    },
    onError: e => toast.error("Fehler: " + e.message),
  });

  // ── Handlers ──────────────────────────────────────────────────
  const handleToggle = (frist) => {
    const newStatus = frist.status === "erledigt" ? "offen" : "erledigt";
    updateMutation.mutate({ id: frist.id, data: { status: newStatus } });
    if (newStatus === "erledigt") toast.success("Erledigt ✓");
  };

  const handleUpdate = (id, patch) => {
    updateMutation.mutate({ id, data: patch });
  };

  const handleDelete = (id) => {
    if (window.confirm("Frist wirklich löschen?")) deleteMutation.mutate(id);
  };

  const handleCreate = (data) => {
    createMutation.mutate({ ...data, customer_id: customer.id });
  };

  // ── Loading ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: textMuted }}>
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Laden...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: textMuted }}>
          {fristen.length === 0
            ? "Keine Fristen"
            : `${open.length} offen, ${done.length} erledigt`}
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowGenerate(true)}
            className="h-7 gap-1.5 text-xs"
            style={{ borderColor: isArtis ? "#bfcfbf" : "#c4b5fd", color: isArtis ? "#7a9b7f" : "#7c3aed" }}
            title="Fristen automatisch generieren"
          >
            <Wand2 className="h-3.5 w-3.5" /> Generieren
          </Button>
          <Button
            size="sm"
            onClick={() => { setShowNewRow(true); }}
            className="h-7 gap-1.5 text-xs"
            style={{ backgroundColor: accentBg, color: "#fff" }}
            disabled={showNewRow}
          >
            <Plus className="h-3.5 w-3.5" /> Neue Frist
          </Button>
        </div>
      </div>

      {/* New frist inline row */}
      {showNewRow && (
        <NewFristRow
          customerId={customer.id}
          onSave={handleCreate}
          onCancel={() => setShowNewRow(false)}
        />
      )}

      {/* Empty state */}
      {fristen.length === 0 && !showNewRow ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: textMuted }}>
          <CalendarClock className="h-10 w-10 opacity-30" />
          <p className="text-sm">Noch keine Fristen für diesen Kunden.</p>
          <Button size="sm" onClick={() => setShowNewRow(true)} style={{ backgroundColor: accentBg, color: "#fff" }}>
            <Plus className="h-4 w-4 mr-1" /> Erste Frist anlegen
          </Button>
        </div>
      ) : (
        <>
          {/* Open fristen */}
          {open.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: textMuted }}>
                Offen
              </div>
              {open.map(frist => (
                <FristInlineRow
                  key={frist.id}
                  frist={frist}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                  showName={false}
                  personType={customer.person_type === "privatperson" ? "privatperson" : "unternehmen"}
                />
              ))}
            </div>
          )}

          {/* Done fristen */}
          {done.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: textMuted }}>
                Erledigt ({done.length})
              </div>
              {done.map(frist => (
                <FristInlineRow
                  key={frist.id}
                  frist={frist}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                  showName={false}
                  personType={customer.person_type === "privatperson" ? "privatperson" : "unternehmen"}
                />
              ))}
            </div>
          )}
        </>
      )}

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
