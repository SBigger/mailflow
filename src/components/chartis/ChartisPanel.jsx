import React, { useState, useContext, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, functions, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  X, Send, Mail, Lock, MessageSquare, FileText, Loader2, Type, AlertTriangle, Users, Paperclip,
} from "lucide-react";
import { toast } from "sonner";

// ──────────────────────────────────────────────────────────────────────────
// CHARTIS – Chat-Panel (Objekt ODER Direkt/Gruppe), mit Anhängen
//   Objekt:        module + recordId (+ subject, docInfo, extContactEmail)
//   Direkt/Gruppe: threadId + titleOverride + directMode
// Anhänge (Screenshots via Strg+V, Drag&Drop, Datei-Button) -> Bucket
// "ticket-attachments", als Markdown im body_text gespeichert & in der Bubble
// als Bild/Link gerendert.
// ──────────────────────────────────────────────────────────────────────────

const EMAIL_ENABLED = !!(typeof window !== "undefined" && window.env?.CHARTIS_DOMAIN);
const FONT_KEY = "chartis_font_px";
const ATTACH_BUCKET = "ticket-attachments";

function detectAuthor(user) {
  const email = (user?.email || "").toLowerCase();
  const name = (user?.full_name || "").toLowerCase();
  if (email.includes("claude") || name === "claude") return "claude";
  if (email.includes("roger") || name.startsWith("roger")) return "roger";
  if (email.includes("sascha") || name.startsWith("sascha")) return "sascha";
  return "staff";
}

