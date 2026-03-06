import React, { useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { Plus, MapPin, CalendarClock, ChevronRight, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CH_KANTONE_NAMES = {
  'AG': 'Aargau',        'AI': 'App. Innerrhoden', 'AR': 'App. Ausserrhoden',
  'BE': 'Bern',          'BL': 'Basel-Landschaft', 'BS': 'Basel-Stadt',
  'FR': 'Freiburg',      'GE': 'Genf',             'GL': 'Glarus',
  'GR': 'Graubünden',    'JU': 'Jura',             'LU': 'Luzern',
  'NE': 'Neuenburg',     'NW': 'Nidwalden',        'OW': 'Obwalden',
  'SG': 'St. Gallen',    'SH': 'Schaffhausen',     'SO': 'Solothurn',
  'SZ': 'Schwyz',        'TG': 'Thurgau',          'TI': 'Tessin',
  'UR': 'Uri',           'VD': 'Waadt',            'VS': 'Wallis',
  'ZG': 'Zug',           'ZH': 'Zürich',
};

export default function CustomerNebensteuerdomizileTab({ customer, allCustomers, onSelect }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const queryClient = useQueryClient();

  const textMain   = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const cardBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.6)";
  const cardBorder = isArtis ? "#d4e0d4" : isLight ? "#d4d4e8" : "#3f3f46";
  const accentBg   = isArtis ? "#7a9b7f" : "#7c3aed";

  const nebendomizile = allCustomers.filter(c => c.hauptdomizil_id === customer.id);

  // Load fristen for open-count badges (served from cache if already loaded)
  const { data: allFristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => entities.Customer.create(data),
    onSuccess: (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Nebendomizil erstellt");
      onSelect(newCustomer);
    },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Customer.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Nebendomizil gelöscht");
    },
    onError: e => toast.error("Fehler: " + e.message),
  });

  const handleAdd = () => {
    createMutation.mutate({
      company_name: "Nebendomizil",
      person_type: customer.person_type,
      ist_nebensteuerdomizil: true,
      hauptdomizil_id: customer.id,
      activities: [], contact_persons: [], tags: [], steuer_zugaenge: [],
    });
  };

  const handleDelete = (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Nebendomizil wirklich löschen? Alle Fristen und Zugänge dieses Domizils gehen verloren.")) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: textMain }}>Nebensteuerdomizile</p>
          <p className="text-xs" style={{ color: textMuted }}>
            {nebendomizile.length === 0
              ? "Noch keine Nebendomizile erfasst"
              : `${nebendomizile.length} Domizil${nebendomizile.length !== 1 ? 'e' : ''}`}
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={createMutation.isPending}
          className="h-7 gap-1.5 text-xs"
          style={{ backgroundColor: accentBg, color: "#fff" }}
        >
          <Plus className="h-3.5 w-3.5" /> Neues Domizil
        </Button>
      </div>

      {nebendomizile.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: textMuted }}>
          <Globe className="h-10 w-10 opacity-30" />
          <p className="text-sm">Noch keine Nebensteuerdomizile.</p>
          <p className="text-xs text-center max-w-xs" style={{ color: textMuted }}>
            Nebendomizile haben eigene Fristen und Steuer-Zugänge, aber keine Mails, Tasks oder Aktivitäten.
          </p>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={createMutation.isPending}
            style={{ backgroundColor: accentBg, color: "#fff" }}
          >
            <Plus className="h-4 w-4 mr-1" /> Erstes Domizil hinzufügen
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {nebendomizile.map(neben => {
            const offeneFristen = allFristen.filter(f => f.customer_id === neben.id && f.status === 'offen').length;
            const alleFristen   = allFristen.filter(f => f.customer_id === neben.id).length;
            const kantonName    = neben.kanton ? (CH_KANTONE_NAMES[neben.kanton] || neben.kanton) : null;
            const label         = kantonName || neben.company_name || "Nebendomizil";

            return (
              <div
                key={neben.id}
                onClick={() => onSelect(neben)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm group"
                style={{ backgroundColor: cardBg, borderColor: cardBorder }}
              >
                {/* Kanton Badge */}
                {neben.kanton ? (
                  <span
                    className="flex-shrink-0 text-xs font-bold px-2 py-1 rounded"
                    style={{
                      backgroundColor: isArtis ? '#e6ede6' : isLight ? '#ede9fe' : 'rgba(99,102,241,0.15)',
                      color: isArtis ? '#4a5e4a' : isLight ? '#4c1d95' : '#818cf8',
                    }}
                  >
                    {neben.kanton}
                  </span>
                ) : (
                  <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: textMuted }} />
                )}

                {/* Name + Ort */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: textMain }}>
                    {label}
                  </div>
                  {neben.ort && (
                    <div className="text-xs truncate" style={{ color: textMuted }}>{neben.ort}</div>
                  )}
                </div>

                {/* Fristen count badge */}
                {alleFristen > 0 && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <CalendarClock className="h-3.5 w-3.5" style={{ color: offeneFristen > 0 ? '#f97316' : textMuted }} />
                    <span className="text-xs" style={{ color: offeneFristen > 0 ? '#f97316' : textMuted }}>
                      {offeneFristen > 0 ? offeneFristen : alleFristen}
                    </span>
                  </div>
                )}

                {/* Delete */}
                <button
                  onClick={e => handleDelete(e, neben.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Nebendomizil löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: textMuted }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
