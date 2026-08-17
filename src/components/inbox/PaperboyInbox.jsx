import React, { useState, useRef, useEffect, useMemo, useContext, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Mail, CheckSquare, MessageSquare, PhoneOff, MessageCircle, X } from "lucide-react";
import { ThemeContext } from "@/Layout";
import PaperboyIcon from "./PaperboyIcon";
import { useInboxSummary } from "./useInboxSummary";
import { useTelephony } from "@/modules/telefonie/context/TelephonyContext";
import { FAB, RAND, STANDARD, zuPlatz, zuPunkt } from "./paperboyPlatz";

// Reihenfolge & Meta der Quellen-Kacheln (Variante 2)
const SOURCES = [
  { key: "mails", label: "Mails", icon: Mail, color: "#4e79a7" },
  { key: "tasks", label: "Aufgaben", icon: CheckSquare, color: "#2f9e77" },
  { key: "chats", label: "Chats", icon: MessageSquare, color: "#7a5bd4" },
  { key: "paperboy", label: "Paperboy", icon: null, color: "#4ba3c7" },
  { key: "calls", label: "Anrufe", icon: PhoneOff, color: "#c94f4f" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#25d366" },
];

// Position: siehe paperboyPlatz.js – dort steht auch, warum absolute Pixel
// der falsche Ansatz waren.
const PLATZ_KEY = "paperboy_fab_platz";    // Ecke + Abstand
const ALT_KEY = "paperboy_fab_pos";        // altes Format, absolute Pixel

function fenster() {
  return {
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  };
}

function ladePlatz() {
  try {
    const p = JSON.parse(localStorage.getItem(PLATZ_KEY));
    if (p && Number.isFinite(p.dx) && Number.isFinite(p.dy)) return p;
  } catch { /* egal */ }
  // Alte, absolut gespeicherte Position NICHT übernehmen: Sie wurde in einem
  // Fenster unbekannter Grösse gesetzt, lässt sich also nicht sinnvoll
  // umrechnen – und ist genau der Grund, warum er in der Luft hing. Einmal
  // wegräumen und beim Standard anfangen; wer ihn woanders haben will, zieht
  // ihn hin, und ab jetzt bleibt er dort.
  try { localStorage.removeItem(ALT_KEY); } catch { /* egal */ }
  return STANDARD;
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

// themeVorgabe: für Shells OHNE ThemeContext-Provider (FiBu). Ohne die käme
// der Vorgabewert des Contexts zum Zug – "dark" – und das Panel stünde dunkel
// auf einer hellen Seite. Telefonie und Besprechungen brauchen das nicht, die
// stellen den Context selbst bereit.
export default function PaperboyInbox({ theme: themeVorgabe } = {}) {
  const navigate = useNavigate();
  const { theme: themeAusContext } = useContext(ThemeContext) || {};
  const theme = themeVorgabe || themeAusContext;
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isDark = !isLight && !isArtis;

  const { counts, feed } = useInboxSummary();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(null); // null = alle
  const panelRef = useRef(null);

  // ── Position (verschiebbar, pro Gerät gespeichert) ────────────────
  // Die Wahrheit ist der Platz (Ecke + Abstand); `pos` ist nur die daraus
  // berechnete Stelle im AKTUELLEN Fenster.
  const platzRef = useRef(null);
  if (platzRef.current === null) platzRef.current = ladePlatz();
  const [pos, setPos] = useState(() => { const { w, h } = fenster(); return zuPunkt(platzRef.current, w, h); });
  const posRef = useRef(pos);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // Fenster geändert (Grösse, zweiter Bildschirm, Zoom): neu aus der Ecke
  // rechnen. Ohne das bliebe er dort stehen, wo die Ecke einmal war.
  useEffect(() => {
    const neu = () => { const { w, h } = fenster(); setPos(zuPunkt(platzRef.current, w, h)); };
    window.addEventListener("resize", neu);
    return () => window.removeEventListener("resize", neu);
  }, []);

  const clamp = (x, y) => {
    const { w, h } = fenster();
    return {
      x: Math.min(Math.max(RAND, x), w - FAB - RAND),
      y: Math.min(Math.max(RAND, y), h - FAB - RAND),
    };
  };

  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) movedRef.current = true;
      setPos(clamp(d.origX + (e.clientX - d.startX), d.origY + (e.clientY - d.startY)));
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      // Nicht die Pixel merken, sondern die Ecke samt Abstand – siehe oben.
      const { w, h } = fenster();
      platzRef.current = zuPlatz(posRef.current.x, posRef.current.y, w, h);
      try { localStorage.setItem(PLATZ_KEY, JSON.stringify(platzRef.current)); } catch { /* egal */ }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  // Popup schliessen: Klick ausserhalb / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    // kleiner Delay, sonst schliesst der öffnende Klick sofort wieder
    const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const goTo = useCallback((go) => {
    if (!go) return;
    setOpen(false);
    if (go.scope) { try { localStorage.setItem("chartis_jump_scope", go.scope); } catch { /* egal */ } }
    navigate(createPageUrl(go.page));
  }, [navigate]);

  const shownFeed = useMemo(
    () => (filter ? feed.filter(f => f.kind === filter) : feed).slice(0, 40),
    [feed, filter]
  );

  // ── Farben (theme-abhängig) ───────────────────────────────────────
  const c = {
    circleBg: "#ffffff",
    circleBorder: isDark ? "#3f3f46" : isArtis ? "#bfcfbf" : "#d0d0dc",
    panelBg: isDark ? "#1f1f23" : "#ffffff",
    panelBorder: isDark ? "#3f3f46" : isArtis ? "#ccd8cc" : "#e2e2ea",
    text: isDark ? "#e4e4e7" : isArtis ? "#2d3a2d" : "#1f2430",
    muted: isDark ? "#a1a1aa" : isArtis ? "#6b826b" : "#8a8a9a",
    tileBg: isDark ? "rgba(63,63,70,0.4)" : isArtis ? "#f2f5f2" : "#f5f5fa",
    rowHover: isDark ? "rgba(63,63,70,0.35)" : isArtis ? "#eef3ee" : "#f5f5fa",
    accent: isArtis ? "#5b8a5b" : "#7c3aed",
  };
  const paperboyGreen = "#5b8a5b";

  // Popup-Position relativ zur FAB (öffnet nach oben-links)
  // ── Dem Softphone ausweichen (Sascha-Wunsch 2026-07-26) ───────────────
  // Das globale Softphone-Panel schwebt auf zIndex 3000 unten rechts und
  // verdeckte den Paperboy (frueher zIndex 55) komplett, sobald ein Anruf
  // lief oder das Waehl-Panel offen war. Jetzt: Paperboy liegt UEBER der
  // Telefon-Ebene, und sitzt seine (gespeicherte) Position in der Ecke, in
  // der das offene Softphone-Panel steht, rutscht er fuers Rendern darueber
  // -- die gespeicherte Wunschposition bleibt unangetastet, nach dem Anruf
  // steht er wieder exakt dort, wo er hingezogen wurde.
  const teleState = useTelephony() || {};
  const phoneEngaged = !!(teleState.call || teleState.incoming || teleState.panelOpen || teleState.wrapup);
  const SOFTPHONE_ZONE_W = 420; // Softphone-Shell 340-384px breit + Rand
  const SOFTPHONE_CLEAR_Y = 560; // Panelhoehe (~470) + Abstand + FAB-Hoehe
  const displayPos = useMemo(() => {
    if (!phoneEngaged) return pos;
    const w = typeof window !== "undefined" ? window.innerWidth : 1280;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    const inSoftphoneCorner = pos.x > w - SOFTPHONE_ZONE_W && pos.y > h - SOFTPHONE_CLEAR_Y;
    return inSoftphoneCorner ? { x: pos.x, y: Math.max(6, h - SOFTPHONE_CLEAR_Y) } : pos;
  }, [pos, phoneEngaged]);

  const PANEL_W = 344;
  const panelStyle = useMemo(() => {
    const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const left = Math.min(Math.max(8, displayPos.x + 52 - PANEL_W), winW - PANEL_W - 8);
    const bottom = Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 800) - displayPos.y + 10);
    return { left, bottom };
  }, [displayPos]);

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed", left: panelStyle.left, bottom: panelStyle.bottom, width: PANEL_W, zIndex: 3020,
            background: c.panelBg, border: `1px solid ${c.panelBorder}`, borderRadius: 14,
            boxShadow: "0 12px 40px rgba(20,30,24,.22)", overflow: "hidden",
            color: c.text, fontSize: 13,
          }}
        >
          {/* Kopf */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" }}>
            <PaperboyIcon color={paperboyGreen} size={22} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>Posteingang</span>
            {counts.total > 0 && (
              <span style={{ background: "#e24b4a", color: "#fff", fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "1px 8px" }}>
                {counts.total} neu
              </span>
            )}
            <button onClick={() => setOpen(false)} title="Schliessen" style={{ marginLeft: "auto", color: c.muted, display: "flex" }}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Zähler-Kacheln (klickbar = Filter) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 5, padding: "0 12px 10px" }}>
            {SOURCES.map(s => {
              const n = counts[s.key] || 0;
              const active = filter === s.key;
              const Icon = s.icon;
              return (
                <button key={s.key} onClick={() => setFilter(active ? null : s.key)} title={s.label}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    padding: "7px 2px", borderRadius: 9, background: c.tileBg,
                    outline: active ? `2px solid ${c.accent}` : "none",
                    opacity: n === 0 && !active ? 0.5 : 1,
                  }}>
                  {Icon
                    ? <Icon className="h-[17px] w-[17px]" style={{ color: s.color }} />
                    : <PaperboyIcon color={s.color} size={17} />}
                  <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1, color: n > 0 ? c.text : c.muted }}>{n}</span>
                </button>
              );
            })}
          </div>

          {/* Filter-Hinweis */}
          {filter && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px 8px" }}>
              <span style={{ fontSize: 11, color: c.muted }}>Gefiltert:</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: c.accent }}>{SOURCES.find(s => s.key === filter)?.label}</span>
              <button onClick={() => setFilter(null)} style={{ fontSize: 11, color: c.muted, marginLeft: "auto" }}>Alle zeigen</button>
            </div>
          )}

          {/* Recent-Liste */}
          <div style={{ maxHeight: 320, overflowY: "auto", borderTop: `1px solid ${c.panelBorder}` }}>
            {shownFeed.length === 0 ? (
              <div style={{ textAlign: "center", padding: "28px 16px", color: c.muted }}>
                <PaperboyIcon color={c.muted} size={40} style={{ opacity: 0.5, margin: "0 auto 6px" }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>Alles erledigt</div>
                <div style={{ fontSize: 11 }}>Keine offenen Eingänge.</div>
              </div>
            ) : shownFeed.map(item => {
              const src = SOURCES.find(s => s.key === item.kind);
              const Icon = src?.icon;
              return (
                <button key={item.id} onClick={() => goTo(item.go)}
                  className="w-full text-left"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${c.panelBorder}` }}
                  onMouseOver={e => { e.currentTarget.style.background = c.rowHover; }}
                  onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: (src?.color || c.muted) + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {Icon ? <Icon className="h-[16px] w-[16px]" style={{ color: src.color }} /> : <PaperboyIcon color={src?.color || paperboyGreen} size={16} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</span>
                  </span>
                  <span style={{ fontSize: 10.5, color: c.muted, flexShrink: 0 }}>{fmtTime(item.time)}</span>
                </button>
              );
            })}
          </div>

          {/* Fuss: in Chartis öffnen */}
          <button onClick={() => goTo({ page: "Chartis", scope: "tag" })}
            style={{ width: "100%", padding: "10px 14px", fontSize: 12.5, fontWeight: 500, color: c.accent, borderTop: `1px solid ${c.panelBorder}` }}>
            Alle in Chartis öffnen
          </button>
        </div>
      )}

      {/* Schwebende FAB (helle Variante: weisser Kreis, grüner Paperboy) */}
      <button
        title="Posteingang · Ziehen zum Verschieben"
        onMouseDown={(e) => {
          movedRef.current = false;
          dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
          document.body.style.userSelect = "none";
        }}
        onClick={() => { if (movedRef.current) { movedRef.current = false; return; } setOpen(o => !o); }}
        style={{
          position: "fixed", left: displayPos.x, top: displayPos.y, zIndex: 3010,
          transition: dragRef.current ? "none" : "top .25s ease, left .25s ease",
          width: 52, height: 52, borderRadius: "50%",
          background: c.circleBg, border: `1.5px solid ${c.circleBorder}`,
          boxShadow: "0 6px 18px rgba(30,50,35,.20)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: dragRef.current ? "grabbing" : "pointer",
        }}
      >
        <PaperboyIcon color={paperboyGreen} size={34} />
        {counts.total > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4, background: "#e24b4a", color: "#fff",
            fontSize: 11, fontWeight: 600, minWidth: 20, height: 20, borderRadius: 20,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
            border: `2px solid ${c.circleBg}`,
          }}>{counts.total > 99 ? "99+" : counts.total}</span>
        )}
      </button>
    </>
  );
}
