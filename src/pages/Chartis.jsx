import React, { useState, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, supabase, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import ChartisPanel from "@/components/chartis/ChartisPanel";
import {
  MessageSquare, Plus, Users, Lock, AtSign, Inbox, FolderOpen, X, Search, Check, Loader2,
} from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { key: "tag",     label: "Mein Tag", icon: Inbox },
  { key: "erwaehnt", label: "Erwähnt", icon: AtSign },
  { key: "direkt",  label: "Direkt",   icon: Users },
  { key: "objekte", label: "Objekte",  icon: FolderOpen },
  { key: "alle",    label: "Alle",     icon: MessageSquare },
];

export default function Chartis() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [tab, setTab] = useState("tag");
  const [activeId, setActiveId] = useState(null);
  const [picker, setPicker] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickSel, setPickSel] = useState([]); // user-ids für Gruppe
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  const panelBg  = isArtis ? "#f8faf8" : isLight ? "#ffffff" : "#18181b";
  const sideBg   = isArtis ? "#f2f5f2" : isLight ? "#f7f7fb" : "#1d1d20";
  const textMain = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted= isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border   = isArtis ? "#ccd8cc" : isLight ? "#e2e2ee" : "rgba(63,63,70,0.5)";
  const accent   = isArtis ? "#7a9b7f" : "#6366f1";

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => auth.me() });
  const { data: users = [] } = useQuery({ queryKey: ["chartisUsers"], queryFn: () => entities.User.list("full_name"), staleTime: 300000 });
  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);

  // Direkt-/Gruppen-Fäden, in denen ich teilnehme
  const { data: myThreads = [], error: thErr } = useQuery({
    queryKey: ["chartisMyThreads", me?.id],
    enabled: !!me?.id,
    refetchInterval: 12000,
    queryFn: async () => {
      const { data: parts } = await supabase.from("chartis_participants").select("thread_id").eq("user_id", me.id);
      const ids = (parts || []).map(p => p.thread_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("chartis_threads")
        .select("*, chartis_participants(user_id)").in("id", ids).order("updated_at", { ascending: false });
      return data || [];
    },
  });

  // Objekt-Fäden (zuletzt aktiv)
  const { data: objektThreads = [] } = useQuery({
    queryKey: ["chartisObjektThreads"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase.from("chartis_threads").select("*")
        .eq("thread_type", "objekt").order("updated_at", { ascending: false }).limit(50);
      return data || [];
    },
  });

  // Erwähnungen
  const { data: mentions = [] } = useQuery({
    queryKey: ["chartisMentions", me?.id],
    enabled: !!me?.id,
    refetchInterval: 12000,
    queryFn: async () => {
      const { data } = await supabase.from("chartis_mentions").select("thread_id, seen").eq("user_id", me.id);
      return data || [];
    },
  });
  const mentionIds = useMemo(() => new Set(mentions.map(m => m.thread_id)), [mentions]);
  const unseenMentions = mentions.filter(m => !m.seen).length;

  const tablesMissing = thErr && /relation .*chartis|does not exist|thread_type/i.test(thErr.message || "");

  function title(t) {
    if (t.thread_type === "direkt") {
      const other = (t.chartis_participants || []).map(p => p.user_id).find(uid => uid !== me?.id);
      return userById[other]?.full_name || userById[other]?.email || "Direkt";
    }
    if (t.thread_type === "gruppe") return t.subject || "Gruppe";
    return t.subject || "Objekt";
  }
  function sub(t) {
    if (t.thread_type === "direkt") return "Direktnachricht";
    if (t.thread_type === "gruppe") return `Gruppe · ${(t.chartis_participants || []).length} Teilnehmer`;
    return t.module || "Objekt";
  }

  const list = useMemo(() => {
    const dm = myThreads;
    const obj = objektThreads;
    if (tab === "direkt") return dm;
    if (tab === "objekte") return obj;
    if (tab === "erwaehnt") return [...dm, ...obj].filter(t => mentionIds.has(t.id));
    if (tab === "alle") return [...dm, ...obj];
    // Mein Tag: meine DMs + erwähnte Objekt-Fäden
    return [...dm, ...obj.filter(t => mentionIds.has(t.id))];
  }, [tab, myThreads, objektThreads, mentionIds]);

  const activeThread = useMemo(
    () => [...myThreads, ...objektThreads].find(t => t.id === activeId),
    [activeId, myThreads, objektThreads]);

  async function openDirect(otherId) {
    if (!me?.id) return;
    setBusy(true);
    try {
      const existing = myThreads.find(t => {
        if (t.thread_type !== "direkt") return false;
        const ids = (t.chartis_participants || []).map(p => p.user_id);
        return ids.length === 2 && ids.includes(me.id) && ids.includes(otherId);
      });
      if (existing) { setActiveId(existing.id); setPicker(false); return; }
      const other = userById[otherId];
      const { data: th, error } = await supabase.from("chartis_threads")
        .insert({ thread_type: "direkt", subject: other?.full_name || "Direkt", created_by: me.id, owner_id: me.id })
        .select("id").single();
      if (error) throw error;
      const { error: pErr } = await supabase.from("chartis_participants")
        .insert([{ thread_id: th.id, user_id: me.id }, { thread_id: th.id, user_id: otherId }]);
      if (pErr) throw pErr;
      await qc.invalidateQueries({ queryKey: ["chartisMyThreads", me.id] });
      setActiveId(th.id); setPicker(false);
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  async function createGroup() {
    if (!me?.id || !groupName.trim() || pickSel.length === 0) { toast.info("Name + mind. 1 Person wählen"); return; }
    setBusy(true);
    try {
      const { data: th, error } = await supabase.from("chartis_threads")
        .insert({ thread_type: "gruppe", subject: groupName.trim(), created_by: me.id, owner_id: me.id })
        .select("id").single();
      if (error) throw error;
      const ids = [me.id, ...pickSel].filter((v, i, a) => a.indexOf(v) === i);
      const { error: pErr } = await supabase.from("chartis_participants")
        .insert(ids.map(uid => ({ thread_id: th.id, user_id: uid })));
      if (pErr) throw pErr;
      await qc.invalidateQueries({ queryKey: ["chartisMyThreads", me.id] });
      setActiveId(th.id); setPicker(false); setGroupName(""); setPickSel([]);
    } catch (e) { toast.error("Fehler: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  const pickList = users.filter(u => u.id !== me?.id &&
    ((u.full_name || "").toLowerCase().includes(pickSearch.toLowerCase()) || (u.email || "").toLowerCase().includes(pickSearch.toLowerCase())));

  return (
    <div className="h-full flex" style={{ backgroundColor: panelBg, color: textMain }}>
      {/* Linke Spalte */}
      <div className="flex flex-col flex-shrink-0 border-r" style={{ width: 320, borderColor: border, backgroundColor: sideBg }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: border }}>
          <MessageSquare className="h-5 w-5" style={{ color: accent }} />
          <span className="text-base font-bold">Chartis</span>
          {unseenMentions > 0 && (
            <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "#ef4444", color: "#fff" }}>{unseenMentions}</span>
          )}
          <button onClick={() => setPicker(true)} title="Neuer Chat"
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: accent, color: "#fff" }}>
            <Plus className="h-3.5 w-3.5" /> Neuer Chat
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-2 py-2 border-b overflow-x-auto" style={{ borderColor: border }}>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
              style={tab === key ? { background: accent, color: "#fff" } : { color: textMuted }}>
              <Icon className="h-3 w-3" /> {label}
              {key === "erwaehnt" && unseenMentions > 0 && <span className="text-[10px]">({unseenMentions})</span>}
            </button>
          ))}
        </div>

        {/* Faden-Liste */}
        <div className="flex-1 overflow-y-auto">
          {tablesMissing ? (
            <div className="m-3 text-xs p-3 rounded-lg" style={{ color: "#92400e", background: "#fef3c7" }}>
              Chartis-Tabellen/Spalten fehlen. Bitte beide Migrationen im Supabase-SQL-Editor ausführen.
            </div>
          ) : list.length === 0 ? (
            <div className="text-center text-xs py-8" style={{ color: textMuted }}>
              Keine Chats hier.<br />Starte oben mit „Neuer Chat".
            </div>
          ) : list.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b text-left"
              style={{ borderColor: border, background: activeId === t.id ? (isArtis ? "#e6ede6" : isLight ? "#eef0fb" : "rgba(99,102,241,0.12)") : "transparent" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: t.thread_type === "objekt" ? "#e0e7ff" : "#dcfce7", color: t.thread_type === "objekt" ? "#3730a3" : "#166534" }}>
                {t.thread_type === "gruppe" ? <Users className="h-4 w-4" /> : t.thread_type === "objekt" ? <FolderOpen className="h-4 w-4" /> : (title(t)[0] || "?")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{title(t)}</div>
                <div className="text-[11px] truncate" style={{ color: textMuted }}>{sub(t)}</div>
              </div>
              {mentionIds.has(t.id) && <AtSign className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#ef4444" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Rechte Spalte: aktiver Faden */}
      <div className="flex-1 min-w-0">
        {activeThread ? (
          <ChartisPanel
            key={activeThread.id}
            threadId={activeThread.id}
            titleOverride={title(activeThread)}
            directMode={activeThread.thread_type !== "objekt"}
            embedded
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2" style={{ color: textMuted }}>
            <MessageSquare className="h-10 w-10" style={{ opacity: 0.3 }} />
            <div className="text-sm">Wähle links einen Chat oder starte einen neuen.</div>
          </div>
        )}
      </div>

      {/* Neuer-Chat-Picker */}
      {picker && (
        <div onClick={() => setPicker(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: "92vw", maxHeight: "80vh", background: panelBg, borderRadius: 14, border: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: border }}>
              <Users className="h-4 w-4" style={{ color: accent }} />
              <span className="text-sm font-bold">Neuer Chat</span>
              <button onClick={() => setPicker(false)} className="ml-auto p-1" style={{ color: textMuted }}><X className="h-4 w-4" /></button>
            </div>
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border mb-2" style={{ borderColor: border }}>
                <Search className="h-4 w-4" style={{ color: textMuted }} />
                <input value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Mitarbeiter suchen…"
                  className="flex-1 bg-transparent outline-none text-sm" style={{ color: textMain }} />
              </div>
              <div className="text-[11px] mb-1" style={{ color: textMuted }}>
                Klick = 1:1-Chat · Mehrfachauswahl + Name = Gruppe
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {pickList.map(u => {
                const sel = pickSel.includes(u.id);
                return (
                  <div key={u.id} className="flex items-center gap-2 px-2 py-2 rounded-lg" style={{ background: sel ? (isArtis ? "#e6ede6" : "#eef0fb") : "transparent" }}>
                    <button onClick={() => openDirect(u.id)} disabled={busy} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: 600 }}>
                        {(u.full_name || u.email || "?")[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{u.full_name || u.email}</div>
                        <div className="text-[11px] truncate" style={{ color: textMuted }}>{u.email}</div>
                      </div>
                    </button>
                    <button onClick={() => setPickSel(p => sel ? p.filter(x => x !== u.id) : [...p, u.id])}
                      title="Für Gruppe auswählen"
                      className="w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0"
                      style={{ borderColor: sel ? accent : border, background: sel ? accent : "transparent", color: "#fff" }}>
                      {sel && <Check className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
            {pickSel.length > 0 && (
              <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: border }}>
                <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={`Gruppenname (${pickSel.length})`}
                  className="flex-1 px-2.5 py-2 rounded-lg border bg-transparent outline-none text-sm" style={{ borderColor: border, color: textMain }} />
                <button onClick={createGroup} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: accent, color: "#fff" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Gruppe
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
