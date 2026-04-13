import React, {useContext, useState} from "react";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Button} from "@/components/ui/button";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Badge} from "@/components/ui/badge";
import {X, Upload, Paperclip, CalendarClock} from "lucide-react";
import {entities, functions, auth, uploadFile} from "@/api/supabaseClient";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {ThemeContext} from "@/Layout.jsx";

export default function AddTaskDialog({open, onClose, onAdd, columns}) {
    const {theme} = useContext(ThemeContext);
    const isArtis = theme === "artis";
    const isLight = theme === "light";

    // ── Theme ────────────────────────────────────────────────────
    const dialogBg = isArtis ? "#f2f5f2" : isLight ? "#ffffff" : "#18181b";
    const headerBg = isArtis ? "#e6ede6" : isLight ? "#f8fafc" : "#1c1c21";
    const dialogBorder = isArtis ? "#bfcfbf" : isLight ? "#e2e8f0" : "#3f3f46";
    const labelColor = isArtis ? "#4a5e4a" : isLight ? "#374151" : "#a1a1aa";
    const textColor = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
    const mutedColor = isArtis ? "#6b826b" : isLight ? "#6b7280" : "#71717a";
    const inputBg = isArtis ? "#ffffff" : isLight ? "#f9fafb" : "#27272a";
    const inputBorder = isArtis ? "#bfcfbf" : isLight ? "#d1d5db" : "#3f3f46";
    const accentBg = isArtis ? "#7a9b7f" : "#7c3aed";
    const dropdownBg = isArtis ? "#f8faf8" : isLight ? "#ffffff" : "#1c1c21";
    const dropdownHover = isArtis ? "#edf2ed" : isLight ? "#f3f4f6" : "#27272a";
    const sectionBg = isArtis ? "rgba(122,155,127,0.06)" : isLight ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.03)";
    const inputCls = "rounded-md border px-3 py-1.5 text-sm focus:outline-none w-full";
    const labelCls = "text-xs font-semibold uppercase tracking-wide mb-1 block";
    const selectCls = "rounded-md border px-2 py-1.5 text-sm focus:outline-none w-full cursor-pointer";

    const inStyle = {backgroundColor: inputBg, borderColor: inputBorder, color: textColor};

    // ── State ────────────────────────────────────────────────────
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
    const titleRef = React.useRef(null);

    const {data: priorities = []} = useQuery({
        queryKey: ["priorities"],
        queryFn: () => entities.Priority.list("level"),
    });

    const {data: users = []} = useQuery({
        queryKey: ["users"],
        queryFn: async () => {
            const response = await functions.invoke('getAllUsers', {});
            return response.data.users || [];
        },
    });

    const {data: currentUser} = useQuery({
        queryKey: ["currentUser"],
        queryFn: () => auth.me(),
    });

    const {data: customers = []} = useQuery({
        queryKey: ["customers"],
        queryFn: () => entities.Customer.list("company_name"),
    });

    const {data: existingTags = []} = useQuery({
        queryKey: ["tags"],
        queryFn: async () => {
            if (!currentUser) return [];
            return entities.Tag.filter({created_by: currentUser.id});
        },
        enabled: !!currentUser,
    });

    // Default: aktueller Benutzer als Zugewiesen + Verantwortlich
    React.useEffect(() => {
        if (currentUser && open) {
            if (!assignee) setAssignee(currentUser.email);
            if (!verantwortlich) setVerantwortlich(currentUser.email);
        }
    }, [currentUser, open]);

    // Alle User inkl. sich selbst (für beide Dropdowns)
    const allUsers = currentUser
        ? [{
            id: currentUser.id,
            email: currentUser.email,
            full_name: currentUser.full_name || currentUser.email
        }, ...users.filter(u => u.email !== currentUser.email)]
        : users;

    const handleAdd = () => {
        if (!title.trim() || !columnId) return;
        if (!assignee) {
            toast.error("Bitte 'Zugewiesen an' auswählen.");
            return;
        }
        if (!verantwortlich) {
            toast.error("Bitte 'Verantwortlich' auswählen.");
            return;
        }

        onAdd({
            title: title.trim(),
            description: description.trim(),
            assignee: assignee || null,
            verantwortlich: verantwortlich || null,
            priority_id: priorityId || null,
            column_id: columnId,
            due_date: dueDate || null,
            tags,
            attachments,
            customer_id: customerId || null,
        });

        setTitle('');
        setDescription('');
        setAssignee('');
        setVerantwortlich('');
        setPriorityId('');
        setColumnId('');
        setDueDate('');
        setTags([]);
        setAttachments([]);
        setCustomerId('');
        setCustomerSearch('');
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
    const handleAddTag = (tagName) => {
        if (!tags.includes(tagName)) setTags([...tags, tagName]);
    };
    const handleRemoveTag = (tagToRemove) => setTags(tags.filter(t => t !== tagToRemove));

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-lg p-0 overflow-hidden gap-0"
                           style={{backgroundColor: dialogBg, borderColor: dialogBorder, color: textColor}}>
                {/* ── Header ── */}
                <DialogHeader className="px-5 pt-4 pb-3 border-b"
                              style={{backgroundColor: headerBg, borderColor: dialogBorder}}>
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold" style={{color: textColor}}>
                        <CalendarClock className="h-5 w-5" style={{color: accentBg}}/>
                        Neuer Task
                    </DialogTitle>
                </DialogHeader>

                {/* ── Body ── */}
                <div className="px-5 py-4 space-y-4 max-h-[72vh] overflow-y-auto">

                    {/* Titel */}
                    <div>
                        <label className={labelCls} style={{color: labelColor}}>Titel *</label>
                        <input
                            autoFocus
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Task-Titel"
                            className={inputCls}
                            style={inStyle}
                            tabIndex={1}
                        />
                    </div>

                    {/* Bezeichnung */}
                    <div>
                        <label className={labelCls} style={{color: labelColor}}>Bezeichnung *</label>
                        <input
                            autoFocus
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSave()}
                            placeholder="Details..."
                            className={inputCls}
                            style={inStyle}
                            tabIndex={2}
                        />
                    </div>

                    {/* Spalte + Priorität */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls} style={{ color: labelColor }}>Spalte *</label>
                            <Select value={columnId || ''} onValueChange={setColumnId} className={selectCls} style={inStyle}>
                                <SelectTrigger tabIndex={3}>
                                    <SelectValue placeholder="Wählen..."/>
                                </SelectTrigger>
                                <SelectContent>
                                    {columns.map((col) => (
                                        <SelectItem key={col.id} value={col.id || ''}>{col.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className={labelCls} style={{ color: labelColor }}>Priorität</label>
                            <Select value={priorityId} onValueChange={setPriorityId} className={selectCls} style={inStyle}>
                                <SelectTrigger tabIndex={4}>
                                    <SelectValue placeholder="Wählen..."/>
                                </SelectTrigger>
                                <SelectContent>
                                    {priorities.map((priority) => (
                                        <SelectItem key={priority.id} value={priority.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full"
                                                     style={{backgroundColor: priority.color}}/>
                                                {priority.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Datum */}
                    <div>
                        <label className={labelCls} style={{color: labelColor}}>Fällig am *</label>
                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                               className={inputCls} style={inStyle}/>
                    </div>

                    {/* Zugewiesen + Verantwortlich (beide Pflichtfelder) */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls} style={{ color: labelColor }}>Zugewiesen an *</label>
                            <Select value={assignee || 'none'} className={selectCls} style={inStyle}
                                    onValueChange={(v) => setAssignee(v === 'none' ? '' : v)}>
                                <SelectTrigger tabIndex={6}>
                                    <SelectValue placeholder="Benutzer wählen..."/>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none" >Niemand</SelectItem>
                                    {allUsers.map((user) => (
                                        <SelectItem key={user.id} value={user.email}>
                                            {user.full_name || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className={labelCls} style={{ color: labelColor }}>Verantwortlich *</label>
                            <Select value={verantwortlich || 'none'}
                                    onValueChange={(v) => setVerantwortlich(v === 'none' ? '' : v)}
                                    className={selectCls} style={inStyle}>
                                <SelectTrigger tabIndex={7}>
                                    <SelectValue placeholder="Verantwortliche/r..."/>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Niemand</SelectItem>
                                    {allUsers.map((user) => (
                                        <SelectItem key={user.id} value={user.email}>
                                            {user.full_name || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Kunde */}
                    <div>
                        <label className={labelCls} style={{ color: labelColor }}>Kunde</label>
                        <div className="relative">
                            <Input
                                value={customerSearch}
                                onChange={(e) => {
                                    setCustomerSearch(e.target.value);
                                    setShowCustomerDropdown(true);
                                    if (!e.target.value) setCustomerId('');
                                }}
                                onFocus={() => setShowCustomerDropdown(true)}
                                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                                placeholder="Kunde suchen..." className="bg-zinc-900/60 border-zinc-700 text-zinc-200"
                                tabIndex={8} autoComplete="off" data-lpignore="true"
                            />
                            {showCustomerDropdown && (
                                <div
                                    className="absolute z-50 top-full left-0 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                    <div className="px-3 py-2 text-zinc-400 text-sm cursor-pointer hover:bg-zinc-800"
                                         onMouseDown={() => {
                                             setCustomerId('');
                                             setCustomerSearch('');
                                             setShowCustomerDropdown(false);
                                         }}>
                                        Kein Kunde
                                    </div>
                                    {customers.filter(c => c.company_name.toLowerCase().includes(customerSearch.toLowerCase())).map((c) => (
                                        <div key={c.id}
                                             className="px-3 py-2 text-zinc-200 text-sm cursor-pointer hover:bg-zinc-800"
                                             onMouseDown={() => {
                                                 setCustomerId(c.id);
                                                 setCustomerSearch(c.company_name);
                                                 setShowCustomerDropdown(false);
                                             }}>
                                            {c.company_name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tags */}
                    <div>
                        <label className={labelCls} style={{ color: labelColor }}>Tags</label>
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                                {tags.map((tag) => (
                                    <Badge key={tag} variant="outline"
                                           className="bg-violet-500/10 border-violet-500/30 text-violet-300 gap-2">
                                        {tag}
                                        <button onClick={() => handleRemoveTag(tag)} className="hover:text-violet-100">
                                            <X className="h-3 w-3"/></button>
                                    </Badge>
                                ))}
                            </div>
                        )}
                        <Select value="" onValueChange={handleAddTag}>
                            <SelectTrigger className="bg-zinc-900/60 border-zinc-700 text-zinc-200" tabIndex={9}>
                                <SelectValue placeholder="Tag hinzufügen..."/>
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-700">
                                {existingTags.filter(t => !tags.includes(t.name)).map((tag) => (
                                    <SelectItem key={tag.id} value={tag.name} className="text-zinc-200">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full"
                                                 style={{backgroundColor: tag.color || '#a78bfa'}}/>
                                            {tag.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Anhänge */}
                    <div>
                        <label className={labelCls} style={{ color: labelColor }}>Anhänge</label>
                        <label
                            className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors cursor-pointer bg-zinc-900/60">
                            <Upload className="h-4 w-4 text-zinc-500"/>
                            <span
                                className="text-sm text-zinc-400">{uploading ? 'Wird hochgeladen...' : 'Dateien hochladen'}</span>
                            <input type="file" multiple onChange={handleFileUpload} disabled={uploading}
                                   className="hidden"/>
                        </label>
                        {attachments.length > 0 && (
                            <div className="space-y-1">
                                {attachments.map((url, index) => {
                                    const filename = decodeURIComponent(url.split('/').pop().replace(/^\d+_/, ''));
                                    return (
                                        <div key={index}
                                             className="flex items-center justify-between p-2 bg-zinc-900/60 rounded-lg border border-zinc-800">
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <Paperclip className="h-3 w-3 text-zinc-500 flex-shrink-0"/>
                                                <span className="text-xs text-zinc-300 truncate">{filename}</span>
                                            </div>
                                            <button onClick={() => handleRemoveAttachment(index)}
                                                    className="text-zinc-500 hover:text-red-400 flex-shrink-0">
                                                <X className="h-3 w-3"/>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Footer ── */}
                <DialogFooter className="px-5 py-3 border-t flex items-center justify-end gap-2"
                              style={{borderColor: dialogBorder, backgroundColor: headerBg}}>
                    <button onClick={onClose}
                            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80"
                            style={{color: mutedColor}} tabIndex={10}>
                        Abbrechen
                    </button>
                    <button onClick={handleAdd}
                            disabled={!title.trim() || !columnId || !assignee || !verantwortlich}
                            className="px-4 py-1.5 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-40"
                            tabIndex={11}
                            style={{backgroundColor: accentBg}}>
                        Erstellen
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
