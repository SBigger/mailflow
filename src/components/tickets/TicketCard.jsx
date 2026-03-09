import React, { useContext } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { ThemeContext } from "@/Layout";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";
import { FileText, Clock, User } from "lucide-react";

export default function TicketCard({ ticket, index, onClick, users = [] }) {
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

  const assignee = users.find(u => u.id === ticket.assigned_to);

  return (
    <Draggable draggableId={ticket.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(ticket)}
          className="rounded-lg border cursor-pointer transition-shadow mb-2"
          style={{
            backgroundColor: cardBg,
            borderColor: snapshot.isDragging ? accentLeft : borderCol,
            borderLeftWidth: "4px",
            borderLeftColor: accentLeft,
            boxShadow: snapshot.isDragging
              ? "0 8px 24px rgba(0,0,0,0.18)"
              : "0 1px 3px rgba(0,0,0,0.06)",
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
              {isUrgent && (
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
                  <div
                    className="h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: accentLeft }}
                  >
                    {(assignee.full_name || assignee.email || "?")[0].toUpperCase()}
                  </div>
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
      )}
    </Draggable>
  );
}
