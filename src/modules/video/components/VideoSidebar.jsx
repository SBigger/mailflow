import React, { useContext } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronLeft, LayoutGrid, Video as Cam } from "lucide-react";
import { ThemeContext } from "@/Layout";
import { videoTheme } from "../theme";

// Seitenleiste des Video-Moduls – gleicher Aufbau wie die Telefonie-Leiste,
// damit sich die Module untereinander vertraut anfühlen. Bewusst kurz: In
// Phase 1 gibt es nur die Übersicht; geplante Termine und Aufzeichnungen
// kommen als weitere Einträge dazu.
const NAV = [
  { to: "", label: "Übersicht", icon: LayoutGrid, end: true },
];

export default function VideoSidebar() {
  const { theme } = useContext(ThemeContext);
  const t = videoTheme(theme);
  const navigate = useNavigate();

  return (
    <aside style={{
      width: 216, flexShrink: 0, background: t.sunken,
      borderRight: `1px solid ${t.borderSubtle}`,
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      <div style={{ padding: "14px 14px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, background: t.accent, color: "#fff",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Cam size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.1 }}>
            Besprechungen
          </div>
          <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 600 }}>Artis Treuhand</div>
        </div>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "2px 8px 12px" }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to || "uebersicht"}
              to={`/besprechungen/${item.to}`}
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
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

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
