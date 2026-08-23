import React, { useState, useContext, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { entities, supabase, auth, functions } from "@/api/supabaseClient";
import { createPageUrl } from "@/utils";
import { ThemeContext } from "@/Layout";
import ChartisPanel from "@/components/chartis/ChartisPanel";
import PersonAvatar from "@/components/ui/PersonAvatar";
import CommandPalette from "@/components/chartis/CommandPalette";
import TaskGlobalListView from "@/components/tasks/TaskGlobalListView";
import { chartisTheme, SEM, AUTHOR, authorKey, personStyle, initials, isMissed } from "@/lib/chartisTheme";
import {
  MessageSquare, MessagesSquare, MessageCircle, Plus, Users, User, Lock, AtSign, LayoutGrid, Building2, Clock,
  PhoneOff, Phone, Mail, Calendar, CheckSquare, X, Search, Check, Loader2, Send, Paperclip, Video, Command, CloudUpload,
} from "lucide-react";
import { toast } from "sonner";

export default function Chartis() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const t = chartisTheme(theme);
  const qc = useQueryClient();

  const [scope, setScope] = useState(() => {
    // Deep-Link aus der Paperboy-FAB: gewünschten Bereich einmalig übernehmen
    try { const j = localStorage.getItem("chartis_jump_scope"); if (j) { localStorage.removeItem("chartis_jump_scope"); return j; } } catch { /* egal */ }
    return "tag";
  });
  const [activeId, setActiveId] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [activeMail, setActiveMail] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [activeTask, setActiveTask] = useState(null);
  const [activeTeamsChat, setActiveTeamsChat] = useState(null);
  const [search, setSearch] = useState("");
  const [seg, setSeg] = useState("alle");
  const [picker, setPicker] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickSel, setPickSel] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [listWidth, setListWidth] = useState(() => Number(localStorage.getItem("chartis_list_w")) || 260);
  const [calView, setCalView] = useState(() => localStorage.getItem("chartis_cal_view") || "liste");
  const dragRef = useRef(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => auth.me() });
  const { data: users = [] } = useQuery({
    queryKey: ["chartisUsers"], staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("chartis_list_staff");
      if (!error && data) return [...data].sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
      return entities.User.list("full_name"); // Fallback bis RLS-Fix-Migration angewendet
    },
  });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => entities.Customer.list("company_name"), staleTime: 300000 });
  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const custById = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);

  const { data: myThreads = [], error: thErr } = useQuery({
    queryKey: ["chartisMyThreads", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => {
      const { data: parts } = await supabase.from("chartis_participants").select("thread_id").eq("user_id", me.id);
      const ids = (parts || []).map(p => p.thread_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("chartis_threads").select("*, chartis_participants(user_id)").in("id", ids).order("updated_at", { ascending: false });
      return data || [];
    },
  });
  const { data: objektThreads = [] } = useQuery({
    queryKey: ["chartisObjektThreads"], refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase.from("chartis_threads").select("*").eq("thread_type", "objekt").order("updated_at", { ascending: false }).limit(80);
      return data || [];
    },
  });
  const { data: mentions = [] } = useQuery({
    queryKey: ["chartisMentions", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => { const { data } = await supabase.from("chartis_mentions").select("thread_id, seen").eq("user_id", me.id); return data || []; },
  });
  const { data: readState = [] } = useQuery({
    queryKey: ["chartisReadState", me?.id], enabled: !!me?.id, refetchInterval: 12000,
    queryFn: async () => { const { data } = await supabase.from("chartis_read_state").select("thread_id, last_read_at").eq("user_id", me.id); return data || []; },
  });
  const { data: searchRaw = [], isFetching: searching } = useQuery({
    queryKey: ["chartisSearch", search.trim()], enabled: scope === "suche" && search.trim().length >= 2,
    queryFn: async () => {
      const q = search.trim();
      // RLS begrenzt Treffer automatisch auf sichtbare Fäden (Objekt=Staff, Direkt/Gruppe=Teilnehmer)
      const { data } = await supabase.from("chartis_messages")
        .select("id, thread_id, body_text, created_at, kind, chartis_threads!inner(id, thread_type, subject, module, ext_contact_email, updated_at, last_message_at, last_message_preview, chartis_participants(user_id))")
        .ilike("body_text", `%${q}%`).order("created_at", { ascending: false }).limit(80);
      return data || [];
    },
  });
  const { data: missedCalls = [] } = useQuery({
    queryKey: ["chartisMissedCalls", me?.id], enabled: !!me?.id, refetchInterval: 60000,
    queryFn: async () => {
      const { data } = await supabase.from("call_records")
        .select("id,direction,call_type,caller_number,caller_name,artis_user_name,customer_id,start_time,duration_seconds,missed,notes")
        .eq("direction", "incoming").order("start_time", { ascending: false }).limit(120);
      const mine = (data || []).filter(isMissed);
      const myName = (me?.full_name || "").trim().toLowerCase();
      const own = mine.filter(c => myName && (c.artis_user_name || "").trim().toLowerCase() === myName);
      return own.length ? own : mine; // Fallback: Namens-Match leer -> teamweit zeigen
    },
  });
  const { data: mailItems = [] } = useQuery({
    queryKey: ["chartisMails", me?.id], enabled: !!me?.id, refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase.from("mail_items")
        .select("id,subject,sender_name,sender_email,recipient_email,received_date,created_at,is_read,has_attachments,body_preview,body,customer_id")
        .eq("created_by", me.id).order("received_date", { ascending: false }).limit(200);
      return data || [];
    },
  });
  const { data: calendarEvents = [] } = useQuery({
    queryKey: ["chartisCalendar", me?.id], enabled: !!me?.id, refetchInterval: 60000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 31); since.setHours(0, 0, 0, 0);
      const { data } = await supabase.from("calendar_events")
        .select("id,subject,start_time,end_time,is_all_day,location,online_meeting_url,organizer_name,customer_id")
        .eq("created_by", me.id).eq("is_cancelled", false).gte("start_time", since.toISOString())
        .order("start_time", { ascending: true }).limit(150);
      return data || [];
    },
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["chartisTasks", me?.id], enabled: !!me?.id, refetchInterval: 30000,
    queryFn: async () => {
      const ors = [me.email && `assignee.eq.${me.email}`, me.email && `verantwortlich.eq.${me.email}`, `created_by.eq.${me.id}`].filter(Boolean).join(",");
      const { data } = await supabase.from("tasks")
        .select("id,title,description,due_date,priority,priority_id,tags,completed,customer_id,assignee,verantwortlich,created_by,column_id")
        .eq("completed", false).or(ors).order("due_date", { ascending: true }).limit(100);
      return data || [];
    },
  });
  const { data: taskColumns = [] } = useQuery({
    queryKey: ["chartisTaskColumns"], staleTime: 300000,
    queryFn: async () => {
      const { data } = await supabase.from("task_columns").select("id,name,color,order").order("order");
      return data || [];
    },
  });
  // Teams-Chats (read-only, pro Mitarbeiter via RLS owner_id=auth.uid()) — getrennt von Mails
  const { data: teamsChats = [] } = useQuery({
    queryKey: ["chartisTeamsChats", me?.id], enabled: !!me?.id, refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from("teams_chats").select("*").order("last_message_at", { ascending: false }).limit(100);
      if (error) return []; // Tabelle/Feature ggf. noch nicht aktiv
      return data || [];
    },
  });
  // WhatsApp-Fäden: Objekt-Fäden mit hinterlegter wa_id-Bindung (chartis_thread_whatsapp)
  const { data: whatsappThreads = [] } = useQuery({
    queryKey: ["chartisWhatsappThreads"], refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from("chartis_thread_whatsapp")
        .select("wa_id, phone, name, chartis_threads!inner(*)").limit(100);
      if (error) return []; // Tabelle ggf. noch nicht migriert -> Feature still aus
      return (data || [])
        .map(r => ({ ...r.chartis_threads, _wa_id: r.wa_id, _wa_name: r.name || r.phone }))
        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    },
  });

  // Paperboy: offene (noch nicht abgelegte) Dokumente im Storage-Bucket "posteingang".
  // Gleicher queryKey wie Posteingang.jsx -> geteilter Cache.
  const { data: paperboyFolders = [] } = useQuery({
    queryKey: ["dokumente-all-post"], staleTime: 60000, refetchInterval: 120000,
    queryFn: async () => {
      const { data: folders, error } = await supabase.storage.from("posteingang").list();
      if (error) throw error;
      const results = await Promise.all((folders || []).map(async (folder) => {
        const { data: files } = await supabase.storage.from("posteingang").list(folder.name);
        const docs = (files || []).map(f => ({ ...f, storage_path: `${folder.name}/${f.name}`, customer_id: folder.name, fileName: f.name.split("@")[1] || f.name }));
        return { customerId: folder.name, docs };
      }));
      return results;
    },
  });
  const paperboyDocs = useMemo(() => paperboyFolders.flatMap(f => f.docs || []), [paperboyFolders]);

  const mentionIds = useMemo(() => new Set(mentions.map(m => m.thread_id)), [mentions]);
  const unseenMentions = mentions.filter(m => !m.seen).length;
  const tablesMissing = thErr && /relation .*chartis|does not exist|thread_type/i.test(thErr.message || "");

  const lastReadByThread = useMemo(() => Object.fromEntries((readState || []).map(r => [r.thread_id, r.last_read_at])), [readState]);
  const isUnread = (th) => {
    if (!th?.last_message_at) return false;
    if (th.last_message_by && me?.id && th.last_message_by === me.id) return false; // eigene Nachricht ist nie "ungelesen"
    const lr = lastReadByThread[th.id];
    return !lr || new Date(th.last_message_at) > new Date(lr);
  };
  const unreadDirekt = useMemo(() => myThreads.filter(x => x.thread_type === "direkt" && isUnread(x)).length, [myThreads, lastReadByThread, me]);
  const unreadGruppen = useMemo(() => myThreads.filter(x => x.thread_type === "gruppe" && isUnread(x)).length, [myThreads, lastReadByThread, me]);

  const isKunde = (th) => th.thread_type === "objekt" && !!th.ext_contact_email;
  const teamObjekt = objektThreads.filter(th => !isKunde(th));
  const kundenThreads = objektThreads.filter(isKunde);
  const unreadKunden = useMemo(() => kundenThreads.filter(isUnread).length, [objektThreads, lastReadByThread, me]);
  const myEmail = (me?.email || "").toLowerCase();
  const mailThreads = useMemo(() => {
    const map = new Map();
    for (const m of mailItems) {
      const key = normSubject(m.subject) + "|" + (custById[m.customer_id]?.company_name || m.sender_email || "");
      const md = m.received_date || m.created_at;
      if (!map.has(key)) map.set(key, { key, subject: m.subject, customer_id: m.customer_id, mails: [], last: md, unread: false });
      const g = map.get(key); g.mails.push(m); if (!m.is_read) g.unread = true;
      if (new Date(md) > new Date(g.last)) { g.last = md; g.subject = m.subject; }
    }
    return [...map.values()].sort((a, b) => new Date(b.last) - new Date(a.last));
  }, [mailItems, custById]);

  const searchResult = useMemo(() => {
    if (scope !== "suche") return { threads: [], items: [] };
    const q = search.trim().toLowerCase();
    if (q.length < 2) return { threads: [], items: [] };
    const byThread = new Map();
    for (const m of searchRaw) {
      const th = m.chartis_threads; if (!th || byThread.has(th.id)) continue;
      byThread.set(th.id, { x: th, snippet: snippetAround(m.body_text, q) });
    }
    for (const th of [...myThreads, ...objektThreads]) {
      if (byThread.has(th.id)) continue;
      if ((title(th) + " " + preview(th)).toLowerCase().includes(q)) byThread.set(th.id, { x: th, snippet: th.last_message_preview || "" });
    }
    const items = [...byThread.values()].map(v => ({ type: "thread", x: v.x, snippet: v.snippet }));
    return { threads: items.map(i => i.x), items };
  }, [scope, search, searchRaw, myThreads, objektThreads, userById]);

  function title(th) {
    if (th.thread_type === "direkt") {
      const other = (th.chartis_participants || []).map(p => p.user_id).find(uid => uid !== me?.id);
      return userById[other]?.full_name || userById[other]?.email || "Direkt";
    }
    return th.subject || (th.thread_type === "gruppe" ? "Gruppe" : "Objekt");
  }
  function preview(th) {
    if (th.last_message_preview) return th.last_message_preview;
    if (th.thread_type === "direkt") return "Direktnachricht";
    if (th.thread_type === "gruppe") return `Gruppe · ${(th.chartis_participants || []).length} Teilnehmer`;
    return isKunde(th) ? (th.ext_contact_email || "Kunde") : (th.module || "intern");
  }
  function avatarFor(th) {
    if (th.thread_type === "gruppe") return { icon: Users, ...AUTHOR.team };
    if (th.thread_type === "direkt") {
      const other = (th.chartis_participants || []).map(p => p.user_id).find(uid => uid !== me?.id);
      const u = userById[other];
      // user/avatarUrl mitgeben → ThreadRow kann das Profilfoto zeigen (Fallback = Initialen)
      return { label: initials(u?.full_name || u?.email), userId: other, user: u, avatarUrl: u?.avatar_url, ...personStyle(u) };
    }
    return { label: initials(th.subject), ...AUTHOR.staff };
  }

  const scopeMeta = {
    tag: { label: "Heute", icon: LayoutGrid }, direkt: { label: "Direkt", icon: User }, gruppen: { label: "Gruppen", icon: Users },
    erwaehnt: { label: "Erwähnt", icon: AtSign }, kunden: { label: "Kunden-Konversationen", icon: Building2 },
    wartet: { label: "Wartet auf Kunde", icon: Clock }, anrufe: { label: "Entgangene Anrufe", icon: PhoneOff },
    whatsapp: { label: "WhatsApp", icon: MessageCircle },
    mails: { label: "Mails", icon: Mail }, teams: { label: "Teams-Chats", icon: MessagesSquare },
    kalender: { label: "Kalender", icon: Calendar }, todos: { label: "Todos", icon: CheckSquare },
    paperboy: { label: "Paperboy – offen", icon: CloudUpload },
    suche: { label: "Suche", icon: Search },
  };

  const items = useMemo(() => {
    const dm = myThreads;
    let list;
    if (scope === "direkt") list = dm.filter(x => x.thread_type === "direkt").map(x => ({ type: "thread", x }));
    else if (scope === "gruppen") list = dm.filter(x => x.thread_type === "gruppe").map(x => ({ type: "thread", x }));
    else if (scope === "erwaehnt") list = [...dm, ...objektThreads].filter(x => mentionIds.has(x.id)).map(x => ({ type: "thread", x }));
    else if (scope === "kunden") list = kundenThreads.map(x => ({ type: "thread", x }));
    else if (scope === "wartet") list = kundenThreads.filter(x => x.status === "wartet_kunde").map(x => ({ type: "thread", x }));
    else if (scope === "whatsapp") list = whatsappThreads.map(x => ({ type: "thread", x }));
    else if (scope === "paperboy") list = paperboyDocs.map(d => ({ type: "paperboy", d }));
    else if (scope === "anrufe") list = missedCalls.map(c => ({ type: "call", c }));
    else if (scope === "mails") list = mailThreads.map(m => ({ type: "mail", m }));
    else if (scope === "teams") list = teamsChats.map(tc => ({ type: "teamschat", tc }));
    else if (scope === "kalender") list = calendarEvents.map(e => ({ type: "event", e }));
    else if (scope === "todos") list = tasks.map(k => ({ type: "task", k }));
    else list = [ // Heute
      ...missedCalls.slice(0, 4).map(c => ({ type: "call", c })),
      ...dm.map(x => ({ type: "thread", x })),
      ...[...teamObjekt, ...kundenThreads].filter(x => mentionIds.has(x.id) || x.status === "wartet_kunde").map(x => ({ type: "thread", x })),
    ];
    if (seg === "mich") list = list.filter(it =>
      it.type === "thread" ? mentionIds.has(it.x.id)
      : it.type === "call" ? (!!me?.full_name && (it.c.artis_user_name || "").trim().toLowerCase() === me.full_name.trim().toLowerCase())
      : it.type === "task" ? (it.k.assignee === me?.email || it.k.verantwortlich === me?.email)
      : true);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(it =>
      it.type === "call" ? (it.c.caller_name || it.c.caller_number || "").toLowerCase().includes(q)
      : it.type === "mail" ? ((it.m.subject || "") + " " + (it.m.mails[0]?.sender_name || "")).toLowerCase().includes(q)
      : it.type === "event" ? (it.e.subject || "").toLowerCase().includes(q)
      : it.type === "task" ? (it.k.title || "").toLowerCase().includes(q)
      : it.type === "teamschat" ? ((it.tc.topic || "") + " " + (it.tc.member_names || []).join(" ") + " " + (it.tc.last_message_preview || "")).toLowerCase().includes(q)
      : it.type === "paperboy" ? ((it.d.fileName || "") + " " + (custById[it.d.customer_id]?.company_name || "")).toLowerCase().includes(q)
      : (title(it.x) + " " + preview(it.x)).toLowerCase().includes(q));
    return list;
  }, [scope, seg, search, myThreads, objektThreads, missedCalls, mailThreads, calendarEvents, tasks, teamsChats, whatsappThreads, paperboyDocs, mentionIds, me]);

  const activeThread = useMemo(() => [...myThreads, ...objektThreads, ...whatsappThreads, ...searchResult.threads].find(x => x.id === activeId), [activeId, myThreads, objektThreads, whatsappThreads, searchResult]);

  // Aufgaben für die Tabellen-Ansicht (Pane C) – nach @Mich + Suche gefiltert
  const todosFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(k => {
      if (seg === "mich" && k.assignee !== me?.email && k.verantwortlich !== me?.email) return false;
      if (q && !(k.title || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, search, seg, me?.email]);

  const groupedTodos = useMemo(() => {
    if (scope !== "todos") return null;
    const q = search.trim().toLowerCase();
    const filtered = tasks.filter(k => {
      if (seg === "mich" && k.assignee !== me?.email && k.verantwortlich !== me?.email) return false;
      if (q && !(k.title || "").toLowerCase().includes(q)) return false;
      return true;
    });
    if (!filtered.length) return [];
    const colMap = new Map(taskColumns.map(c => [c.id, c]));
    const byCol = {};
    const noCol = [];
    for (const k of filtered) {
      if (k.column_id && colMap.has(k.column_id)) {
        (byCol[k.column_id] = byCol[k.column_id] || []).push(k);
      } else {
        noCol.push(k);
      }
    }
    const result = [];
    for (const col of taskColumns) {
      const ct = byCol[col.id] || [];
      if (ct.length) {
        result.push({ type: "header", label: col.name, count: ct.length, color: col.color });
        ct.forEach(k => result.push({ type: "task", k }));
      }
    }
    if (noCol.length) {
      result.push({ type: "header", label: "Ohne Spalte", count: noCol.length, color: null });
      noCol.forEach(k => result.push({ type: "task", k }));
    }
    return result;
  }, [scope, tasks, taskColumns, search, seg, me?.email]);

  async function openDirect(otherId) {
    if (!me?.id) return; setBusy(true);
    try {
      // Live-Session prüfen: bei abgelaufenem Login ist auth.uid() leer -> jeder
      // Insert scheitert an RLS. Klare Meldung statt kryptischem "row violates".
      const { data: { user: live } } = await supabase.auth.getUser();
      if (!live) { toast.error("Sitzung abgelaufen – bitte ab- und wieder anmelden."); return; }
      // Frischer DB-Check (kein stale-closure auf myThreads) gegen Duplikat-Threads
      const { data: myP } = await supabase.from("chartis_participants").select("thread_id").eq("user_id", me.id);
      const pIds = (myP || []).map(r => r.thread_id);
      let existing = null;
      if (pIds.length) {
        const { data: cand } = await supabase.from("chartis_threads").select("id, chartis_participants(user_id)").in("id", pIds).eq("thread_type", "direkt");
        existing = (cand || []).find(x => { const ids = (x.chartis_participants || []).map(p => p.user_id); return ids.length === 2 && ids.includes(me.id) && ids.includes(otherId); });
      }
      if (existing) { setActiveCall(null); setActiveId(existing.id); setPicker(false); return; }
      const other = userById[otherId];
      const { data: th, error } = await supabase.from("chartis_threads").insert({ thread_type: "direkt", subject: other?.full_name || "Direkt", created_by: me.id, owner_id: me.id }).select("id").single();
      if (error) throw error;
      const { error: pErr } = await supabase.from("chartis_participants").insert([{ thread_id: th.id, user_id: me.id }, { thread_id: th.id, user_id: otherId }]);
      if (pErr) throw pErr;
      await qc.invalidateQueries({ queryKey: ["chartisMyThreads", me.id] });
      setActiveCall(null); setActiveId(th.id); setPicker(false); setScope("direkt");
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); } finally { setBusy(false); }
  }
  async function createGroup() {
    if (!me?.id || !groupName.trim() || !pickSel.length) { toast.info("Name + mind. 1 Person"); return; } setBusy(true);
    try {
      const { data: { user: live } } = await supabase.auth.getUser();
      if (!live) { toast.error("Sitzung abgelaufen – bitte ab- und wieder anmelden."); return; }
      const { data: th, error } = await supabase.from("chartis_threads").insert({ thread_type: "gruppe", subject: groupName.trim(), created_by: me.id, owner_id: me.id }).select("id").single();
      if (error) throw error;
      const ids = [me.id, ...pickSel].filter((v, i, a) => a.indexOf(v) === i);
      const { error: pErr } = await supabase.from("chartis_participants").insert(ids.map(uid => ({ thread_id: th.id, user_id: uid })));
      if (pErr) throw pErr;
      await qc.invalidateQueries({ queryKey: ["chartisMyThreads", me.id] });
      setActiveCall(null); setActiveId(th.id); setPicker(false); setGroupName(""); setPickSel([]); setScope("gruppen");
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); } finally { setBusy(false); }
  }
  const pickList = users.filter(u => u.id !== me?.id && ((u.full_name || "").toLowerCase().includes(pickSearch.toLowerCase()) || (u.email || "").toLowerCase().includes(pickSearch.toLowerCase())));

  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setCmdOpen(o => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Realtime-Presence: wer ist gerade in Chartis online
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase.channel("chartis-presence", { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => setOnlineIds(new Set(Object.keys(ch.presenceState()))))
      .subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ at: Date.now() }); });
    return () => supabase.removeChannel(ch);
  }, [me?.id]);
  // Ziehbarer Trenn-Balken für die Listenbreite
  useEffect(() => {
    const onMove = (e) => { if (!dragRef.current) return; setListWidth(Math.max(200, Math.min(640, dragRef.current.w + (e.clientX - dragRef.current.x)))); };
    const onUp = () => { dragRef.current = null; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);
  useEffect(() => { localStorage.setItem("chartis_list_w", String(listWidth)); }, [listWidth]);
  useEffect(() => { localStorage.setItem("chartis_cal_view", calView); }, [calView]);

  async function completeTask(id) {
    // optimistisch aus der Liste nehmen
    qc.setQueryData(["chartisTasks", me?.id], (old) => Array.isArray(old) ? old.filter(k => k.id !== id) : old);
    try {
      const { error } = await supabase.from("tasks").update({ completed: true }).eq("id", id);
      if (error) throw error;
      if (activeTask?.id === id) setActiveTask(null);
    } catch (e) {
      toast.error("Konnte nicht abhaken: " + (e?.message || e));
      qc.invalidateQueries({ queryKey: ["chartisTasks", me?.id] });
    }
  }
  const commands = useMemo(() => {
    const nav = [
      { id: "s-tag", icon: LayoutGrid, label: "Heute", run: () => setScope("tag") },
      { id: "s-direkt", icon: User, label: "Direkt", run: () => setScope("direkt") },
      { id: "s-gruppen", icon: Users, label: "Gruppen", run: () => setScope("gruppen") },
      { id: "s-erwaehnt", icon: AtSign, label: "Erwähnt", run: () => setScope("erwaehnt") },
      { id: "s-kunden", icon: Building2, label: "Kunden-Konversationen", run: () => setScope("kunden") },
      { id: "s-whatsapp", icon: MessageCircle, label: "WhatsApp", run: () => setScope("whatsapp") },
      { id: "s-anrufe", icon: PhoneOff, label: "Entgangene Anrufe", run: () => setScope("anrufe") },
      { id: "s-mails", icon: Mail, label: "Mails", run: () => setScope("mails") },
      { id: "s-paperboy", icon: CloudUpload, label: "Paperboy – offene Uploads", run: () => setScope("paperboy") },
      { id: "s-teams", icon: MessagesSquare, label: "Teams-Chats", run: () => setScope("teams") },
      { id: "s-kalender", icon: Calendar, label: "Kalender", run: () => setScope("kalender") },
      { id: "s-todos", icon: CheckSquare, label: "Todos", run: () => setScope("todos") },
      { id: "s-suche", icon: Search, label: "Alle Chats durchsuchen", run: () => { setScope("suche"); setSearch(""); } },
      { id: "neu", icon: Plus, label: "Neuer Chat / Gruppe", run: () => setPicker(true) },
    ];
    const people = users.filter(u => u.id !== me?.id).map(u => ({ id: "u-" + u.id, icon: User, label: "Direkt an " + (u.full_name || u.email), sub: "Chat", run: () => openDirect(u.id) }));
    return [...nav, ...people];
  }, [users, me]);

  const displayItems = scope === "suche" ? searchResult.items : scope === "todos" ? (groupedTodos || []) : items;

  const clearActive = () => { setActiveId(null); setActiveCall(null); setActiveMail(null); setActiveEvent(null); setActiveTask(null); setActiveTeamsChat(null); };
  const openThread = async (id) => {
    clearActive(); setActiveId(id);
    // optimistisch als gelesen markieren, damit der Badge sofort verschwindet
    qc.setQueryData(["chartisReadState", me?.id], (old) => {
      const now = new Date().toISOString();
      const arr = Array.isArray(old) ? old.filter(r => r.thread_id !== id) : [];
      return [...arr, { thread_id: id, last_read_at: now }];
    });
    try { await supabase.rpc("chartis_mark_thread_read", { p_thread: id }); } catch { /* read_state ist unkritisch */ }
  };
  const NavItem = ({ k, icon: Icon, label, count, red }) => (
    <button onClick={() => { clearActive(); setScope(k); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left relative"
      style={{ fontSize: 12, color: scope === k ? t.accent : t.textSecondary, background: scope === k ? t.accentSoft : "transparent", fontWeight: scope === k ? 500 : 400 }}>
      {scope === k && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: t.accentFill }} />}
      <Icon className="h-4 w-4" style={{ color: red ? SEM.missed : undefined }} />
      <span className="truncate flex-1">{label}</span>
      {count > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: red ? SEM.missed : t.accentFill, borderRadius: 9, padding: "0 6px" }}>{count}</span>}
    </button>
  );

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: t.sunken, color: t.textPrimary }}>
      {/* Pane A — Modul-Rail */}
      <div className="flex flex-col flex-shrink-0" style={{ width: 168, borderRight: `1px solid ${t.borderSubtle}`, background: t.sunken }}>
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="rounded-full flex items-center justify-center" style={{ width: 24, height: 24, background: t.accentFill, color: "#fff", fontSize: 11, fontWeight: 700 }}>C</div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>Chartis</span>
          {unseenMentions > 0 && <span style={{ fontSize: 10, color: "#fff", background: SEM.missed, borderRadius: 9, padding: "0 6px" }}>{unseenMentions}</span>}
          <button onClick={() => setCmdOpen(true)} title="Befehle (⌘K)" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: t.textMuted, border: `1px solid ${t.borderSubtle}`, borderRadius: 6, padding: "3px 6px" }}><Command className="h-3 w-3" />K</button>
        </div>
        <div className="px-2 overflow-y-auto flex-1">
          <NavItem k="tag" icon={LayoutGrid} label="Heute" />
          <NavItem k="suche" icon={Search} label="Suche" />
          <div style={{ fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted, padding: "9px 8px 3px" }}>Team · intern</div>
          <NavItem k="direkt" icon={User} label="Direkt" count={unreadDirekt} />
          <NavItem k="gruppen" icon={Users} label="Gruppen" count={unreadGruppen} />
          <NavItem k="erwaehnt" icon={AtSign} label="Erwähnt" count={unseenMentions} />
          <div style={{ fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted, padding: "9px 8px 3px" }}>Kunden · extern</div>
          <NavItem k="kunden" icon={Building2} label="Konversationen" count={unreadKunden} />
          <NavItem k="wartet" icon={Clock} label="Wartet" />
          <NavItem k="whatsapp" icon={MessageCircle} label="WhatsApp" count={whatsappThreads.length} />
          <NavItem k="paperboy" icon={CloudUpload} label="Paperboy – offen" count={paperboyDocs.length} />
          <div style={{ height: 6 }} />
          <NavItem k="anrufe" icon={PhoneOff} label="Anrufe" count={missedCalls.length} red />
          <div style={{ borderTop: `1px solid ${t.borderSubtle}`, margin: "8px 6px" }} />
          <NavItem k="mails" icon={Mail} label="Mails" />
          <NavItem k="teams" icon={MessagesSquare} label="Teams" count={teamsChats.length} />
          <NavItem k="kalender" icon={Calendar} label="Kalender" count={calendarEvents.length} />
          <NavItem k="todos" icon={CheckSquare} label="Todos" count={tasks.length} />
        </div>
        <div className="p-2">
          <button onClick={() => setPicker(true)} className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: t.accentFill, color: "#fff", fontSize: 12, fontWeight: 500 }}>
            <Plus className="h-3.5 w-3.5" /> Neuer Chat
          </button>
        </div>
      </div>

      {/* Pane B — Liste */}
      <div className="flex flex-col flex-shrink-0" style={{ width: listWidth, borderRight: `1px solid ${t.borderSubtle}`, background: t.base }}>
        <div className="px-3 py-3" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: t.sunken, border: `1px solid ${t.borderSubtle}` }}>
            <Search className="h-4 w-4" style={{ color: t.textMuted }} />
            <input value={search} onChange={e => setSearch(e.target.value)} autoFocus={scope === "suche"} placeholder={scope === "suche" ? "Alle Chats & Nachrichten durchsuchen…" : `${scopeMeta[scope].label} durchsuchen…`} className="flex-1 bg-transparent outline-none" style={{ fontSize: 12, color: t.textPrimary }} />
            {scope === "suche" && searching && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: t.textMuted }} />}
          </div>
          <div className="flex gap-1.5 mt-2">
            {[["alle", "Alle"], ["mich", "@Mich"]].map(([k, l]) => (
              <button key={k} onClick={() => setSeg(k)} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 7, fontWeight: seg === k ? 500 : 400, color: seg === k ? "#fff" : t.textMuted, background: seg === k ? t.accentFill : "transparent" }}>{l}</button>
            ))}
            <span className="ml-auto" style={{ fontSize: 11, fontWeight: 600 }}>{scopeMeta[scope].label}</span>
          </div>
        </div>
        {scope === "tag" && !tablesMissing && (
          <div className="flex gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${t.borderSubtle}`, overflowX: "auto" }}>
            {[
              { l: "Erwähnt", n: unseenMentions, go: "erwaehnt", red: false },
              { l: "Anrufe", n: missedCalls.length, go: "anrufe", red: true },
              { l: "Paperboy", n: paperboyDocs.length, go: "paperboy", red: false },
              { l: "Todos", n: tasks.filter(k => k.due_date && new Date(k.due_date) <= new Date(new Date().setHours(23, 59, 59, 999))).length, go: "todos", red: false },
              { l: "Termine", n: calendarEvents.filter(e => new Date(e.start_time).toDateString() === new Date().toDateString()).length, go: "kalender", red: false },
            ].map(c => (
              <button key={c.l} onClick={() => setScope(c.go)} className="flex flex-col items-start px-2.5 py-1.5 rounded-lg flex-shrink-0" style={{ background: t.sunken, minWidth: 62 }}>
                <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: c.red && c.n > 0 ? SEM.missed : t.textPrimary }}>{c.n}</span>
                <span style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>{c.l}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {tablesMissing ? (
            <div className="m-3 text-xs p-3 rounded-lg" style={{ color: "#92400e", background: "#fef3c7" }}>Chartis-Tabellen fehlen. Bitte Migrationen im SQL-Editor ausführen.</div>
          ) : displayItems.length === 0 ? (
            scope === "suche" ? (
              <div className="text-center py-10 px-4" style={{ color: t.textMuted }}>
                <Search className="h-8 w-8 mx-auto mb-2" style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>{search.trim().length < 2 ? "Alle Chats durchsuchen" : "Keine Treffer"}</div>
                <div style={{ fontSize: 11 }}>{search.trim().length < 2 ? "Tippe mind. 2 Zeichen – sucht in Nachrichten & Titeln." : `Nichts gefunden für „${search.trim()}".`}</div>
              </div>
            ) : (
              <div className="text-center py-10 px-4" style={{ color: t.textMuted }}>
                <Check className="h-8 w-8 mx-auto mb-2" style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>Alles erledigt</div>
                <div style={{ fontSize: 11 }}>Keine offenen Punkte hier.</div>
              </div>
            )
          ) : displayItems.map((it, i) => it.type === "header" ? (
            <div key={"h" + i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted, borderTop: i > 0 ? `1px solid ${t.borderSubtle}` : "none" }}>
              {it.color && <span style={{ width: 7, height: 7, borderRadius: 99, background: it.color, flexShrink: 0 }} />}
              <span className="truncate">{it.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 500 }}>{it.count}</span>
            </div>
          ) : it.type === "call" ? (
            <button key={"c" + it.c.id} onClick={() => { clearActive(); setActiveCall(it.c); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}`, borderLeft: `3px solid ${SEM.missed}`, paddingLeft: 9, background: activeCall?.id === it.c.id ? t.activeRow : "transparent" }}>
              <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: SEM.missedSoft, color: SEM.missed }}><PhoneOff className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 12, fontWeight: 700 }}>{custById[it.c.customer_id]?.company_name || it.c.caller_name || it.c.caller_number || "Unbekannt"}</div>
                <div className="truncate" style={{ fontSize: 11, color: t.textMuted }}>Entgangener {it.c.call_type === "pstnCall" ? "Anruf" : "Teams-Anruf"}</div>
              </div>
              <span style={{ fontSize: 10, color: SEM.missed, flexShrink: 0 }}>{fmtTime(it.c.start_time)}</span>
            </button>
          ) : it.type === "paperboy" ? (
            <Link key={"pb" + it.d.storage_path} to={createPageUrl("Posteingang")}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}`, borderLeft: "3px solid #4ba3c7", paddingLeft: 9 }}>
              <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: "rgba(75,163,199,0.16)", color: "#4ba3c7" }}><CloudUpload className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 12, fontWeight: 700 }}>{it.d.fileName || "Dokument"}</div>
                <div className="truncate" style={{ fontSize: 11, color: t.textMuted }}>{custById[it.d.customer_id]?.company_name || "Noch nicht abgelegt"}</div>
              </div>
              <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0 }}>{fmtTime(it.d.created_at)}</span>
            </Link>
          ) : it.type === "mail" ? (
            <MailRow key={"m" + it.m.key} m={it.m} t={t} active={activeMail?.key === it.m.key} onClick={() => { clearActive(); setActiveMail(it.m); }} />
          ) : it.type === "teamschat" ? (
            <TeamsRow key={"tc" + it.tc.chat_id} tc={it.tc} t={t} meName={me?.full_name} active={activeTeamsChat?.chat_id === it.tc.chat_id} onClick={() => { clearActive(); setActiveTeamsChat(it.tc); }} />
          ) : it.type === "event" ? (
            <EventRow key={"e" + it.e.id} e={it.e} t={t} active={activeEvent?.id === it.e.id} onClick={() => { clearActive(); setActiveEvent(it.e); }} />
          ) : it.type === "task" ? (
            <TaskRow key={"t" + it.k.id} k={it.k} t={t} active={activeTask?.id === it.k.id} onClick={() => { clearActive(); setActiveTask(it.k); }} />
          ) : (
            <ThreadRow key={it.x.id} th={it.x} t={t} active={activeId === it.x.id} mentioned={mentionIds.has(it.x.id)} unread={scope !== "suche" && isUnread(it.x)}
              title={title(it.x)} preview={it.snippet || preview(it.x)} av={avatarFor(it.x)} kunde={isKunde(it.x)} onlineIds={onlineIds}
              onClick={() => openThread(it.x.id)} />
          ))}
        </div>
      </div>

      {/* Ziehbarer Trenn-Balken */}
      <div onMouseDown={(e) => { dragRef.current = { x: e.clientX, w: listWidth }; document.body.style.userSelect = "none"; e.preventDefault(); }}
        title="Breite ziehen" className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 8, cursor: "col-resize" }}>
        <div style={{ width: 3, height: 34, borderRadius: 2, background: t.borderStrong, opacity: 0.5 }} />
      </div>

      {/* Pane C — aktiver Faden / Anruf / Kalender / Leerstaat */}
      <div className="flex-1 min-w-0" style={{ background: t.raised, boxShadow: t.shadow }}>
        {activeMail ? (
          <MailThread m={activeMail} t={t} myEmail={myEmail} customer={custById[activeMail.customer_id]} />
        ) : activeTeamsChat ? (
          <TeamsThread chat={activeTeamsChat} t={t} meName={me?.full_name} />
        ) : activeEvent ? (
          <EventDetail e={activeEvent} t={t} customer={custById[activeEvent.customer_id]} />
        ) : activeTask ? (
          <TaskDetail k={activeTask} t={t} customer={custById[activeTask.customer_id]} />
        ) : activeCall ? (
          <CallDetail c={activeCall} t={t} customer={custById[activeCall.customer_id]} />
        ) : scope === "kalender" ? (
          calView === "liste"
            ? <CalendarAgenda events={calendarEvents} t={t} calView={calView} setCalView={setCalView} onSelect={(e) => { clearActive(); setActiveEvent(e); }} />
            : <CalendarMonth events={calendarEvents} t={t} calView={calView} setCalView={setCalView} onSelect={(e) => { clearActive(); setActiveEvent(e); }} />
        ) : scope === "todos" ? (
          <div className="h-full flex flex-col">
            <TaskGlobalListView columns={taskColumns} tasks={todosFiltered}
              onTaskClick={(k) => { clearActive(); setActiveTask(k); }}
              onToggleComplete={(k) => completeTask(k.id)} />
          </div>
        ) : activeThread ? (
          <ChartisPanel key={activeThread.id} threadId={activeThread.id} titleOverride={title(activeThread)} directMode={activeThread.thread_type !== "objekt"} embedded />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2" style={{ color: t.textMuted }}>
            <MessageSquare className="h-10 w-10" style={{ opacity: 0.25 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: t.textSecondary }}>Wähle einen Chat</div>
            <div style={{ fontSize: 12 }}>oder starte mit „Neuer Chat" links.</div>
          </div>
        )}
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} t={t} />
      {picker && <Picker t={t} list={pickList} onlineIds={onlineIds} pickSearch={pickSearch} setPickSearch={setPickSearch} pickSel={pickSel} setPickSel={setPickSel} groupName={groupName} setGroupName={setGroupName} busy={busy} onDirect={openDirect} onGroup={createGroup} onClose={() => setPicker(false)} />}
    </div>
  );
}

