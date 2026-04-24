import React, { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { BookOpen, Car, FileText, UserCog, ChevronRight, Wrench, PenLine, Presentation, FileSpreadsheet, Sparkles } from "lucide-react";

const TOOLS = [
  {
    id: "aktienbuch",
    title: "Aktienbuch",
    description: "Aktionärsregister nach Art. 686 OR: Namenaktien, Übertragungen, Splits & Kapitalstruktur",
    icon: BookOpen,
    color: "#5b8a5b",
    bg: "#e8f2e8",
    route: "/Aktienbuch",
  },
  {
    id: "fahrzeugliste",
    title: "Fahrzeugliste",
    description: "Firmenfahrzeuge pro Mandant erfassen, Privatanteil berechnen & exportieren",
    icon: Car,
    color: "#3b6a8a",
    bg: "#e0eef5",
    route: "/Fahrzeugliste",
  },
  {
    id: "briefe",
    title: "Briefe schreiben",
    description: "Steuer- und Geschäftsbriefe professionell erstellen",
    icon: FileText,
    color: "#8a6a3b",
    bg: "#f5ede0",
    route: "/BriefSchreiben",
  },
  {
    id: "unterschriften",
    title: "Unterschriften",
    description: "Dokumente digital signieren lassen – rechtsgültig nach OR Art. 14 (AES/SES)",
    icon: PenLine,
    color: "#1e6a7a",
    bg: "#dff0f5",
    route: "/Unterschriften",
  },
  {
    id: "abschluss",
    title: "Abschlussdokumentation",
    description: "Jahresabschlüsse und Revisionsunterlagen dokumentieren",
    icon: UserCog,
    color: "#6a5b8a",
    bg: "#eeeaf5",
    route: "/Abschlussdokumentation",
  },
  {
    id: "steuern",
    title: "Steuererklärungen",
    description: "Juristische Personen SG / TG / ESTV: AcroForm-Vorlagen, Live-PDF-Vorschau, Speichern pro Kunde & Jahr",
    icon: FileSpreadsheet,
    color: "#8a3b5b",
    bg: "#f5e0ea",
    route: "/Steuern",
  },
  {
    id: "whiteboard",
    title: "Whiteboard",
    description: "Digitales Whiteboard zum Skizzieren und Zeichnen – pro Kunde, mit PDF Import/Export",
    icon: Presentation,
    color: "#2a7a5a",
    bg: "#e0f5ec",
    route: "/Whiteboard",
  },
  {
    id: "promptvorlagen",
    title: "Promptvorlagen",
    description: "Claude-Prompts für alle Mitarbeitenden – erstellen, verwalten und mit einem Klick kopieren",
    icon: Sparkles,
    color: "#6a3ba0",
    bg: "#ede0f5",
    route: "/Promptvorlagen",
  },
];

export default function ArtisTools() {
  const { theme } = useContext(ThemeContext);
  const navigate = useNavigate();
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isDark = !isLight && !isArtis;

  const pageBg   = isLight ? "#f4f4f8"              : isArtis ? "#f2f5f2"              : "#2a2a2f";
  const cardBg   = isLight ? "rgba(255,255,255,0.9)" : isArtis ? "rgba(255,255,255,0.85)" : "rgba(39,39,42,0.8)";
  const cardBorder = isLight ? "#e2e2ec"             : isArtis ? "#ccd8cc"              : "#3f3f46";
  const headingColor = isLight ? "#1e293b"           : isArtis ? "#1a3a1a"              : "#e4e4e7";
  const subColor = isLight ? "#64748b"               : isArtis ? "#4a6a4a"              : "#a1a1aa";
  const accent   = isArtis ? "#7a9b7f"               : isLight  ? "#4f6aab"             : "#7c3aed";
  const headerIconBg = isLight ? "#f0f0fa"           : isArtis ? "#e8f2e8"              : "#3f3f46";
  const badgeBg  = isLight ? "#f1f5f9"               : isArtis ? "#e8f2e8"              : "#3f3f46";

  return (
    <div className="flex flex-col h-full p-6 overflow-auto" style={{ backgroundColor: pageBg }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: headerIconBg }}
        >
          <Wrench className="w-6 h-6" style={{ color: accent }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: headingColor }}>
            Artis Tools
          </h1>
          <p className="text-sm" style={{ color: subColor }}>
            Treuhand-Werkzeugkasten
          </p>
        </div>
      </div>

      {/* ── Tool-Kacheln ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5 max-w-3xl">
        {TOOLS.map(({ id, title, description, icon: Icon, color, bg, route }) => (
          <div
            key={id}
            onClick={() => route && navigate(route)}
            className="rounded-2xl p-6 flex flex-col gap-4 transition-all hover:shadow-lg hover:-translate-y-0.5"
            style={{
              backgroundColor: cardBg,
              border: `1px solid ${cardBorder}`,
              cursor: route ? "pointer" : "default",
            }}
          >
            {/* Icon + Badge */}
            <div className="flex items-start justify-between">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: isDark ? "rgba(255,255,255,0.06)" : bg }}
              >
                <Icon className="w-7 h-7" style={{ color: isDark ? "#a1a1aa" : color }} />
              </div>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ backgroundColor: badgeBg, color: route ? accent : subColor }}
              >
                {route ? "Verfügbar" : "Kommt bald"}
              </span>
            </div>

            {/* Text */}
            <div>
              <h3 className="font-semibold text-base mb-1" style={{ color: headingColor }}>
                {title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: subColor }}>
                {description}
              </p>
            </div>

            {/* Footer-Link */}
            <div className="flex items-center gap-1 mt-auto" style={{ color: accent }}>
              <span className="text-xs font-semibold">Öffnen</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
