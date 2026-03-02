import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Mic, MicOff } from "lucide-react";
import { useDictation } from "./useDictation";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import SendWithTagsReminderDialog from "./SendWithTagsReminderDialog";

export default function NewMailDialog({ open, onClose, onSend }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showTagReminderDialog, setShowTagReminderDialog] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { isListening: isDictating, toggle: toggleDictation } = useDictation((transcript) => {
    setBody(prev => prev ? prev + " " + transcript : transcript);
  });
  
  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => entities.Tag.list()
  });

  const { data: mails = [] } = useQuery({
    queryKey: ['mailItems'],
    queryFn: () => entities.MailItem.list()
  });

  // Alle unique E-Mail-Adressen aus Mails sammeln
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

  // Filter suggestions basierend auf Eingabe
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
    emails.pop(); // Remove last partial email
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

  const handleSendClick = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      return;
    }
    setShowTagReminderDialog(true);
  };

  const handleSendWithData = async (data) => {
    const sendData = { to, subject, body, tag: data.tag, reminder: data.reminder };
    setTo('');
    setSubject('');
    setBody('');

    setSending(true);
    try {
      await onSend(sendData);
      onClose();
    } catch (error) {
      // Error handled by parent
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Neue E-Mail</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
            
            {/* Autocomplete Dropdown */}
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
            <Label className="text-zinc-300">Betreff</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="E-Mail Betreff"
              className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300">Nachricht</Label>
              <Button
                type="button"
                size="sm"
                onClick={toggleDictation}
                className={`gap-1.5 h-7 px-2 text-xs ${isDictating ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: isDictating ? '#dc2626' : '#52525b', color: '#ffffff' }}
                title="Diktieren"
              >
                {isDictating ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {isDictating ? "Stopp" : "Diktieren"}
              </Button>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isDictating ? "🎤 Höre zu..." : "Ihre Nachricht..."}
              className={`bg-zinc-900/60 border-zinc-700 text-zinc-200 min-h-[200px] transition-colors ${isDictating ? 'border-red-500/60' : ''}`}
            />
            <p className="text-xs text-zinc-500">Signatur wird automatisch angefügt</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            Abbrechen
          </Button>
          <Button
            onClick={handleSendClick}
            disabled={!to.trim() || !subject.trim() || !body.trim() || sending}
            className="bg-indigo-600 hover:bg-indigo-500 gap-2"
          >
            {sending ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4" /> Mit Tag/Reminder
              </>
            )}
          </Button>
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