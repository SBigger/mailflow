import React, { useState, useEffect, useContext, useRef } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight, Paperclip, Download } from "lucide-react";
import { ThemeContext } from "@/Layout";
import { supabase, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";

// Parse notes: handle raw JSON string, array, or legacy plain string
function parseNotes(rawNotes) {
  if (!rawNotes) return [];
  if (Array.isArray(rawNotes)) return rawNotes;
  if (typeof rawNotes === "string") {
    const trimmed = rawNotes.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        return [{ text: String(parsed), date: new Date().toISOString() }];
      } catch {
        // not valid JSON – fall through
      }
    }
    return [{ text: rawNotes, date: new Date().toISOString() }];
  }
  return [];
}

// Strip HTML tags for plain-text preview
function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

const QUILL_MODULES = {
  toolbar: [
    ["bold", "italic", "underline"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["clean"],
  ],
  clipboard: {
    matchVisual: false, // Formatierung (Fett, Kursiv etc.) beim Einfuegen beibehalten
  },
};

const QUILL_FORMATS = ["bold", "italic", "underline", "color", "background", "list", "bullet"];

export default function CustomerNotesTab({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
    staleTime: 300000,
  });

  const [notes, setNotes] = useState(parseNotes(customer.notes));
  const [newText, setNewText] = useState("");
  const [newFiles, setNewFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState("");
  const [editFiles, setEditFiles] = useState([]);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});

  const fileInputRef = useRef(null);
  const editFileInputRef = useRef(null);

  useEffect(() => {
    setNotes(parseNotes(customer.notes));
    setExpandedIdx(null);
    setEditingIdx(null);
  }, [customer.id]);

  // Generate signed URLs for all attachments (1h validity)
  useEffect(() => {
    const allPaths = notes.flatMap((n) => (n.attachments || []).map((a) => a.path));
    const missing = allPaths.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (path) => {
        const { data } = await supabase.storage
          .from("note-attachments")
          .createSignedUrl(path, 3600);
        return [path, data?.signedUrl];
      })
    ).then((entries) => {
      const newMap = {};
      entries.forEach(([path, url]) => {
        if (url) newMap[path] = url;
      });
      setSignedUrls((prev) => ({ ...prev, ...newMap }));
    });
  }, [notes]);

  const uploadFiles = async (files, customerId) => {
    const uploaded = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${customerId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage
        .from("note-attachments")
        .upload(path, file, { upsert: false });
      if (!error) uploaded.push({ name: file.name, path });
    }
    return uploaded;
  };

  const saveNotes = (updated) => {
    setNotes(updated);
    onUpdate({ notes: updated });
  };

  const handleAdd = async () => {
    if (!htmlToText(newText) && newFiles.length === 0) return;
    setUploading(true);
    try {
      const attachments = await uploadFiles(newFiles, customer.id);
      const note = {
        text: newText,
        date: new Date().toISOString(),
        author: currentUser?.email || currentUser?.full_name || "",
        attachments,
      };
      saveNotes([note, ...notes]);
      setNewText("");
      setNewFiles([]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (idx) => {
    for (const att of notes[idx].attachments || []) {
      await supabase.storage.from("note-attachments").remove([att.path]);
    }
    saveNotes(notes.filter((_, i) => i !== idx));
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const handleEditStart = (idx) => {
    setEditingIdx(idx);
    setEditText(notes[idx].text);
    setEditFiles([]);
    setExpandedIdx(idx);
  };

  const handleEditSave = async (idx) => {
    setUploading(true);
    try {
      const newAttachments = await uploadFiles(editFiles, customer.id);
      saveNotes(
        notes.map((n, i) =>
          i === idx
            ? { ...n, text: editText, attachments: [...(n.attachments || []), ...newAttachments] }
            : n
        )
      );
      setEditingIdx(null);
      setEditFiles([]);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (noteIdx, attIdx) => {
    const att = notes[noteIdx].attachments[attIdx];
    await supabase.storage.from("note-attachments").remove([att.path]);
    saveNotes(
      notes.map((n, i) =>
        i === noteIdx
          ? { ...n, attachments: n.attachments.filter((_, ai) => ai !== attIdx) }
          : n
      )
    );
  };

  const cardBorder = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#e5e7eb";
  const textColor = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#1f2937";
  const mutedColor = isArtis ? "#8aaa8f" : isLight ? "#9090b8" : "#6b7280";
  const canAdd = htmlToText(newText).length > 0 || newFiles.length > 0;

  return (
    <div className="space-y-3 flex flex-col">
      {/* ── New note input ── */}
      <div className="rounded-lg border p-3 space-y-2 bg-white" style={{ borderColor: cardBorder }}>
        <ReactQuill
          value={newText}
          onChange={setNewText}
          modules={QUILL_MODULES}
          formats={QUILL_FORMATS}
          placeholder="Neue Notiz eingeben..."
          theme="snow"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors hover:bg-gray-50"
            style={{ borderColor: cardBorder, color: mutedColor }}
          >
            <Paperclip className="h-3.5 w-3.5" /> Anhang
          </button>
          {newFiles.map((f, i) => (
            <span
              key={i}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200"
            >
              {f.name}
              <button onClick={() => setNewFiles((prev) => prev.filter((_, fi) => fi !== i))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setNewFiles((prev) => [...prev, ...Array.from(e.target.files)])}
          />
          <Button
            onClick={handleAdd}
            disabled={!canAdd || uploading}
            size="sm"
            className="ml-auto bg-violet-600 hover:bg-violet-500 text-white gap-1"
          >
            <Plus className="h-4 w-4" />
            {uploading ? "Speichern…" : "Notiz hinzufügen"}
          </Button>
        </div>
      </div>

      {/* ── Notes list ── */}
      <div className="space-y-2">
        {notes.map((note, idx) => {
          const plainText = htmlToText(note.text);
          const title = plainText.slice(0, 70) + (plainText.length > 70 ? "…" : "");
          const dateStr = note.date
            ? format(new Date(note.date), "dd.MM.yyyy HH:mm", { locale: de })
            : "";
          const isExpanded = expandedIdx === idx;
          const attCount = (note.attachments || []).length;

          return (
            <div
              key={idx}
              className="rounded-lg border overflow-hidden bg-white"
              style={{ borderColor: cardBorder }}
            >
              {/* Header */}
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" style={{ color: mutedColor }} />
                ) : (
                  <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: mutedColor }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: textColor }}>
                    {title || "(Leere Notiz)"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: mutedColor }}>
                    {dateStr}
                    {note.author ? ` · ${note.author}` : ""}
                    {attCount > 0 ? ` · ${attCount} Anhang${attCount > 1 ? "hänge" : ""}` : ""}
                  </p>
                </div>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t" style={{ borderColor: cardBorder }}>
                  {editingIdx === idx ? (
                    /* Edit mode */
                    <div className="space-y-2 pt-2">
                      <ReactQuill
                        value={editText}
                        onChange={setEditText}
                        modules={QUILL_MODULES}
                        formats={QUILL_FORMATS}
                        theme="snow"
                      />
                      {/* Existing attachments */}
                      {(note.attachments || []).map((att, ai) => (
                        <div
                          key={ai}
                          className="flex items-center gap-2 text-xs"
                          style={{ color: mutedColor }}
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate">{att.name}</span>
                          <button
                            onClick={() => handleDeleteAttachment(idx, ai)}
                            className="text-red-400 hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {/* New attachments in edit */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => editFileInputRef.current?.click()}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors hover:bg-gray-50"
                          style={{ borderColor: cardBorder, color: mutedColor }}
                        >
                          <Paperclip className="h-3.5 w-3.5" /> Anhang hinzufügen
                        </button>
                        {editFiles.map((f, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200"
                          >
                            {f.name}
                            <button
                              onClick={() =>
                                setEditFiles((prev) => prev.filter((_, fi) => fi !== i))
                              }
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          ref={editFileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) =>
                            setEditFiles((prev) => [...prev, ...Array.from(e.target.files)])
                          }
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingIdx(null);
                            setEditFiles([]);
                          }}
                          className="text-gray-400 h-7 px-2"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleEditSave(idx)}
                          disabled={uploading}
                          className="bg-violet-600 hover:bg-violet-500 text-white h-7 px-2"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="pt-2 space-y-2">
                      <div
                        className="text-sm prose prose-sm max-w-none"
                        style={{ color: textColor }}
                        dangerouslySetInnerHTML={{ __html: note.text }}
                      />
                      {attCount > 0 && (
                        <div
                          className="space-y-1 pt-1 border-t"
                          style={{ borderColor: cardBorder }}
                        >
                          {note.attachments.map((att, ai) => (
                            <a
                              key={ai}
                              href={signedUrls[att.path] || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs hover:text-violet-600 transition-colors"
                              style={{ color: mutedColor }}
                            >
                              <Paperclip className="h-3 w-3 shrink-0" />
                              <span className="flex-1 truncate">{att.name}</span>
                              <Download className="h-3 w-3 shrink-0" />
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          onClick={() => handleEditStart(idx)}
                          className="text-gray-400 hover:text-violet-500"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(idx)}
                          className="text-gray-400 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {notes.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-4">Noch keine Notizen vorhanden.</p>
        )}
      </div>
    </div>
  );
}
