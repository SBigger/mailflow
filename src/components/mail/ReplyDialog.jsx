import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Mail, Bold, Italic, List, ListOrdered } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import SendWithTagsReminderDialog from "./SendWithTagsReminderDialog";

export default function ReplyDialog({ open, onClose, mail, onSend }) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  // Reset text whenever the dialog opens for a new mail
  useEffect(() => {
    if (open) {
      setReplyText("");
    }
  }, [open, mail?.id]);
  const [showTagReminderDialog, setShowTagReminderDialog] = useState(false);
  
  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => entities.Tag.list()
  });

  const handleSendClick = () => {
    setShowTagReminderDialog(true);
  };

  const handleSendWithData = async (data) => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await onSend(replyText, data);
      setReplyText("");
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setSending(false);
    }
  };

  const handleOpenInOutlook = () => {
    const subject = `RE: ${mail?.subject || ""}`;
    const to = mail?.sender_email || "";
    const body = replyText || "";
    const mailtoLink = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
    onClose();
  };

  const insertFormatting = (before, after = "") => {
    const textarea = document.querySelector('textarea[placeholder="Ihre Antwort..."]');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = replyText.substring(start, end);
    const newText = replyText.substring(0, start) + before + selectedText + after + replyText.substring(end);
    
    setReplyText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length);
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Antworten auf: {mail?.subject}</DialogTitle>
          <p className="text-sm text-zinc-500 mt-1">An: {mail?.sender_email}</p>
        </DialogHeader>
        <div className="py-4 space-y-3">
          {/* Formatting Toolbar */}
          <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => insertFormatting("**", "**")}
              className="h-8 px-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              title="Fett"
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => insertFormatting("*", "*")}
              className="h-8 px-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              title="Kursiv"
            >
              <Italic className="h-4 w-4" />
            </Button>
            <div className="w-px h-6 bg-zinc-700 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => insertFormatting("\n- ")}
              className="h-8 px-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              title="Aufzählungsliste"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => insertFormatting("\n1. ")}
              className="h-8 px-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              title="Nummerierte Liste"
            >
              <ListOrdered className="h-4 w-4" />
            </Button>
          </div>

          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Ihre Antwort..."
            className="min-h-[200px] bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
            autoFocus
          />
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            Abbrechen
          </Button>
          <div className="flex gap-2">
            <Button 
              onClick={handleOpenInOutlook}
              variant="outline"
              className="border-blue-600/30 text-blue-400 hover:bg-blue-600/10 hover:text-blue-300 gap-2"
            >
              <Mail className="h-4 w-4" />
              In Outlook öffnen
            </Button>
            <Button 
              onClick={handleSendClick} 
              disabled={!replyText.trim() || sending}
              className="bg-blue-600 hover:bg-blue-500 text-white gap-2"
            >
              <Send className="h-4 w-4" />
              {sending ? 'Sende...' : 'Mit Tag/Reminder'}
            </Button>
          </div>
        </DialogFooter>

        <SendWithTagsReminderDialog
          open={showTagReminderDialog}
          onClose={() => setShowTagReminderDialog(false)}
          onSend={handleSendWithData}
          tags={tags}
        />
        </DialogContent>
        </Dialog>
        );
        }