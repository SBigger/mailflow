import React, { useState, useMemo, useEffect, useRef } from "react";
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
  LogOut,
} from "lucide-react";
import { useTheme } from "@/components/useTheme";
import { getPowerBIToken, isPowerBIAuthenticated, initMsal, powerBILogout } from "@/lib/powerbiAuth";
import * as pbi from "powerbi-client";

// ── Power BI Konfiguration ─────────────────────────────────────────────────────
const REPORT_ID    = "13a220be-5f7c-490e-9d33-c8fe2b57b438";
const WORKSPACE_ID = "a39e904f-2669-4744-bac2-66286edd4221";
const EMBED_URL    = `https://app.powerbi.com/reportEmbed?reportId=${REPORT_ID}&groupId=${WORKSPACE_ID}`;

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

  const pageBg      = isDark ? "#18181b" : isArtis ? "#f2f5f2" : "#f4f4f8";
  const topbarBg    = isDark ? "rgba(24,24,27,0.7)"    : isArtis ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.7)";
  const subtabBg    = isDark ? "rgba(24,24,27,0.5)"    : isArtis ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.55)";
  const pillBg      = isDark ? "rgba(39,39,42,0.6)"    : isArtis ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.75)";
  const cardBorder  = isDark ? "#3f3f46"               : isArtis ? "#bfcfbf"                : "#d0d0dc";
  const heading     = isDark ? "#e4e4e7"               : isArtis ? "#1a3a1a"                : "#1e293b";
  const muted       = isDark ? "#71717a"               : isArtis ? "#5a7a5a"                : "#6b7280";
  const accent      = isDark ? "#818cf8"               : isArtis ? "#7a9b7f"                : "#7c3aed";
  const accentDark  = isDark ? "#6366f1"               : isArtis ? "#3a6640"                : "#5b21b6";
  const hoverBg     = isDark ? "rgba(99,102,241,0.1)"  : isArtis ? "rgba(122,155,127,0.12)" : "rgba(124,58,237,0.08)";
  const titleIconBg = isDark ? "rgba(129,140,248,0.15)": isArtis ? "rgba(122,155,127,0.18)" : "rgba(124,58,237,0.1)";
  const kvRowBg     = isDark ? "rgba(255,255,255,0.04)": isArtis ? "rgba(122,155,127,0.08)" : "rgba(0,0,0,0.03)";
  const modalBg     = isDark ? "#27272a"               : isArtis ? "#fbfdfb"                : "#ffffff";

  // State
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
  const [msalReady, setMsalReady]           = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading]           = useState(false);
  const [error, setError]                   = useState(null);

  const embedContainerRef = useRef(null);
  const reportRef         = useRef(null);
  const isTauri = typeof window !== "undefined" && !!window.__TAURI__;

  // MSAL initialisieren
  useEffect(() => {
    initMsal().then(() => {
      setMsalReady(true);
      setIsAuthenticated(isPowerBIAuthenticated());
    }).catch(e => {
      console.error("MSAL init fehler:", e);
      setMsalReady(true);
    });
  }, []);

  // Power BI Report einbetten (wenn authentifiziert + Container bereit)
  useEffect(() => {
    if (!msalReady || !isAuthenticated || !embedContainerRef.current) return;

    const section = SECTIONS[currentSection];
    const page    = section.pages.find(p => p.id === currentPage) || section.pages[0];

    setIsLoading(true);
    setError(null);

    getPowerBIToken().then(token => {
      if (!token) return; // Redirect läuft

      const powerbiService = new pbi.service.Service(
        pbi.factories.hpmFactory,
        pbi.factories.wpmpFactory,
        pbi.factories.routerFactory
      );

      // Alten Report aufräumen
      if (reportRef.current) {
        try { powerbiService.reset(embedContainerRef.current); } catch (_) {}
      }

      const embedConfig = {
        type:        "report",
        id:          REPORT_ID,
        embedUrl:    EMBED_URL,
        accessToken: token,
        tokenType:   pbi.models.TokenType.Aad,
        settings: {
          navContentPaneEnabled: false,
          background: pbi.models.BackgroundType.Transparent,
        },
        pageName: page.pageName,
      };

      const report = powerbiService.embed(embedContainerRef.current, embedConfig);
      reportRef.current = report;

      report.on("loaded", () => setIsLoading(false));
      report.on("error",  (e) => {
        console.error("PBI error:", e.detail);
        setIsLoading(false);
        setError("Report konnte nicht geladen werden.");
      });
    }).catch(e => {
      console.error("Token fehler:", e);
      setIsLoading(false);
      setError("Authentifizierung fehlgeschlagen.");
    });
  }, [msalReady, isAuthenticated, currentSection, currentPage]);

  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ section: currentSection, page: currentPage }));
  }, [currentSection, currentPage]);

  const handleLogin = async () => {
    try {
      await getPowerBIToken(); // Startet Redirect
    } catch (e) {
      setError("Login fehlgeschlagen: " + e.message);
    }
  };

  const handleSection = (sectionId) => {
    if (sectionId === currentSection) return;
    setCurrentSection(sectionId);
    setCurrentPage(SECTIONS[sectionId].pages[0].id);
  };

  const openInBrowser = (url) => {
    if (isTauri) {
      window.__TAURI__.core.invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  };

  const iconBtnHandlers = {
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = heading; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = muted; },
  };

  const section = SECTIONS[currentSection];
  const page    = section.pages.find(p => p.id === currentPage) || section.pages[0];

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

        {/* Section Pills */}
        <div className="flex gap-1 p-0.5 rounded-lg border flex-shrink-0" style={{ backgroundColor: pillBg, borderColor: cardBorder }} role="tablist">
          {Object.entries(SECTIONS).map(([id, s]) => {
            const Icon   = s.icon;
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
                  border: "none", cursor: "pointer",
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

        {/* Actions */}
        {isAuthenticated && (
          <button onClick={() => { if (reportRef.current) reportRef.current.reload(); }} title="Report neu laden"
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }} {...iconBtnHandlers}>
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        {!isAuthenticated && msalReady && (
          <button onClick={handleLogin} title="Bei Microsoft anmelden"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: accent, color: "white", border: "none", cursor: "pointer" }}>
            <LogIn className="w-4 h-4" />
            <span>Anmelden</span>
          </button>
        )}
        {isAuthenticated && (
          <button onClick={powerBILogout} title="Microsoft-Abmeldung"
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: muted, background: "transparent", border: "none", cursor: "pointer" }} {...iconBtnHandlers}>
            <LogOut className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => openInBrowser(`${PBI_WORKSPACE}/${page.pageName}`)} title="In Power BI öffnen"
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

      {/* ── Embed-Bereich ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 p-2.5">
        {!msalReady && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-sm" style={{ color: muted }}>Initialisierung…</div>
          </div>
        )}

        {msalReady && !isAuthenticated && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4">
            <BarChart3 className="w-12 h-12 opacity-20" style={{ color: accentDark }} />
            <p className="text-sm" style={{ color: muted }}>Bitte melde dich mit deinem Microsoft-365-Konto an.</p>
            <button onClick={handleLogin}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: accent, color: "white", border: "none", cursor: "pointer" }}>
              <LogIn className="w-4 h-4" />
              Bei Microsoft anmelden
            </button>
          </div>
        )}

        {msalReady && isAuthenticated && (
          <div className="relative w-full h-full rounded-xl overflow-hidden" style={{ border: `1px solid ${cardBorder}` }}>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <div className="text-sm" style={{ color: muted }}>Report wird geladen…</div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <div className="text-sm text-red-500">{error}</div>
              </div>
            )}
            <div ref={embedContainerRef} className="w-full h-full" />
          </div>
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
              ["Report-ID",     REPORT_ID],
              ["Workspace-ID",  WORKSPACE_ID],
              ["Tenant (ctid)", "cc857d96-3c6e-45ba-afbf-c20d0946d2be"],
              ["Client-ID",     "4e6116e1-9b0b-4f91-8c97-041bf8eb6d87"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 mb-2 py-1.5 px-2 rounded-lg" style={{ background: kvRowBg }}>
                <span className="text-xs flex-shrink-0" style={{ color: muted, minWidth: 130 }}>{k}:</span>
                <span className="font-mono text-xs break-all" style={{ color: heading }}>{v}</span>
              </div>
            ))}
            <p className="text-sm mt-4" style={{ color: muted, lineHeight: 1.5 }}>
              <b>Zugriff:</b> Einmalige Anmeldung mit Microsoft-365-Konto (Artis Treuhand GmbH).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
