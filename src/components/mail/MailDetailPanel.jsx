import React, { useState, useEffect, useContext } from "react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { useDictation } from "./useDictation";
import { X, Reply, Paperclip, Clock, AlertTriangle, Trash2, Edit2, Folder, Download, Send, Bell, CheckSquare, CheckCircle2, Unlink, Loader2, Forward, Building2, Mic, MicOff, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { entities, functions, auth } from "@/api/supabaseClient";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReminderDatePicker from "./ReminderDatePicker";
import SendWithTagsReminderDialog from "./SendWithTagsReminderDialog";
import ForwardMailDialog from "./ForwardMailDialog";
import AssignToCustomerDialog from "./AssignToCustomerDialog";
import { ThemeContext } from "@/Layout";
import DokUploadDialog from "@/components/dokumente/DokUploadDialog";

export default function MailDetailPanel({ mail, onClose, onReply, onDelete, onEdit, onViewChange, onConvertToTask, onToggleComplete, linkedTaskId, onUnlinkTask }) {

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [tagReminderDialogOpen, setTagReminderDialogOpen] = useState(false);
  const [forwardDialogOpen, setForwardDialogOpen] = useState(false);
  const [assignCustomerOpen, setAssignCustomerOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [ablageFile, setAblageFile] = useState(null); // Anhang → Dateiablage
  const isMobile = useIsMobile();

  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const panelBg   = isArtis ? "#f5f8f5"  : isLight ? "#f8f8fc"  : "#27272a";
  const cardBg    = isArtis ? "#ffffff"  : isLight ? "#ffffff"  : "#3f3f46";
  const accent    = isArtis ? "#4a7a4f"  : isLight ? "#7c3aed"  : "#6366f1";
  const textMain  = isArtis ? "#2d3a2d"  : isLight ? "#1a1a2e"  : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b"  : isLight ? "#7a7a9a"  : "#71717a";
  const borderCol = isArtis ? "#ccd8cc"  : isLight ? "#d4d4e8"  : "#52525b";
  const rowBg     = isArtis ? "#f0f5f0"  : isLight ? "#f0f0f8"  : "#18181b";

  const { isListening: isDictating, toggle: toggleDictation } = useDictation((transcript) => {
    setReplyText(prev => prev ? prev + " " + transcript : transcript);
  });

  const handleQuickReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || sending) return;
    setTagReminderDialogOpen(true);
  };

  const handleSendWithTagsReminder = async (tag, reminder) => {
    setSending(true);
    const textToSend = replyText;
    setReplyText('');
    try {
      await functions.invoke('replyOutlookMail', {
        mail_id: mail.id,
        reply_text: textToSend,
        tag: tag,
        reminder: reminder
      });
      toast.success('Antwort gesendet');
      setTagReminderDialogOpen(false);
    } catch (error) {
      toast.error('Fehler beim Senden: ' + (error.response?.data?.error || error.message));
    } finally {
      setSending(false);
    }
  };

  const handleSetReminder = async (reminderDate) => {
    try {
      await entities.MailItem.update(mail.id, { reminder_date: reminderDate });
      toast.success('Reminder gesetzt');
      setReminderDialogOpen(false);
    } catch (error) {
      toast.error('Fehler: ' + error.message);
    }
  };

  const handleForward = async (data) => {
    try {
      await functions.invoke('forwardOutlookMail', {
        mail_id: mail.id,
        ...data
      });
      toast.success('E-Mail weitergeleitet');
      setForwardDialogOpen(false);
    } catch (error) {
      toast.error('Fehler beim Weiterleiten: ' + (error.response?.data?.error || error.message));
    }
  };

  useEffect(() => {
    if (mail && mail.has_attachments) {
      setLoadingAttachments(true);
      functions.invoke('getOutlookAttachments', { mail_id: mail.id })
        .then(res => {
          setAttachments(res.data.attachments || []);
        })
        .catch(error => {
          console.error('Failed to load attachments:', error);
          toast.error('Fehler beim Laden der Anhänge');
        })
        .finally(() => setLoadingAttachments(false));
    } else {
      setAttachments([]);
    }
  }, [mail?.id]);

  const handleDownloadAttachment = (attachment) => {
    const binaryString = atob(attachment.contentBytes);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: attachment.contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.name;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleAblageAttachment = (attachment) => {
    const binaryString = atob(attachment.contentBytes);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const file = new File([bytes], attachment.name, { type: attachment.contentType || "application/octet-stream" });
    setAblageFile(file);
  };

  if (!mail) return null;

  const formattedDate = mail.received_date
    ? format(new Date(mail.received_date), "EEEE, dd. MMMM yyyy 'um' HH:mm 'Uhr'", { locale: de })
    : "";

  return (
    <AnimatePresence>
      <motion.div
        initial={isMobile ? { y: "100%" } : { x: "100%", opacity: 0 }}
        animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
        exit={isMobile ? { y: "100%" } : { x: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className={isMobile ? "fixed inset-0 z-50 flex flex-col" : "h-full w-full backdrop-blur-xl border-l flex flex-col shadow-2xl shadow-black/50"}
        style={{ backgroundColor: panelBg, borderColor: borderCol }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: borderCol, backgroundColor: cardBg }}>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              style={{ color: textMuted }}
              title="Zurück"
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="text-sm" style={{ color: textMuted }}>E-Mail Details</span>
          </div>
          <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => onToggleComplete?.(mail)} 
              className={`justify-start gap-1.5 text-xs ${mail.is_completed ? 'text-green-400 hover:text-green-300 hover:bg-green-500/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> {mail.is_completed ? 'Erledigt' : 'Als erledigt markieren'}
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => onConvertToTask?.(mail)} 
              className="justify-start text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 gap-1.5 text-xs"
            >
              <CheckSquare className="h-3.5 w-3.5" /> In Task umwandeln
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setReminderDialogOpen(true)} 
              className={`justify-start gap-1.5 text-xs ${mail.reminder_date ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
            >
              <Bell className="h-3.5 w-3.5" /> {mail.reminder_date ? 'Reminder' : 'Reminder setzen'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit?.(mail)} className="justify-start text-zinc-400 hover:text-zinc-200 hover:bg-white/5 gap-1.5 text-xs">
              <Edit2 className="h-3.5 w-3.5" /> Bearbeiten
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onReply?.(mail)} className="justify-start text-zinc-400 hover:text-zinc-200 hover:bg-white/5 gap-1.5 text-xs">
              <Reply className="h-3.5 w-3.5" /> Antworten
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForwardDialogOpen(true)} className="justify-start text-zinc-400 hover:text-zinc-200 hover:bg-white/5 gap-1.5 text-xs">
              <Forward className="h-3.5 w-3.5" /> Weiterleiten
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAssignCustomerOpen(true)} className="justify-start text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5" /> Firma zuweisen
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete?.(mail)} className="justify-start text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5 text-xs w-full">
              <Trash2 className="h-3.5 w-3.5" /> Löschen
            </Button>
            {linkedTaskId && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => onUnlinkTask?.(mail)} 
                className="justify-start text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 gap-1.5 text-xs"
              >
                <Unlink className="h-3.5 w-3.5" /> Mail trennen
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Subject */}
          <h2 className="text-xl font-semibold mb-4 leading-tight" style={{ color: textMain }}>
            {mail.subject}
          </h2>

          {/* Meta */}
          <div className="flex flex-col gap-3 mb-6 p-4 rounded-xl border" style={{ backgroundColor: rowBg, borderColor: borderCol }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-300 font-semibold text-sm">
                {(mail.sender_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: textMain }}>{mail.sender_name}</p>
                <p className="text-xs" style={{ color: textMuted }}>{mail.recipient_email || mail.sender_email}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: textMuted }}>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> {formattedDate}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {mail.priority === "high" && (
                <Badge variant="outline" className="text-red-400 border-red-500/30 bg-red-500/10 text-xs gap-1">
                  <AlertTriangle className="h-3 w-3" /> Hohe Priorität
                </Badge>
              )}

              {mail.mailbox === "group" && (
                <Badge variant="outline" className="text-violet-400 border-violet-500/30 bg-violet-500/10 text-xs">
                  Gruppenpostfach
                </Badge>
              )}
              {mail.mailbox === "personal" && (
                <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 bg-cyan-500/10 text-xs">
                  Persönlich
                </Badge>
              )}
            </div>
          </div>

          {/* Project & Tags */}
          <div className="space-y-3 mb-6">
            {mail.project && (
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-zinc-500" />
                <span className="text-sm text-zinc-400">Projekt:</span>
                <Badge variant="outline" className="bg-indigo-500/10 border-indigo-500/30 text-indigo-300">
                  {mail.project}
                </Badge>
              </div>
            )}

            {mail.tags && mail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {mail.tags.map((tag) => (
                  <span key={tag} className="text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 rounded-lg">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>



          {/* Body */}
          <div
            className="rounded-xl border"
            style={{
              fontSize: '15px',
              lineHeight: '1.9',
              color: textMain,
              fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
              padding: '24px',
              backgroundColor: cardBg,
              borderColor: borderCol,
              minHeight: '320px',
            }}
          >
            {mail.body ? (
              <div dangerouslySetInnerHTML={{ __html: mail.body.replace(/\n/g, "<br/>") }} />
            ) : mail.body_preview ? (
              <p style={{ color: textMuted, fontStyle: 'italic' }}>{mail.body_preview}</p>
            ) : (
              <p style={{ color: textMuted }}>Kein Inhalt verfügbar</p>
            )}
          </div>

          {/* Attachments */}
          {mail.has_attachments && (
            <div className="mt-6 p-4 rounded-xl border" style={{ backgroundColor: rowBg, borderColor: borderCol }}>
              <div className="flex items-center gap-2 mb-3">
                <Paperclip className="h-4 w-4" style={{ color: textMuted }} />
                <h3 className="text-sm font-medium" style={{ color: textMain }}>Anhänge</h3>
              </div>
              {loadingAttachments ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: textMuted }}>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Wird geladen...
                </div>
              ) : attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 p-2 rounded-lg border transition-colors"
                      style={{ backgroundColor: cardBg, borderColor: borderCol }}
                    >
                      <Paperclip className="h-4 w-4 flex-shrink-0" style={{ color: textMuted }} />
                      <span className="text-sm truncate flex-1" style={{ color: textMain }}>{attachment.name}</span>
                      {/* Download */}
                      <button
                        onClick={() => handleDownloadAttachment(attachment)}
                        title="Herunterladen"
                        className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity"
                        style={{ color: textMuted, background: "none", border: "none", cursor: "pointer" }}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      {/* In Ablage hochladen */}
                      <button
                        onClick={() => handleAblageAttachment(attachment)}
                        title="In Dateiablage hochladen"
                        className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity"
                        style={{ color: accent, background: accent + "15", border: "none", cursor: "pointer", borderRadius: 5 }}
                      >
                        <FolderUp className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: textMuted }}>Keine Anhänge gefunden</p>
              )}
            </div>
          )}
          </div>

          {/* Quick Reply Input */}
          <div className="flex-shrink-0 border-t p-4" style={{ borderColor: borderCol, backgroundColor: rowBg }}>
            <form onSubmit={handleQuickReply} className="flex items-end gap-2">
              <div className="flex-1">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={isDictating ? "🎤 Höre zu..." : "Schnell antworten..."}
                  disabled={sending}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 resize-none transition-colors"
                  style={{ background: cardBg, color: textMain, border: `1px solid ${isDictating ? '#ef4444' : borderCol}`, boxShadow: 'none' }}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleQuickReply(e);
                    }
                  }}
                />
                <div className="text-[10px] mt-1 px-1" style={{ color: textMuted }}>
                  Signatur wird automatisch angefügt
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={toggleDictation}
                  className={`h-10 px-3 ${isDictating ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: isDictating ? '#dc2626' : '#52525b', color: '#ffffff' }}
                  title="Diktieren"
                >
                  {isDictating ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white h-10 px-4"
                >
                  {sending ? (
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* Reminder Date Picker Dialog */}
          <ReminderDatePicker
            open={reminderDialogOpen}
            onClose={() => setReminderDialogOpen(false)}
            onSave={handleSetReminder}
            currentReminder={mail.reminder_date}
          />

          {/* Send with Tags & Reminder Dialog */}
          <SendWithTagsReminderDialog
            open={tagReminderDialogOpen}
            onClose={() => setTagReminderDialogOpen(false)}
            onSend={(data) => {
              handleSendWithTagsReminder(data.tag, data.reminder);
            }}
            onSendOnly={() => {
              setSending(true);
              const textToSend = replyText;
              setReplyText('');
              functions.invoke('replyOutlookMail', {
                mail_id: mail.id,
                reply_text: textToSend
              }).then(() => {
                toast.success('Antwort gesendet');
                setTagReminderDialogOpen(false);
              }).catch(error => {
                toast.error('Fehler beim Senden: ' + (error.response?.data?.error || error.message));
              }).finally(() => {
                setSending(false);
              });
            }}
          />

          {/* Forward Mail Dialog */}
          <ForwardMailDialog
            open={forwardDialogOpen}
            onClose={() => setForwardDialogOpen(false)}
            mail={mail}
            onForward={handleForward}
          />

          {/* Assign to Customer Dialog */}
          {assignCustomerOpen && (
            <AssignToCustomerDialog
              open={assignCustomerOpen}
              onClose={() => setAssignCustomerOpen(false)}
              mail={mail}
            />
          )}

          {/* Dateiablage Upload Dialog */}
          {ablageFile && (
            <DokUploadDialog
              preFile={ablageFile}
              preCustomerId={mail.customer_id || ""}
              onClose={() => setAblageFile(null)}
            />
          )}
          </motion.div>
          </AnimatePresence>
          );
          }