import React, { useState, useContext, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { entities, supabase } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";
import { FileText, MessageSquare, Users, ImagePlus, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

// Helper: Bild/PDF in Bucket "ticket-attachments" hochladen (identisch zu TicketDetailPanel).
// Beim Erstellen existiert noch keine ticket.id -> wir legen unter einem Draft-Ordner ab;
// die eingebettete Public-URL bleibt nach dem Erstellen gueltig.
const ATTACH_BUCKET = "ticket-attachments";
async function uploadTicketAttachment(file, folder) {
  const ext = (file.name?.split(".").pop() || "png").toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = (file.name || `screenshot.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder || "no-ticket"}/${stamp}-${safeName}`;
  const { error } = await supabase.storage
    .from(ATTACH_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  return { url: publicUrl, mime: file.type, filename: file.name || safeName };
}

// Anhang -> Markdown (Bild: ![alt](url), sonst Link). Wird beim Erstellen in body gespeichert.
function attachmentMarkdown(att) {
  const isImg = (att.mime || "").startsWith("image/");
  return isImg
    ? `![${att.filename || "Screenshot"}](${att.url})`
    : `[${att.filename || "Datei"}](${att.url})`;
}

export default function AddTicketDialog({ open, onClose, defaultColumnId }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [fromEmail, setFromEmail]   = useState("");
  const [fromName, setFromName]     = useState("");
  const [title, setTitle]           = useState("");
  const [body, setBody]             = useState("");
  const [ticketType, setTicketType] = useState("regular");
  const [columnId, setColumnId]     = useState(defaultColumnId || "");
  const [customerId, setCustomerId] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [loading, setLoading]       = useState(false);
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]); // {url, mime, filename}
  const fileInputRef = useRef(null);
  // Stabiler Draft-Ordner pro Dialog-Sitzung fuer die Screenshot-Ablage
  const draftFolderRef = useRef(`draft-${(globalThis.crypto?.randomUUID?.() || Date.now())}`);

  const { data: columns = [] } = useQuery({
    queryKey: ["ticketColumns"],
    queryFn: () => entities.TicketColumn.list("order"),
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
  });

  // Aktuellen User holen fuer Auto-Fill bei internen Tickets
  const { data: me } = useQuery({
    queryKey: ["addTicketDialogMe"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      // Profil-Tabelle fuer full_name falls vorhanden
      const { data: prof } = await supabase
        .from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      return { id: user.id, email: user.email, full_name: prof?.full_name || user.email };
    },
  });

  // Bei Wechsel auf "internal" Felder automatisch fuellen
  useEffect(() => {
    if (ticketType === "internal" && me) {
      if (!fromEmail) setFromEmail(me.email);
      if (!fromName)  setFromName(me.full_name || "");
    }
  }, [ticketType, me]);

  const labelColor  = isArtis ? "#4a5e4a" : isLight ? "#4b4b80" : "#a1a1aa";
  const inputBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.6)";
  const inputBorder = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.6)";

  // ── Screenshot/Datei einfuegen (Paste, Drop, Button) ──
  // Als Thumbnail-Chip unter dem Feld zeigen, beim Erstellen an body anhaengen.
  const handleFiles = async (files) => {
    if (!files?.length) return;
    setUploadingAttach(true);
    try {
      for (const f of files) {
        try {
          const att = await uploadTicketAttachment(f, draftFolderRef.current);
          setPendingAttachments(prev => [...prev, att]);
        } catch (e) {
          toast.error(`Upload "${f.name}" fehlgeschlagen: ${e.message}`);
        }
      }
    } finally {
      setUploadingAttach(false);
    }
  };

  const removePendingAttachment = (idx) =>
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs = [];
    for (const it of items) {
      if (it.kind === "file") {
        const blob = it.getAsFile();
        if (blob) imgs.push(blob);
      }
    }
    if (imgs.length === 0) return; // normales Text-Paste
    e.preventDefault();
    await handleFiles(imgs);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    await handleFiles(files);
  };

  const handleCreate = async () => {
    if (!fromEmail.trim() || !title.trim()) return;
    setLoading(true);
    try {
      // Erste Spalte als Default wenn nichts gewählt
      const targetColumn = columnId || columns[0]?.id;
      // Beschreibung + angehaengte Screenshots/Dateien als Markdown zusammenfuehren
      const attachMd = pendingAttachments.map(attachmentMarkdown);
      const finalBody = [body.trim(), ...attachMd].filter(Boolean).join("\n\n") || null;
      await entities.Ticket.create({
        from_email: fromEmail.trim(),
        from_name: fromName.trim() || null,
        title: title.trim(),
        body: finalBody,
        ticket_type: ticketType,
        column_id: targetColumn,
        customer_id: (customerId && customerId !== "__none__") ? customerId : null,
        priority_id: priorityId || null,
        is_read: true,
      });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      handleClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFromEmail("");
    setFromName("");
    setTitle("");
    setBody("");
    setPendingAttachments([]);
    setTicketType("regular");
    setColumnId(defaultColumnId || "");
    setCustomerId("");
    setPriorityId("");
    onClose();
  };

  const LabelStyle = { fontSize: "0.75rem", fontWeight: 600, color: labelColor, marginBottom: "4px" };
  const inputStyle = { backgroundColor: inputBg, borderColor: inputBorder, fontSize: "0.875rem" };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" style={{
        backgroundColor: isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b",
      }}>
        <DialogHeader>
          <DialogTitle style={{ color: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7" }}>
            Neues Ticket erstellen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Ticket-Typ */}
          <div>
            <div style={LabelStyle}>Ticket-Typ</div>
            <div className="flex gap-2">
              <button
                onClick={() => setTicketType("regular")}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
                style={{
                  backgroundColor: ticketType === "regular"
                    ? (isArtis ? "#7a9b7f" : "#6366f1") : inputBg,
                  color: ticketType === "regular" ? "#fff" : labelColor,
                  borderColor: ticketType === "regular"
                    ? (isArtis ? "#7a9b7f" : "#6366f1") : inputBorder,
                }}
              >
                <MessageSquare className="h-4 w-4" />
                Anfrage
              </button>
              <button
                onClick={() => setTicketType("documents_only")}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
                style={{
                  backgroundColor: ticketType === "documents_only" ? "#3b82f6" : inputBg,
                  color: ticketType === "documents_only" ? "#fff" : labelColor,
                  borderColor: ticketType === "documents_only" ? "#3b82f6" : inputBorder,
                }}
              >
                <FileText className="h-4 w-4" />
                Unterlagen
              </button>
              <button
                onClick={() => setTicketType("internal")}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
                style={{
                  backgroundColor: ticketType === "internal" ? "#10b981" : inputBg,
                  color: ticketType === "internal" ? "#fff" : labelColor,
                  borderColor: ticketType === "internal" ? "#10b981" : inputBorder,
                }}
                title="Internes Dev-Thema -- Sascha/Roger/Claude. E-Mail wird automatisch gesetzt."
              >
                <Users className="h-4 w-4" />
                Intern
              </button>
            </div>
            {ticketType === "internal" && (
              <div style={{ fontSize: "0.7rem", color: labelColor, marginTop: 6 }}>
                Internes Dev-Thema -- E-Mail/Name werden automatisch mit deinem Account gefuellt.
              </div>
            )}
          </div>

          {/* Von */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={LabelStyle}>E-Mail Absender *</div>
              <Input
                placeholder="max@beispiel.ch"
                value={fromEmail}
                onChange={e => setFromEmail(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={LabelStyle}>Name</div>
              <Input
                placeholder="Max Mustermann"
                value={fromName}
                onChange={e => setFromName(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Betreff */}
          <div>
            <div style={LabelStyle}>Betreff *</div>
            <Input
              placeholder="Betreff der Anfrage"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Nachricht */}
          <div>
            <div style={LabelStyle}>Nachricht</div>
            <Textarea
              placeholder="Inhalt der Anfrage… (Screenshot via Strg+V einfügen oder reinziehen)"
              value={body}
              onChange={e => setBody(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              rows={4}
              style={inputStyle}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              multiple
              hidden
              onChange={e => { handleFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAttach}
              title="Bild oder PDF anhängen (oder Strg+V im Textfeld)"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6,
                fontSize: "0.75rem", fontWeight: 600, color: labelColor,
                background: "transparent", border: `1px solid ${inputBorder}`,
                borderRadius: 8, padding: "4px 10px",
                cursor: uploadingAttach ? "default" : "pointer",
                opacity: uploadingAttach ? 0.6 : 1,
              }}
            >
              {uploadingAttach
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <ImagePlus className="h-3.5 w-3.5" />}
              {uploadingAttach ? "Lädt…" : "Screenshot / Anhang"}
            </button>
            {pendingAttachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {pendingAttachments.map((att, i) => {
                  const isImg = (att.mime || "").startsWith("image/");
                  return (
                    <div
                      key={i}
                      style={{
                        position: "relative", display: "flex", alignItems: "center", gap: 6,
                        border: `1px solid ${inputBorder}`, borderRadius: 8, padding: 4,
                        background: inputBg, maxWidth: 180,
                      }}
                    >
                      {isImg
                        ? <img src={att.url} alt={att.filename} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />
                        : <Paperclip className="h-4 w-4" style={{ color: labelColor, flexShrink: 0 }} />}
                      <span style={{ fontSize: 11, color: labelColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {att.filename || "Anhang"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(i)}
                        title="Entfernen"
                        style={{
                          position: "absolute", top: -7, right: -7, width: 18, height: 18,
                          borderRadius: 99, border: "none", background: "#ef4444", color: "#fff",
                          fontSize: 12, lineHeight: "18px", textAlign: "center", cursor: "pointer", padding: 0,
                        }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Prioritaet */}
          <div>
            <div style={LabelStyle}>Prioritaet</div>
            <Select value={priorityId || "__none__"} onValueChange={v => setPriorityId(v === "__none__" ? "" : v)}>
              <SelectTrigger style={inputStyle}>
                <SelectValue placeholder="Keine Prioritaet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Keine —</SelectItem>
                {priorities.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: p.color, display: "inline-block" }} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Spalte + Kunde */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={LabelStyle}>Spalte</div>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger style={inputStyle}>
                  <SelectValue placeholder="Spalte wählen" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map(col => (
                    <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div style={LabelStyle}>Kunde (optional)</div>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger style={inputStyle}>
                  <SelectValue placeholder="Kunden zuordnen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Kein Kunde —</SelectItem>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_name || `${c.vorname || ""} ${c.nachname || ""}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} style={{ borderColor: inputBorder }}>
            Abbrechen
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!fromEmail.trim() || !title.trim() || loading}
            style={{
              backgroundColor: isArtis ? "#7a9b7f" : "#6366f1",
              color: "#fff",
              opacity: (!fromEmail.trim() || !title.trim() || loading) ? 0.5 : 1,
            }}
          >
            {loading ? "Erstelle…" : "Ticket erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
