import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, auth } from "@/api/supabaseClient";
import { isMissed } from "@/lib/chartisTheme";

// ── useInboxSummary ────────────────────────────────────────────────
// Bündelt alle Posteingang-Quellen für die schwebende Paperboy-FAB.
// Nutzt bewusst DIESELBEN queryKeys wie Chartis.jsx, damit React-Query
// den Cache teilt und nichts doppelt geladen wird.
const BUCKET = "posteingang";

export function useInboxSummary() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => auth.me(), staleTime: 300000 });

  // Mails (ungelesen) — geteilt mit Chartis ["chartisMails"]
  const { data: mailItems = [] } = useQuery({
    queryKey: ["chartisMails", me?.id], enabled: !!me?.id, refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase.from("mail_items")
        .select("id,subject,sender_name,sender_email,received_date,created_at,is_read,has_attachments,customer_id")
        .eq("created_by", me.id).order("received_date", { ascending: false }).limit(200);
      return data || [];
    },
  });

  // Offene Aufgaben — geteilt mit Chartis ["chartisTasks"]
  const { data: tasks = [] } = useQuery({
    queryKey: ["chartisTasks", me?.id], enabled: !!me?.id, refetchInterval: 30000,
    queryFn: async () => {
      const ors = [me.email && `assignee.eq.${me.email}`, me.email && `verantwortlich.eq.${me.email}`, `created_by.eq.${me.id}`].filter(Boolean).join(",");
      const { data } = await supabase.from("tasks")
        .select("id,title,due_date,priority,completed,customer_id,assignee,verantwortlich,created_by")
        .eq("completed", false).or(ors).order("due_date", { ascending: true }).limit(100);
      return data || [];
    },
  });

  // Entgangene Anrufe — geteilt mit Chartis ["chartisMissedCalls"]
  const { data: missedCalls = [] } = useQuery({
    queryKey: ["chartisMissedCalls", me?.id], enabled: !!me?.id, refetchInterval: 60000,
    queryFn: async () => {
      const { data } = await supabase.from("call_records")
        .select("id,direction,call_type,caller_number,caller_name,artis_user_name,customer_id,start_time,missed,notes")
        .eq("direction", "incoming").order("start_time", { ascending: false }).limit(120);
      const mine = (data || []).filter(isMissed);
      const myName = (me?.full_name || "").trim().toLowerCase();
      const own = mine.filter(c => myName && (c.artis_user_name || "").trim().toLowerCase() === myName);
      return own.length ? own : mine;
    },
  });

  // Meine Chartis-Fäden (Direkt/Gruppe) — geteilt ["chartisMyThreads"]
  const { data: myThreads = [] } = useQuery({
    queryKey: ["chartisMyThreads", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => {
      const { data: parts } = await supabase.from("chartis_participants").select("thread_id").eq("user_id", me.id);
      const ids = (parts || []).map(p => p.thread_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("chartis_threads").select("*, chartis_participants(user_id)").in("id", ids).order("updated_at", { ascending: false });
      return data || [];
    },
  });
  const { data: readState = [] } = useQuery({
    queryKey: ["chartisReadState", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => { const { data } = await supabase.from("chartis_read_state").select("thread_id, last_read_at").eq("user_id", me.id); return data || []; },
  });
  const { data: mentions = [] } = useQuery({
    queryKey: ["chartisMentions", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => { const { data } = await supabase.from("chartis_mentions").select("thread_id, seen").eq("user_id", me.id); return data || []; },
  });

  // WhatsApp-Fäden — geteilt ["chartisWhatsappThreads"]
  const { data: whatsappThreads = [] } = useQuery({
    queryKey: ["chartisWhatsappThreads"], refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_thread_whatsapp")
        .select("wa_id, phone, name, chartis_threads!inner(*)").limit(100);
      if (error) return [];
      return (data || [])
        .map(r => ({ ...r.chartis_threads, _wa_id: r.wa_id, _wa_name: r.name || r.phone }))
        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    },
  });

  // Paperboy: offene (noch nicht abgelegte) Dokumente im Storage-Bucket.
  // Geteilt mit Posteingang.jsx ["dokumente-all-post"].
  const { data: paperboyFolders = [] } = useQuery({
    queryKey: ["dokumente-all-post"], staleTime: 60000, refetchInterval: 120000,
    queryFn: async () => {
      const { data: folders, error } = await supabase.storage.from(BUCKET).list();
      if (error) throw error;
      const results = await Promise.all((folders || []).map(async (folder) => {
        const { data: files } = await supabase.storage.from(BUCKET).list(folder.name);
        const docs = (files || []).map(f => ({
          ...f, storage_path: `${folder.name}/${f.name}`, customer_id: folder.name,
          fileName: f.name.split("@")[1] || f.name,
        }));
        return { customerId: folder.name, docs };
      }));
      return results;
    },
  });

  // ── Ungelesen-Logik (aus Chartis übernommen) ──────────────────────
  const lastReadByThread = useMemo(
    () => Object.fromEntries((readState || []).map(r => [r.thread_id, r.last_read_at])),
    [readState]
  );
  const isUnread = (th) => {
    if (!th?.last_message_at) return false;
    if (th.last_message_by && me?.id && th.last_message_by === me.id) return false;
    const lr = lastReadByThread[th.id];
    return !lr || new Date(th.last_message_at) > new Date(lr);
  };

  return useMemo(() => {
    const unreadMails = mailItems.filter(m => !m.is_read);
    const chatThreads = myThreads.filter(x => (x.thread_type === "direkt" || x.thread_type === "gruppe") && isUnread(x));
    const unseenMentions = mentions.filter(m => !m.seen);
    const unreadWa = whatsappThreads.filter(isUnread);
    const paperboyDocs = paperboyFolders.flatMap(f => f.docs || []);

    // Chats-Zähler = ungelesene Direkt-/Gruppen-Fäden + neue Erwähnungen (z. B. in Aufgaben-Fäden)
    const chatsCount = chatThreads.length + unseenMentions.length;

    const counts = {
      mails: unreadMails.length,
      tasks: tasks.length,
      chats: chatsCount,
      paperboy: paperboyDocs.length,
      calls: missedCalls.length,
      whatsapp: unreadWa.length,
    };
    counts.total = counts.mails + counts.tasks + counts.chats + counts.paperboy + counts.calls + counts.whatsapp;

    // Recent-Feed (neueste zuerst), normalisiert für das Popup
    const feed = [
      ...missedCalls.map(c => ({
        kind: "calls", id: "call-" + c.id,
        title: c.caller_name || c.caller_number || "Unbekannt",
        sub: "Entgangener Anruf", time: c.start_time,
        go: { page: "Chartis", scope: "anrufe" },
      })),
      ...unreadMails.map(m => ({
        kind: "mails", id: "mail-" + m.id,
        title: m.subject || "(kein Betreff)",
        sub: m.sender_name || m.sender_email || "Mail", time: m.received_date || m.created_at,
        go: { page: "MailKanban" },
      })),
      ...paperboyDocs.map(d => ({
        kind: "paperboy", id: "pb-" + d.storage_path,
        title: d.fileName || "Dokument",
        sub: "Noch nicht abgelegt", time: d.created_at || d.updated_at,
        go: { page: "Posteingang" },
      })),
      ...unreadWa.map(w => ({
        kind: "whatsapp", id: "wa-" + w.id,
        title: w._wa_name || w.subject || "WhatsApp",
        sub: w.last_message_preview || "Neue Nachricht", time: w.last_message_at || w.updated_at,
        go: { page: "Chartis", scope: "whatsapp" },
      })),
      ...chatThreads.map(x => ({
        kind: "chats", id: "th-" + x.id,
        title: x.subject || (x.thread_type === "gruppe" ? "Gruppe" : "Direkt"),
        sub: x.last_message_preview || "Neue Nachricht", time: x.last_message_at || x.updated_at,
        go: { page: "Chartis", scope: x.thread_type === "gruppe" ? "gruppen" : "direkt" },
      })),
      ...tasks.slice(0, 20).map(k => ({
        kind: "tasks", id: "task-" + k.id,
        title: k.title || "Aufgabe",
        sub: k.due_date ? "Fällig " + new Date(k.due_date).toLocaleDateString("de-CH") : "Offene Aufgabe",
        time: k.due_date, go: { page: "TaskBoard" },
      })),
    ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    return { counts, feed, me };
  }, [mailItems, tasks, missedCalls, myThreads, mentions, whatsappThreads, paperboyFolders, lastReadByThread, me]);
}
