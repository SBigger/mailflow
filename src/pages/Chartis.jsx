import React, { useState, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { entities, supabase, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import ChartisPanel from "@/components/chartis/ChartisPanel";
import { chartisTheme, SEM, AUTHOR, authorKey, initials, isMissed } from "@/lib/chartisTheme";
import {
  MessageSquare, Plus, Users, User, Lock, AtSign, LayoutGrid, Building2, Clock,
  PhoneOff, Phone, Mail, Calendar, CheckSquare, X, Search, Check, Loader2, Send,
} from "lucide-react";
import { toast } from "sonner";

export default function Chartis() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const t = chartisTheme(theme);
  const qc = useQueryClient();

  const [scope, setScope] = useState("tag");
  const [activeId, setActiveId] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [search, setSearch] = useState("");
  const [seg, setSeg] = useState("alle");
  const [picker, setPicker] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickSel, setPickSel] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => auth.me() });
  const { data: users = [] } = useQuery({ queryKey: ["chartisUsers"], queryFn: () => entities.User.list("full_name"), staleTime: 300000 });
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
  const { data: missedCalls = [] } = useQuery({
    queryKey: ["chartisMissedCalls", me?.id], enabled: !!me?.id, refetchInterval: 60000,
    queryFn: async () => {
      const { data } = await supabase.from("call_records")
        .select("id,direction,call_type,caller_number,caller_name,artis_user_name,customer_id,start_time,duration_seconds,missed,notes")
        .eq("direction", "incoming").order("start_time", { ascending: false }).limit(120);
      const mine = (data || []).filter(isMissed);
      const own = mine.filter(c => me?.full_name && c.artis_user_name === me.full_name);
      return own.length ? own : mine; // Fallback: Namens-Match leer -> teamweit zeigen
    },
  });
  const mentionIds = useMemo(() => new Set(mentions.map(m => m.thread_id)), [mentions]);
  const unseenMentions = mentions.filter(m => !m.seen).length;
  const tablesMissing = thErr && /relation .*chartis|does not exist|thread_type/i.test(thErr.message || "");

  const isKunde = (th) => th.thread_type === "objekt" && !!th.ext_contact_email;
  const teamObjekt = objektThreads.filter(th => !isKunde(th));
  const kundenThreads = objektThreads.filter(isKunde);

  function title(th) {
    if (th.thread_type === "direkt") {
      const other = (th.chartis_participants || []).map(p => p.user_id).find(uid => uid !== me?.id);
      return userById[other]?.full_name || userById[other]?.email || "Direkt";
    }
    return th.subject || (th.thread_type === "gruppe" ? "Gruppe" : "Objekt");
  }
  function preview(th) {
    if (th.thread_type === "direkt") return "Direktnachricht";
    if (th.thread_type === "gruppe") return `Gruppe · ${(th.chartis_participants || []).length} Teilnehmer`;
    return isKunde(th) ? (th.ext_contact_email || "Kunde") : (th.module || "intern");
  }
  function avatarFor(th) {
    if (th.thread_type === "gruppe") return { icon: Users, ...AUTHOR.team };
    if (th.thread_type === "direkt") {
      const other = (th.chartis_participants || []).map(p => p.user_id).find(uid => uid !== me?.id);
      const u = userById[other];
      return { label: initials(u?.full_name || u?.email), ...AUTHOR[authorKey(u)] };
    }
    return { label: initials(th.subject), ...AUTHOR.staff };
  }

  const scopeMeta = {
    tag: { label: "Heute", icon: LayoutGrid }, direkt: { label: "Direkt", icon: User }, gruppen: { label: "Gruppen", icon: Users },
    erwaehnt: { label: "Erwähnt", icon: AtSign }, kunden: { label: "Kunden-Konversationen", icon: Building2 },
    wartet: { label: "Wartet auf Kunde", icon: Clock }, anrufe: { label: "Entgangene Anrufe", icon: PhoneOff },
  };

  const items = useMemo(() => {
    const dm = myThreads;
    let list;
    if (scope === "direkt") list = dm.filter(x => x.thread_type === "direkt").map(x => ({ type: "thread", x }));
    else if (scope === "gruppen") list = dm.filter(x => x.thread_type === "gruppe").map(x => ({ type: "thread", x }));
    else if (scope === "erwaehnt") list = [...dm, ...objektThreads].filter(x => mentionIds.has(x.id)).map(x => ({ type: "thread", x }));
    else if (scope === "kunden") list = kundenThreads.map(x => ({ type: "thread", x }));
    else if (scope === "wartet") list = kundenThreads.filter(x => x.status === "wartet_kunde").map(x => ({ type: "thread", x }));
    else if (scope === "anrufe") list = missedCalls.map(c => ({ type: "call", c }));
    else list = [ // Heute
      ...missedCalls.slice(0, 4).map(c => ({ type: "call", c })),
      ...dm.map(x => ({ type: "thread", x })),
      ...[...teamObjekt, ...kundenThreads].filter(x => mentionIds.has(x.id) || x.status === "wartet_kunde").map(x => ({ type: "thread", x })),
    ];
    if (seg === "mich") list = list.filter(it => it.type === "call" || mentionIds.has(it.x.id));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(it => it.type === "call"
      ? (it.c.caller_name || it.c.caller_number || "").toLowerCase().includes(q)
      : (title(it.x) + " " + preview(it.x)).toLowerCase().includes(q));
    return list;
  }, [scope, seg, search, myThreads, objektThreads, missedCalls, mentionIds, me]);

  const activeThread = useMemo(() => [...myThreads, ...objektThreads].find(x => x.id === activeId), [activeId, myThreads, objektThreads]);

  async function openDirect(otherId) {
    if (!me?.id) return; setBusy(true);
    try {
      const existing = myThreads.find(x => x.thread_type === "direkt" && (() => { const ids = (x.chartis_participants || []).map(p => p.user_id); return ids.length === 2 && ids.includes(me.id) && ids.includes(otherId); })());
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

  const NavItem = ({ k, icon: Icon, label, count, red }) => (
    <button onClick={() => { setScope(k); setActiveCall(null); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left relative"
      style={{ fontSize: 12, color: scope === k ? t.accent : t.textSecondary, background: scope === k ? t.accentSoft : "transparent", fontWeight: scope === k ? 500 : 400 }}>
      {scope === k && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: t.accentFill }} />}
      <Icon className="h-4 w-4" style={{ color: red ? SEM.missed : undefined }} />
      <span className="truncate flex-1">{label}</span>
      {count > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: red ? SEM.missed : t.accentFill, borderRadius: 9, padding: "0 6px" }}>{count}</span>}
    </button>
  );

  return (
    <div className="h-full flex" style={{ background: t.sunken, color: t.textPrimary }}>
      {/* Pane A — Modul-Rail */}
      <div className="flex flex-col flex-shrink-0" style={{ width: 168, borderRight: `1px solid ${t.borderSubtle}`, background: t.sunken }}>
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="rounded-full flex items-center justify-center" style={{ width: 24, height: 24, background: t.accentFill, color: "#fff", fontSize: 11, fontWeight: 700 }}>C</div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>Chartis</span>
          {unseenMentions > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#fff", background: SEM.missed, borderRadius: 9, padding: "0 6px" }}>{unseenMentions}</span>}
        </div>
        <div className="px-2 overflow-y-auto flex-1">
          <NavItem k="tag" icon={LayoutGrid} label="Heute" />
          <div style={{ fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted, padding: "9px 8px 3px" }}>Team · intern</div>
          <NavItem k="direkt" icon={User} label="Direkt" />
          <NavItem k="gruppen" icon={Users} label="Gruppen" />
          <NavItem k="erwaehnt" icon={AtSign} label="Erwähnt" count={unseenMentions} />
          <div style={{ fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted, padding: "9px 8px 3px" }}>Kunden · extern</div>
          <NavItem k="kunden" icon={Building2} label="Konversationen" count={kundenThreads.length} />
          <NavItem k="wartet" icon={Clock} label="Wartet" />
          <div style={{ height: 6 }} />
          <NavItem k="anrufe" icon={PhoneOff} label="Anrufe" count={missedCalls.length} red />
          <div style={{ borderTop: `1px solid ${t.borderSubtle}`, margin: "8px 6px" }} />
          {[["/MailKanban", Mail, "Mails"], ["/Kalender", Calendar, "Kalender"], ["/TaskBoard", CheckSquare, "Todos"]].map(([to, Icon, label]) => (
            <Link key={to} to={to} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ fontSize: 12, color: t.textSecondary, opacity: 0.9 }}>
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </div>
        <div className="p-2">
          <button onClick={() => setPicker(true)} className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: t.accentFill, color: "#fff", fontSize: 12, fontWeight: 500 }}>
            <Plus className="h-3.5 w-3.5" /> Neuer Chat
          </button>
        </div>
      </div>

      {/* Pane B — Liste */}
      <div className="flex flex-col flex-shrink-0" style={{ width: 250, borderRight: `1px solid ${t.borderSubtle}`, background: t.base }}>
        <div className="px-3 py-3" style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: t.sunken, border: `1px solid ${t.borderSubtle}` }}>
            <Search className="h-4 w-4" style={{ color: t.textMuted }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${scopeMeta[scope].label} durchsuchen…`} className="flex-1 bg-transparent outline-none" style={{ fontSize: 12, color: t.textPrimary }} />
          </div>
          <div className="flex gap-1.5 mt-2">
            {[["alle", "Alle"], ["mich", "@Mich"]].map(([k, l]) => (
              <button key={k} onClick={() => setSeg(k)} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 7, fontWeight: seg === k ? 500 : 400, color: seg === k ? "#fff" : t.textMuted, background: seg === k ? t.accentFill : "transparent" }}>{l}</button>
            ))}
            <span className="ml-auto" style={{ fontSize: 11, fontWeight: 600 }}>{scopeMeta[scope].label}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tablesMissing ? (
            <div className="m-3 text-xs p-3 rounded-lg" style={{ color: "#92400e", background: "#fef3c7" }}>Chartis-Tabellen fehlen. Bitte Migrationen im SQL-Editor ausführen.</div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 px-4" style={{ color: t.textMuted }}>
              <Check className="h-8 w-8 mx-auto mb-2" style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 13, fontWeight: 500 }}>Alles erledigt</div>
              <div style={{ fontSize: 11 }}>Keine offenen Punkte hier.</div>
            </div>
          ) : items.map((it, i) => it.type === "call" ? (
            <button key={"c" + it.c.id} onClick={() => { setActiveId(null); setActiveCall(it.c); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ borderBottom: `1px solid ${t.borderSubtle}`, borderLeft: `3px solid ${SEM.missed}`, paddingLeft: 9, background: activeCall?.id === it.c.id ? t.activeRow : "transparent" }}>
              <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: SEM.missedSoft, color: SEM.missed }}><PhoneOff className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 12, fontWeight: 700 }}>{custById[it.c.customer_id]?.company_name || it.c.caller_name || it.c.caller_number || "Unbekannt"}</div>
                <div className="truncate" style={{ fontSize: 11, color: t.textMuted }}>Entgangener {it.c.call_type === "pstnCall" ? "Anruf" : "Teams-Anruf"}</div>
              </div>
              <span style={{ fontSize: 10, color: SEM.missed, flexShrink: 0 }}>{fmtTime(it.c.start_time)}</span>
            </button>
          ) : (
            <ThreadRow key={it.x.id} th={it.x} t={t} active={activeId === it.x.id} mentioned={mentionIds.has(it.x.id)}
              title={title(it.x)} preview={preview(it.x)} av={avatarFor(it.x)} kunde={isKunde(it.x)}
              onClick={() => { setActiveCall(null); setActiveId(it.x.id); }} />
          ))}
        </div>
      </div>

      {/* Pane C — aktiver Faden / Anruf / Leerstaat */}
      <div className="flex-1 min-w-0" style={{ background: t.raised, boxShadow: t.shadow }}>
        {activeCall ? (
          <CallDetail c={activeCall} t={t} customer={custById[activeCall.customer_id]} />
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

      {picker && <Picker t={t} list={pickList} pickSearch={pickSearch} setPickSearch={setPickSearch} pickSel={pickSel} setPickSel={setPickSel} groupName={groupName} setGroupName={setGroupName} busy={busy} onDirect={openDirect} onGroup={createGroup} onClose={() => setPicker(false)} />}
    </div>
  );
}

function fmtTime(ts) {
  try { const d = new Date(ts); const now = new Date(); const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }); } catch { return ""; }
}

function ThreadRow({ th, t, active, mentioned, title, preview, av, kunde, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-left relative" style={{ borderBottom: `1px solid ${t.borderSubtle}`, background: active ? t.activeRow : "transparent" }}>
      {mentioned && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: t.accentFill }} />}
      <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: av.bg, color: av.text, fontSize: 11, fontWeight: 600 }}>
        {av.icon ? <av.icon className="h-4 w-4" /> : av.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12, fontWeight: mentioned ? 700 : 500, color: t.textPrimary }}>{title}</div>
        <div className="truncate flex items-center gap-1" style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>
          {kunde
            ? <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: SEM.externSoft, color: SEM.extern, fontWeight: 500 }}>Kunde</span>
            : <Lock className="h-2.5 w-2.5" style={{ opacity: 0.6 }} />}
          <span className="truncate">{preview}</span>
        </div>
      </div>
      {mentioned && <AtSign className="h-3.5 w-3.5 flex-shrink-0" style={{ color: t.accent }} />}
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

function Picker({ t, list, pickSearch, setPickSearch, pickSel, setPickSel, groupName, setGroupName, busy, onDirect, onGroup, onClose }) {
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
                  <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, background: AUTHOR[authorKey(u)].bg, color: AUTHOR[authorKey(u)].text, fontSize: 11, fontWeight: 600 }}>{initials(u.full_name || u.email)}</div>
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
