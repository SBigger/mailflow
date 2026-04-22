import React, { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { Mail, CalendarClock, CheckSquare, StickyNote } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ThemeContext } from "@/Layout";

// Parse notes field (same logic as CustomerNotesTab)
function parseNotes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[") || t.startsWith("{")) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) return p;
        return [{ text: String(p), date: new Date().toISOString() }];
      } catch { /* */ }
    }
    return [{ text: raw, date: new Date().toISOString() }];
  }
  return [];
}
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

/**
 * Merged activity feed for a customer: Mails + Fristen + Tasks + Notizen.
 * Pure client-side aggregation; reuses existing query keys so invalidations propagate.
 */
export default function CustomerActivityTimeline({ customer, limit = 12 }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const cid = customer?.id;

  const { data: mails = [] } = useQuery({
    queryKey: ["customer-mails-timeline", cid],
    queryFn: () => entities.MailItem.filter({ customer_id: cid }, "-received_date", 30),
    enabled: !!cid,
  });
  const { data: allFristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn:  () => entities.Frist.list("due_date"),
    enabled:  !!cid,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "customer", cid],
    queryFn:  () => entities.Task.filter({ customer_id: cid }, "-created_at"),
    enabled:  !!cid,
  });

  const items = useMemo(() => {
    if (!cid) return [];
    const fristen = allFristen.filter(f => f.customer_id === cid);
    const noteList = parseNotes(customer?.notes);

    const merged = [
      ...mails.map(m => ({
        kind: "mail",
        date: m.received_date || m.created_at,
        title: m.subject || "(ohne Betreff)",
        sub:   m.from_address || "",
      })),
      ...fristen.map(f => ({
        kind:  "frist",
        date:  f.einreichen_datum || f.updated_at || f.created_at || f.due_date,
        title: (f.status === "erledigt" ? "Frist eingereicht · " : "Frist · ") + (f.description || f.title || (f.jahr ? "Jahr " + f.jahr : "")),
        sub:   f.einreichen_notiz || (f.due_date ? "fällig " + formatShort(f.due_date) : ""),
      })),
      ...tasks.map(t => ({
        kind:  "task",
        date:  t.completed_at || t.updated_at || t.created_at,
        title: (t.completed ? "Task erledigt · " : "Task · ") + (t.title || "(ohne Titel)"),
        sub:   "",
      })),
      ...noteList.map(n => ({
        kind:  "note",
        date:  n.date || n.created_at,
        title: "Notiz",
        sub:   stripHtml(n.text || n.content || "").slice(0, 140),
      })),
    ].filter(x => !!x.date);

    merged.sort((a, b) => new Date(b.date) - new Date(a.date));
    return merged.slice(0, limit);
  }, [cid, mails, allFristen, tasks, customer?.notes, limit]);

  const borderColor = isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const subtle      = isArtis ? "#6b826b" : isLight ? "#8080a0" : "#9090b8";
  const cardBg      = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(30,30,34,0.9)";
  const textMain    = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";

  if (!items.length) {
    return (
      <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: 24, textAlign: "center", color: subtle, fontSize: 13 }}>
        Noch keine Aktivität
      </div>
    );
  }

  return (
    <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: 20 }}>
      {items.map((it, i) => {
        const { Icon, dotBorder, dotGlow } = kindStyles(it.kind, isArtis);
        const isLast = i === items.length - 1;
        return (
          <div key={i} style={{ position: "relative", paddingLeft: 28, paddingBottom: isLast ? 0 : 18 }}>
            {!isLast && <div style={{ position: "absolute", left: 10, top: 4, bottom: -4, width: 2, background: borderColor }} />}
            <div style={{
              position: "absolute", left: 5, top: 4, width: 12, height: 12, borderRadius: "50%",
              background: cardBg, border: `2px solid ${dotBorder}`, boxShadow: `0 0 0 3px ${dotGlow}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: textMain, minWidth: 0 }}>
                <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: dotBorder }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
              </div>
              <div style={{ fontSize: 11, color: subtle, flexShrink: 0 }}>{formatRelative(it.date)}</div>
            </div>
            {it.sub && (
              <div style={{ fontSize: 12.5, color: subtle, marginTop: 3, paddingLeft: 22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.sub}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function kindStyles(kind, isArtis) {
  switch (kind) {
    case "mail":  return { Icon: Mail,          dotBorder: "#2e4a7d", dotGlow: "#e3eaf5" };
    case "frist": return { Icon: CalendarClock, dotBorder: "#8a5a00", dotGlow: "#fef0c7" };
    case "task":  return { Icon: CheckSquare,   dotBorder: "#5f3a9c", dotGlow: "#efe4f8" };
    case "note":  return { Icon: StickyNote,    dotBorder: isArtis ? "#4d6a50" : "#6b826b", dotGlow: isArtis ? "#e6ede6" : "#edf2ed" };
    default:      return { Icon: Mail,          dotBorder: "#7a9b7f", dotGlow: "#e6ede6" };
  }
}

function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / 36e5;
  const diffD = diffH / 24;
  if (diffH < 1)  return "gerade";
  if (diffH < 24) return `heute · ${format(d, "HH:mm")}`;
  if (diffD < 2)  return "gestern";
  if (diffD < 7)  return `vor ${Math.floor(diffD)} Tagen`;
  if (diffD < 31) return `vor ${Math.floor(diffD / 7)} Wo`;
  return format(d, "dd. MMM yy", { locale: de });
}

function formatShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return format(d, "dd.MM.yy", { locale: de });
}
