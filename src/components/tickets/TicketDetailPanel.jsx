import React, { useState, useContext, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, functions } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  X, Sparkles, Send, FileText, MessageSquare,
  User, ChevronDown, Loader2, Trash2
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function TicketDetailPanel({ ticket, onClose, currentUser, users = [] }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [replyText, setReplyText]     = useState("");
  const [aiLoading, setAiLoading]     = useState(false);
  const [sending, setSending]         = useState(false);
  const [localTicket, setLocalTicket] = useState(ticket);
  const messagesEndRef = useRef(null);

  // Bei Ticket-Wechsel updaten
  useEffect(() => {
    setLocalTicket(ticket);
    setReplyText("");
  }, [ticket?.id]);

  // Nachrichten laden
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["ticketMessages", ticket?.id],
    queryFn: () => entities.TicketMessage.filter({ ticket_id: ticket.id }, "created_at"),
    enabled: !!ticket?.id,
    refetchInterval: 10000,
  });

  // Columns für Spalten-Wechsel
  const { data: columns = [] } = useQuery({
    queryKey: ["ticketColumns"],
    queryFn: () => entities.TicketColumn.list("order"),
  });

  // Als gelesen markieren
  useEffect(() => {
    if (ticket?.id && !ticket.is_read) {
      entities.Ticket.update(ticket.id, { is_read: true })
        .then(() => qc.invalidateQueries({ queryKey: ["tickets"] }));
    }
  }, [ticket?.id]);

  // Scroll to bottom bei neuen Nachrichten
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Theme Colors
  const panelBg   = isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b";
  const headerBg  = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const inputBg   = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.8)";
  const accent    = isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1";

  const isDocOnly = localTicket?.ticket_type === "documents_only";

  // KI-Antwort generieren
  const handleAiSuggest = async () => {
    if (!ticket?.id) return;
    setAiLoading(true);
    try {
      const { data } = await functions.invoke("suggest-ticket-reply", { ticket_id: ticket.id });
      if (data?.suggestion) {
        setReplyText(data.suggestion);
        toast.success("KI-Vorschlag wurde eingefügt");
      } else {
        toast.error("Kein Vorschlag erhalten");
      }
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Laden des KI-Vorschlags: " + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  // Antwort senden
  const handleSend = async () => {
    if (!replyText.trim() || !ticket?.id) return;
    setSending(true);
    try {
      await entities.TicketMessage.create({
        ticket_id: ticket.id,
        body: replyText.trim(),
        sender_type: "staff",
        sender_id: currentUser?.id || null,
        is_ai_suggestion: false,
      });
      // updated_at aktualisieren
      await entities.Ticket.update(ticket.id, { updated_at: new Date().toISOString() });
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["ticketMessages", ticket.id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Senden: " + e.message);
    } finally {
      setSending(false);
    }
  };

  // Ticket-Typ wechseln
  const handleTypeToggle = async () => {
    const newType = isDocOnly ? "regular" : "documents_only";
    setLocalTicket(prev => ({ ...prev, ticket_type: newType }));
    await entities.Ticket.update(ticket.id, { ticket_type: newType });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  // Spalte wechseln
  const handleColumnChange = async (colId) => {
    setLocalTicket(prev => ({ ...prev, column_id: colId }));
    await entities.Ticket.update(ticket.id, { column_id: colId });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  // Ticket löschen
  const handleDelete = async () => {
    if (!confirm("Ticket wirklich löschen?")) return;
    await entities.Ticket.delete(ticket.id);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onClose();
  };

  if (!ticket) return null;

  const currentColumn = columns.find(c => c.id === localTicket.column_id);

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: panelBg }}
    >
      {/* ── Header ── */}
      <div
        className="flex-shrink-0 px-4 py-3 border-b"
        style={{ backgroundColor: headerBg, borderColor: border }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Betreff */}
            <div className="text-sm font-bold leading-tight mb-1 truncate" style={{ color: textMain }}>
              {localTicket.title}
            </div>
            {/* Von */}
            <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
              <User className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {localTicket.from_name
                  ? `${localTicket.from_name} · ${localTicket.from_email}`
                  : localTicket.from_email}
              </span>
            </div>
            {/* Datum */}
            <div className="text-xs mt-0.5" style={{ color: textMuted }}>
              {format(new Date(localTicket.created_at), "dd.MM.yyyy HH:mm", { locale: de })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/10 flex-shrink-0 transition-colors"
            style={{ color: textMuted }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {/* Ticket-Typ Toggle */}
          <button
            onClick={handleTypeToggle}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
            style={isDocOnly
              ? { backgroundColor: "#dbeafe", color: "#1d4ed8", borderColor: "#93c5fd" }
              : { backgroundColor: isArtis ? "#f0f4f0" : "#f3f0ff", color: accent, borderColor: border }
            }
          >
            {isDocOnly
              ? <><FileText className="h-3 w-3" /> Unterlagen</>
              : <><MessageSquare className="h-3 w-3" /> Anfrage</>
            }
          </button>

          {/* Spalte wechseln */}
          <Select value={localTicket.column_id || ""} onValueChange={handleColumnChange}>
            <SelectTrigger
              className="h-7 text-xs px-2 rounded-full border"
              style={{
                backgroundColor: currentColumn?.color
                  ? currentColumn.color + "22"
                  : (isArtis ? "#f0f4f0" : "#f3f0ff"),
                borderColor: currentColumn?.color || border,
                color: currentColumn?.color || accent,
                width: "auto",
                minWidth: "120px",
              }}
            >
              <div className="flex items-center gap-1">
                {currentColumn?.color && (
                  <span className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentColumn.color }} />
                )}
                <SelectValue placeholder="Spalte" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {columns.map(col => (
                <SelectItem key={col.id} value={col.id}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
                    {col.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Löschen */}
          <button
            onClick={handleDelete}
            className="ml-auto p-1.5 rounded-full transition-colors"
            style={{ color: textMuted }}
            title="Ticket löschen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Chat-Thread ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Erste Kundennachricht (aus Ticket-Body) */}
        {localTicket.body && (
          <ChatBubble
            text={localTicket.body}
            side="left"
            senderLabel={localTicket.from_name || localTicket.from_email}
            time={localTicket.created_at}
            theme={theme}
          />
        )}

        {/* Weitere Nachrichten */}
        {msgsLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : (
          messages.map(msg => {
            const sender = users.find(u => u.id === msg.sender_id);
            return (
              <ChatBubble
                key={msg.id}
                text={msg.body}
                side={msg.sender_type === "customer" ? "left" : "right"}
                senderLabel={
                  msg.sender_type === "customer"
                    ? (localTicket.from_name || localTicket.from_email)
                    : (sender?.full_name || sender?.email || "Mitarbeiter")
                }
                time={msg.created_at}
                theme={theme}
                isAi={msg.is_ai_suggestion}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Reply Box ── */}
      <div
        className="flex-shrink-0 border-t p-3"
        style={{ borderColor: border, backgroundColor: headerBg }}
      >
        <textarea
          className="w-full rounded-lg border p-2.5 text-sm resize-none outline-none transition-colors"
          style={{
            backgroundColor: inputBg,
            borderColor: border,
            color: textMain,
            minHeight: "80px",
            maxHeight: "160px",
          }}
          placeholder="Antwort schreiben…"
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
          }}
        />
        <div className="flex items-center justify-between mt-2 gap-2">
          {/* KI-Vorschlag Button */}
          <button
            onClick={handleAiSuggest}
            disabled={aiLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
            style={{
              backgroundColor: isArtis ? "#f0f7f0" : "#f5f3ff",
              color: isArtis ? "#4a7a50" : "#7c3aed",
              borderColor: isArtis ? "#b8d4bb" : "#c4b5fd",
              opacity: aiLoading ? 0.6 : 1,
            }}
          >
            {aiLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />
            }
            {aiLoading ? "Generiere…" : "KI-Antwort"}
          </button>

          {/* Senden */}
          <button
            onClick={handleSend}
            disabled={!replyText.trim() || sending}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: replyText.trim() && !sending ? accent : (isArtis ? "#ccd8cc" : "#a1a1aa"),
              color: "#fff",
              opacity: (!replyText.trim() || sending) ? 0.6 : 1,
            }}
          >
            {sending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
            Senden
          </button>
        </div>
        <div className="text-xs mt-1.5" style={{ color: textMuted }}>
          Ctrl+Enter zum Senden
        </div>
      </div>
    </div>
  );
}

// ── Chat Bubble Komponente ──────────────────────────────────
function ChatBubble({ text, side, senderLabel, time, theme, isAi = false }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const isLeft = side === "left";

  const bubbleBg = isAi
    ? (isArtis ? "#f0f7f0" : "#f5f3ff")
    : isLeft
      ? (isArtis ? "#e6ede6" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)")
      : (isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1");

  const bubbleText = isLeft && !isAi
    ? (isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7")
    : isAi
      ? (isArtis ? "#4a7a50" : "#5b21b6")
      : "#ffffff";

  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";

  return (
    <div className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] ${isLeft ? "" : ""}`}>
        {/* Sender-Label */}
        <div
          className={`text-xs mb-1 ${isLeft ? "" : "text-right"}`}
          style={{ color: textMuted }}
        >
          {isAi && (
            <span className="inline-flex items-center gap-0.5 mr-1">
              <Sparkles className="h-3 w-3" />
              KI-Vorschlag ·{" "}
            </span>
          )}
          {senderLabel}
          {time && ` · ${format(new Date(time), "dd.MM. HH:mm", { locale: de })}`}
        </div>

        {/* Bubble */}
        <div
          className="rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words"
          style={{
            backgroundColor: bubbleBg,
            color: bubbleText,
            borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
            border: isAi ? "1px dashed currentColor" : "none",
            borderColor: isAi ? (isArtis ? "#b8d4bb" : "#c4b5fd") : "transparent",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}