function fmtTime(ts) {
  try { const d = new Date(ts); const now = new Date(); const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }); } catch { return ""; }
}

function ThreadRow({ th, t, active, mentioned, unread, title, preview, av, kunde, onClick, onlineIds }) {
  const online = !!av.userId && onlineIds?.has(av.userId);
  const strong = mentioned || unread;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left relative" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      {strong && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: t.accentFill }} />}
      <div className="relative flex-shrink-0">
        {av.user ? (
          /* Person → zentraler Avatar (Foto oder Initialen), Online-Dot als Overlay-Child */
          <PersonAvatar user={av.user} size={30}>
            {online && <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 99, background: SEM.presence.online, border: `1.5px solid ${t.base}` }} />}
          </PersonAvatar>
        ) : (
          <>
            <div className="rounded-full flex items-center justify-center" style={{ width: 30, height: 30, background: av.bg, color: av.text, fontSize: 11, fontWeight: 600 }}>
              {av.icon ? <av.icon className="h-4 w-4" /> : av.label}
            </div>
            {online && <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 99, background: SEM.presence.online, border: `1.5px solid ${t.base}` }} />}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate flex-1" style={{ fontSize: 12, fontWeight: strong ? 700 : 500, color: t.textPrimary }}>{title}</div>
          {th.last_message_at && <span style={{ fontSize: 10, color: unread ? t.accent : t.textMuted, flexShrink: 0 }}>{fmtTime(th.last_message_at)}</span>}
        </div>
        <div className="truncate flex items-center gap-1" style={{ fontSize: 11, color: unread ? t.textSecondary : t.textMuted, marginTop: 1 }}>
          {kunde
            ? <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: SEM.externSoft, color: SEM.extern, fontWeight: 500 }}>Kunde</span>
            : <Lock className="h-2.5 w-2.5" style={{ opacity: 0.6, flexShrink: 0 }} />}
          <span className="truncate flex-1">{preview}</span>
          {mentioned ? <AtSign className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.accent }} />
            : unread ? <span style={{ width: 8, height: 8, borderRadius: 99, background: t.accentFill, flexShrink: 0 }} /> : null}
        </div>
      </div>
    </button>
  );
}

