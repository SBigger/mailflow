import React, { useState, useContext } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Upload, Paperclip } from "lucide-react";
import { entities, functions, auth, uploadFile } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";

export default function AddTaskDialog({ open, onClose, onAdd, columns }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const bg          = isArtis ? '#ffffff'           : isLight ? '#ffffff'           : '#18181b';
  const borderColor = isArtis ? '#bfcfbf'           : isLight ? '#d1d5db'           : '#3f3f46';
  const textColor   = isArtis ? '#2d3a2d'           : isLight ? '#111827'           : '#e4e4e7';
  const mutedText   = isArtis ? '#6b826b'           : isLight ? '#6b7280'           : '#a1a1aa';
  const inputBg     = isArtis ? '#f2f5f2'           : isLight ? '#f9fafb'           : 'rgba(9,9,11,0.6)';
  const inputBorder = isArtis ? '#bfcfbf'           : isLight ? '#d1d5db'           : '#52525b';
  const dropdownBg  = isArtis ? '#ffffff'           : isLight ? '#ffffff'           : '#18181b';
  const dropdownHov = isArtis ? '#edf2ed'           : isLight ? '#f3f4f6'           : '#27272a';
  const accentBg    = isArtis ? '#5f7d64'           : isLight ? '#4f46e5'           : '#4f46e5';
  const labelColor  = isArtis ? '#4a5e4a'           : isLight ? '#374151'           : '#a1a1aa';

  const inputStyle  = { backgroundColor: inputBg, borderColor: inputBorder, color: textColor };
  const dropStyle   = { backgroundColor: dropdownBg, borderColor: inputBorder };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [verantwortlich, setVerantwortlich] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [columnId, setColumnId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerHighlight, setCustomerHighlight] = useState(-1);
  const titleRef = React.useRef(null);

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

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  const { data: existingTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.Tag.filter({ created_by: currentUser.id });
    },
    enabled: !!currentUser,
  });

  // Default: aktueller Benutzer als Zugewiesen + Verantwortlich
  React.useEffect(() => {
    if (currentUser && open) {
      if (!assignee)      setAssignee(currentUser.email);
      if (!verantwortlich) setVerantwortlich(currentUser.email);
    }
  }, [currentUser, open]);

  // Alle User inkl. sich selbst (für beide Dropdowns)
  const allUsers = currentUser
    ? [{ id: currentUser.id, email: currentUser.email, full_name: currentUser.full_name || currentUser.email }, ...users.filter(u => u.email !== currentUser.email)]
    : users;

  const handleAdd = () => {
    if (!title.trim() || !columnId) return;
    if (!assignee)       { toast.error("Bitte 'Zugewiesen an' auswählen."); return; }
    if (!verantwortlich) { toast.error("Bitte 'Verantwortlich' auswählen."); return; }

    onAdd({
      title:          title.trim(),
      description:    description.trim(),
      assignee:       assignee || null,
      verantwortlich: verantwortlich || null,
      priority_id:    priorityId || null,
      column_id:      columnId,
      due_date:       dueDate || null,
      tags,
      attachments,
      customer_id:    customerId || null,
    });

    setTitle(''); setDescription(''); setAssignee(''); setVerantwortlich('');
    setPriorityId(''); setColumnId(''); setDueDate('');
    setTags([]); setAttachments([]); setCustomerId(''); setCustomerSearch('');
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const url = await uploadFile(file);
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

  const handleRemoveAttachment = (index) => setAttachments(attachments.filter((_, i) => i !== index));
  const handleAddTag    = (tagName)     => { if (!tags.includes(tagName)) setTags([...tags, tagName]); };
  const handleRemoveTag = (tagToRemove) => setTags(tags.filter(t => t !== tagToRemove));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" style={{ backgroundColor: bg, borderColor: borderColor, color: textColor }}>
        <DialogHeader>
          <DialogTitle style={{ color: textColor }}>Neuer Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto max-h-[70vh] pr-1">
          {/* Titel */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Titel</Label>
            <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Task-Titel" className="border" style={inputStyle} tabIndex={1} autoFocus />
          </div>

          {/* Beschreibung */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Beschreibung</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Details..." className="border h-20" style={inputStyle} tabIndex={2} />
          </div>

          {/* Spalte + Priorität */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label style={{ color: labelColor }}>Spalte *</Label>
              <Select value={columnId || ''} onValueChange={setColumnId}>
                <SelectTrigger className="border" style={inputStyle} tabIndex={3}>
                  <SelectValue placeholder="Wählen..." />
                </SelectTrigger>
                <SelectContent style={dropStyle}>
                  {columns.map((col) => (
                    <SelectItem key={col.id} value={col.id || ''} style={{ color: textColor }}>{col.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label style={{ color: labelColor }}>Priorität</Label>
              <Select value={priorityId} onValueChange={setPriorityId}>
                <SelectTrigger className="border" style={inputStyle} tabIndex={4}>
                  <SelectValue placeholder="Wählen..." />
                </SelectTrigger>
                <SelectContent style={dropStyle}>
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
          </div>

          {/* Datum */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Fällig am</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="border" style={inputStyle} tabIndex={5} />
          </div>

          {/* Zugewiesen + Verantwortlich */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label style={{ color: labelColor }}>Zugewiesen an *</Label>
              <Select value={assignee || 'none'} onValueChange={(v) => setAssignee(v === 'none' ? '' : v)}>
                <SelectTrigger className="border" style={inputStyle} tabIndex={6}>
                  <SelectValue placeholder="Benutzer wählen..." />
                </SelectTrigger>
                <SelectContent style={dropStyle}>
                  <SelectItem value="none" style={{ color: mutedText }}>Niemand</SelectItem>
                  {allUsers.map((user) => (
                    <SelectItem key={user.id} value={user.email} style={{ color: textColor }}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label style={{ color: labelColor }}>Verantwortlich *</Label>
              <Select value={verantwortlich || 'none'} onValueChange={(v) => setVerantwortlich(v === 'none' ? '' : v)}>
                <SelectTrigger className="border" style={inputStyle} tabIndex={7}>
                  <SelectValue placeholder="Verantwortliche/r..." />
                </SelectTrigger>
                <SelectContent style={dropStyle}>
                  <SelectItem value="none" style={{ color: mutedText }}>Niemand</SelectItem>
                  {allUsers.map((user) => (
                    <SelectItem key={user.id} value={user.email} style={{ color: textColor }}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Kunde */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Kunde</Label>
            <div className="relative">
              <Input
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); setCustomerHighlight(-1); if (!e.target.value) setCustomerId(''); }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                onKeyDown={(e) => {
                  if (!showCustomerDropdown) return;
                  const filtered = customers.filter(c => c.company_name.toLowerCase().includes(customerSearch.toLowerCase()));
                  const total = filtered.length + 1;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerHighlight(h => (h + 1) % total); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerHighlight(h => (h - 1 + total) % total); }
                  else if (e.key === 'Enter' && customerHighlight >= 0) {
                    e.preventDefault();
                    if (customerHighlight === 0) { setCustomerId(''); setCustomerSearch(''); }
                    else { const c = filtered[customerHighlight - 1]; setCustomerId(c.id); setCustomerSearch(c.company_name); }
                    setShowCustomerDropdown(false); setCustomerHighlight(-1);
                  } else if (e.key === 'Escape') { setShowCustomerDropdown(false); setCustomerHighlight(-1); }
                }}
                placeholder="Kunde suchen..." className="border" style={inputStyle}
                tabIndex={8} autoComplete="off" data-lpignore="true"
              />
              {showCustomerDropdown && (
                <div className="absolute z-50 top-full left-0 mt-1 w-full border rounded-md shadow-lg max-h-48 overflow-y-auto" style={dropStyle}>
                  <div className="px-3 py-2 text-sm cursor-pointer rounded-t-md"
                    style={{ color: mutedText, backgroundColor: customerHighlight === 0 ? dropdownHov : '' }}
                    onMouseDown={() => { setCustomerId(''); setCustomerSearch(''); setShowCustomerDropdown(false); setCustomerHighlight(-1); }}>
                    Kein Kunde
                  </div>
                  {customers.filter(c => c.company_name.toLowerCase().includes(customerSearch.toLowerCase())).map((c, i) => (
                    <div key={c.id} className="px-3 py-2 text-sm cursor-pointer"
                      style={{ color: textColor, backgroundColor: customerHighlight === i + 1 ? dropdownHov : '' }}
                      onMouseDown={() => { setCustomerId(c.id); setCustomerSearch(c.company_name); setShowCustomerDropdown(false); setCustomerHighlight(-1); }}>
                      {c.company_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Tags</Label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline"
                    style={{ backgroundColor: isArtis ? 'rgba(122,155,127,0.1)' : 'rgba(139,92,246,0.1)', borderColor: isArtis ? 'rgba(122,155,127,0.3)' : 'rgba(139,92,246,0.3)', color: isArtis ? '#5f7d64' : '#a78bfa' }}
                    className="gap-2">
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
            <Select value="" onValueChange={handleAddTag}>
              <SelectTrigger className="border" style={inputStyle} tabIndex={9}>
                <SelectValue placeholder="Tag hinzufügen..." />
              </SelectTrigger>
              <SelectContent style={dropStyle}>
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

          {/* Anhänge */}
          <div className="space-y-2">
            <Label style={{ color: labelColor }}>Anhänge</Label>
            <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
              style={{ borderColor: inputBorder, backgroundColor: inputBg }}>
              <Upload className="h-4 w-4" style={{ color: mutedText }} />
              <span className="text-sm" style={{ color: mutedText }}>{uploading ? 'Wird hochgeladen...' : 'Dateien hochladen'}</span>
              <input type="file" multiple onChange={handleFileUpload} disabled={uploading} className="hidden" />
            </label>
            {attachments.length > 0 && (
              <div className="space-y-1">
                {attachments.map((url, index) => {
                  const filename = decodeURIComponent(url.split('/').pop().replace(/^\d+_/, ''));
                  return (
                    <div key={index} className="flex items-center justify-between p-2 rounded-lg border"
                      style={{ backgroundColor: inputBg, borderColor: inputBorder }}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Paperclip className="h-3 w-3 flex-shrink-0" style={{ color: mutedText }} />
                        <span className="text-xs truncate" style={{ color: textColor }}>{filename}</span>
                      </div>
                      <button onClick={() => handleRemoveAttachment(index)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} style={{ color: mutedText }} tabIndex={10}>Abbrechen</Button>
          <Button onClick={handleAdd}
            disabled={!title.trim() || !columnId || !assignee || !verantwortlich}
            style={{ backgroundColor: accentBg, color: '#ffffff' }} tabIndex={11}>
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
