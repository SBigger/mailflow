import React, { useState, useContext, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, functions, supabase } from "@/api/supabaseClient";
import { personStyle } from "@/lib/chartisTheme";
import { ThemeContext } from "@/Layout";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  X, Send, Mail, Lock, MessageSquare, FileText, Loader2, Type, AlertTriangle, Users, Paperclip, UserPlus,
  Pencil, Trash2, SmilePlus, Check,
} from "lucide-react";
import { toast } from "sonner";

// Schnell-Reaktionen (bewusst kleine, arbeitsplatz-taugliche Auswahl)
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "✅", "🙏"];

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
  const [showInvite, setShowInvite] = useState(false);
  const [extEmail, setExtEmail] = useState("");
  const [extName, setExtName] = useState("");
  const [invBusy, setInvBusy] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // userId -> {name, at}
  const [editingId, setEditingId] = useState(null);   // Nachricht wird gerade bearbeitet
  const [editText, setEditText] = useState("");
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const channelRef = useRef(null);
  const lastTypingSent = useRef(0);
  const showEmail = !directMode;

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontPx)); }, [fontPx]);

  const { data: users = [] } = useQuery({
    queryKey: ["chartisUsers"], staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("chartis_list_staff");
      if (!error && data) return data;
      return entities.User.list("full_name");
    },
  });
  const { data: me } = useQuery({
    queryKey: ["chartisMe"], staleTime: 300000,
    queryFn: async () => (await supabase.auth.getUser()).data.user,
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

  const { data: externals = [] } = useQuery({
    queryKey: ["chartisExternals", thread?.id],
    enabled: !!thread?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_thread_externals").select("email, name").eq("thread_id", thread.id).order("added_at");
      if (error) return []; // Tabelle ggf. noch nicht migriert -> Feature still aus
      return data || [];
    },
  });
  const hasExternals = externals.length > 0;

  // Emoji-Reaktionen aller Nachrichten des Fadens (live via Realtime unten)
  const { data: reactions = [] } = useQuery({
    queryKey: ["chartisReactions", thread?.id],
    enabled: !!thread?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_reactions")
        .select("message_id, user_id, emoji").eq("thread_id", thread.id);
      if (error) return []; // Tabelle ggf. noch nicht migriert -> Feature still aus
      return data || [];
    },
  });

  // Lesebestätigung: Read-State aller Teilnehmer des Fadens (braucht RLS-Policy chartis_read_state_thread)
  const { data: threadReads = [] } = useQuery({
    queryKey: ["chartisThreadReads", thread?.id],
    enabled: !!thread?.id,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_read_state").select("user_id, last_read_at").eq("thread_id", thread.id);
      if (error) return [];
      return data || [];
    },
  });

  const addExternal = async () => {
    const email = extEmail.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast.error("Bitte gültige E-Mail eingeben"); return; }
    if (!thread?.id) return;
    setInvBusy(true);
    try {
      const { error } = await supabase.from("chartis_thread_externals")
        .insert({ thread_id: thread.id, email, name: extName.trim() || null, added_by: me?.id });
      if (error) throw error;
      setExtEmail(""); setExtName("");
      qc.invalidateQueries({ queryKey: ["chartisExternals", thread.id] });
      toast.success(EMAIL_ENABLED ? "Extern eingeladen" : "Extern hinzugefügt (E-Mail-Weg noch nicht aktiv)");
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); }
    finally { setInvBusy(false); }
  };
  const removeExternal = async (email) => {
    if (!thread?.id) return;
    try {
      await supabase.from("chartis_thread_externals").delete().eq("thread_id", thread.id).eq("email", email);
      qc.invalidateQueries({ queryKey: ["chartisExternals", thread.id] });
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); }
  };

  useEffect(() => {
    if (!thread?.id) return;
    const ch = supabase.channel(`chartis-${thread.id}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "chartis_messages", filter: `thread_id=eq.${thread.id}` },
        () => { qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] }); qc.invalidateQueries({ queryKey: ["chartisThreadReads", thread.id] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "chartis_reactions", filter: `thread_id=eq.${thread.id}` },
        () => qc.invalidateQueries({ queryKey: ["chartisReactions", thread.id] }))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload?.userId) return;
        setTypingUsers(prev => ({ ...prev, [payload.userId]: { name: payload.name, at: Date.now() } }));
      })
      .subscribe();
    channelRef.current = ch;
    return () => { channelRef.current = null; supabase.removeChannel(ch); };
  }, [thread?.id]);

  // Abgelaufene Tipp-Anzeigen (>4s ohne neues Signal) wegräumen
  useEffect(() => {
    const iv = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now(); let changed = false; const next = {};
        for (const [id, v] of Object.entries(prev)) { if (now - v.at < 4000) next[id] = v; else changed = true; }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  const broadcastTyping = () => {
    const now = Date.now();
    if (now - lastTypingSent.current < 1800 || !channelRef.current || !me) return; // gedrosselt
    lastTypingSent.current = now;
    channelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: me.id, name: me.user_metadata?.full_name || me.email || "Jemand" } });
  };
  const typingLabel = (() => {
    const names = Object.entries(typingUsers).filter(([id]) => id !== me?.id).map(([, v]) => (v.name || "Jemand").split(" ")[0]);
    if (!names.length) return null;
    if (names.length === 1) return `${names[0]} tippt…`;
    if (names.length === 2) return `${names[0]} und ${names[1]} tippen…`;
    return `${names.length} tippen…`;
  })();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // Faden beim Öffnen (und bei neuer Nachricht während offen) als gelesen markieren
  useEffect(() => {
    if (!thread?.id) return;
    supabase.rpc("chartis_mark_thread_read", { p_thread: thread.id })
      .then(() => qc.invalidateQueries({ queryKey: ["chartisReadState"] }))
      .catch(() => { /* read_state ist unkritisch / Migration ggf. noch nicht angewendet */ });
  }, [thread?.id, messages.length]);

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
    if (!finalBody || !thread?.id || sending) return; // harte Doppelsende-Sperre
    setSending(true);
    const savedText = text, savedPending = pending;
    const mkey = ["chartisMessages", thread.id];
    try {
      if (mode === "email") {
        await functions.invoke("chartis-send", { thread_id: thread.id, body: markdownToEmailHtml(finalBody) });
        toast.success("E-Mail an Kunde gesendet");
        setText(""); setPending([]);
        qc.invalidateQueries({ queryKey: mkey });
        return;
      }
      // ── Interne Nachricht: SOFORT optimistisch anzeigen + Feld leeren ──────
      let uid = me?.id;
      const tmp = { id: `tmp-${Date.now()}`, thread_id: thread.id, kind: "intern", body_text: finalBody,
        created_by: uid, created_at: new Date().toISOString(), _optimistic: true };
      qc.setQueryData(mkey, (old) => Array.isArray(old) ? [...old, tmp] : [tmp]);
      setText(""); setPending([]);

      if (!uid) { const { data: { user } } = await supabase.auth.getUser(); uid = user?.id; }
      const { data: msg, error } = await supabase.from("chartis_messages")
        .insert({ thread_id: thread.id, mandant_id: thread.mandant_id, kind: "intern", body_text: finalBody, created_by: uid })
        .select("id").single();
      if (error) throw error;

      const toks = [...finalBody.matchAll(/@([A-Za-zÀ-ÿ]+)/g)].map(m => m[1].toLowerCase());
      if (toks.length) {
        const hit = users.filter(u => {
          const fn = (u.full_name || "").toLowerCase();
          return u.id !== uid && toks.some(t => fn.split(" ")[0] === t || fn.startsWith(t) || (u.email || "").toLowerCase().startsWith(t));
        });
        if (hit.length) await supabase.from("chartis_mentions").insert(hit.map(u => ({ message_id: msg.id, thread_id: thread.id, user_id: u.id })));
      }
      if (hasExternals && EMAIL_ENABLED) {
        try { const { data: fo } = await functions.invoke("chartis-fanout", { thread_id: thread.id, body: markdownToEmailHtml(finalBody) }); if (fo?.sent) toast.success(`An ${fo.sent} Externe gemailt`); }
        catch { toast.error("E-Mail an Externe fehlgeschlagen"); }
      }
      qc.invalidateQueries({ queryKey: mkey });
    } catch (e) {
      toast.error("Fehler: " + (e?.message || e));
      qc.setQueryData(mkey, (old) => Array.isArray(old) ? old.filter(m => !m._optimistic) : old);
      setText(savedText); setPending(savedPending);
    } finally { setSending(false); }
  };

  // ── Bearbeiten / Löschen (soft) / Reagieren ────────────────────────────────
  const startEdit = (msg) => { setEditingId(msg.id); setEditText(msg.body_text || ""); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); };
  const saveEdit = async (msg) => {
    const body = editText.trim();
    if (!body) { toast.error("Leere Nachricht — zum Löschen bitte den Papierkorb nutzen"); return; }
    if (body === (msg.body_text || "")) { cancelEdit(); return; }
    try {
      const { error } = await supabase.from("chartis_messages")
        .update({ body_text: body, edited_at: new Date().toISOString() }).eq("id", msg.id);
      if (error) throw error;
      cancelEdit();
      qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] });
    } catch (e) { toast.error("Bearbeiten fehlgeschlagen: " + (e?.message || e)); }
  };
  const deleteMsg = async (msg) => {
    if (!window.confirm("Diese Nachricht löschen?")) return;
    try {
      const { error } = await supabase.from("chartis_messages")
        .update({ deleted_at: new Date().toISOString() }).eq("id", msg.id);
      if (error) throw error;
      if (editingId === msg.id) cancelEdit();
      qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] });
    } catch (e) { toast.error("Löschen fehlgeschlagen: " + (e?.message || e)); }
  };
  const toggleReaction = async (msg, emoji) => {
    if (!me?.id || !thread?.id) return;
    const mineReacted = reactions.some(r => r.message_id === msg.id && r.user_id === me.id && r.emoji === emoji);
    try {
      if (mineReacted) {
        const { error } = await supabase.from("chartis_reactions").delete()
          .match({ message_id: msg.id, user_id: me.id, emoji });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chartis_reactions")
          .insert({ message_id: msg.id, thread_id: thread.id, user_id: me.id, emoji });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["chartisReactions", thread.id] });
    } catch (e) { toast.error("Reaktion fehlgeschlagen: " + (e?.message || e)); }
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
          <div className="flex items-center gap-1.5 text-sm font-bold min-w-0" style={{ color: isArtis ? "#2d6a4f" : accent }}>
            {directMode ? <Users className="h-4 w-4 flex-shrink-0" /> : <MessageSquare className="h-4 w-4 flex-shrink-0" />}
            <span className="truncate">{headTitle}</span>
            {!titleOverride && module && <span className="text-xs font-normal flex-shrink-0" style={{ color: textMuted }}>· {module}</span>}
          </div>
          {(() => {
            const isExt = (!directMode && mode === "email") || (directMode && hasExternals);
            return (
              <span className="inline-flex items-center gap-1 flex-shrink-0" style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 8,
                background: isExt ? "#fff3e6" : (isArtis ? "rgba(122,155,127,.16)" : "rgba(99,102,241,.10)"),
                color: isExt ? "#d97706" : accent }}>
                {(!directMode && mode === "email") ? <><Mail className="h-3 w-3" />Extern · an Kunde</>
                  : (directMode && hasExternals) ? <><Mail className="h-3 w-3" />Geteilt · Extern</>
                  : <><Lock className="h-3 w-3" />Intern</>}
              </span>
            );
          })()}
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

        {directMode && (
          <div className="mt-2.5">
            {hasExternals && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {externals.map(ex => (
                  <span key={ex.email} className="inline-flex items-center gap-1" title={ex.email}
                    style={{ fontSize: 11, padding: "2px 4px 2px 7px", borderRadius: 8, background: "#fff3e6", color: "#b45309", border: "1px solid #f0b76a" }}>
                    <Mail className="h-3 w-3" /> {ex.name || ex.email}
                    <button onClick={() => removeExternal(ex.email)} title="Entfernen"
                      style={{ width: 15, height: 15, borderRadius: 99, border: "none", background: "transparent", color: "#b45309", cursor: "pointer", fontSize: 13, lineHeight: "15px", padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            {showInvite ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input value={extEmail} onChange={e => setExtEmail(e.target.value)} placeholder="E-Mail" type="email"
                  onKeyDown={e => { if (e.key === "Enter") addExternal(); }}
                  className="rounded-md border px-2 py-1 outline-none" style={{ background: inputBg, borderColor: border, color: textMain, fontSize: 12, minWidth: 150 }} />
                <input value={extName} onChange={e => setExtName(e.target.value)} placeholder="Name (optional)"
                  onKeyDown={e => { if (e.key === "Enter") addExternal(); }}
                  className="rounded-md border px-2 py-1 outline-none" style={{ background: inputBg, borderColor: border, color: textMain, fontSize: 12, minWidth: 120 }} />
                <button onClick={addExternal} disabled={invBusy}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium" style={{ background: accent, color: "#fff", opacity: invBusy ? 0.6 : 1 }}>
                  {invBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Einladen
                </button>
                <button onClick={() => { setShowInvite(false); setExtEmail(""); setExtName(""); }} className="p-1 rounded" style={{ color: textMuted }}><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-1" style={{ fontSize: 11, color: accent, fontWeight: 500 }}>
                <UserPlus className="h-3.5 w-3.5" /> Extern einladen
              </button>
            )}
            {hasExternals && (
              <div className="flex items-start gap-1.5 mt-2" style={{ fontSize: 10, color: "#b45309", background: "#fff7ed", border: "1px solid #fde0c0", borderRadius: 7, padding: "5px 8px" }}>
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> Geteilte Unterhaltung — deine Nachrichten gehen auch per E-Mail an die Externen{EMAIL_ENABLED ? "" : " (sobald der Mailweg aktiv ist)"}.
              </div>
            )}
          </div>
        )}
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
            const mine = !isIncoming && me?.id && msg.created_by === me.id;
            const deleted = !!msg.deleted_at;
            const customerTone = { bg: isArtis ? "#e6ede6" : isLight ? "#ebebf4" : "rgba(63,63,70,0.4)", text: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7" };
            const tone = isIncoming ? customerTone : mine ? { bg: accent, text: "#fff" } : personStyle(sender);
            const agg = Object.values(reactions.filter(r => r.message_id === msg.id).reduce((a, r) => {
              (a[r.emoji] ||= { emoji: r.emoji, count: 0, mine: false }); a[r.emoji].count++;
              if (r.user_id === me?.id) a[r.emoji].mine = true; return a;
            }, {}));
            return (
              <ChartisBubble key={msg.id} msg={msg} text={msg.body_text} kind={msg.kind} side={mine ? "right" : "left"}
                senderLabel={isIncoming ? (msg.from_addr || "Kunde") : (sender?.full_name || sender?.email || "Mitarbeiter")}
                showLabel={!mine} tone={tone} time={msg.created_at} theme={theme} fontPx={fontPx}
                deleted={deleted} edited={!!msg.edited_at} canModify={mine && msg.kind === "intern" && !deleted}
                reactions={agg} onToggleReaction={toggleReaction} quickEmojis={QUICK_EMOJIS}
                editing={editingId === msg.id} editText={editText} setEditText={setEditText}
                onStartEdit={startEdit} onSaveEdit={saveEdit} onCancelEdit={cancelEdit} onDelete={deleteMsg}
                inputBg={inputBg} border={border} accent={accent} />
            );
          })
        )}
        {(() => {
          const myLast = [...messages].reverse().find(m => m.kind !== "email_in" && me?.id && m.created_by === me.id);
          if (!myLast) return null;
          const readers = threadReads
            .filter(r => r.user_id !== me?.id && r.last_read_at && new Date(r.last_read_at) >= new Date(myLast.created_at))
            .map(r => { const u = users.find(x => x.id === r.user_id); return (u?.full_name || u?.email || "").split(" ")[0]; })
            .filter(Boolean);
          if (!readers.length) return null;
          const label = readers.length <= 3 ? `Gelesen von ${readers.join(", ")}` : `Gelesen von ${readers.length}`;
          return <div className="flex justify-end"><span style={{ fontSize: 10, color: textMuted }}>✓✓ {label}</span></div>;
        })()}
        {typingLabel && (
          <div className="flex justify-start"><span style={{ fontSize: 11, color: textMuted, fontStyle: "italic" }}>{typingLabel}</span></div>
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
          value={text} onChange={e => { setText(e.target.value); broadcastTyping(); }} onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => e.preventDefault()}
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

function ChartisBubble({ msg, text, kind, side, senderLabel, showLabel = true, tone, time, theme, fontPx,
  deleted = false, edited = false, canModify = false, reactions = [], onToggleReaction, quickEmojis = [],
  editing = false, editText = "", setEditText, onStartEdit, onSaveEdit, onCancelEdit, onDelete,
  inputBg = "#fff", border = "#ddd", accent = "#6366f1" }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isLeft = side === "left";
  const [showPicker, setShowPicker] = useState(false);
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const timeStr = time ? format(new Date(time), "dd.MM. HH:mm", { locale: de }) : "";

  const pill = (children, onClick, title) => (
    <button type="button" title={title} onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
        borderRadius: 7, border: `1px solid ${border}`, background: inputBg, color: textMuted, cursor: "pointer" }}>
      {children}
    </button>
  );

  return (
    <div className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[85%] group relative">
        <div className={`mb-1 ${isLeft ? "" : "text-right"}`} style={{ color: textMuted, fontSize: Math.max(10, fontPx - 2) }}>
          {kind === "email_in" && <Mail className="inline h-3 w-3 mr-0.5" />}
          {kind === "email_out" && <Mail className="inline h-3 w-3 mr-0.5" />}
          {kind === "intern" && <Lock className="inline h-3 w-3 mr-0.5" />}
          {showLabel ? `${senderLabel}${timeStr ? " · " : ""}${timeStr}` : timeStr}
          {edited && !deleted && <span style={{ marginLeft: 5, fontStyle: "italic" }}>· bearbeitet</span>}
        </div>

        {deleted ? (
          <div className="px-3.5 py-2.5" style={{ border: `1px dashed ${border}`, color: textMuted, fontStyle: "italic",
            borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px", fontSize: `${fontPx}px` }}>
            <Trash2 className="inline h-3.5 w-3.5 mr-1" /> Nachricht gelöscht
          </div>
        ) : editing ? (
          <div>
            <textarea autoFocus value={editText} onChange={e => setEditText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSaveEdit(msg); if (e.key === "Escape") onCancelEdit(); }}
              className="w-full rounded-lg border p-2 resize-none outline-none"
              style={{ background: inputBg, borderColor: accent, color: isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7", minHeight: 60, fontSize: `${fontPx}px` }} />
            <div className="flex items-center gap-2 mt-1" style={{ justifyContent: isLeft ? "flex-start" : "flex-end" }}>
              <button type="button" onClick={onCancelEdit} className="px-2.5 py-1 rounded-md text-xs" style={{ color: textMuted, border: `1px solid ${border}` }}>Abbrechen</button>
              <button type="button" onClick={() => onSaveEdit(msg)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium" style={{ background: accent, color: "#fff" }}><Check className="h-3.5 w-3.5" /> Speichern</button>
            </div>
            <div style={{ fontSize: 10, color: textMuted, marginTop: 2, textAlign: isLeft ? "left" : "right" }}>Strg+Enter speichern · Esc abbrechen</div>
          </div>
        ) : (
          <div className="px-3.5 py-2.5 whitespace-pre-wrap break-words"
            style={{ backgroundColor: tone.bg, color: tone.text, fontSize: `${fontPx}px`, borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px" }}>
            {renderBubbleContent(text)}
          </div>
        )}

        {!deleted && reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isLeft ? "" : "justify-end"}`}>
            {reactions.map(r => (
              <button key={r.emoji} type="button" onClick={() => onToggleReaction(msg, r.emoji)} title={r.mine ? "Reaktion entfernen" : "Auch reagieren"}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 7px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${r.mine ? accent : border}`, background: r.mine ? (isArtis ? "rgba(122,155,127,.16)" : "rgba(99,102,241,.12)") : inputBg,
                  color: r.mine ? accent : textMuted, fontSize: Math.max(11, fontPx - 1) }}>
                <span>{r.emoji}</span><span style={{ fontWeight: 500 }}>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {!deleted && !editing && (
          <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-10"
            style={{ top: 14, [isLeft ? "right" : "left"]: -6, transform: isLeft ? "translateX(100%)" : "translateX(-100%)" }}
            onMouseLeave={() => setShowPicker(false)}>
            <div style={{ position: "relative" }}>
              {pill(<SmilePlus className="h-3.5 w-3.5" />, () => setShowPicker(s => !s), "Reagieren")}
              {showPicker && (
                <div style={{ position: "absolute", bottom: "calc(100% + 4px)", [isLeft ? "left" : "right"]: 0, display: "flex", gap: 2, padding: 4,
                  background: inputBg, border: `1px solid ${border}`, borderRadius: 10, boxShadow: "0 4px 14px rgba(0,0,0,.12)", zIndex: 20 }}>
                  {quickEmojis.map(e => (
                    <button key={e} type="button" onClick={() => { onToggleReaction(msg, e); setShowPicker(false); }}
                      style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 3px", borderRadius: 6 }}>{e}</button>
                  ))}
                </div>
              )}
            </div>
            {canModify && pill(<Pencil className="h-3.5 w-3.5" />, () => onStartEdit(msg), "Bearbeiten")}
            {canModify && pill(<Trash2 className="h-3.5 w-3.5" />, () => onDelete(msg), "Löschen")}
          </div>
        )}
      </div>
    </div>
  );
}