function CallDetail({ c, t, customer }) {
  const name = customer?.company_name || c.caller_name || c.caller_number || "Unbekannt";
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
        <div className="rounded-full flex items-center justify-center" style={{ width: 36, height: 36, background: SEM.missedSoft, color: SEM.missed }}><PhoneOff className="h-5 w-5" /></div>
        <div><div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div><div style={{ fontSize: 11, color: SEM.missed }}>Entgangener Anruf · {fmtTime(c.start_time)}</div></div>
      </div>
      <div className="p-4 space-y-2" style={{ fontSize: 13, color: t.textSecondary }}>
        <Field t={t} label="Nummer" value={c.caller_number || "—"} />
        <Field t={t} label="Art" value={c.call_type === "pstnCall" ? "Telefon" : "Teams"} />
        <Field t={t} label="Mitarbeiter" value={c.artis_user_name || "—"} />
        <Field t={t} label="Zeit" value={new Date(c.start_time).toLocaleString("de-CH")} />
        <div className="flex gap-2 pt-2">
          {customer && <Link to={`/Kunden?customer=${c.customer_id}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ fontSize: 12, background: t.accentSoft, color: t.accent }}><Building2 className="h-3.5 w-3.5" /> Im Kundenbereich</Link>}
          <a href={`tel:${c.caller_number}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ fontSize: 12, background: t.accentFill, color: "#fff" }}><Phone className="h-3.5 w-3.5" /> Zurückrufen</a>
        </div>
      </div>
    </div>
  );
}
function Field({ t, label, value }) {
  return <div className="flex justify-between" style={{ borderBottom: `1px solid ${t.borderSubtle}`, padding: "6px 0" }}><span style={{ color: t.textMuted }}>{label}</span><span>{value}</span></div>;
}

