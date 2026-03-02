import React, { useState } from "react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { X, Trash2, CheckCircle2, Circle, Mail, Tag, Paperclip, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export default function TaskDetailPanel({ task, onClose, onUpdate, onDelete }) {
  const isMobile = useIsMobile();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [priorityId, setPriorityId] = useState(task.priority_id || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');
  const [tags, setTags] = useState(task.tags || []);
  const [columnId, setColumnId] = useState(task.column_id || '');
  const [attachments, setAttachments] = useState(task.attachments || []);
  const [uploading, setUploading] = useState(false);

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await functions.invoke('getAllUsers', {});
      return response.data.users || [];
    },
  });

  const { data: taskColumns = [] } = useQuery({
    queryKey: ["taskColumns"],
    queryFn: () => entities.TaskColumn.list("order"),
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: existingTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.Tag.filter({ created_by: currentUser.email });
    },
    enabled: !!currentUser,
  });

  // Mark as read for current user on first open
  React.useEffect(() => {
    const markAsRead = async () => {
      if (!currentUser) return;
      try {
        const existing = await entities.TaskReadStatus.filter({
          task_id: task.id,
          user_email: currentUser.email
        });
        if (!existing || existing.length === 0) {
          await entities.TaskReadStatus.create({
            task_id: task.id,
            user_email: currentUser.email
          });
        }
      } catch (error) {
        console.error('Failed to mark task as read:', error);
      }
    };
    markAsRead();
  }, [task.id, currentUser?.email]);

  const handleSave = () => {
    onUpdate({
      title,
      description,
      assignee,
      priority_id: priorityId || null,
      due_date: dueDate || null,
      column_id: columnId,
      tags,
      attachments
    });
    onClose();
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const res = await entities.integrations.Core.UploadFile({ file });
        uploadedUrls.push(res.file_url);
      }
      setAttachments([...attachments, ...uploadedUrls]);
      toast.success(`${files.length} Datei(en) hochgeladen`);
    } catch (error) {
      toast.error('Upload fehlgeschlagen: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = (index) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleDownloadAttachment = (url) => {
    window.open(url, '_blank');
  };

  const handleAddTag = (tagName) => {
    if (!tags.includes(tagName)) {
      setTags([...tags, tagName]);
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const toggleComplete = () => {
    onUpdate({ completed: !task.completed });
  };

  return (
    <motion.div
      initial={isMobile ? { y: "100%" } : { x: "100%", opacity: 0 }}
      animate={isMobile ? { y: 0 } : { x: 0, opacity: 1 }}
      exit={isMobile ? { y: "100%" } : { x: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className={isMobile
        ? "fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-xl flex flex-col"
        : "fixed right-0 top-0 h-full w-full max-w-lg bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800/60 z-50 flex flex-col shadow-2xl"
      }
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </Button>
          <span className="text-sm text-zinc-500">Task Details</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleComplete}
            className={task.completed ? "text-green-400 hover:text-green-300" : "text-zinc-400 hover:text-zinc-200"}
          >
            {task.completed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            {task.completed ? "Abgeschlossen" : "Offen"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        <div className="space-y-2">
          <Label className="text-zinc-400">Titel</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-lg font-semibold"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-zinc-400">Beschreibung</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-zinc-900/60 border-zinc-700 text-zinc-200 min-h-[120px]"
            placeholder="Details zum Task..."
          />
        </div>

        <div className="space-y-2">
          <Label className="text-zinc-400">Spalte</Label>
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="Spalte wählen..." />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              {taskColumns.map((column) => (
                <SelectItem key={column.id} value={column.id} className="text-zinc-200">
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">Priorität</Label>
            <Select value={priorityId} onValueChange={setPriorityId}>
              <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
                <SelectValue placeholder="Keine" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {priorities.map((priority) => (
                  <SelectItem key={priority.id} value={priority.id} className="text-zinc-200">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: priority.color }} />
                      {priority.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-400">Zugewiesen an</Label>
            <Select value={assignee || ''} onValueChange={(v) => setAssignee(v === '' ? '' : v)}>
              <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
                <SelectValue placeholder="Benutzer wählen..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                <SelectItem value={null} className="text-zinc-400">Niemand</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.email} className="text-zinc-200">
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-zinc-400">Fällig am</Label>
          <Input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-zinc-400 flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Tags
          </Label>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="bg-violet-500/10 border-violet-500/30 text-violet-300 gap-2"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-violet-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Select value="" onValueChange={handleAddTag}>
            <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="Tag hinzufügen..." />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {existingTags
                .filter(t => !tags.includes(t.name))
                .map((tag) => (
                  <SelectItem key={tag.id} value={tag.name} className="text-zinc-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color || '#a78bfa' }} />
                      {tag.name}
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Attachments Section */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-zinc-400">
            <Paperclip className="h-4 w-4" /> Anhänge
          </Label>
          <div className="space-y-2">
            <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors cursor-pointer bg-zinc-900/60">
              <Upload className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-400">
                {uploading ? 'Wird hochgeladen...' : 'Dateien hochladen'}
              </span>
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>

            {attachments && attachments.length > 0 && (
              <div className="space-y-1">
                {attachments.map((url, index) => {
                  const filename = url.split('/').pop();
                  return (
                    <div key={index} className="flex items-center justify-between p-2 bg-zinc-900/60 rounded-lg border border-zinc-800 group">
                      <button
                        onClick={() => handleDownloadAttachment(url)}
                        className="flex items-center gap-2 min-w-0 flex-1 hover:text-indigo-400 transition-colors"
                      >
                        <Paperclip className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                        <span className="text-xs text-zinc-300 truncate">{filename}</span>
                        <Download className="h-3 w-3 text-zinc-500 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                      </button>
                      <button
                        onClick={() => handleRemoveAttachment(index)}
                        className="text-zinc-500 hover:text-red-400 flex-shrink-0 ml-2"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {task.linked_mail_microsoft_id && (
           <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
             <div className="flex items-center gap-2">
               <Mail className="h-4 w-4 text-cyan-400" />
               <span className="text-sm font-medium text-cyan-400">E-Mail verknüpft</span>
             </div>
           </div>
         )}

        {task.created_date && (
          <div className="text-xs text-zinc-600 pt-4 border-t border-zinc-800/40 space-y-1">
            <div>Erstellt: {format(new Date(task.created_date), "dd.MM.yyyy HH:mm", { locale: de })}</div>
            {task.completed && task.updated_date && (
              <div className="text-green-700">Abgeschlossen: {format(new Date(task.updated_date), "dd.MM.yyyy HH:mm", { locale: de })}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-zinc-800/60 p-4">
        <Button
          onClick={handleSave}
          className="w-full bg-indigo-600 hover:bg-indigo-500"
        >
          Änderungen speichern
        </Button>
      </div>
    </motion.div>
  );
}