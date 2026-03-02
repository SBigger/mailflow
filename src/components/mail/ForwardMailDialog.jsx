import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Forward } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import SendWithTagsReminderDialog from "./SendWithTagsReminderDialog";

export default function ForwardMailDialog({ open, onClose, mail, onForward }) {
  const [to, setTo] = useState('');
  const [comment, setComment] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [showTagReminderDialog, setShowTagReminderDialog] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => entities.Tag.list()
  });

  const { data: mails = [] } = useQuery({
    queryKey: ['mailItems'],
    queryFn: () => entities.MailItem.list()
  });

  const emailSuggestions = useMemo(() => {
    const emails = new Set();
    mails.forEach(mail => {
      if (mail.sender_email) emails.add(mail.sender_email);
      if (mail.to) {
        mail.to.split(',').forEach(e => {
          const trimmed = e.trim();
          if (trimmed) emails.add(trimmed);
        });
      }
    });
    return Array.from(emails).sort();
  }, [mails]);

  const filteredSuggestions = useMemo(() => {
    if (!to.trim()) return [];
    const lastEmail = to.split(',').pop().trim().toLowerCase();
    if (!lastEmail) return [];
    return emailSuggestions.filter(email => 
      email.toLowerCase().includes(lastEmail)
    ).slice(0, 5);
  }, [to, emailSuggestions]);

  const handleToChange = (value) => {
    setTo(value);
    setShowSuggestions(true);
    setSelectedIndex(0);
  };

  const selectSuggestion = (email) => {
    const emails = to.split(',').map(e => e.trim()).filter(e => e);
    emails.pop();
    emails.push(email);
    setTo(emails.join(', ') + ', ');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => 
        prev < filteredSuggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => 
        prev > 0 ? prev - 1 : filteredSuggestions.length - 1
      );
    } else if (e.key === 'Enter' && filteredSuggestions.length > 0) {
      e.preventDefault();
      selectSuggestion(filteredSuggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleForwardClick = () => {
    if (!to.trim()) return;
    setShowTagReminderDialog(true);
  };

  const handleForwardWithData = async (data) => {
    setForwarding(true);
    try {
      await onForward({
        to_recipients: to,
        comment,
        tag: data.tag,
        reminder: data.reminder
      });
      setTo('');
      setComment('');
      onClose();
    } catch (error) {
      // Error handled by parent
    } finally {
      setForwarding(false);
    }
  };

  if (!mail) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">E-Mail weiterleiten</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
            <div className="text-sm text-zinc-400">Original:</div>
            <div className="text-sm font-medium text-zinc-200">{mail.subject}</div>
            <div className="text-xs text-zinc-500">Von: {mail.sender_name} ({mail.sender_email})</div>
            {mail.has_attachments && (
              <div className="text-xs text-amber-400">📎 Anhänge werden mitgesendet</div>
            )}
          </div>

          <div className="space-y-2 relative">
            <Label className="text-zinc-300">An</Label>
            <Input
              value={to}
              onChange={(e) => handleToChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              onFocus={() => setShowSuggestions(true)}
              placeholder="empfaenger@example.com"
              className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
            />
            
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-auto">
                {filteredSuggestions.map((email, index) => (
                  <button
                    key={email}
                    type="button"
                    onClick={() => selectSuggestion(email)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      index === selectedIndex 
                        ? 'bg-indigo-600 text-white' 
                        : 'text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {email}
                  </button>
                ))}
              </div>
            )}
            
            <p className="text-xs text-zinc-500">Mehrere Empfänger mit Komma trennen</p>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Kommentar (optional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optionaler Kommentar zur Weiterleitung..."
              className="bg-zinc-900/60 border-zinc-700 text-zinc-200 min-h-[120px]"
            />
            <p className="text-xs text-zinc-500">Signatur wird automatisch angefügt</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            Abbrechen
          </Button>
          <Button
            onClick={handleForwardClick}
            disabled={!to.trim() || forwarding}
            className="bg-indigo-600 hover:bg-indigo-500 gap-2"
          >
            {forwarding ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Forward className="h-4 w-4" /> Mit Tag/Reminder
              </>
            )}
          </Button>
        </DialogFooter>

        <SendWithTagsReminderDialog
          open={showTagReminderDialog}
          onClose={() => setShowTagReminderDialog(false)}
          onSend={handleForwardWithData}
          tags={tags}
        />
      </DialogContent>
    </Dialog>
  );
}