function normSubject(s) { return String(s || "").replace(/^((re|aw|wg|fwd|fw|antw)\s*:\s*)+/gi, "").trim().toLowerCase(); }
function snippetAround(text, q) {
  const s = String(text || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "[Bild]").replace(/\s+/g, " ").trim();
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return s.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + s.slice(start, i + 80) + (s.length > i + 80 ? "…" : "");
}
function stripHtml(s) { return String(s || "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }

function MailRow({ m, t, active, onClick }) {
  const last = m.mails[0];
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left relative" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      {m.unread && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: t.accentFill }} />}
      <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: "#e0e7ff", color: "#3730a3" }}><Mail className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12, fontWeight: m.unread ? 700 : 500, color: t.textPrimary }}>{m.subject || "(Kein Betreff)"}</div>
        <div className="truncate" style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{last?.sender_name || last?.sender_email}{m.mails.length > 1 ? ` · ${m.mails.length}` : ""}</div>
      </div>
      {last?.has_attachments && <Paperclip className="h-3 w-3 flex-shrink-0" style={{ color: t.textMuted }} />}
      <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0 }}>{fmtTime(m.last)}</span>
    </button>
  );
}

function MailThread({ m, t, myEmail, customer }) {
  const mails = [...m.mails].sort((a, b) => new Date(a.received_date || a.created_at) - new Date(b.received_date || b.created_at));
  const replyTo = [...mails].reverse().find(x => (x.sender_email || "").toLowerCase() !== myEmail)?.sender_email || mails[mails.length - 1]?.sender_email || "";
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
        <Mail className="h-4 w-4" style={{ color: t.accent }} />
        <div className="min-w-0"><div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{m.subject || "(Kein Betreff)"}</div>
          <div className="truncate" style={{ fontSize: 10, color: t.textMuted }}>{customer?.company_name || mails[0]?.sender_email} · {mails.length} Mail(s)</div></div>
        <span className="ml-auto inline-flex items-center gap-1 flex-shrink-0" style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 8, background: SEM.externSoft, color: SEM.extern }}><Mail className="h-3 w-3" />Mail · read-only</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mails.map(mail => {
          const mine = (mail.sender_email || "").toLowerCase() === myEmail;
          const text = stripHtml(mail.body || mail.body_preview);
          return (
            <div key={mail.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
              <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>{mine ? "Du" : (mail.sender_name || mail.sender_email)} · {new Date(mail.received_date).toLocaleString("de-CH")}</div>
              <div style={{ maxWidth: "86%", background: mine ? t.accentFill : t.base, color: mine ? "#fff" : t.textPrimary, border: mine ? "none" : `1px solid ${t.borderSubtle}`, padding: "8px 11px", fontSize: 12, lineHeight: 1.5, borderRadius: mine ? "14px 4px 14px 14px" : "4px 14px 14px 14px", whiteSpace: "pre-wrap" }}>{text || "(kein Inhalt)"}</div>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 flex items-center gap-2" style={{ borderTop: `1px solid ${t.borderSubtle}` }}>
        <a href={`mailto:${replyTo}?subject=${encodeURIComponent("Re: " + (m.subject || ""))}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: t.accentFill, color: "#fff" }}><Mail className="h-3.5 w-3.5" /> Antworten</a>
        <span style={{ fontSize: 10, color: t.textMuted }}>öffnet Outlook · Chartis zeigt Mails read-only</span>
      </div>
    </div>
  );
}

function fmtDateTime(ts, dateOnly) {
  try { const d = new Date(ts); const base = d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
    return dateOnly ? base : base + " " + d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

// ── Teams-Chats (read-only, aus teams_chats/teams_chat_messages) ─────────────
function teamsTitle(tc, meName) {
  if (tc.topic) return tc.topic;
  const others = (tc.member_names || []).filter(n => n && n !== meName);
  if (others.length) return others.join(", ");
  return tc.chat_type === "meeting" ? "Besprechungs-Chat" : "Teams-Chat";
}

function TeamsRow({ tc, t, meName, active, onClick }) {
  const isGroup = tc.chat_type === "group" || tc.chat_type === "meeting";
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left relative" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: "#e5edfb", color: "#4b6bb7" }}>
        {isGroup ? <Users className="h-4 w-4" /> : <MessagesSquare className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12, fontWeight: 500, color: t.textPrimary }}>{teamsTitle(tc, meName)}</div>
        <div className="truncate" style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{tc.last_message_preview || "—"}</div>
      </div>
      {tc.last_message_at && <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0 }}>{fmtTime(tc.last_message_at)}</span>}
    </button>
  );
}

function TeamsThread({ chat, t, meName }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { data: msgs = [], isLoading } = useQuery({
    queryKey: ["chartisTeamsMsgs", chat.chat_id],
    queryFn: async () => {
      const { data } = await supabase.from("teams_chat_messages").select("*").eq("chat_id", chat.chat_id).order("created_at", { ascending: true });
      return data || [];
    },
  });
  // Realtime (statt Polling): live bei neuen/geänderten Teams-Nachrichten via postgres_changes
  useEffect(() => {
    const ch = supabase.channel(`teams-${chat.chat_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams_chat_messages", filter: `chat_id=eq.${chat.chat_id}` },
        () => qc.invalidateQueries({ queryKey: ["chartisTeamsMsgs", chat.chat_id] }))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [chat.chat_id]);
  const sendTeams = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await functions.invoke("chartis-teams-send", { chat_id: chat.chat_id, text: body });
      setText("");
      qc.invalidateQueries({ queryKey: ["chartisTeamsMsgs", chat.chat_id] });
    } catch (e) {
      toast.error("Senden fehlgeschlagen: " + (e?.message || e));
    } finally { setSending(false); }
  };
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
        <MessagesSquare className="h-4 w-4" style={{ color: "#4b6bb7" }} />
        <div className="min-w-0"><div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{teamsTitle(chat, meName)}</div>
          <div className="truncate" style={{ fontSize: 10, color: t.textMuted }}>{(chat.member_names || []).join(", ") || "Teams"}</div></div>
        <span className="ml-auto inline-flex items-center gap-1 flex-shrink-0" style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 8, background: "#e5edfb", color: "#4b6bb7" }}><MessagesSquare className="h-3 w-3" />Teams · read-only</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" style={{ color: t.textMuted }} /></div>
        ) : msgs.length === 0 ? (
          <div className="text-center text-xs py-6" style={{ color: t.textMuted }}>Keine Nachrichten synchronisiert.</div>
        ) : msgs.map(m => (
          <div key={m.msg_id} style={{ display: "flex", flexDirection: "column", alignItems: m.is_mine ? "flex-end" : "flex-start" }}>
            <div style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>{m.is_mine ? "Du" : (m.from_name || "Teams")}{m.created_at ? " · " + new Date(m.created_at).toLocaleString("de-CH") : ""}</div>
            <div style={{ maxWidth: "86%", background: m.is_mine ? t.accentFill : t.base, color: m.is_mine ? "#fff" : t.textPrimary, border: m.is_mine ? "none" : `1px solid ${t.borderSubtle}`, padding: "8px 11px", fontSize: 12, lineHeight: 1.5, borderRadius: m.is_mine ? "14px 4px 14px 14px" : "4px 14px 14px 14px", whiteSpace: "pre-wrap" }}>{m.body_text || "(kein Inhalt)"}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2" style={{ borderTop: `1px solid ${t.borderSubtle}` }}>
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendTeams(); }}
            placeholder="In Teams antworten… (Strg+Enter)" rows={1}
            className="flex-1 rounded-lg border px-2.5 py-2 resize-none outline-none"
            style={{ background: t.base, borderColor: t.borderSubtle, color: t.textPrimary, fontSize: 13, maxHeight: 100 }} />
          <button onClick={sendTeams} disabled={!text.trim() || sending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: text.trim() && !sending ? t.accentFill : "#a1a1aa", color: "#fff", opacity: (!text.trim() || sending) ? 0.6 : 1 }}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Senden
          </button>
        </div>
        <div style={{ fontSize: 10, color: t.textMuted, marginTop: 3 }}>Geht als Teams-Nachricht raus · aktiv, sobald Chat.Read/ChatMessage.Send freigegeben + MS neu verbunden</div>
      </div>
    </div>
  );
}