async function uploadAttachment(file, threadId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = (file.name || `bild-${stamp}.png`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `chartis/${threadId || "neu"}/${stamp}-${safe}`;
  const { error } = await supabase.storage.from(ATTACH_BUCKET)
    .upload(path, file, { cacheControl: "3600", contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  return { url: publicUrl, mime: file.type, filename: file.name || safe };
}

function attachmentMarkdown(att) {
  return (att.mime || "").startsWith("image/")
    ? `![${att.filename || "Bild"}](${att.url})`
    : `[${att.filename || "Datei"}](${att.url})`;
}

// body-Markdown -> HTML (nur für E-Mail-Versand, damit Bilder ankommen)
function markdownToEmailHtml(text) {
  let html = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a || "Bild"}" style="max-width:100%;border-radius:8px;" />`);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  return html.replace(/\n/g, "<br>");
}

export default function ChartisPanel({
  module, recordId, subject, docInfo, extContactEmail,
  threadId, titleOverride, directMode = false, embedded = false, onClose,
}) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [mode, setMode] = useState("intern");
  const [sending, setSending] = useState(false);
  const [fontPx, setFontPx] = useState(() => Number(localStorage.getItem(FONT_KEY)) || 13);
  const [pending, setPending] = useState([]); // {url, mime, filename}
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const showEmail = !directMode;

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontPx)); }, [fontPx]);

  const { data: users = [] } = useQuery({
    queryKey: ["chartisUsers"], queryFn: () => entities.User.list("full_name"), staleTime: 300000,
  });

  const { data: thread, isLoading: threadLoading, error: threadError } = useQuery({
    queryKey: ["chartisThread", threadId || `${module}:${recordId}`],
    enabled: !!(threadId || (module && recordId)),
    queryFn: async () => {
      if (threadId) {
        const { data, error } = await supabase.from("chartis_threads").select("*").eq("id", threadId).maybeSingle();
        if (error) throw error;
        return data;
      }
      const { data: existing, error: selErr } = await supabase
        .from("chartis_threads").select("*").eq("module", module).eq("record_id", recordId).maybeSingle();
      if (selErr) throw selErr;
      if (existing) return existing;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: created, error: insErr } = await supabase.from("chartis_threads")
        .insert({ module, record_id: recordId, thread_type: "objekt", subject: subject || "Chartis",
          ext_contact_email: extContactEmail || null, owner_id: user?.id, created_by: user?.id })
        .select("*").single();
      if (insErr) throw insErr;
      return created;
    },
  });

  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["chartisMessages", thread?.id],
    enabled: !!thread?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_messages").select("*")
        .eq("thread_id", thread.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!thread?.id) return;
    const ch = supabase.channel(`chartis-${thread.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chartis_messages", filter: `thread_id=eq.${thread.id}` },
        () => qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] }))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [thread?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // ── Anhänge ───────────────────────────────────────────────────────────────
  const handleFiles = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        try { const att = await uploadAttachment(f, thread?.id); setPending(p => [...p, att]); }
        catch (e) { toast.error(`Upload "${f.name}" fehlgeschlagen: ${e.message}`); }
      }
    } finally { setUploading(false); }
  };
  const handlePaste = async (e) => {
    const imgs = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file").map(i => i.getAsFile()).filter(Boolean);
    if (!imgs.length) return; // normales Text-Paste
    e.preventDefault();
    await handleFiles(imgs);
  };
  const handleDrop = async (e) => { e.preventDefault(); await handleFiles([...(e.dataTransfer?.files || [])]); };

  // ── Senden ────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const finalBody = [text.trim(), ...pending.map(attachmentMarkdown)].filter(Boolean).join("\n\n");
    if (!finalBody || !thread?.id) return;
    setSending(true);
    try {
      if (mode === "email") {
        await functions.invoke("chartis-send", { thread_id: thread.id, body: markdownToEmailHtml(finalBody) });
        toast.success("E-Mail an Kunde gesendet");
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: msg, error } = await supabase.from("chartis_messages").insert({
          thread_id: thread.id, mandant_id: thread.mandant_id, kind: "intern", body_text: finalBody, created_by: user?.id,
        }).select("id").single();
        if (error) throw error;
        const toks = [...finalBody.matchAll(/@([A-Za-zÀ-ÿ]+)/g)].map(m => m[1].toLowerCase());
        if (toks.length) {
          const hit = users.filter(u => {
            const fn = (u.full_name || "").toLowerCase();
            return u.id !== user?.id && toks.some(t => fn.split(" ")[0] === t || fn.startsWith(t) || (u.email || "").toLowerCase().startsWith(t));
          });
          if (hit.length) await supabase.from("chartis_mentions").insert(hit.map(u => ({ message_id: msg.id, thread_id: thread.id, user_id: u.id })));
        }
        toast.success("Gesendet");
      }
      setText(""); setPending([]);
      qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] });
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); }
    finally { setSending(false); }
  };

  const panelBg  = isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b";
  const headerBg = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#27272a";
  const textMain = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted= isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border   = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const inputBg  = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.8)";
  const accent   = isArtis ? "#7a9b7f" : "#6366f1";

  const tablesMissing = threadError && /relation .*chartis|does not exist|column .*thread_type/i.test(threadError.message || "");
  const headTitle = titleOverride || (thread?.thread_type === "gruppe" ? thread?.subject : "Chartis");

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: panelBg }}>
      <div className="flex-shrink-0 px-4 py-3 border-b" style={{ backgroundColor: headerBg, borderColor: border }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm font-bold min-w-0" style={{ color: accent }}>
            {directMode ? <Users className="h-4 w-4 flex-shrink-0" /> : <MessageSquare className="h-4 w-4 flex-shrink-0" />}
            <span className="truncate">{headTitle}</span>
            {!titleOverride && module && <span className="text-xs font-normal flex-shrink-0" style={{ color: textMuted }}>· {module}</span>}
          </div>
          <span className="inline-flex items-center gap-1 flex-shrink-0" style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 8,
            background: (!directMode && mode === "email") ? "#fff3e6" : (isArtis ? "rgba(122,155,127,.16)" : "rgba(99,102,241,.10)"),
            color: (!directMode && mode === "email") ? "#d97706" : accent }}>
            {(!directMode && mode === "email") ? <><Mail className="h-3 w-3" />Extern · an Kunde</> : <><Lock className="h-3 w-3" />Intern</>}
          </span>
          {!embedded && <button onClick={onClose} className="p-1 rounded hover:bg-black/10 flex-shrink-0" style={{ color: textMuted }}><X className="h-4 w-4" /></button>}
        </div>

        {docInfo?.filename && (
          <button onClick={docInfo.onOpen} className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left"
            style={{ borderColor: border, background: inputBg }} title="Dokument öffnen">
            <FileText className="h-4 w-4 flex-shrink-0" style={{ color: "#dc2626" }} />
            <span className="text-xs truncate flex-1" style={{ color: textMain }}>{docInfo.filename}</span>
            <span className="text-[10px]" style={{ color: textMuted }}>öffnen</span>
          </button>
        )}

        <div className="flex items-center gap-2 mt-2.5">
          <Type className="h-3 w-3" style={{ color: textMuted }} />
          <input type="range" min="11" max="18" step="1" value={fontPx} onChange={e => setFontPx(Number(e.target.value))}
            className="flex-1 h-1 cursor-pointer" style={{ accentColor: accent }} aria-label="Schriftgrösse" />
          <span className="text-[11px] tabular-nums" style={{ color: textMuted, minWidth: 30 }}>{fontPx}px</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ fontSize: `${fontPx}px` }}
        onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        {tablesMissing ? (
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg" style={{ color: "#92400e", background: "#fef3c7" }}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>Chartis-Tabellen/Spalten fehlen noch. Bitte die Migration(en) im Supabase-SQL-Editor ausführen.</span>
          </div>
        ) : (threadLoading || msgsLoading) ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" style={{ color: textMuted }} /></div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs py-6" style={{ color: textMuted }}>Noch keine Nachrichten. Schreib die erste.</div>
        ) : (
          messages.map(msg => {
            const sender = users.find(u => u.id === msg.created_by);
            const isIncoming = msg.kind === "email_in";
            return (
              <ChartisBubble key={msg.id} text={msg.body_text} kind={msg.kind} side={isIncoming ? "left" : "right"}
                senderLabel={isIncoming ? (msg.from_addr || "Kunde") : (sender?.full_name || sender?.email || "Mitarbeiter")}
                time={msg.created_at} author={isIncoming ? "customer" : detectAuthor(sender)} theme={theme} fontPx={fontPx} />
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t p-3" style={{ borderColor: border, backgroundColor: headerBg }}>
        {showEmail && (
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setMode("intern")} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
              style={mode === "intern" ? { backgroundColor: accent, color: "#fff", borderColor: accent } : { backgroundColor: "transparent", color: textMuted, borderColor: border }}>
              <Lock className="h-3 w-3" /> Intern
            </button>
            <button onClick={() => EMAIL_ENABLED ? setMode("email") : toast.info("E-Mail-Rückkanal aktiv, sobald Domain & Postmark stehen")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
              style={mode === "email" ? { backgroundColor: accent, color: "#fff", borderColor: accent } : { backgroundColor: "transparent", color: EMAIL_ENABLED ? textMuted : "#bbb", borderColor: border, opacity: EMAIL_ENABLED ? 1 : 0.6 }}
              title={EMAIL_ENABLED ? "E-Mail an Kunde" : "Noch nicht aktiv (Domain fehlt)"}>
              <Mail className="h-3 w-3" /> E-Mail an Kunde
            </button>
            {mode === "email" && <span className="text-[11px] truncate" style={{ color: textMuted }}>an {extContactEmail || "—"}</span>}
          </div>
        )}
        {showEmail && mode === "email" && (
          <div className="flex items-center gap-2 mb-2" style={{ fontSize: 10, color: "#b45309", background: "#fff7ed", border: "1px solid #fde0c0", borderRadius: 7, padding: "5px 8px" }}>
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> Geht raus an: {extContactEmail || "(keine Adresse hinterlegt)"} · Signatur aus Einstellungen wird angehängt
          </div>
        )}

        <textarea className="w-full rounded-lg border p-2.5 resize-none outline-none"
          style={{ backgroundColor: inputBg, borderColor: border, color: textMain, height: 80, fontSize: `${Math.max(12, fontPx)}px` }}
          placeholder={mode === "email" ? "E-Mail an den Kunden… (Bild via Strg+V)" : "Nachricht… (@Name, Bild via Strg+V oder reinziehen)"}
          value={text} onChange={e => setText(e.target.value)} onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }} />
        <input ref={fileRef} type="file" multiple style={{ display: "none" }}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          onChange={e => { handleFiles([...(e.target.files || [])]); e.target.value = ""; }} />

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {pending.map((att, i) => {
              const isImg = (att.mime || "").startsWith("image/");
              return (
                <div key={i} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, border: `1px solid ${border}`, borderRadius: 8, padding: 4, background: inputBg, maxWidth: 170 }}>
                  {isImg ? <img src={att.url} alt={att.filename} style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 4 }} />
                    : <Paperclip className="h-4 w-4" style={{ color: textMuted, flexShrink: 0 }} />}
                  <span style={{ fontSize: 11, color: textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.filename || "Anhang"}</span>
                  <button type="button" onClick={() => setPending(p => p.filter((_, x) => x !== i))} title="Entfernen"
                    style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 99, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, lineHeight: "18px", cursor: "pointer", padding: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between mt-2 gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={{ backgroundColor: "transparent", color: textMuted, borderColor: border, opacity: uploading ? 0.6 : 1 }}
            title="Screenshot oder Datei anhängen (oder Strg+V im Textfeld)">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            {uploading ? "Lädt…" : "Anhang"}
          </button>
          <button onClick={handleSend} disabled={(!text.trim() && !pending.length) || sending || tablesMissing}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: (text.trim() || pending.length) && !sending ? accent : "#a1a1aa", color: "#fff", opacity: ((!text.trim() && !pending.length) || sending || tablesMissing) ? 0.6 : 1 }}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "email" ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {mode === "email" ? "Senden + Mail" : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bubble: rendert Markdown-Bilder ![alt](url), Links [t](url) und URLs ─────
function renderBubbleContent(text) {
  if (!text) return null;
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  const parts = []; let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<a key={`a${key++}`} href={m[2]} target="_blank" rel="noopener noreferrer"><img src={m[2]} alt={m[1] || "Bild"} style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, display: "block", margin: "4px 0", cursor: "zoom-in" }} /></a>);
    else if (m[4]) parts.push(<a key={`l${key++}`} href={m[4]} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{m[3]}</a>);
    else if (m[5]) parts.push(<a key={`u${key++}`} href={m[5]} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{m[5]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ChartisBubble({ text, kind, side, senderLabel, time, author, theme, fontPx }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isLeft = side === "left";
  const palette = {
    sascha:   { bg: "#dbeafe", text: "#1e3a8a" },
    claude:   { bg: "#d1fae5", text: "#065f46" },
    roger:    { bg: "#fef3c7", text: "#78350f" },
    customer: { bg: isArtis ? "#e6ede6" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)", text: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7" },
    staff:    { bg: isArtis ? "#7a9b7f" : "#6366f1", text: "#ffffff" },
  };
  const tone = palette[author] || (isLeft ? palette.customer : palette.staff);
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  return (
    <div className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[85%]">
        <div className={`mb-1 ${isLeft ? "" : "text-right"}`} style={{ color: textMuted, fontSize: Math.max(10, fontPx - 2) }}>
          {kind === "email_in" && <Mail className="inline h-3 w-3 mr-0.5" />}
          {kind === "email_out" && <Mail className="inline h-3 w-3 mr-0.5" />}
          {kind === "intern" && <Lock className="inline h-3 w-3 mr-0.5" />}
          {senderLabel}{time && ` · ${format(new Date(time), "dd.MM. HH:mm", { locale: de })}`}
        </div>
        <div className="px-3.5 py-2.5 whitespace-pre-wrap break-words"
          style={{ backgroundColor: tone.bg, color: tone.text, fontSize: `${fontPx}px`, borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px" }}>
          {renderBubbleContent(text)}
        </div>
      </div>
    </div>
  );
}
