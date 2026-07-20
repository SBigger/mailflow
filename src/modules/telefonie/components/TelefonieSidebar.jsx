import React, { useContext, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ChevronLeft, LayoutGrid, Clock, Users, Voicemail as VoicemailIcon,
  Settings, PhoneCall, ChevronDown, Radio,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import { tele, PRESENCE } from "../theme";
import { useTelephony } from "../context/TelephonyContext";

const NAV = [
  { to: "",           label: "Cockpit",         icon: LayoutGrid, end: true },
  { to: "verlauf",    label: "Anrufverlauf",    icon: Clock },
  { to: "rufgruppen", label: "Rufgruppen",      icon: Radio },
  { to: "team",       label: "Team & Presence", icon: Users },
  { to: "voicemail",  label: "Voicemail",       icon: VoicemailIcon },
  { to: "einstellungen", label: "Einstellungen", icon: Settings },
];

const PRESENCE_CHOICES = ["available", "busy", "dnd", "away"];

export default function TelefonieSidebar() {
  const { theme } = useContext(ThemeContext);
  const t = tele(theme);
  const navigate = useNavigate();
  const { presence, effectivePresence, setPresence, call } = useTelephony();
  const [presOpen, setPresOpen] = useState(false);

  const cur = PRESENCE[effectivePresence] || PRESENCE.available;
  const dotColor = t.presence[cur.dot] || t.presence.offline;

  return (
    <aside
      style={{
        width: 216, flexShrink: 0, background: t.sunken,
        borderRight: `1px solid ${t.borderSubtle}`,
        display: "flex", flexDirection: "column", height: "100%",
      }}
    >
      {/* Kopf */}
      <div style={{ padding: "14px 14px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: t.accent, color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <PhoneCall size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.1 }}>Telefonie</div>
          <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 600 }}>Artis Treuhand</div>
        </div>
      </div>

      {/* Presence-Wähler */}
      <div style={{ padding: "0 12px 10px", position: "relative" }}>
        <button
          onClick={() => setPresOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            padding: "7px 10px", borderRadius: 9, cursor: "pointer",
            background: t.raised, border: `1px solid ${t.borderSubtle}`, color: t.textPrimary,
            font: "inherit", fontSize: 12, fontWeight: 600,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, boxShadow: `0 0 0 3px ${dotColor}22`, flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: "left" }}>{cur.label}</span>
          {call ? (
            <span style={{ fontSize: 9.5, fontWeight: 700, color: t.textMuted }}>auto</span>
          ) : (
            <ChevronDown size={14} style={{ color: t.textMuted }} />
          )}
        </button>

        {presOpen && !call && (
          <div
            style={{
              position: "absolute", left: 12, right: 12, top: "100%", zIndex: 40, marginTop: 3,
              background: t.raised, border: `1px solid ${t.borderStrong}`, borderRadius: 10,
              boxShadow: t.shadow, overflow: "hidden",
            }}
          >
            {PRESENCE_CHOICES.map((p) => {
              const info = PRESENCE[p];
              return (
                <button
                  key={p}
                  onClick={() => { setPresence(p); setPresOpen(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 11px", cursor: "pointer", border: "none", background: "transparent",
                    font: "inherit", fontSize: 12, color: t.textPrimary,
                    fontWeight: p === presence ? 700 : 500, textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = t.activeRow)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.presence[info.dot], flexShrink: 0 }} />
                  {info.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "2px 8px 12px" }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to || "cockpit"}
              to={`/telefonie/${item.to}`}
              end={item.end}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 11px", borderRadius: 9, fontSize: 12.5,
                marginBottom: 2, textDecoration: "none",
                fontWeight: isActive ? 650 : 500,
                color: isActive ? "#fff" : t.textSecondary,
                background: isActive ? t.accent : "transparent",
                transition: "background .12s",
              })}
              onMouseEnter={(e) => { if (!e.currentTarget.style.background.includes("rgb") && e.currentTarget.getAttribute("aria-current") !== "page") e.currentTarget.style.background = t.activeRow; }}
              onMouseLeave={(e) => { if (e.currentTarget.getAttribute("aria-current") !== "page") e.currentTarget.style.background = "transparent"; }}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Zurück zu smartis */}
      <button
        onClick={() => navigate("/Dashboard")}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "11px 14px", border: "none", borderTop: `1px solid ${t.borderSubtle}`,
          background: "transparent", cursor: "pointer", color: t.textMuted,
          font: "inherit", fontSize: 11.5, fontWeight: 650,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.textPrimary)}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.textMuted)}
      >
        <ChevronLeft size={15} /> Zurück zu smartis
      </button>
    </aside>
  );
}
