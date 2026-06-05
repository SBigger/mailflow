import React, { useState, useContext, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, functions, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { format, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";
import {
  X, Sparkles, Send, Mail, FileText, MessageSquare,
  User, ChevronDown, Loader2, Trash2, CheckCircle2,
  Image as ImageIcon, Paperclip
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// ──────────────────────────────────────────────────────────────
// Helper: Bild/PDF in Bucket "ticket-attachments" hochladen
// Gibt {url, mime, filename} zurück.
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
// Author-Farben für die 3-Wege-Kollab: Sascha (blau), Claude (grün), Roger (gelb)
// Erkennung via Email-Pattern und KI-Marker.
// ──────────────────────────────────────────────────────────────
function detectAuthor({ msg, sender }) {
  // Claude: KI-Vorschlag-Flag ODER Body beginnt mit Roboter-Emoji
  if (msg?.is_ai_suggestion) return "claude";
  if (typeof msg?.body === "string" && msg.body.trimStart().startsWith("🤖")) return "claude";

  const email = (sender?.email || "").toLowerCase();
  const name  = (sender?.full_name || "").toLowerCase();
  if (email.includes("roger") || name.startsWith("roger")) return "roger";
  if (email.includes("claude") || name === "claude") return "claude";
  if (email.includes("sascha") || name.startsWith("sascha")) return "sascha";

  if (msg?.sender_type === "customer") return "customer";
  return "staff"; // sonstiger Mitarbeiter
}

const ATTACH_BUCKET = "ticket-attachments";
async function uploadTicketAttachment(file, ticketId) {
  const ext = (file.name?.split(".").pop() || "png").toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = (file.name || `screenshot.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${ticketId || "no-ticket"}/${stamp}-${safeName}`;
  const { error } = await supabase.storage
    .from(ATTACH_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  return { url: publicUrl, mime: file.type, filename: file.name || safeName };
}

export default function TicketDetailPanel({ ticket, onClose, currentUser, users = [] }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [replyText, setReplyText]     = useState("");
  const [aiLoading, setAiLoading]     = useState(false);
  const [sending, setSending]         = useState(false);
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const fileInputRef = useRef(null);
  // Mail-Versand: default OFF bei internal, ON bei Kunden-Tickets
  const [sendMail, setSendMail] = useState(ticket?.ticket_type !== "internal");
  const [localTicket, setLocalTicket] = useState(ticket);
  const [replyHeight, setReplyHeight] = useState(120);
  const messagesEndRef = useRef(null);
  const isDraggingRef  = useRef(false);
  const dragStartY     = useRef(0);
  const dragStartH     = useRef(120);

  // Drag-to-resize Logik
  useEffect(() => {
    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartY.current - e.clientY;
      setReplyHeight(Math.max(80, Math.min(520, dragStartH.current + delta)));
    };
    const onUp = () => { isDraggingRef.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Bei Ticket-Wechsel updaten
  useEffect(() => {
    setLocalTicket(ticket);
    setReplyText("");
    setSendMail(ticket?.ticket_type !== "internal");
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

  // Erledigt-Hinweis: Ticket in "Warten auf Antwort" > 2 Tage ohne Kundenantwort
  const currentColumn = columns.find(c => c.id === localTicket.column_id);
  const isWaitingColumn = currentColumn?.name?.toLowerCase().includes("warten");
  const daysSinceUpdate = localTicket.updated_at
    ? differenceInDays(new Date(), new Date(localTicket.updated_at))
    : 0;
  const showErledigtHint = isWaitingColumn && daysSinceUpdate >= 2;
  const erledigtCol = columns.find(c => c.name.toLowerCase().includes("erledigt"));

  // KI-Antwort generieren
  const handleAiSuggest = async () => {
    if (!ticket?.id) return;
    setAiLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("KI: Nicht eingeloggt – bitte neu anmelden");
        return;
      }

      const res = await fetch(
        `${window.env.API_URL}/functions/v1/suggest-ticket-reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "apikey": window.env.KEY1,
          },
          body: JSON.stringify({ ticket_id: ticket.id }),
        }
      );

      // Erst als Text lesen, damit wir auch bei Non-JSON-Fehlern was Sinnvolles zeigen
      const responseText = await res.text();
      console.log("[KI-Antwort] HTTP", res.status, "Response:", responseText.substring(0, 500));

      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch {
        toast.error(`KI: HTTP ${res.status} – Antwort kein JSON: ${responseText.substring(0, 150)}`);
        return;
      }

      if (!res.ok) {
        toast.error(
          `KI: HTTP ${res.status} – ${data?.error || data?.message || data?.msg || responseText.substring(0, 150)}`
        );
        return;
      }

      if (data?.suggestion) {
        setReplyText(data.suggestion);
        toast.success("KI-Vorschlag wurde eingefügt");
      } else if (data?.error) {
        toast.error("KI: " + data.error);
      } else {
        // Response war 200 OK, aber kein suggestion und kein error → Diagnose-Info
        toast.error(`KI: Unerwartete Antwort – ${JSON.stringify(data).substring(0, 200)}`);
      }
    } catch (e) {
      console.error("[KI-Antwort] Exception:", e);
      toast.error("Netzwerkfehler: " + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Attachment-Upload (Paste, Drop, Datei-Button) ───────────────
  const insertAttachmentMarkdown = (att) => {
    const isImg = (att.mime || "").startsWith("image/");
    const md = isImg
      ? `\n![${att.filename || "Screenshot"}](${att.url})\n`
      : `\n[${att.filename || "Datei"}](${att.url})\n`;
    setReplyText(prev => (prev || "") + md);
  };

  const handleFiles = async (files) => {
    if (!files?.length || !ticket?.id) return;
    setUploadingAttach(true);
    try {
      for (const f of files) {
        try {
          const att = await uploadTicketAttachment(f, ticket.id);
          insertAttachmentMarkdown(att);
        } catch (e) {
          toast.error(`Upload "${f.name}" fehlgeschlagen: ${e.message}`);
        }
      }
    } finally {
      setUploadingAttach(false);
    }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs = [];
    for (const it of items) {
      if (it.kind === "file") {
        const blob = it.getAsFile();
        if (blob) imgs.push(blob);
      }
    }
    if (imgs.length === 0) return; // normales Text-Paste
    e.preventDefault();
    await handleFiles(imgs);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await handleFiles(files);
  };

  // Antwort senden
  const handleSend = async () => {
    if (!replyText.trim() || !ticket?.id) return;
    setSending(true);
    // Mail-Versand jetzt per Toggle steuerbar (default off bei internal, on bei Kunden)
    const willSendMail = !!sendMail;
    try {
      // Direkt-Insert (Wrapper waere kaputt: entities.create fuegt created_by ein,
      // aber ticket_messages hat diese Spalte nicht)
      const { error: insErr } = await supabase
        .from("ticket_messages")
        .insert({
          ticket_id: ticket.id,
          body: replyText.trim(),
          sender_type: "staff",
          sender_id: currentUser?.id || null,
          is_ai_suggestion: false,
        });
      if (insErr) throw new Error(insErr.message);
      // updated_at aktualisieren
      await entities.Ticket.update(ticket.id, { updated_at: new Date().toISOString() });
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["ticketMessages", ticket.id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });

      if (!willSendMail) {
        toast.success("Notiz gespeichert");
      } else {
        // E-Mail an Empfaenger senden
        try {
          await functions.invoke("send-ticket-reply", { ticket_id: ticket.id, message_body: replyText.trim() });
          toast.success("Antwort gespeichert und E-Mail gesendet");
        } catch (emailErr) {
          console.warn("E-Mail konnte nicht gesendet werden:", emailErr);
          toast.success("Antwort gespeichert (E-Mail-Versand fehlgeschlagen)");
        }
        // Nach Mail-Versand -> Ticket zu "Warten auf Antwort" verschieben
        const wartenCol = columns.find(c => c.name.toLowerCase().includes("warten"));
        if (wartenCol && localTicket.column_id !== wartenCol.id) {
          setLocalTicket(prev => ({ ...prev, column_id: wartenCol.id }));
          await entities.Ticket.update(ticket.id, { column_id: wartenCol.id });
          qc.invalidateQueries({ queryKey: ["tickets"] });
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Speichern: " + e.message);
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

  // Prioritaeten laden + Wechsel
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });
  const currentPriority = priorities.find(p => p.id === localTicket.priority_id);
  const handlePriorityChange = async (pid) => {
    const newPid = pid === "__none__" ? null : pid;
    setLocalTicket(prev => ({ ...prev, priority_id: newPid }));
    await entities.Ticket.update(ticket.id, { priority_id: newPid });
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

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: panelBg }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 px-4 py-3 border-b"
        style={{ backgroundColor: headerBg, borderColor: border }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold leading-tight mb-1 truncate" style={{ color: textMain }}>
              {localTicket.title}
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
              <User className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {localTicket.from_name
                  ? `${localTicket.from_name} · ${localTicket.from_email}`
                  : localTicket.from_email}
              </span>
            </div>
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

          {/* Prioritaet */}
          <Select value={localTicket.priority_id || "__none__"} onValueChange={handlePriorityChange}>
            <SelectTrigger
              className="h-7 text-xs px-2 rounded-full border"
              style={{
                backgroundColor: currentPriority?.color ? currentPriority.color + "22" : (isArtis ? "#f0f4f0" : "#f3f0ff"),
                borderColor: currentPriority?.color || border,
                color: currentPriority?.color || textMuted,
                width: "auto",
                minWidth: "110px",
              }}
              title="Prioritaet setzen"
            >
              <div className="flex items-center gap-1">
                {currentPriority?.color && (
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: currentPriority.color }} />
                )}
                <SelectValue placeholder="Prioritaet" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Keine —</SelectItem>
              {priorities.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showErledigtHint && erledigtCol && (
            <button
              onClick={() => handleColumnChange(erledigtCol.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
              style={{ backgroundColor: "#dcfce7", color: "#15803d", borderColor: "#86efac" }}
              title="2+ Tage ohne Kundenantwort – als Erledigt markieren"
            >
              <CheckCircle2 className="h-3 w-3" /> Erledigt?
            </button>
          )}
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

      {/* Chat-Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {localTicket.body && (
          <ChatBubble
            text={localTicket.body}
            side="left"
            senderLabel={localTicket.from_name || localTicket.from_email}
            time={localTicket.created_at}
            theme={theme}
            author={detectAuthor({ msg: { body: localTicket.body, sender_type: "customer" }, sender: { email: localTicket.from_email, full_name: localTicket.from_name } })}
          />
        )}

        {msgsLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : (
          messages
            .filter(msg => !(msg.sender_type === "customer" && msg.body === localTicket.body))
            .map(msg => {
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
                author={detectAuthor({ msg, sender })}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Box */}
      <div
        className="flex-shrink-0 border-t"
        style={{ borderColor: border, backgroundColor: headerBg }}
      >
        {/* Drag-Handle: nach oben ziehen zum Vergrössern */}
        <div
          className="flex items-center justify-center h-4 cursor-ns-resize select-none"
          style={{ borderBottom: `1px solid ${border}` }}
          onMouseDown={(e) => {
            isDraggingRef.current = true;
            dragStartY.current = e.clientY;
            dragStartH.current = replyHeight;
            e.preventDefault();
          }}
          title="Ziehen um Textfeld zu vergrössern"
        >
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: border, opacity: 0.8 }} />
        </div>
        <div className="p-3">
        <textarea
          className="w-full rounded-lg border p-2.5 text-sm resize-none outline-none transition-colors"
          style={{
            backgroundColor: inputBg,
            borderColor: border,
            color: textMain,
            height: `${replyHeight}px`,
          }}
          placeholder="Antwort schreiben… (Bild via Strg+V einfügen oder reinziehen)"
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend();
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={e => { handleFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
        />
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAttach || !ticket?.id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{
                backgroundColor: isArtis ? "#f0f7f0" : "#eef2ff",
                color: isArtis ? "#4a7a50" : "#4f46e5",
                borderColor: isArtis ? "#b8d4bb" : "#c7d2fe",
                opacity: uploadingAttach ? 0.6 : 1,
              }}
              title="Bild oder PDF anhängen (oder Strg+V im Textfeld)"
            >
              {uploadingAttach
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Paperclip className="h-3.5 w-3.5" />
              }
              {uploadingAttach ? "Lädt…" : "Anhang"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label
              className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none"
              style={{ color: textMuted }}
              title="Wenn aktiv: nach Speichern wird E-Mail an Absender geschickt"
            >
              <input
                type="checkbox"
                checked={sendMail}
                onChange={e => setSendMail(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Mail senden
            </label>
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
                : (sendMail ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />)
              }
              {sendMail ? "Senden + Mail" : "Nur speichern"}
            </button>
          </div>
        </div>
        <div className="text-xs mt-1.5" style={{ color: textMuted }}>
          {sendMail
            ? "Ctrl+Enter zum Senden — Empfaenger erhaelt E-Mail von support@artis-gmbh.ch"
            : "Ctrl+Enter zum Speichern — nur Notiz, kein E-Mail-Versand"}
        </div>
        </div>{/* end p-3 */}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Bubble-Inhalt rendern: Markdown-Bilder ![alt](url) und Links [name](url)
// werden als <img> bzw. <a> dargestellt, Rest bleibt Plaintext.
// Bewusst MVP: keine volle Markdown-Engine, nur das was Paste-Upload
// einfügt + http(s)-Links.
// ──────────────────────────────────────────────────────────────
function renderBubbleContent(text) {
  if (!text) return null;
  // Regex matches ![alt](url)  ODER  [name](url)  ODER  nackte http(s)-URL
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  const parts = [];
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) {
      // Bild
      parts.push(
        <a key={`a${key++}`} href={m[2]} target="_blank" rel="noopener noreferrer">
          <img
            src={m[2]}
            alt={m[1] || "Bild"}
            style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8, display: "block", marginTop: 4, marginBottom: 4, cursor: "zoom-in" }}
          />
        </a>
      );
    } else if (m[4]) {
      parts.push(
        <a key={`l${key++}`} href={m[4]} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
          {m[3]}
        </a>
      );
    } else if (m[5]) {
      parts.push(
        <a key={`u${key++}`} href={m[5]} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
          {m[5]}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Signatur aus E-Mail-Text entfernen
function stripSignature(text) {
  if (!text || typeof text !== "string") return text;
  const lines = text.split("\n");
  const sigPatterns = [
    /^--\s*$/,
    /^[-_]{3,}\s*$/,
    /^Mit freundlichen Gr[üu][sz]/i,
    /^Freundliche Gr[üu][sz]/i,
    /^Viele Gr[üu][sz]/i,
    /^Herzliche Gr[üu][sz]/i,
    /^Best regards/i,
    /^Kind regards/i,
    /^dipl\.\s*(Treuhand|Steuer)/i,
    /^Artis Treuhand GmbH/i,
    /^support@artis-gmbh/i,
    /^Von:\s+/i,
    /^From:\s+/i,
    /^Gesendet:\s+/i,
    /^Sent:\s+/i,
  ];
  for (let i = 1; i < lines.length; i++) {
    if (sigPatterns.some(p => p.test(lines[i].trim()))) {
      const trimmed = lines.slice(0, i).join("\n").trim();
      return trimmed || text;
    }
  }
  return text;
}

// Chat Bubble Komponente
function ChatBubble({ text, side, senderLabel, time, theme, isAi = false, author = null }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const isLeft = side === "left";

  // ── Farb-Palette pro Author (3-Wege-Kollab) ───────────────────
  // Sascha = blau, Claude = grün, Roger = gelb, Kunde/Sonstige = neutral
  const palette = {
    sascha:   { bg: "#dbeafe", text: "#1e3a8a", label: "Sascha"   },
    claude:   { bg: "#d1fae5", text: "#065f46", label: "Claude 🤖" },
    roger:    { bg: "#fef3c7", text: "#78350f", label: "Roger"    },
    customer: { bg: isArtis ? "#e6ede6" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)",
                text: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7" },
    staff:    { bg: isArtis ? "#7a9b7f" : "#6366f1", text: "#ffffff" },
  };
  const tone = palette[author] || (isLeft ? palette.customer : palette.staff);

  const bubbleBg   = isAi && !author ? (isArtis ? "#f0f7f0" : "#f5f3ff") : tone.bg;
  const bubbleText = isAi && !author ? (isArtis ? "#4a7a50" : "#5b21b6") : tone.text;

  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";

  return (
    <div className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[85%]">
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
          {renderBubbleContent(stripSignature(text))}
        </div>
      </div>
    </div>
  );
}

