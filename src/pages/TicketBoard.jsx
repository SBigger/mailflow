import React, { useState, useContext, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";
import { entities, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { differenceInDays } from "date-fns";
import {
  Plus, RefreshCw, Search, Filter,
  ChevronDown, LifeBuoy, Inbox, Loader2
} from "lucide-react";
import TicketCard from "@/components/tickets/TicketCard";
import TicketDetailPanel from "@/components/tickets/TicketDetailPanel";
import AddTicketDialog from "@/components/tickets/AddTicketDialog";

// ────────────────────────────────────────────────────
// Haupt-Seite
// ────────────────────────────────────────────────────
export default function TicketBoard() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showAddDialog, setShowAddDialog]   = useState(false);
  const [addColumnId, setAddColumnId]       = useState(null);
  const [searchQuery, setSearchQuery]       = useState("");
  const [filterMode, setFilterMode]         = useState("all"); // all | mine | unread
  const [panelWidth, setPanelWidth]         = useState(520);
  const isResizing = React.useRef(false);
  const startX     = React.useRef(0);
  const startWidth = React.useRef(520);

  // Drag-to-resize Handler
  const handleResizeStart = (e) => {
    isResizing.current = true;
    startX.current     = e.clientX;
    startWidth.current = panelWidth;
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup",   handleResizeEnd);
    e.preventDefault();
  };
  const handleResizeMove = React.useCallback((e) => {
    if (!isResizing.current) return;
    const delta   = startX.current - e.clientX; // nach links = breiter
    const newWidth = Math.min(900, Math.max(320, startWidth.current + delta));
    setPanelWidth(newWidth);
  }, []);
  const handleResizeEnd = React.useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup",   handleResizeEnd);
  }, [handleResizeMove]);

  // Theme Colors
  const pageBg    = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#18181b";
  const topBarBg  = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const accent    = isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1";
  const inputBg   = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.8)";

  // Daten laden
  const { data: columns = [], isLoading: colLoading } = useQuery({
    queryKey: ["ticketColumns"],
    queryFn: () => entities.TicketColumn.list("order"),
  });

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => entities.Ticket.list("-created_at"),
    refetchInterval: 30000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => entities.User.list("full_name"),
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  // Ticket verschieben (Drag & Drop)
  const updateTicket = useMutation({
    mutationFn: ({ id, data }) => entities.Ticket.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  const handleDragEnd = (result) => {
    const { draggableId, destination } = result;
    if (!destination) return;
    updateTicket.mutate({ id: draggableId, data: { column_id: destination.droppableId } });
    // Optimistic update für selectedTicket
    if (selectedTicket?.id === draggableId) {
      setSelectedTicket(prev => ({ ...prev, column_id: destination.droppableId }));
    }
  };

  // Gefilterte Tickets
  const filteredTickets = useMemo(() => {
    let list = tickets;
    if (filterMode === "mine" && currentUser) {
      list = list.filter(t => t.assigned_to === currentUser.id);
    }
    if (filterMode === "unread") {
      list = list.filter(t => !t.is_read);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.from_email?.toLowerCase().includes(q) ||
        t.from_name?.toLowerCase().includes(q) ||
        t.body?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [tickets, filterMode, searchQuery, currentUser]);

  // Statistiken für Top-Bar
  const totalUnread = tickets.filter(t => !t.is_read).length;
  const totalUrgent = tickets.filter(t =>
    differenceInDays(new Date(), new Date(t.created_at)) >= 2 &&
    t.ticket_type !== "documents_only"
  ).length;

  const isLoading = colLoading || ticketsLoading;

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* ── Hauptbereich (Board) ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top Bar */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b flex-wrap"
          style={{ backgroundColor: topBarBg, borderColor: border }}
        >
          {/* Icon + Titel */}
          <div className="flex items-center gap-2 mr-2">
            <LifeBuoy className="h-5 w-5" style={{ color: accent }} />
            <span className="font-semibold text-sm" style={{ color: textMain }}>Support Tickets</span>
          </div>

          {/* Statistiken */}
          {totalUnread > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>
              {totalUnread} ungelesen
            </span>
          )}
          {totalUrgent > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}>
              {totalUrgent} dringend
            </span>
          )}

          <div className="flex-1" />

          {/* Suche */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: textMuted }} />
            <input
              type="text"
              placeholder="Suchen…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg border text-xs outline-none"
              style={{ backgroundColor: inputBg, borderColor: border, color: textMain, width: "180px" }}
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1 rounded-lg border overflow-hidden"
            style={{ borderColor: border, backgroundColor: inputBg }}>
            {["all", "mine", "unread"].map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className="px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: filterMode === mode
                    ? accent : "transparent",
                  color: filterMode === mode ? "#fff" : textMuted,
                }}
              >
                {mode === "all" ? "Alle" : mode === "mine" ? "Meine" : "Ungelesen"}
              </button>
            ))}
          </div>

          {/* Neues Ticket */}
          <button
            onClick={() => { setAddColumnId(null); setShowAddDialog(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: accent, color: "#fff" }}
          >
            <Plus className="h-3.5 w-3.5" />
            Neues Ticket
          </button>

          {/* Refresh */}
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["tickets"] })}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: textMuted }}
            title="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Kanban Board */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex-1 flex gap-0 overflow-x-auto p-4" style={{ minHeight: 0 }}>
              {columns.map(col => {
                const colTickets = filteredTickets.filter(t => t.column_id === col.id);
                return (
                  <TicketColumn
                    key={col.id}
                    column={col}
                    tickets={colTickets}
                    users={users}
                    theme={theme}
                    onTicketClick={setSelectedTicket}
                    onAddTicket={() => { setAddColumnId(col.id); setShowAddDialog(true); }}
                    selectedTicketId={selectedTicket?.id}
                  />
                );
              })}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* ── Detail Panel (rechts) ── */}
      {selectedTicket && (
        <div
          className="flex-shrink-0 overflow-hidden flex flex-row"
          style={{
            width: `${panelWidth}px`,
            borderColor: border,
            backgroundColor: isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b",
          }}
        >
          {/* Drag Handle */}
          <div
            onMouseDown={handleResizeStart}
            style={{
              width: "5px",
              flexShrink: 0,
              cursor: "col-resize",
              backgroundColor: "transparent",
              borderLeft: `1px solid ${border}`,
              transition: "background-color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = border}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
            title="Panel-Breite anpassen"
          />
          {/* Panel Inhalt */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <TicketDetailPanel
              ticket={selectedTicket}
              onClose={() => setSelectedTicket(null)}
              currentUser={currentUser}
              users={users}
            />
          </div>
        </div>
      )}

      {/* ── Add Dialog ── */}
      <AddTicketDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        defaultColumnId={addColumnId}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────
// Ticket-Spalte Komponente
// ────────────────────────────────────────────────────
function TicketColumn({ column, tickets, users, theme, onTicketClick, onAddTicket, selectedTicketId }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const [collapsed, setCollapsed] = useState(false);

  const colBg    = isArtis ? "#eff3ef" : isLight ? "#ebebf4" : "rgba(39,39,42,0.5)";
  const textMain = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border   = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";

  return (
    <div
      className="flex-shrink-0 flex flex-col rounded-xl border mr-3"
      style={{
        width: "280px",
        backgroundColor: colBg,
        borderColor: border,
        maxHeight: "calc(100vh - 120px)",
      }}
    >
      {/* Spalten-Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b cursor-pointer select-none"
        style={{ borderColor: border }}
        onClick={() => setCollapsed(v => !v)}
      >
        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: column.color || "#6366f1" }} />
        <span className="text-xs font-bold uppercase tracking-wide flex-1 truncate"
          style={{ color: textMain }}>
          {column.name}
        </span>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: column.color + "22" || "#6366f122", color: column.color || "#6366f1" }}>
          {tickets.length}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          style={{ color: textMuted }}
        />
      </div>

      {/* Cards */}
      {!collapsed && (
        <Droppable droppableId={column.id}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex-1 overflow-y-auto p-2"
              style={{
                backgroundColor: snapshot.isDraggingOver
                  ? (isArtis ? "#e6ede6" : isLight ? "#ebebf4" : "rgba(63,63,70,0.3)")
                  : "transparent",
                transition: "background-color 0.15s",
                minHeight: "60px",
              }}
            >
              {tickets.length === 0 && !snapshot.isDraggingOver && (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Inbox className="h-6 w-6" style={{ color: textMuted, opacity: 0.4 }} />
                  <span className="text-xs" style={{ color: textMuted }}>Keine Tickets</span>
                </div>
              )}
              {tickets.map((ticket, idx) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  index={idx}
                  users={users}
                  onClick={onTicketClick}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}

      {/* + Ticket Button */}
      {!collapsed && (
        <button
          onClick={onAddTicket}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-t w-full transition-colors rounded-b-xl"
          style={{ borderColor: border, color: textMuted }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = border + "55"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
        >
          <Plus className="h-3.5 w-3.5" />
          Ticket hinzufügen
        </button>
      )}
    </div>
  );
}
