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
} from "lucide-react";
import { useTheme } from "@/components/useTheme";

// ── Power BI Embed-Konfiguration ──────────────────────────────────────────────
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

  const initial = useMemo(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      const section = SECTIONS[s.section] ? s.section : "fakturierung";
      const page    = s.page && SECTIONS[section].pages.find(p => p.id === s.page)
          ? s.page : SECTIONS[section].pages[0].id;
      return { section, page };
    } catch {
      return { section: "fakturierung", page: SECTIONS.fakturierung.pages[0].id };
    }
  }, []);

  const [currentSection, setCurrentSection] = useState(initial.section);
  const [currentPage, setCurrentPage]       = useState(initial.page);
  const [infoOpen, setInfoOpen]             = useState(false);
  const [reloadKey, setReloadKey]           = useState(0);
  // In Tauri: iframe nicht rendern (Tauri's Plugin-Init-Scripts crashen im
  // cross-origin Power-BI-iframe auf window.__TAURI_INTERNALS__.plugins).
  // Stattdessen Fallback-UI mit Browser-Button.
  const isTauri = typeof window !== "undefined" && !!window.__TAURI__;

  const openInBrowser = (url) => {
    if (isTauri) {
      window.__TAURI__.core.invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  };

  // Power BI in eigenem Tauri-Fenster öffnen (top-level Frame, kein Iframe-Crash).
  const openInTauriWindow = (url, title) => {
    window.__TAURI__.core.invoke("open_embedded_window", {
      url,
      title,
      width: 1400,
      height: 900,
    }).catch((e) => {
      console.error("[Smartis] open_embedded_window fehlgeschlagen, Fallback Browser:", e);
      window.__TAURI__.core.invoke("open_external_url", { url });
    });
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

  const iconBtnHandlers = {
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = heading; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = muted; },
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: pageBg }}>

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-4 px-4 py-2.5 border-b"
        style={{ backgroundColor: topbarBg, borderColor: cardBorder, backdropFilter: "blur(10px)" }}
      >
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-7 h-7 flex items-center justify-center rounded-lg" style={{ backgroundColor: titleIconBg, color: accentDark }}>
            <BarChart3 className="w-4 h-4" />
          </div>
          <h1 className="text-base font-semibold m-0" style={{ color: heading, letterSpacing: "-0.01em" }}>Auswertungen</h1>
        </div>

        <div className="flex gap-1 p-0.5 rounded-lg border flex-shrink-0" style={{ backgroundColor: pillBg, borderColor: cardBorder }} role="tablist">
          {Object.entries(SECTIONS).map(([id, s]) => {
            const Icon = s.icon;
            const active = id === currentSection;
            return (
              <button key={id} onClick={() => handleSection(id)} role="tab" aria-selected={active}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all"
                style={{ backgroundColor: active ? accent : "transparent", color: active ? "white" : muted,
                  boxShadow: active ? "0 1px 3px rgba(26,58,26,0.12)" : "none", border: "none", cursor: "pointer" }}
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

        <button onClick={() => setReloadKey(k => k + 1)} title="Report neu laden"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }} {...iconBtnHandlers}>
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={() => openInBrowser(directUrl)} title="In Power BI öffnen"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }} {...iconBtnHandlers}>
          <ExternalLink className="w-4 h-4" />
        </button>
        <button onClick={() => setInfoOpen(true)} title="Info"
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }} {...iconBtnHandlers}>
          <Info className="w-4 h-4" />
        </button>
      </div>

      {/* ── Sub-Tabs ────────────────────────────────────────────────────── */}
      {section.pages.length > 1 && (
        <div className="flex-shrink-0 flex gap-1 px-4 pt-1.5 border-b overflow-x-auto"
          style={{ backgroundColor: subtabBg, borderColor: cardBorder }}>
          {section.pages.map(p => {
            const active = p.id === currentPage;
            return (
              <button key={p.id} onClick={() => setCurrentPage(p.id)}
                className="px-3.5 py-1.5 text-sm whitespace-nowrap transition-all"
                style={{
                  background: active ? pageBg : "transparent",
                  border: active ? `1px solid ${cardBorder}` : "1px solid transparent",
                  borderBottom: "none", borderTopLeftRadius: 8, borderTopRightRadius: 8,
                  color: active ? accentDark : muted, fontWeight: active ? 600 : 500,
                  position: "relative", top: 1, cursor: "pointer",
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

      {/* ── iFrame (Browser) / Fallback (Tauri) ─────────────────────────── */}
      <div className="flex-1 min-h-0 p-2.5">
        {isTauri ? (
          <div className="w-full h-full rounded-xl flex flex-col items-center justify-center gap-5 text-center px-8"
            style={{ border: `1px solid ${cardBorder}`, backgroundColor: "white" }}>
            <div className="w-16 h-16 flex items-center justify-center rounded-2xl"
              style={{ backgroundColor: titleIconBg, color: accentDark }}>
              <BarChart3 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-semibold m-0 mb-2" style={{ color: heading }}>
                {section.label} – {page.name}
              </h2>
              <p className="text-sm max-w-md mx-auto" style={{ color: muted, lineHeight: 1.6 }}>
                Klicke hier, um den Report in einem eigenen Smartis-Fenster zu öffnen.
                Du bleibst mit deinem Microsoft-365-Konto angemeldet.
              </p>
            </div>
            <button
              onClick={() => openInTauriWindow(embedUrl, `Smartis – ${section.label} · ${page.name}`)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium text-sm transition-all"
              style={{
                backgroundColor: accent,
                color: "white",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(26,58,26,0.15)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = accentDark; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = accent; }}
            >
              <BarChart3 className="w-4 h-4" />
              Report in neuem Fenster öffnen
            </button>
          </div>
        ) : (
          <iframe
            key={`${page.pageName}-${reloadKey}`}
            src={embedUrl}
            title={`${section.label} – ${page.name}`}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="w-full h-full rounded-xl"
            style={{ border: `1px solid ${cardBorder}`, boxShadow: "0 1px 4px rgba(26,58,26,0.04)", backgroundColor: "white" }}
          />
        )}
      </div>

      {/* ── Info-Modal ──────────────────────────────────────────────────── */}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(26,58,26,0.35)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setInfoOpen(false); }}>
          <div className="rounded-2xl p-6 w-full max-w-xl shadow-2xl border" style={{ background: modalBg, borderColor: cardBorder }}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold m-0" style={{ color: heading }}>Power BI Report – Info</h2>
              <button onClick={() => setInfoOpen(false)} className="p-1 rounded"
                style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: muted, lineHeight: 1.5 }}>
              Alle Auswertungen stammen aus dem Power-BI-Report <b>"Artis Auswertungen neu"</b> im Workspace <b>Artis Treuhand GmbH</b>.
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
