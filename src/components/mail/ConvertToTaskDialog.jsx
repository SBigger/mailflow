import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, Loader2 } from "lucide-react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";

export default function ConvertToTaskDialog({ open, onClose, mail, columns, onConvert }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [columnId, setColumnId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);

  const { data: priorities = [] } = useQuery({
    queryKey: ['priorities'],
    queryFn: () => entities.Priority.list('level'),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsersForTask'],
    queryFn: async () => {
      try {
        const res = await functions.invoke('getAllUsers');
        return res.data?.users || [];
      } catch {
        return [];
      }
    },
  });

  // Set defaults when dialog opens
  useEffect(() => {
    if (mail && open) {
      setTitle(mail.subject || '');
      setDescription(mail.body_preview || '');
      setDueDate('');

      // Load attachments if mail has them
      if (mail.has_attachments && mail.outlook_id) {
        setLoadingAttachments(true);
        functions.invoke('getOutlookAttachments', { mail_id: mail.id })
          .then(async (res) => {
            const mailAttachments = res.data.attachments || [];
            const uploadedUrls = [];
            for (const att of mailAttachments) {
              try {
                const binaryString = atob(att.contentBytes);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: att.contentType });
                const file = new File([blob], att.name, { type: att.contentType });
                const uploadRes = await entities.integrations.Core.UploadFile({ file });
                uploadedUrls.push(uploadRes.file_url);
              } catch (error) {
                console.error('Failed to upload attachment:', error);
              }
            }
            setAttachments(uploadedUrls);
          })
          .catch(console.error)
          .finally(() => setLoadingAttachments(false));
      } else {
        setAttachments([]);
      }
    }
  }, [mail, open]);

  // Set default assignee & priority once data is loaded
  useEffect(() => {
    if (currentUser && !assignee) {
      setAssignee(currentUser.email);
    }
  }, [currentUser]);

  useEffect(() => {
    if (priorities.length > 0 && !priorityId) {
      // Default to highest priority (lowest level number)
      setPriorityId(priorities[0].id);
    }
  }, [priorities]);

  const handleConvert = () => {
    if (!columnId) return;

    onConvert({
      title: title.trim(),
      description: description.trim(),
      priority_id: priorityId || undefined,
      column_id: columnId,
      assignee: assignee || undefined,
      due_date: dueDate ? dueDate + 'T00:00:00.000Z' : undefined,
      linked_mail_microsoft_id: mail.outlook_id,
      attachments: attachments,
    });

    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-lg">
        <DialogHeader>
          <DialogTitle>E-Mail in Task umwandeln</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Task-Titel</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
            />
          </div>

          <div className="space-y-2">
            <Label>Beschreibung</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-zinc-900/60 border-zinc-700 text-zinc-200 h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Spalte *</Label>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
                  <SelectValue placeholder="Wählen..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  {columns.map((col) => (
                    <SelectItem key={col.id} value={col.id} className="text-zinc-200">
                      {col.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priorität</Label>
              <Select value={priorityId} onValueChange={setPriorityId}>
                <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
                  <SelectValue placeholder="Wählen..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  {priorities.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Zugewiesen an</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
                  <SelectValue placeholder="Wählen..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  {currentUser && (
                    <SelectItem value={currentUser.email} className="text-zinc-200">
                      {currentUser.full_name || currentUser.email} (ich)
                    </SelectItem>
                  )}
                  {allUsers
                    .filter(u => u.email !== currentUser?.email)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.email} className="text-zinc-200">
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fälligkeitsdatum</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
              />
            </div>
          </div>

          {/* Attachments Info */}
          {mail?.has_attachments && (
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Paperclip className="h-4 w-4" />
                {loadingAttachments ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Anhänge werden übertragen...</span>
                  </div>
                ) : (
                  <span>{attachments.length} Anhänge werden mit dem Task übernommen</span>
                )}
              </div>
            </div>
          )}

          <div className="text-xs text-zinc-500 bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
            Die E-Mail bleibt im Postfach und wird mit dem neuen Task verknüpft.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            Abbrechen
          </Button>
          <Button
            onClick={handleConvert}
            disabled={!columnId || loadingAttachments}
            className="bg-green-600 hover:bg-green-500"
          >
            Task erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}