function EventRow({ e, t, active, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      <div className="rounded-lg flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, background: t.accentSoft, color: t.accent, fontSize: 13, fontWeight: 700 }}>{new Date(e.start_time).getDate()}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12, fontWeight: 500, color: t.textPrimary }}>{e.subject || "(ohne Titel)"}</div>
        <div className="truncate" style={{ fontSize: 11, color: t.textMuted }}>{fmtDateTime(e.start_time, e.is_all_day)}{e.location ? " · " + e.location : ""}</div>
      </div>
      {e.online_meeting_url && <Video className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.accent }} />}
    </button>
  );
}

function EventDetail({ e, t, customer }) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
        <Calendar className="h-4 w-4" style={{ color: t.accent }} />
        <div className="min-w-0"><div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{e.subject || "(ohne Titel)"}</div>
          <div style={{ fontSize: 11, color: t.textMuted }}>{fmtDateTime(e.start_time, e.is_all_day)}{e.end_time && !e.is_all_day ? " – " + new Date(e.end_time).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : ""}</div></div>
      </div>
      <div className="p-4 space-y-2" style={{ fontSize: 13, color: t.textSecondary }}>
        {e.location && <Field t={t} label="Ort" value={e.location} />}
        {e.organizer_name && <Field t={t} label="Organisator" value={e.organizer_name} />}
        {customer && <Field t={t} label="Kunde" value={customer.company_name} />}
        {e.online_meeting_url && <a href={e.online_meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg mt-2" style={{ fontSize: 12, background: t.accentFill, color: "#fff" }}><Video className="h-3.5 w-3.5" /> Teams beitreten</a>}
      </div>
    </div>
  );
}

