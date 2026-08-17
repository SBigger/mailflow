import React, { useContext } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";
import { FileText, Clock, User, AlertTriangle } from "lucide-react";
import PersonAvatar from "@/components/ui/PersonAvatar";

export default function TicketCard({ ticket, index, onClick, users = [] }) {
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });
  const ticketPriority = priorities.find(p => p.id === ticket.priority_id);
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const borderCol = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";

  // Farblogik: Unterlagen = blau, dringend (>2 Tage offen) = rot
  const ageInDays = differenceInDays(new Date(), new Date(ticket.created_at));
  const isUrgent  = ageInDays >= 2 && ticket.ticket_type !== "documents_only";
  const isDocOnly = ticket.ticket_type === "documents_only";

  let accentLeft = isArtis ? "#7a9b7f" : isLight ? "#7c3aed" : "#6366f1"; // standard
  if (isDocOnly)  accentLeft = "#3b82f6"; // blau
  if (isUrgent)   accentLeft = "#ef4444"; // rot (überschreibt)
  if (ticketPriority) accentLeft = ticketPriority.color; // User-Prio gewinnt

  const assignee = users.find(u => u.id === ticket.assigned_to);

  return (
    <Draggable draggableId={ticket.id} index={index}>
      {(provided, snapshot) => {
        // Bei drag: leicht drehen + skalieren, sonst neutral
        const baseTransform = provided.draggableProps.style?.transform || "";
        const rotateTransform = snapshot.isDragging ? " rotate(2.5deg) scale(1.03)" : "";
        return (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => { if (!snapshot.isDragging) onClick(ticket); }}
          className="rounded-lg border mb-2"
          style={{
            ...provided.draggableProps.style,
            transform: baseTransform + rotateTransform,
            backgroundColor: snapshot.isDragging ? (isArtis ? "#f8faf8" : "#fafafe") : cardBg,
            borderColor: snapshot.isDragging ? accentLeft : borderCol,
            borderWidth: snapshot.isDragging ? "2px" : "1px",
            borderLeftWidth: "4px",
            borderLeftColor: accentLeft,
            boxShadow: snapshot.isDragging
              ? `0 20px 40px -10px rgba(0,0,0,0.25), 0 0 0 4px ${accentLeft}22`
              : "0 1px 3px rgba(0,0,0,0.06)",
            cursor: snapshot.isDragging ? "grabbing" : "grab",
            // Snap-Back smooth wenn nicht gedragged, schnell wenn dragging (für smooth follow)
            transition: snapshot.isDragging
              ? "box-shadow 0.18s ease, transform 0.05s linear, background-color 0.18s ease, border-color 0.18s ease"
              : "all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)",
            opacity: snapshot.isDragging ? 0.96 : 1,
            zIndex: snapshot.isDragging ? 100 : "auto",
            userSelect: "none",
          }}
        >
          <div className="p-3">
            {/* Badges oben */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              {isDocOnly && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "#dbeafe", color: "#1d4ed8" }}>
                  <FileText className="h-3 w-3" />
                  Unterlagen
                </span>
              )}
              {ticketPriority ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: ticketPriority.color + "22",
                    color: ticketPriority.color,
                    border: "1px solid " + ticketPriority.color + "55",
                  }}>
                  {ticketPriority.level === 1 && <AlertTriangle className="h-3 w-3" />}
                  {ticketPriority.name}
                </span>
              ) : isUrgent && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}>
                  <Clock className="h-3 w-3" />
                  Dringend
                </span>
              )}
              {!ticket.is_read && (
                <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" title="Ungelesen" />
              )}
            </div>

            {/* Betreff */}
            <div
              className="text-sm font-semibold leading-tight mb-1 truncate"
              style={{ color: textMain }}
            >
              {ticket.title}
            </div>

            {/* Von */}
            <div className="text-xs truncate mb-2" style={{ color: textMuted }}>
              {ticket.from_name
                ? `${ticket.from_name} <${ticket.from_email}>`
                : ticket.from_email}
            </div>

            {/* Body Preview */}
            {ticket.body && (
              <div
                className="text-xs line-clamp-2 mb-2"
                style={{ color: textMuted }}
              >
                {(() => {
                  const plain = ticket.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
                  return plain.slice(0, 120) + (plain.length > 120 ? '…' : '')
                })()}
              </div>
            )}

            {/* Footer: Assignee + Datum */}
            <div className="flex items-center justify-between">
              {assignee ? (
                <div className="flex items-center gap-1">
                  <PersonAvatar user={assignee} size={20} />
                  <span className="text-xs truncate max-w-[80px]" style={{ color: textMuted }}>
                    {assignee.full_name || assignee.email}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" style={{ color: textMuted }} />
                  <span className="text-xs" style={{ color: textMuted }}>Unzugewiesen</span>
                </div>
              )}
              <span className="text-xs flex-shrink-0" style={{ color: textMuted }}>
                {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: de })}
              </span>
            </div>
          </div>
        </div>
      );
      }}
    </Draggable>
  );
}
