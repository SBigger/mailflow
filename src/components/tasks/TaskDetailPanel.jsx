import React, { useState, useRef, useContext, useCallback, useEffect } from "react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { X, Trash2, CheckCircle2, Circle, Mail, Tag, Paperclip, Upload, Download, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { entities, functions, auth, supabase, uploadFile } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";

export default function TaskDetailPanel({ task, onClose, onUpdate, onDelete }) {
  const isMobile = useIsMobile();
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [priorityId, setPriorityId] = useState(task.priority_id || '');
  const [dueDate, setDueDate] = useState(task.due_date ? task.due_date.split('T')[0] : '');
  const [tags, setTags] = useState(task.tags || []);
  const [columnId, setColumnId] = useState(task.column_id || '');
  const [attachments, setAttachments] = useState(task.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [verantwortlich, setVerantwortlich] = useState(task.verantwortlich || '');
  const [customerId, setCustomerId] = useState(task.customer_id || '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const chatEndRef = useRef(null);
  const queryClient = useQueryClient();

  // Resize state
  const [panelWidth, setPanelWidth] = useState(512); // default max-w-lg = 512px
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Theme colors
  const bg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(9,9,11,0.97)';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#e4e4e7' : 'rgba(63,63,70,0.6)';
  const headerBorder = isArtis ? '#dde8dd' : isLight ? '#e4e4e7' : 'rgba(63,63,70,0.6)';
  const labelColor = isArtis ? '#4a5e4a' : isLight ? '#6b7280' : '#a1a1aa';
  const textColor = isArtis ? '#2d3a2d' : isLight ? '#111827' : '#e4e4e7';
  const mutedText = isArtis ? '#6b826b' : isLight ? '#9ca3af' : '#71717a';
  const inputBg = isArtis ? '#f2f5f2' : isLight ? '#f9fafb' : 'rgba(24,24,27,0.7)';
  const inputBorder = isArtis ? '#bfcfbf' : isLight ? '#d1d5db' : '#52525b';
  const dropdownBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : '#18181b';
  const dropdownHover = isArtis ? '#edf2ed' : isLight ? '#f3f4f6' : '#27272a';
  const accentColor = isArtis ? '#7a9b7f' : isLight ? '#6366f1' : '#6366f1';
  const accentHover = isArtis ? '#5f7d64' : isLight ? '#4f46e5' : '#4f46e5';

  const inputStyle = { backgroundColor: inputBg, borderColor: inputBorder, color: textColor };
  const selectStyle = { backgroundColor: inputBg, borderColor: inputBorder, color: textColor };

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
      return entities.Tag.filter({ created_by: currentUser.id });
    },
    enabled: !!currentUser,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ["task_comments", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  React.useEffect(() => {
    if (task.customer_id && customers.length > 0) {
      const found = customers.find(c => c.id === task.customer_id);
      if (found) setCustomerSearch(found.company_name);
    }
  }, [task.customer_id, customers]);

  useEffect(() => {
    if (!currentUser || comments.length === 0) return;
    const unread = comments.filter(c => c.user_email !== currentUser.email && !c.read_by?.includes(currentUser.email));
    if (unread.length === 0) return;
    Promise.all(unread.map(c =>
      supabase.from('task_comments').update({ read_by: [...(c.read_by || []), currentUser.email] }).eq('id', c.id)
    )).then(() => queryClient.invalidateQueries({ queryKey: ["unread_comments"] }));
  }, [comments, currentUser?.email]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !currentUser) return;
    setSendingMessage(true);
    try {
      await supabase.from('task_comments').insert({
        task_id: task.id,
        user_email: currentUser.email,
        user_name: currentUser.full_name || currentUser.email,
        message: chatMessage.trim(),
        read_by: [currentUser.email],
      });
      setChatMessage('');
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ["unread_comments"] });
    } catch (error) {
      toast.error('Fehler beim Senden: ' + error.message);
    } finally {
      setSendingMessage(false);
    }
  };

  React.useEffect(() => {
    const markAsRead = async () => {
      if (!currentUser) return;
      try {
        const { error } = await supabase.from('task_read_statuses').insert({
          task_id: task.id,
          user_email: currentUser.email
        });
        if (error && !error.code?.includes('23505') && !error.message?.includes('duplicate')) {
          console.error('Failed to mark task as read:', error);
        }
      } catch (error) {
        console.error('Failed to mark task as read:', error);
      }
    };
    markAsRead();
  }, [task.id, currentUser?.email]);

  // Resize handlers
  const onMouseDown = useCallback((e) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(900, Math.max(360, startWidth.current + delta));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  const handleSave = () => {
    onUpdate({
      title,
      description,
      assignee,
      verantwortlich: verantwortlich || null,
      priority_id: priorityId || null,
      due_date: dueDate || null,
      column_id: columnId,
      tags,
      attachments,
      customer_id: customerId || null,
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
        const url = await uploadFile(file, 'task-attachments');
        uploadedUrls.push(url);
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
    if (!tags.includes(tagName)) setTags([...tags, tagName]);
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const toggleComplete = () => {
    onUpdate({ completed: !task.completed });
  };

  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed inset-0 z-50 flex flex-col"
          style={{ backgroundColor: bg }}
        >
          {renderContent()}
        </motion.div>
      </>
    );
  }

  function renderContent() {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: headerBorder }}>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onClose} style={{ color: mutedText }}>
              <X className="h-5 w-5" />
            </Button>
            <span className="text-sm" style={{ color: mutedText }}>Task Details</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleComplete}
              style={{ color: task.completed ? '#16a34a' : mutedText }}
            >
              {task.completed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              {task.completed ? "Abgeschlossen" : "Offen"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Titel</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="text-lg font-semibold border" style={inputStyle} />
          </div>

          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Beschreibung</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
              className="min-h-[120px] border" style={inputStyle} placeholder="Details zum Task..." />
          </div>

          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Spalte</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger className="border" style={selectStyle}>
                <SelectValue placeholder="Spalte wählen..." />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                {taskColumns.map((column) => (
                  <SelectItem key={column.id} value={column.id} style={{ color: textColor }}>{column.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label style={{ color: labelColor }}>Priorität</Label>
              <Select value={priorityId} onValueChange={setPriorityId}>
                <SelectTrigger className="border" style={selectStyle}>
                  <SelectValue placeholder="Keine" />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                  {priorities.map((priority) => (
                    <SelectItem key={priority.id} value={priority.id} style={{ color: textColor }}>
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
              <Label style={{ color: labelColor }}>Zugewiesen an *</Label>
              <Select value={assignee || 'none'} onValueChange={(v) => setAssignee(v === 'none' ? '' : v)}>
                <SelectTrigger className="border" style={selectStyle}>
                  <SelectValue placeholder="Benutzer wählen..." />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                  <SelectItem value="none" style={{ color: mutedText }}>Niemand</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.email} style={{ color: textColor }}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Verantwortlich *</Label>
            <Select value={verantwortlich || 'none'} onValueChange={(v) => setVerantwortlich(v === 'none' ? '' : v)}>
              <SelectTrigger className="border" style={selectStyle}>
                <SelectValue placeholder="Verantwortliche/r..." />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                <SelectItem value="none" style={{ color: mutedText }}>Niemand</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.email} style={{ color: textColor }}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Fällig am</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="border" style={inputStyle} />
          </div>

          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Kunde</Label>
            <div className="relative">
              <Input
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); if (!e.target.value) setCustomerId(''); }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                placeholder="Kunde suchen..."
                className="border" style={inputStyle}
                autoComplete="off"
              />
              {showCustomerDropdown && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full border rounded-md shadow-lg max-h-48 overflow-y-auto"
                  style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                  <div className="px-3 py-2 text-sm cursor-pointer" style={{ color: mutedText }}
                    onMouseDown={() => { setCustomerId(''); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                    onMouseEnter={e => e.target.style.backgroundColor = dropdownHover}
                    onMouseLeave={e => e.target.style.backgroundColor = ''}>
                    Kein Kunde
                  </div>
                  {customers
                    .filter(c => c.company_name.toLowerCase().includes(customerSearch.toLowerCase()))
                    .map(c => (
                      <div key={c.id} className="px-3 py-2 text-sm cursor-pointer"
                        style={{ color: textColor }}
                        onMouseDown={() => { setCustomerId(c.id); setCustomerSearch(c.company_name); setShowCustomerDropdown(false); }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = dropdownHover}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                        {c.company_name}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2" style={{ color: labelColor }}>
              <Tag className="h-4 w-4" /> Tags
            </Label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline"
                    style={{ backgroundColor: isArtis ? 'rgba(122,155,127,0.1)' : 'rgba(139,92,246,0.1)', borderColor: isArtis ? 'rgba(122,155,127,0.3)' : 'rgba(139,92,246,0.3)', color: isArtis ? '#5f7d64' : '#a78bfa' }}
                    className="gap-2">
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <Select value="" onValueChange={handleAddTag}>
              <SelectTrigger className="border" style={selectStyle}>
                <SelectValue placeholder="Tag hinzufügen..." />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: dropdownBg, borderColor: inputBorder }}>
                {existingTags.filter(t => !tags.includes(t.name)).map((tag) => (
                  <SelectItem key={tag.id} value={tag.name} style={{ color: textColor }}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color || '#a78bfa' }} />
                      {tag.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2" style={{ color: labelColor }}>
              <Paperclip className="h-4 w-4" /> Anhänge
            </Label>
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
                style={{ borderColor: inputBorder, backgroundColor: inputBg }}>
                <Upload className="h-4 w-4" style={{ color: mutedText }} />
                <span className="text-sm" style={{ color: mutedText }}>
                  {uploading ? 'Wird hochgeladen...' : 'Dateien hochladen'}
                </span>
                <input type="file" multiple onChange={handleFileUpload} disabled={uploading} className="hidden" />
              </label>
              {attachments && attachments.length > 0 && (
                <div className="space-y-1">
                  {attachments.map((url, index) => {
                    const filename = url.split('/').pop();
                    return (
                      <div key={index} className="flex items-center justify-between p-2 rounded-lg border group"
                        style={{ backgroundColor: inputBg, borderColor: inputBorder }}>
                        <button onClick={() => handleDownloadAttachment(url)}
                          className="flex items-center gap-2 min-w-0 flex-1 transition-colors"
                          style={{ color: textColor }}>
                          <Paperclip className="h-3 w-3 flex-shrink-0" style={{ color: mutedText }} />
                          <span className="text-xs truncate">{filename}</span>
                          <Download className="h-3 w-3 opacity-0 group-hover:opacity-100 flex-shrink-0" style={{ color: mutedText }} />
                        </button>
                        <button onClick={() => handleRemoveAttachment(index)}
                          className="flex-shrink-0 ml-2 text-red-400 hover:text-red-600">
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
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)' }}>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-cyan-500" />
                <span className="text-sm font-medium text-cyan-600">E-Mail verknüpft</span>
              </div>
            </div>
          )}

          {task.created_date && (
            <div className="text-xs pt-4 border-t space-y-1" style={{ color: mutedText, borderColor: headerBorder }}>
              <div>Erstellt: {format(new Date(task.created_date), "dd.MM.yyyy HH:mm", { locale: de })}</div>
              {task.completed && task.updated_date && (
                <div style={{ color: '#16a34a' }}>Abgeschlossen: {format(new Date(task.updated_date), "dd.MM.yyyy HH:mm", { locale: de })}</div>
              )}
            </div>
          )}

          {/* Chat */}
          <div className="space-y-3 pt-4 border-t" style={{ borderColor: headerBorder }}>
            <Label className="flex items-center gap-2" style={{ color: labelColor }}>
              <MessageSquare className="h-4 w-4" /> Kommentare
              {comments.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: inputBg, color: mutedText }}>{comments.length}</span>}
            </Label>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {comments.length === 0 && (
                <p className="text-xs text-center py-3" style={{ color: mutedText }}>Noch keine Kommentare</p>
              )}
              {comments.map(comment => {
                const isMe = comment.user_email === currentUser?.email;
                return (
                  <div key={comment.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <div className="h-7 w-7 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-semibold flex-shrink-0">
                      {(comment.user_name || comment.user_email).charAt(0).toUpperCase()}
                    </div>
                    <div className={`max-w-[80%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="text-xs" style={{ color: mutedText }}>
                        {isMe ? 'Du' : (comment.user_name || comment.user_email)} · {format(new Date(comment.created_at), "dd.MM. HH:mm", { locale: de })}
                      </div>
                      <div className="text-sm px-3 py-2" style={{
                        backgroundColor: isMe ? accentColor : inputBg,
                        color: isMe ? '#ffffff' : textColor,
                        borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      }}>
                        {comment.message}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <Input
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                placeholder="Kommentar schreiben... (Enter)"
                className="border flex-1 text-sm"
                style={inputStyle}
              />
              <Button size="icon" onClick={handleSendMessage} disabled={!chatMessage.trim() || sendingMessage}
                style={{ backgroundColor: accentColor, color: '#ffffff', flexShrink: 0 }}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t p-4" style={{ borderColor: headerBorder }}>
          <Button onClick={handleSave} className="w-full text-white font-medium"
            style={{ backgroundColor: accentColor }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = accentHover}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = accentColor}>
            Änderungen speichern
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Backdrop — klick schliesst Panel */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl border-l"
        style={{
          width: panelWidth,
          backgroundColor: bg,
          borderColor: borderColor,
        }}
      >
        {/* Resize Handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-10 group"
          style={{ backgroundColor: 'transparent' }}
        >
          <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: accentColor }} />
        </div>

        {renderContent()}
      </motion.div>
    </>
  );
}