function TaskRow({ k, t, active, onClick }) {
  const overdue = k.due_date && new Date(k.due_date) < new Date();
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      <div className="rounded-md flex-shrink-0" style={{ width: 16, height: 16, border: `2px solid ${t.borderStrong}` }} />
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12, fontWeight: 500, color: t.textPrimary }}>{k.title}</div>
        {k.due_date && <div className="truncate" style={{ fontSize: 11, color: overdue ? SEM.missed : t.textMuted }}>fällig {fmtDateTime(k.due_date, true)}</div>}
      </div>
      {k.priority === "high" && <span style={{ width: 7, height: 7, borderRadius: 99, background: SEM.missed, flexShrink: 0 }} />}
    </button>
  );
}

function TaskDetail({ k, t, customer }) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
        <CheckSquare className="h-4 w-4" style={{ color: t.accent }} />
        <div className="min-w-0"><div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{k.title}</div>
          {k.due_date && <div style={{ fontSize: 11, color: t.textMuted }}>fällig {fmtDateTime(k.due_date, true)}</div>}</div>
      </div>
      <div className="p-4 space-y-2" style={{ fontSize: 13, color: t.textSecondary }}>
        {k.description && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{k.description}</div>}
        {customer && <Field t={t} label="Kunde" value={customer.company_name} />}
        <Link to="/TaskBoard" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg mt-2" style={{ fontSize: 12, background: t.accentSoft, color: t.accent }}><CheckSquare className="h-3.5 w-3.5" /> Im Task-Board öffnen</Link>
      </div>
    </div>
  );
}

