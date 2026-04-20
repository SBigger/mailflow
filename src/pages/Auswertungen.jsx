import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart3,
  FileText,
  ArrowDownCircle,
  CreditCard,
  Users,
  RefreshCw,
  ExternalLink,
  Info,
  X,
  LogIn,
} from "lucide-react";
import { useTheme } from "@/components/useTheme";

// ── Power BI Embed-Konfiguration ──────────────────────────────────────────────
// Report "Artis Auswertungen neu" im Workspace "Artis Treuhand GmbH"
// navContentPaneEnabled=false → blendet die Power-BI-eigene Seitenleiste unten aus
const EMBED_BASE =
  "https://app.powerbi.com/reportEmbed" +
  "?reportId=13a220be-5f7c-490e-9d33-c8fe2b57b438" +
  "&autoAuth=true" +
  "&ctid=cc857d96-3c6e-45ba-afbf-c20d0946d2be" +
  "&navContentPaneEnabled=false";

const PBI_WORKSPACE =
  "https://app.powerbi.com/groups/a39e904f-2669-4744-bac2-66286edd4221" +
  "/reports/13a220be-5f7c-490e-9d33-c8fe2b57b438";

const SECTIONS = {
  fakturierung: {
    label: "Fakturierung",
    icon: FileText,
    pages: [
      { id: "ang",       name: "Angefangene Arbeiten", pageName: "ReportSection" },
      { id: "aaDetails", name: "AA Details",           pageName: "ReportSectionb57c7090fbced2bf4b8b" },
    ],
  },
  debitoren: {
    label: "Debitoren",
    icon: ArrowDownCircle,
    pages: [
      { id: "main",      name: "Übersicht",  pageName: "ReportSection41ecb4dae09ce71b8a29" },
      { id: "mehrjahre", name: "Mehrjahre",  pageName: "ReportSection6c5bfcd7578887cacb06" },
      { id: "grafisch",  name: "Grafisch",   pageName: "ReportSectionf41f0a4509391882b5c4" },
      { id: "rg",        name: "Rechnungen", pageName: "ReportSection9ddfa733016d94cb7bdc" },
    ],
  },
  kreditoren: {
    label: "Kreditoren",
    icon: CreditCard,
    pages: [
      { id: "jahr",  name: "Jahr",      pageName: "ReportSectionc6d97cbe6c245fa819dd" },
      { id: "proMt", name: "Pro Monat", pageName: "ReportSection0ad3eeccae7f9d6d46d9" },
    ],
  },
  produktivitaet: {
    label: "Produktivität",
    icon: Users,
    pages: [
      { id: "total",           name: "Total Stunden",        pageName: "d0ae6245be0970c4ad57" },
      { id: "mitarbeiter",     name: "Mitarbeiter",          pageName: "ReportSectionb9bdf5a78773c54c04da" },
      { id: "mitarbeiterGraf", name: "Mitarbeiter grafisch", pageName: "ReportSection1622be306b42e0d03197" },
      { id: "stundenMa",       name: "Stunden Ma",           pageName: "ReportSectionade5325710d231962ccc" },
    ],
  },
};

const STATE_KEY = "smartis_auswertungen_state_v1";

