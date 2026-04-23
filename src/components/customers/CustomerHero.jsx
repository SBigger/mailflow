import React, { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { Badge } from "@/components/ui/badge";
import {
  Building2, UserRound, MapPin, Phone, Mail as MailIcon,
  FileText, Plus, CalendarClock, CheckSquare, Users as UsersIcon,
} from "lucide-react";
import { ThemeContext } from "@/Layout";

/**
 * Compact hero header for customer profile view.
 * Shows avatar, name, meta (UID/addr/phone/email), tags and KPIs (offene Mails + Fristen).
 * Also emits quick-action callbacks via onAction(kind) where kind ∈ 'frist'|'task'|'kontakt'|'dokument'|'notiz'|'portal'.
 */
export default function CustomerHero({ customer, onAction }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const accent     = isArtis ? "#7a9b7f" : "#7c3aed";
  const accentDark = isArtis ? "#4d6a50" : "#5b21b6";
  const borderColor= isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const subtle     = isArtis ? "#6b826b" : isLight ? "#8080a0" : "#9090b8";
  const textMain   = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const heroBg     = isArtis ? "linear-gradient(180deg,#ffffff 0%,#f7faf7 100%)"
                             : isLight ? "linear-gradient(180deg,#ffffff 0%,#f7f7fb 100%)"
                             : "linear-gradient(180deg,rgba(30,30,34,0.9) 0%,rgba(24,24,27,0.9) 100%)";

  const isPrivat = customer.person_type === "privatperson";
  const initials = useMemo(() => makeInitials(customer.company_name || `${customer.vorname || ""} ${customer.nachname || ""}`), [customer]);
  const addrLine = [customer.strasse, [customer.plz, customer.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  // KPI data
  const { data: mails = [] } = useQuery({
    queryKey: ["customer-mails-count", customer.id],
    queryFn:  () => entities.MailItem.filter({ customer_id: customer.id }, "-received_date", 100),
    enabled:  !!customer.id,
  });
  const { data: allFristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn:  () => entities.Frist.list("due_date"),
    enabled:  !!customer.id,
  });

  const openMails   = mails.filter(m => m.is_read === false).length;
  const openFristen = allFristen.filter(f => f.customer_id === customer.id && f.status !== "erledigt").length;
  const nextFrist   = allFristen
    .filter(f => f.customer_id === customer.id && f.status !== "erledigt" && f.due_date)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  const oldestMail = mails.filter(m => m.is_read === false)
    .sort((a, b) => new Date(a.received_date || 0) - new Date(b.received_date || 0))[0];

  return (
    <div style={{ background: heroBg, padding: "20px 28px 18px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
        <div style={{
          flexShrink: 0, width: 64, height: 64, borderRadius: 16,
          background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: 700, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}>
          {isPrivat && !initials ? <UserRound size={28} /> : initials || <Building2 size={28} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: accentDark, fontWeight: 700, marginBottom: 4 }}>
            {isPrivat ? "Privatperson" : "Unternehmen"}
            {customer.aktiv === false && <span style={{ marginLeft: 8, color: "#8a2d2d" }}>· INAKTIV</span>}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.01em", color: textMain, lineHeight: 1.2 }}>
            {customer.company_name || "Ohne Name"}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 8, fontSize: 12.5, color: subtle, flexWrap: "wrap" }}>
            {customer.portal_uid && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <FileText size={13} /> {customer.portal_uid}
              </span>
            )}
            {addrLine && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <MapPin size={13} /> {addrLine}{customer.kanton ? ` · ${customer.kanton}` : ""}
              </span>
            )}
            {customer.phone && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Phone size={13} /> {customer.phone}
              </span>
            )}
            {customer.email && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <MailIcon size={13} /> {customer.email}
              </span>
            )}
          </div>
          {customer.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
              {customer.tags.slice(0, 6).map(tag => (
                <Badge key={tag} variant="outline" style={{ fontSize: 10.5, padding: "1px 8px", borderColor: isArtis ? "#bfcfbf" : "#d4dcd4", color: accentDark, background: isArtis ? "#e6ede6" : "#f2f5f2" }}>
                  {tag}
                </Badge>
              ))}
              {customer.tags.length > 6 && <span style={{ fontSize: 11, color: subtle }}>+{customer.tags.length - 6}</span>}
            </div>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginTop: 16 }}>
        <KpiCard
          value={openMails}
          label="Offene Mails"
          hint={oldestMail ? `älteste: ${relDate(oldestMail.received_date)}` : "alles gelesen"}
          accent={openMails > 0 ? "#8a2d2d" : subtle}
          bg={openMails > 0 ? "#fde7e7" : (isArtis ? "#f7faf7" : "#f7f7fb")}
          borderColor={borderColor}
          subtle={subtle}
        />
        <KpiCard
          value={openFristen}
          label="Fristen offen"
          hint={nextFrist?.due_date ? `nächste: ${formatDate(nextFrist.due_date)}` : "keine offen"}
          accent={openFristen > 0 ? "#8a5a00" : subtle}
          bg={openFristen > 0 ? "#fef0c7" : (isArtis ? "#f7faf7" : "#f7f7fb")}
          borderColor={borderColor}
          subtle={subtle}
        />
      </div>

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <QuickBtn icon={CalendarClock} label="Frist"    onClick={() => onAction?.("frist")}    accent={accentDark} borderColor={borderColor} isArtis={isArtis} isLight={isLight} />
        <QuickBtn icon={CheckSquare}   label="Task"     onClick={() => onAction?.("task")}     accent={accentDark} borderColor={borderColor} isArtis={isArtis} isLight={isLight} />
        <QuickBtn icon={UsersIcon}     label="Kontakt"  onClick={() => onAction?.("kontakt")}  accent={accentDark} borderColor={borderColor} isArtis={isArtis} isLight={isLight} />
        <QuickBtn icon={FileText}      label="Dokument" onClick={() => onAction?.("dokument")} accent={accentDark} borderColor={borderColor} isArtis={isArtis} isLight={isLight} />
        <QuickBtn icon={Plus}          label="Notiz"    onClick={() => onAction?.("notiz")}    accent={accentDark} borderColor={borderColor} isArtis={isArtis} isLight={isLight} />
      </div>
    </div>
  );
}