function CalViewToggle({ t, calView, setCalView }) {
  return (
    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${t.borderSubtle}`, flexShrink: 0 }}>
      {[["liste", "Liste"], ["grid", "Kalender"]].map(([k, l]) => (
        <button key={k} onClick={() => setCalView(k)} style={{ fontSize: 11, padding: "3px 10px", background: calView === k ? t.accentFill : t.base, color: calView === k ? "#fff" : t.textSecondary, border: "none", cursor: "pointer", fontWeight: calView === k ? 600 : 400 }}>{l}</button>
      ))}
    </div>
  );
}

function CalHeader({ t, label, view, setView, onPrev, onToday, onNext, calView, setCalView }) {
  const navBtn = { fontSize: 12, padding: "3px 9px", borderRadius: 7, border: `1px solid ${t.borderSubtle}`, color: t.textSecondary, background: t.base, cursor: "pointer" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${t.borderSubtle}`, flexShrink: 0, flexWrap: "wrap" }}>
      <Calendar className="h-4 w-4" style={{ color: t.accent }} />
      <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {setCalView && <CalViewToggle t={t} calView={calView} setCalView={setCalView} />}
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${t.borderSubtle}` }}>
          {[["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{ fontSize: 11, padding: "3px 10px", background: view === k ? t.accentFill : t.base, color: view === k ? "#fff" : t.textSecondary, border: "none", cursor: "pointer", fontWeight: view === k ? 600 : 400 }}>{l}</button>
          ))}
        </div>
        <button onClick={onPrev} style={navBtn}>‹</button>
        <button onClick={onToday} style={navBtn}>Heute</button>
        <button onClick={onNext} style={navBtn}>›</button>
      </div>
    </div>
  );
}

// Kalender als Agenda-Liste (kommende Termine, nach Tag gruppiert)
function CalendarAgenda({ events, t, calView, setCalView, onSelect }) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = [...events]
    .filter(e => new Date(e.start_time) >= startToday || (e.end_time && new Date(e.end_time) >= now))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const groups = []; const byKey = new Map();
  for (const e of upcoming) {
    const key = new Date(e.start_time).toDateString();
    if (!byKey.has(key)) { const g = { key, date: new Date(e.start_time), items: [] }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).items.push(e);
  }
  const dayLabel = (d) => {
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startToday) / 86400000);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    return d.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long" });
  };
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${t.borderSubtle}`, flexShrink: 0 }}>
        <Calendar className="h-4 w-4" style={{ color: t.accent }} />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Kalender</span>
        <CalViewToggle t={t} calView={calView} setCalView={setCalView} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {groups.length === 0 ? (
          <div className="text-center py-10 px-4" style={{ color: t.textMuted }}>
            <Calendar className="h-8 w-8 mx-auto mb-2" style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>Keine kommenden Termine</div>
          </div>
        ) : groups.map(g => (
          <div key={g.key}>
            <div style={{ position: "sticky", top: 0, zIndex: 1, background: t.raised, padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: dayLabel(g.date) === "Heute" ? t.accent : t.textSecondary, borderBottom: `1px solid ${t.borderSubtle}` }}>
              {dayLabel(g.date)} · {g.date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}
            </div>
            {g.items.map(e => {
              const st = new Date(e.start_time);
              const et = e.end_time ? new Date(e.end_time) : null;
              const timeStr = e.is_all_day ? "ganztägig"
                : st.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) + (et ? "–" + et.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "");
              return (
                <button key={e.id} onClick={() => onSelect(e)} className="w-full flex items-start gap-3 px-4 py-2.5 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                  <div style={{ width: 104, flexShrink: 0, fontSize: 12, fontWeight: 600, color: t.textSecondary, fontVariantNumeric: "tabular-nums" }}>{timeStr}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13, fontWeight: 500, color: t.textPrimary }}>{e.subject || "(ohne Titel)"}</div>
                    {(e.location || e.organizer_name) && <div className="truncate" style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{[e.location, e.organizer_name].filter(Boolean).join(" · ")}</div>}
                  </div>
                  {e.online_meeting_url && <Video className="h-4 w-4 flex-shrink-0" style={{ color: t.accent, marginTop: 2 }} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarMonth({ events, t, onSelect, calView, setCalView }) {
  const [view, setView] = useState("monat");
  const [off, setOff] = useState(0);
  const scrollRef = useRef(null);
  const today = new Date();

  const HOUR_START = 7, HOUR_END = 21, HOUR_H = 52;
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  useEffect(() => {
    if ((view === "tag" || view === "woche") && scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, (today.getHours() - HOUR_START - 1) * HOUR_H);
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // === TAG ===
  if (view === "tag") {
    const day = new Date(today); day.setDate(today.getDate() + off); day.setHours(0, 0, 0, 0);
    const dayLabel = day.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const dayStr = day.toDateString();
    const dayEvs = events.filter(e => new Date(e.start_time).toDateString() === dayStr);
    const allDay = dayEvs.filter(e => e.is_all_day);
    const timed = dayEvs.filter(e => !e.is_all_day);
    const isToday = day.toDateString() === today.toDateString();
    const nowH = today.getHours() + today.getMinutes() / 60;
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <CalHeader t={t} label={dayLabel} view={view} setView={v => { setView(v); setOff(0); }} onPrev={() => setOff(o => o - 1)} onToday={() => setOff(0)} onNext={() => setOff(o => o + 1)} calView={calView} setCalView={setCalView} />
        {allDay.length > 0 && (
          <div style={{ padding: "4px 4px 4px 48px", borderBottom: `1px solid ${t.borderSubtle}`, display: "flex", flexWrap: "wrap", gap: 3, flexShrink: 0 }}>
            {allDay.map(e => <button key={e.id} onClick={() => onSelect(e)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: t.accentFill, color: "#fff", border: "none", cursor: "pointer" }}>{e.subject || "Termin"}</button>)}
          </div>
        )}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>
          <div style={{ position: "relative" }}>
            {hours.map(h => (
              <div key={h} style={{ height: HOUR_H, display: "flex", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: t.textMuted, paddingTop: 2, textAlign: "right", paddingRight: 8 }}>{String(h).padStart(2, "0")}:00</div>
                <div style={{ flex: 1 }} />
              </div>
            ))}
            {isToday && nowH >= HOUR_START && nowH <= HOUR_END && (
              <div style={{ position: "absolute", left: 44, right: 0, top: (nowH - HOUR_START) * HOUR_H, height: 2, background: SEM.missed, zIndex: 3, pointerEvents: "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: SEM.missed, position: "absolute", left: -4, top: -3 }} />
              </div>
            )}
            <div style={{ position: "absolute", top: 0, left: 48, right: 4, bottom: 0, pointerEvents: "none" }}>
              {timed.map(e => {
                const st = new Date(e.start_time), et = e.end_time ? new Date(e.end_time) : new Date(st.getTime() + 3600000);
                const stH = st.getHours() + st.getMinutes() / 60, etH = et.getHours() + et.getMinutes() / 60;
                const top = Math.max(0, (stH - HOUR_START) * HOUR_H);
                const height = Math.max(22, (Math.min(etH, HOUR_END) - Math.max(stH, HOUR_START)) * HOUR_H);
                return (
                  <button key={e.id} onClick={() => onSelect(e)} style={{ pointerEvents: "all", position: "absolute", left: 0, right: 0, top, height, background: t.accentFill, color: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 8px", textAlign: "left", overflow: "hidden", border: "none", cursor: "pointer", zIndex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 10, opacity: 0.85 }}>{st.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}{e.end_time ? " – " + et.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject || "Termin"}</div>
                    {e.location && <div style={{ fontSize: 9, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.location}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === WOCHE ===
  if (view === "woche") {
    const weekStart = new Date(today);
    const dow = (today.getDay() + 6) % 7;
    weekStart.setDate(today.getDate() - dow + off * 7);
    weekStart.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
    const weekLabel = days[0].toLocaleDateString("de-CH", { day: "2-digit", month: "short" }) + " – " + days[6].toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" });
    const evForDay = (d) => events.filter(e => new Date(e.start_time).toDateString() === d.toDateString());
    const nowH = today.getHours() + today.getMinutes() / 60;
    const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const hasAllDay = days.some(d => evForDay(d).some(e => e.is_all_day));
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <CalHeader t={t} label={weekLabel} view={view} setView={v => { setView(v); setOff(0); }} onPrev={() => setOff(o => o - 1)} onToday={() => setOff(0)} onNext={() => setOff(o => o + 1)} calView={calView} setCalView={setCalView} />
        <div style={{ display: "flex", borderBottom: `1px solid ${t.borderStrong}`, flexShrink: 0 }}>
          <div style={{ width: 44, flexShrink: 0 }} />
          {days.map((d, i) => {
            const isT = d.toDateString() === today.toDateString();
            return (
              <div key={i} style={{ flex: 1, textAlign: "center", padding: "3px 2px", background: isT ? t.accentSoft : "transparent", borderLeft: i > 0 ? `1px solid ${t.borderSubtle}` : "none" }}>
                <div style={{ fontSize: 10, color: t.textMuted }}>{DOW[i]}</div>
                <div style={{ fontSize: 13, fontWeight: isT ? 700 : 400, color: isT ? t.accent : t.textPrimary }}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>
        {hasAllDay && (
          <div style={{ display: "flex", borderBottom: `1px solid ${t.borderSubtle}`, minHeight: 22, flexShrink: 0 }}>
            <div style={{ width: 44, flexShrink: 0, fontSize: 9, color: t.textMuted, textAlign: "right", paddingRight: 6, paddingTop: 4 }}>ganzt.</div>
            {days.map((d, i) => (
              <div key={i} style={{ flex: 1, padding: "2px 1px", borderLeft: i > 0 ? `1px solid ${t.borderSubtle}` : "none" }}>
                {evForDay(d).filter(e => e.is_all_day).map(e => (
                  <button key={e.id} onClick={() => onSelect(e)} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 9, padding: "1px 3px", borderRadius: 3, background: t.accentFill, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", cursor: "pointer", marginBottom: 1 }}>{e.subject || "Termin"}</button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", position: "relative" }}>
            <div style={{ width: 44, flexShrink: 0 }}>
              {hours.map(h => (
                <div key={h} style={{ height: HOUR_H, fontSize: 10, color: t.textMuted, paddingTop: 2, textAlign: "right", paddingRight: 8, borderBottom: `1px solid ${t.borderSubtle}` }}>
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((d, di) => {
              const isT = d.toDateString() === today.toDateString();
              const dayEvs = evForDay(d).filter(e => !e.is_all_day);
              return (
                <div key={di} style={{ flex: 1, position: "relative", borderLeft: `1px solid ${t.borderSubtle}`, background: isT ? t.accentSoft : "transparent" }}>
                  {hours.map(h => <div key={h} style={{ height: HOUR_H, borderBottom: `1px solid ${t.borderSubtle}` }} />)}
                  {isT && nowH >= HOUR_START && nowH <= HOUR_END && (
                    <div style={{ position: "absolute", left: 0, right: 0, top: (nowH - HOUR_START) * HOUR_H, height: 2, background: SEM.missed, zIndex: 3, pointerEvents: "none" }} />
                  )}
                  {dayEvs.map(e => {
                    const st = new Date(e.start_time), et = e.end_time ? new Date(e.end_time) : new Date(st.getTime() + 3600000);
                    const stH = st.getHours() + st.getMinutes() / 60, etH = et.getHours() + et.getMinutes() / 60;
                    const top = Math.max(0, (stH - HOUR_START) * HOUR_H);
                    const height = Math.max(18, (Math.min(etH, HOUR_END) - Math.max(stH, HOUR_START)) * HOUR_H);
                    return (
                      <button key={e.id} onClick={() => onSelect(e)} style={{ position: "absolute", left: 2, right: 2, top, height, background: t.accentFill, color: "#fff", borderRadius: 4, fontSize: 9, padding: "1px 4px", textAlign: "left", overflow: "hidden", border: "none", cursor: "pointer", zIndex: 1 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{st.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} {e.subject || "Termin"}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // === MONAT ===
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + off);
  const year = base.getFullYear(), month = base.getMonth();
  const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const byDay = {};
  for (const e of events) {
    const d = new Date(e.start_time);
    if (d.getFullYear() === year && d.getMonth() === month) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(e);
  }
  const isToday = (d) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
  const monthName = base.toLocaleDateString("de-CH", { month: "long", year: "numeric" });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CalHeader t={t} label={monthName} view={view} setView={v => { setView(v); setOff(0); }} onPrev={() => setOff(o => o - 1)} onToday={() => setOff(0)} onNext={() => setOff(o => o + 1)} calView={calView} setCalView={setCalView} />
      <div style={{ padding: "8px 12px", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => (
            <div key={d} style={{ fontSize: 10, color: t.textMuted, textAlign: "center", paddingBottom: 4 }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "minmax(56px,1fr)", gap: 4, flex: 1, minHeight: 0 }}>
          {cells.map((d, i) => d ? (
            <div key={i}
              onClick={() => { const cd = new Date(year, month, d); const diff = Math.round((cd - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000); setView("tag"); setOff(diff); }}
              style={{ border: `1px solid ${t.borderSubtle}`, borderRadius: 8, padding: 4, overflow: "hidden", background: isToday(d) ? t.accentSoft : t.base, display: "flex", flexDirection: "column", minHeight: 0, cursor: "pointer" }}>
              <div style={{ fontSize: 11, fontWeight: isToday(d) ? 700 : 500, color: isToday(d) ? t.accent : t.textSecondary }}>{d}</div>
              <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                {(byDay[d] || []).slice(0, 3).map(e => (
                  <button key={e.id} onClick={(ev) => { ev.stopPropagation(); onSelect(e); }} title={e.subject} style={{ textAlign: "left", fontSize: 9, padding: "1px 4px", borderRadius: 4, background: t.accentFill, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", cursor: "pointer" }}>
                    {!e.is_all_day && new Date(e.start_time).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) + " "}{e.subject || "Termin"}
                  </button>
                ))}
                {(byDay[d] || []).length > 3 && <div style={{ fontSize: 9, color: t.textMuted }}>+{(byDay[d]).length - 3} mehr</div>}
              </div>
            </div>
          ) : <div key={i} />)}
        </div>
      </div>
    </div>
  );
}

function Picker({ t, list, onlineIds, pickSearch, setPickSearch, pickSel, setPickSel, groupName, setGroupName, busy, onDirect, onGroup, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: "92vw", maxHeight: "80vh", background: t.raised, borderRadius: 14, border: `1px solid ${t.borderStrong}`, boxShadow: t.shadow, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
          <Users className="h-4 w-4" style={{ color: t.accent }} /><span style={{ fontSize: 14, fontWeight: 600 }}>Neuer Chat</span>
          <button onClick={onClose} className="ml-auto p-1" style={{ color: t.textMuted }}><X className="h-4 w-4" /></button>
        </div>
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg mb-1" style={{ border: `1px solid ${t.borderSubtle}` }}>
            <Search className="h-4 w-4" style={{ color: t.textMuted }} /><input value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Mitarbeiter suchen…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13, color: t.textPrimary }} />
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>Klick = 1:1 · Häkchen + Name = Gruppe</div>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {list.map(u => {
            const sel = pickSel.includes(u.id);
            return (
              <div key={u.id} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ background: sel ? t.activeRow : "transparent" }}>
                <button onClick={() => onDirect(u.id)} disabled={busy} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                  <div className="relative flex-shrink-0">
                    <PersonAvatar user={u} size={30}>
                      {onlineIds?.has(u.id) && <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 99, background: SEM.presence.online, border: "1.5px solid #fff" }} />}
                    </PersonAvatar>
                  </div>
                  <div className="min-w-0"><div className="truncate" style={{ fontSize: 13, fontWeight: 500 }}>{u.full_name || u.email}</div><div className="truncate" style={{ fontSize: 11, color: t.textMuted }}>{u.email}</div></div>
                </button>
                <button onClick={() => setPickSel(p => sel ? p.filter(x => x !== u.id) : [...p, u.id])} className="rounded-md flex items-center justify-center flex-shrink-0" style={{ width: 24, height: 24, border: `1px solid ${sel ? t.accentFill : t.borderSubtle}`, background: sel ? t.accentFill : "transparent", color: "#fff" }}>{sel && <Check className="h-3.5 w-3.5" />}</button>
              </div>
            );
          })}
        </div>
        {pickSel.length > 0 && (
          <div className="p-3 flex items-center gap-2" style={{ borderTop: `1px solid ${t.borderSubtle}` }}>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={`Gruppenname (${pickSel.length})`} className="flex-1 px-2.5 py-2 rounded-lg bg-transparent outline-none" style={{ border: `1px solid ${t.borderSubtle}`, fontSize: 13, color: t.textPrimary }} />
            <button onClick={onGroup} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ background: t.accentFill, color: "#fff", fontSize: 13 }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Gruppe</button>
          </div>
        )}
      </div>
    </div>
  );
}
