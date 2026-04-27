import React, { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { User, Phone, Mail as MailIcon, CalendarClock, AlertCircle } from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { de } from "date-fns/locale";
import { ThemeContext } from "@/Layout";
import CustomerActivityTimeline from "./CustomerActivityTimeline";
import CallNotePopup from "./CallNotePopup";

function normalizePhone(raw) {
  if (!raw) return "";
  let d = raw.replace(/\s+/g, "").replace(/[-().]/g, "");
  if (d.startsWith("0041")) d = "+41" + d.slice(4);
  else if (d.startsWith("00") && d.length >= 4 && d[2] !== "0") d = "+41" + d.slice(4);
  else if (d.startsWith("0") && d.length >= 2) d = "+41" + d.slice(1);
  return d;
}

/**
 * Overview tab: 2-column layout with activity timeline + sidebar
 * (contact persons + upcoming deadlines). Read-only quick glance.
 */
export default function CustomerOverviewTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const [callPopup, setCallPopup] = useState(null);

  const handleCallPhone = (phone) => {
    setCallPopup({ phone, customerId: customer?.id, customerName: customer?.company_name });
    const clean = normalizePhone(phone).replace(/[^\d+]/g, "");
    if (clean) setTimeout(() => { window.location.href = `tel:${clean}`; }, 80);
  };

  const borderColor = isArtis ? "#e0e8e0" : isLight ? "#e4e4ea" : "#3f3f46";
  const subtle      = isArtis ? "#6b826b" : isLight ? "#8080a0" : "#9090b8";
  const textMain    = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const cardBg      = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(30,30,34,0.9)";
  const accent      = isArtis ? "#4d6a50" : "#5b21b6";

  const contacts = Array.isArray(customer?.contact_persons) ? customer.contact_persons : [];

  const { data: allFristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn:  () => entities.Frist.list("due_date"),
    enabled:  !!customer?.id,
  });

  const upcoming = allFristen
    .filter(f => f.customer_id === customer?.id && f.status !== "erledigt" && f.due_date)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5);

  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16 }}>
      {/* ── Left: Activity Timeline ─────────────────────────── */}
      <div>
        <SectionHeader label="Aktivität" subtle={subtle} />
        <CustomerActivityTimeline customer={customer} limit={12} />
      </div>

      {/* ── Right: Sidebar ──────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Ansprechpartner */}
        <div>
          <SectionHeader label="Ansprechpartner" subtle={subtle} count={contacts.length} />
          <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: contacts.length ? 10 : 16 }}>
            {contacts.length === 0 ? (
              <div style={{ textAlign: "center", fontSize: 12.5, color: subtle }}>Keine Kontakte erfasst</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {contacts.slice(0, 4).map((cp, idx) => (
                  <ContactRow
                    key={idx}
                    cp={cp}
                    isArtis={isArtis}
                    isLight={isLight}
                    textMain={textMain}
                    subtle={subtle}
                    accent={accent}
                    onCallPhone={handleCallPhone}
                  />
                ))}
                {contacts.length > 4 && (
                  <div style={{ fontSize: 11, color: subtle, textAlign: "center", paddingTop: 2 }}>
                    +{contacts.length - 4} weitere
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Nächste Fristen */}
        <div>
          <SectionHeader label="Nächste Fristen" subtle={subtle} count={upcoming.length} />
          <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: upcoming.length ? 10 : 16 }}>
            {upcoming.length === 0 ? (
              <div style={{ textAlign: "center", fontSize: 12.5, color: subtle }}>Keine offenen Fristen</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {upcoming.map((f) => (
                  <FristRow key={f.id} frist={f} textMain={textMain} subtle={subtle} borderColor={borderColor} />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>

    {callPopup && (
      <CallNotePopup
        open={!!callPopup}
        onClose={() => setCallPopup(null)}
        phone={callPopup.phone}
        customerId={callPopup.customerId}
        customerName={callPopup.customerName}
      />
    )}
    </>
  );
}

function SectionHeader({ label, subtle, count }) {
  return (
    <div style={{
      fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em",
      color: subtle, fontWeight: 700, marginBottom: 8,
      display: "flex", alignItems: "center", gap: 6,
    }}>
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>· {count}</span>
      )}
    </div>
  );
}

function ContactRow({ cp, isArtis, isLight, textMain, subtle, accent, onCallPhone }) {
  const name = [cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ");
  const avatarBg = isArtis ? "#e6ede6" : isLight ? "#eef0fb" : "rgba(63,63,70,0.4)";
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "4px 2px" }}>
      <div style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: "50%",
        background: avatarBg, color: accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 600,
      }}>
        {initials(cp) || <User size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name || "–"}
          {cp.role && <span style={{ color: subtle, fontWeight: 400 }}> · {cp.role}</span>}
        </div>
        {cp.email && (
          <div style={{ fontSize: 11.5, color: subtle, display: "flex", alignItems: "center", gap: 4, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <MailIcon size={11} /> {cp.email}
          </div>
        )}
        {cp.phone && (
          <div
            onClick={() => onCallPhone && onCallPhone(cp.phone)}
            title="Anrufen mit Notiz"
            style={{
              fontSize: 11.5, color: subtle, display: "flex", alignItems: "center",
              gap: 4, marginTop: 1, cursor: onCallPhone ? "pointer" : "default",
            }}
            onMouseEnter={e => { if (onCallPhone) e.currentTarget.style.color = "#16a34a"; }}
            onMouseLeave={e => { e.currentTarget.style.color = subtle; }}
          >
            <Phone size={11} /> {cp.phone}
          </div>
        )}
      </div>
    </div>
  );
}

function initials(cp) {
  const v = (cp.vorname || "").trim();
  const n = (cp.name || "").trim();
  if (!v && !n) return "";
  return ((v[0] || "") + (n[0] || "")).toUpperCase();
}

function FristRow({ frist, textMain, subtle, borderColor }) {
  const due = new Date(frist.due_date);
  const days = isNaN(due.getTime()) ? null : differenceInCalendarDays(due, new Date());
  const overdue = days !== null && days < 0;
  const urgent  = days !== null && days >= 0 && days <= 7;
  const accentColor = overdue ? "#8a2d2d" : urgent ? "#8a5a00" : subtle;
  const dateLabel = isNaN(due.getTime()) ? frist.due_date : format(due, "dd.MM.yy", { locale: de });
  const relLabel  = days === null ? "" :
                    overdue ? `${Math.abs(days)} T überfällig` :
                    days === 0 ? "heute" :
                    days === 1 ? "morgen" :
                    `in ${days} T`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px" }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 8,
        background: overdue ? "#fde7e7" : urgent ? "#fef0c7" : "transparent",
        border: overdue || urgent ? "none" : `1px solid ${borderColor}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accentColor,
      }}>
        {overdue ? <AlertCircle size={14} /> : <CalendarClock size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {frist.description || frist.title || (frist.jahr ? `Jahr ${frist.jahr}` : "Frist")}
        </div>
        <div style={{ fontSize: 11, color: accentColor, marginTop: 1, fontWeight: 500 }}>
          {dateLabel}{relLabel ? ` · ${relLabel}` : ""}
        </div>
      </div>
    </div>
  );
}