function KpiCard({ value, label, hint, accent, bg, borderColor, subtle }) {
  return (
    <div style={{
      background: bg, border: `1px solid ${borderColor}`, borderRadius: 12,
      padding: "12px 14px", position: "relative", overflow: "hidden",
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1, color: accent }}>{value}</div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: subtle, fontWeight: 600, marginTop: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: accent, marginTop: 3, fontWeight: 500 }}>{hint}</div>}
    </div>
  );
}

function QuickBtn({ icon: Icon, label, onClick, accent, borderColor, isArtis, isLight }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        padding: "8px 6px", borderRadius: 9,
        background: isArtis ? "#f7faf7" : isLight ? "#f7f7fb" : "rgba(24,24,27,0.6)",
        border: `1px solid ${borderColor}`, cursor: "pointer",
        transition: "background .15s, border-color .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = isArtis ? "#edf2ed" : isLight ? "#eeeef4" : "rgba(63,63,70,0.4)"; e.currentTarget.style.borderColor = accent + "55"; }}
      onMouseLeave={e => { e.currentTarget.style.background = isArtis ? "#f7faf7" : isLight ? "#f7f7fb" : "rgba(24,24,27,0.6)"; e.currentTarget.style.borderColor = borderColor; }}
    >
      <Icon size={16} style={{ color: accent }} />
      <span style={{ fontSize: 11, color: accent, fontWeight: 500 }}>{label}</span>
    </button>
  );
}

function makeInitials(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffD = (Date.now() - d) / 864e5;
  if (diffD < 1)  return "heute";
  if (diffD < 2)  return "gestern";
  if (diffD < 31) return `vor ${Math.floor(diffD)} T`;
  return d.toLocaleDateString("de-CH");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-CH");
}