export default function Auswertungen() {
  const { theme } = useTheme();
  const isDark  = theme === "dark";
  const isArtis = theme === "artis";

  // Theme-Tokens — analog zu Dashboard.jsx
  const pageBg       = isDark ? "#18181b" : isArtis ? "#f2f5f2" : "#f4f4f8";
  const topbarBg     = isDark ? "rgba(24,24,27,0.7)"    : isArtis ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.7)";
  const subtabBg     = isDark ? "rgba(24,24,27,0.5)"    : isArtis ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.55)";
  const pillBg       = isDark ? "rgba(39,39,42,0.6)"    : isArtis ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.75)";
  const cardBorder   = isDark ? "#3f3f46"               : isArtis ? "#bfcfbf"                : "#d0d0dc";
  const heading      = isDark ? "#e4e4e7"               : isArtis ? "#1a3a1a"                : "#1e293b";
  const muted        = isDark ? "#71717a"               : isArtis ? "#5a7a5a"                : "#6b7280";
  const accent       = isDark ? "#818cf8"               : isArtis ? "#7a9b7f"                : "#7c3aed";
  const accentDark   = isDark ? "#6366f1"               : isArtis ? "#3a6640"                : "#5b21b6";
  const hoverBg      = isDark ? "rgba(99,102,241,0.1)"  : isArtis ? "rgba(122,155,127,0.12)" : "rgba(124,58,237,0.08)";
  const titleIconBg  = isDark ? "rgba(129,140,248,0.15)": isArtis ? "rgba(122,155,127,0.18)" : "rgba(124,58,237,0.1)";
  const kvRowBg      = isDark ? "rgba(255,255,255,0.04)": isArtis ? "rgba(122,155,127,0.08)" : "rgba(0,0,0,0.03)";
  const modalBg      = isDark ? "#27272a"               : isArtis ? "#fbfdfb"                : "#ffffff";

  // State (mit Persistenz)
  const initial = useMemo(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      const section = SECTIONS[s.section] ? s.section : "fakturierung";
      const page    = s.page && SECTIONS[section].pages.find(p => p.id === s.page)
          ? s.page
          : SECTIONS[section].pages[0].id;
      return { section, page };
    } catch {
      return { section: "fakturierung", page: SECTIONS.fakturierung.pages[0].id };
    }
  }, []);

  const [currentSection, setCurrentSection] = useState(initial.section);
  const [currentPage, setCurrentPage]       = useState(initial.page);
  const [infoOpen, setInfoOpen]             = useState(false);
  const [reloadKey, setReloadKey]           = useState(0);

  // Im Tauri-Client kann WebView2 Power BI wegen Tracking-Prevention nicht
  // sauber rendern. Stattdessen direkt im externen Browser öffnen.
  const isTauri = typeof window !== "undefined" && !!window.__TAURI__;

  const openInBrowser = (url) => {
    if (isTauri) {
      window.__TAURI__.core.invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  };

  // Öffnet office.com als natives WebView2-Popup (window.open, kein Tauri-Command).
  // Nach dem Microsoft-Login teilt WebView2 die Cookies mit dem Haupt-Fenster.
  const openPowerBiLogin = () => {
    window.open("https://www.office.com", "pbi-login", "width=640,height=800");
  };

  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ section: currentSection, page: currentPage }));
  }, [currentSection, currentPage]);

  const section = SECTIONS[currentSection];
  const page    = section.pages.find(p => p.id === currentPage) || section.pages[0];

  const embedUrl  = `${EMBED_BASE}&pageName=${encodeURIComponent(page.pageName)}`;
  const directUrl = `${PBI_WORKSPACE}/${page.pageName}`;

  const handleSection = (sectionId) => {
    if (sectionId === currentSection) return;
    setCurrentSection(sectionId);
    setCurrentPage(SECTIONS[sectionId].pages[0].id);
  };

  // Icon-Button-Style helper
  const iconBtnHandlers = {
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = heading; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = muted; },
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: pageBg }}>

      {/* ── Topbar: Titel + Section-Pills + Actions ─────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-4 py-2.5 border-b"
        style={{ backgroundColor: topbarBg, borderColor: cardBorder, backdropFilter: "blur(10px)" }}
      >
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg"
            style={{ backgroundColor: titleIconBg, color: accentDark }}
          >
            <BarChart3 className="w-4 h-4" />
          </div>
          <h1 className="text-base font-semibold m-0" style={{ color: heading, letterSpacing: "-0.01em" }}>
            Auswertungen
          </h1>
        </div>

        {/* Section Pills (Hauptnavigation) */}
        <div
          className="flex gap-1 p-0.5 rounded-lg border flex-shrink-0"
          style={{ backgroundColor: pillBg, borderColor: cardBorder }}
          role="tablist"
        >
          {Object.entries(SECTIONS).map(([id, s]) => {
            const Icon = s.icon;
            const active = id === currentSection;
            return (
              <button
                key={id}
                onClick={() => handleSection(id)}
                role="tab"
                aria-selected={active}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active ? accent : "transparent",
                  color: active ? "white" : muted,
                  boxShadow: active ? "0 1px 3px rgba(26,58,26,0.12)" : "none",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = heading; } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = muted; } }}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Action-Buttons */}
        <button
          onClick={() => setReloadKey(k => k + 1)}
          title="Report neu laden"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
          {...iconBtnHandlers}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        {isTauri && (
          <button
            onClick={openPowerBiLogin}
            title="Microsoft / Power BI anmelden (einmalig)"
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
            {...iconBtnHandlers}
          >
            <LogIn className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => openInBrowser(directUrl)}
          title="In Power BI öffnen"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
          {...iconBtnHandlers}
        >
          <ExternalLink className="w-4 h-4" />
        </button>
        <button
          onClick={() => setInfoOpen(true)}
          title="Info"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
          {...iconBtnHandlers}
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      {/* ── Sub-Tabs (Laschen) ──────────────────────────────────────── */}
      {section.pages.length > 1 && (
        <div
          className="flex-shrink-0 flex gap-1 px-4 pt-1.5 border-b overflow-x-auto"
          style={{ backgroundColor: subtabBg, borderColor: cardBorder }}
        >
          {section.pages.map(p => {
            const active = p.id === currentPage;
            return (
              <button
                key={p.id}
                onClick={() => setCurrentPage(p.id)}
                className="px-3.5 py-1.5 text-sm whitespace-nowrap transition-all"
                style={{
                  background: active ? pageBg : "transparent",
                  border: active ? `1px solid ${cardBorder}` : "1px solid transparent",
                  borderBottom: "none",
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  color: active ? accentDark : muted,
                  fontWeight: active ? 600 : 500,
                  position: "relative",
                  top: 1,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.5)"; e.currentTarget.style.color = heading; } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = muted; } }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Report-iFrame ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 p-2.5">
        <iframe
          key={`${page.pageName}-${reloadKey}`}
          src={embedUrl}
          title={`${section.label} – ${page.name}`}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full h-full rounded-xl"
          style={{
            border: `1px solid ${cardBorder}`,
            boxShadow: "0 1px 4px rgba(26,58,26,0.04)",
            backgroundColor: "white",
          }}
        />
      </div>

      {/* ── Info-Modal ──────────────────────────────────────────────── */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(26,58,26,0.35)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setInfoOpen(false); }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-xl shadow-2xl border"
            style={{ background: modalBg, borderColor: cardBorder }}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold m-0" style={{ color: heading }}>Power BI Report – Info</h2>
              <button
                onClick={() => setInfoOpen(false)}
                className="p-1 rounded"
                style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: muted, lineHeight: 1.5 }}>
              Alle Auswertungen stammen aus dem Power-BI-Report <b>"Artis Auswertungen neu"</b> im Workspace <b>Artis Treuhand GmbH</b>.
              Änderungen im Report sind nach dem Neuladen direkt hier sichtbar.
            </p>
            {[
              ["Report-ID",     "13a220be-5f7c-490e-9d33-c8fe2b57b438"],
              ["Workspace-ID",  "a39e904f-2669-4744-bac2-66286edd4221"],
              ["Tenant (ctid)", "cc857d96-3c6e-45ba-afbf-c20d0946d2be"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 mb-2 py-1.5 px-2 rounded-lg" style={{ background: kvRowBg }}>
                <span className="text-xs flex-shrink-0" style={{ color: muted, minWidth: 130 }}>{k}:</span>
                <span className="font-mono text-xs break-all" style={{ color: heading }}>{v}</span>
              </div>
            ))}
            <p className="text-sm mt-4" style={{ color: muted, lineHeight: 1.5 }}>
              <b>Zugriff:</b> Jeder User muss mit seinem Microsoft-365-Konto angemeldet sein und Viewer-Rechte im Workspace "Artis Treuhand GmbH" haben.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
