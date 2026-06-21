import React, { useState, useContext, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, functions, supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  X, Send, Mail, Lock, MessageSquare, FileText, Loader2, Type, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

// ──────────────────────────────────────────────────────────────────────────
// CHARTIS – kontextbezogenes Chat-Panel (an JEDEM Datensatz einbettbar)
// Props:
//   module        chartis_module ('dokument','task','frist',…)
//   recordId      PK des verknuepften Datensatzes
//   subject       Basis-Betreff (z.B. Dateiname)
//   docInfo       optional { filename, onOpen } – verlinkt das Dokument oben
//   extContactEmail optional – Kundenadresse fuer den E-Mail-Rueckkanal
//   onClose       Schliessen-Callback
// Intern = bleibt in der App. Extern = E-Mail an Kunde (gated bis Domain steht).
// ──────────────────────────────────────────────────────────────────────────

const EMAIL_ENABLED = !!(typeof window !== "undefined" && window.env?.CHARTIS_DOMAIN);
const FONT_KEY = "chartis_font_px";

function detectAuthor(user) {
  const email = (user?.email || "").toLowerCase();
  const name = (user?.full_name || "").toLowerCase();
  if (email.includes("claude") || name === "claude") return "claude";
  if (email.includes("roger") || name.startsWith("roger")) return "roger";
  if (email.includes("sascha") || name.startsWith("sascha")) return "sascha";
  return "staff";
}

export default function ChartisPanel({ module, recordId, subject, docInfo, extContactEmail, onClose }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [mode, setMode] = useState("intern"); // 'intern' | 'email'
  const [sending, setSending] = useState(false);
  const [fontPx, setFontPx] = useState(() => Number(localStorage.getItem(FONT_KEY)) || 13);
  const endRef = useRef(null);

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontPx)); }, [fontPx]);

  // ── Mitarbeiter (created_by -> Name/Farbe) ────────────────────────────────
  const { data: users = [] } = useQuery({
    queryKey: ["chartisUsers"],
    queryFn: () => entities.User.list("full_name"),
    staleTime: 5 * 60 * 1000,
  });

  // ── Faden finden-oder-anlegen ─────────────────────────────────────────────
  const { data: thread, isLoading: threadLoading, error: threadError } = useQuery({
    queryKey: ["chartisThread", module, recordId],
    enabled: !!module && !!recordId,
    queryFn: async () => {
      const { data: existing, error: selErr } = await supabase
        .from("chartis_threads").select("*")
        .eq("module", module).eq("record_id", recordId).maybeSingle();
      if (selErr) throw selErr;
      if (existing) return existing;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: created, error: insErr } = await supabase
        .from("chartis_threads")
        .insert({
          module, record_id: recordId,
          subject: subject || "Chartis",
          ext_contact_email: extContactEmail || null,
          owner_id: user?.id, created_by: user?.id,
        })
        .select("*").single();
      if (insErr) throw insErr;
      return created;
    },
  });

  // ── Nachrichten + Realtime ────────────────────────────────────────────────
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["chartisMessages", thread?.id],
    enabled: !!thread?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chartis_messages").select("*")
        .eq("thread_id", thread.id).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!thread?.id) return;
    const ch = supabase
      .channel(`chartis-${thread.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chartis_messages", filter: `thread_id=eq.${thread.id}` },
        () => qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] }))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [thread?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // ── Senden ────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const body = text.trim();
    if (!body || !thread?.id) return;
    setSending(true);
    try {
      if (mode === "email") {
        await functions.invoke("chartis-send", { thread_id: thread.id, body });
        toast.success("E-Mail an Kunde gesendet");
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from("chartis_messages").insert({
          thread_id: thread.id, mandant_id: thread.mandant_id,
          kind: "intern", body_text: body, created_by: user?.id,
        });
        if (error) throw error;
        await supabase.from("chartis_threads")
          .update({ updated_at: new Date().toISOString() }).eq("id", thread.id);
        toast.success("Interne Notiz gespeichert");
      }
      setText("");
      qc.invalidateQueries({ queryKey: ["chartisMessages", thread.id] });
    } catch (e) {
      toast.error("Fehler: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  };

  // ── Theme ───────────────────────────────────────────────────────────────
  const panelBg  = isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "#18181b";
  const headerBg = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#27272a";
  const textMain = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted= isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border   = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const inputBg  = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.8)";
  const accent   = isArtis ? "#7a9b7f" : "#6366f1";

  const tablesMissing = threadError && /relation .*chartis|does not exist/i.test(threadError.message || "");

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: panelBg }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b" style={{ backgroundColor: headerBg, borderColor: border }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: accent }}>
            <MessageSquare className="h-4 w-4" /> Chartis
            <span className="text-xs font-normal" style={{ color: textMuted }}>· {module}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10" style={{ color: textMuted }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Verlinktes Dokument */}
        {docInfo?.filename && (
          <button
            onClick={docInfo.onOpen}
            className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left"
            style={{ borderColor: border, background: inputBg }}
            title="Dokument öffnen"
          >
            <FileText className="h-4 w-4 flex-shrink-0" style={{ color: "#dc2626" }} />
            <span className="text-xs truncate flex-1" style={{ color: textMain }}>{docInfo.filename}</span>
            <span className="text-[10px]" style={{ color: textMuted }}>öffnen</span>
          </button>
        )}

        {/* Schriftgrössen-Regler (pro Mitarbeiter, lokal gespeichert) */}
        <div className="flex items-center gap-2 mt-2.5">
          <Type className="h-3 w-3" style={{ color: textMuted }} />
          <input
            type="range" min="11" max="18" step="1" value={fontPx}
            onChange={e => setFontPx(Number(e.target.value))}
            className="flex-1 h-1 cursor-pointer" style={{ accentColor: accent }}
            aria-label="Schriftgrösse"
          />
          <span className="text-[11px] tabular-nums" style={{ color: textMuted, minWidth: 30 }}>{fontPx}px</span>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ fontSize: `${fontPx}px` }}>
        {tablesMissing ? (
          <div className="flex items-start gap-2 text-xs p-3 rounded-lg" style={{ color: "#92400e", background: "#fef3c7" }}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>Chartis-Tabellen noch nicht angelegt. Migration <code>20260621120000_chartis_core.sql</code> anwenden (<code>supabase db push</code>), dann lädt der Faden.</span>
          </div>
        ) : (threadLoading || msgsLoading) ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" style={{ color: textMuted }} /></div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs py-6" style={{ color: textMuted }}>
            Noch keine Nachrichten. Starte intern mit dem Team oder schreib dem Kunden.
          </div>
        ) : (
          messages.map(msg => {
            const sender = users.find(u => u.id === msg.created_by);
            const isIncoming = msg.kind === "email_in";
            return (
              <ChartisBubble
                key={msg.id}
                text={msg.body_text}
                kind={msg.kind}
                side={isIncoming ? "left" : msg.kind === "intern" ? "right" : "right"}
                senderLabel={isIncoming ? (msg.from_addr || "Kunde") : (sender?.full_name || sender?.email || "Mitarbeiter")}
                time={msg.created_at}
                author={isIncoming ? "customer" : detectAuthor(sender)}
                theme={theme}
                fontPx={fontPx}
              />
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t p-3" style={{ borderColor: border, backgroundColor: headerBg }}>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setMode("intern")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
            style={mode === "intern"
              ? { backgroundColor: accent, color: "#fff", borderColor: accent }
              : { backgroundColor: "transparent", color: textMuted, borderColor: border }}
          >
            <Lock className="h-3 w-3" /> Intern
          </button>
          <button
            onClick={() => EMAIL_ENABLED ? setMode("email") : toast.info("E-Mail-Rückkanal aktiv, sobald Domain & Postmark stehen")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
            style={mode === "email"
              ? { backgroundColor: accent, color: "#fff", borderColor: accent }
              : { backgroundColor: "transparent", color: EMAIL_ENABLED ? textMuted : "#bbb", borderColor: border, opacity: EMAIL_ENABLED ? 1 : 0.6 }}
            title={EMAIL_ENABLED ? "E-Mail an Kunde" : "Noch nicht aktiv (Domain fehlt)"}
          >
            <Mail className="h-3 w-3" /> E-Mail an Kunde
          </button>
          {mode === "email" && (
            <span className="text-[11px] truncate" style={{ color: textMuted }}>
              an {extContactEmail || "—"}
            </span>
          )}
        </div>

        <textarea
          className="w-full rounded-lg border p-2.5 resize-none outline-none"
          style={{ backgroundColor: inputBg, borderColor: border, color: textMain, height: 84, fontSize: `${Math.max(12, fontPx)}px` }}
          placeholder={mode === "email" ? "E-Mail an den Kunden schreiben…" : "Interne Notiz fürs Team… (@Name erwähnt)"}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px]" style={{ color: textMuted }}>
            {mode === "email"
              ? "Antwort des Kunden kommt automatisch hierher zurück"
              : "Bleibt im Chartis – keine E-Mail. Ctrl+Enter zum Senden"}
          </span>
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending || tablesMissing}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: text.trim() && !sending ? accent : "#a1a1aa", color: "#fff", opacity: (!text.trim() || sending || tablesMissing) ? 0.6 : 1 }}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "email" ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {mode === "email" ? "Senden + Mail" : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bubble ──────────────────────────────────────────────────────────────────
function ChartisBubble({ text, kind, side, senderLabel, time, author, theme, fontPx }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isLeft = side === "left";

  const palette = {
    sascha:   { bg: "#dbeafe", text: "#1e3a8a", label: "Sascha" },
    claude:   { bg: "#d1fae5", text: "#065f46", label: "Claude 🤖" },
    roger:    { bg: "#fef3c7", text: "#78350f", label: "Roger" },
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
        <div
          className="px-3.5 py-2.5 whitespace-pre-wrap break-words"
          style={{
            backgroundColor: tone.bg, color: tone.text, fontSize: `${fontPx}px`,
            borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}
