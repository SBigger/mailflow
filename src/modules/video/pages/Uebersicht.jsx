import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Video as Cam, LogIn, Copy, Check, Clock } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useAppTheme } from "@/modules/telefonie/theme";
import { videoTheme, VIDEO_FONT } from "../theme";

// ===========================================================================
// Übersicht – Einstieg ins Modul: Besprechung starten oder beitreten.
//
// PHASE 1 bewusst schlank: Räume entstehen spontan, es gibt noch keine
// geplanten Termine und keine Gästelinks (das kommt mit Phase 2 samt
// meetings-Tabelle und Warteraum). Zuletzt benutzte Räume liegen lokal im
// Browser – kein Serverzustand, den wir später migrieren müssten.
// ===========================================================================
const RECENT_KEY = "video_recent_rooms";

function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(v) ? v.slice(0, 5) : [];
  } catch { return []; }
}

export function rememberRoom(name) {
  try {
    const list = readRecent().filter((r) => r.name !== name);
    list.unshift({ name, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch { /* ohne Verlauf lebt es sich auch */ }
}

// Lesbarer, nicht erratbarer Raumname – Buchstaben/Ziffern ohne Verwechsler.
function newRoomName() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return `artis-${id}`;
}

export default function Uebersicht() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const theme = useAppTheme();
  const t = videoTheme(theme);

  const [joinName, setJoinName] = useState("");
  const [copied, setCopied] = useState(null);
  const recent = readRecent();

  const start = () => {
    const name = newRoomName();
    rememberRoom(name);
    navigate(`/besprechungen/raum/${name}`);
  };

  const join = (name) => {
    const clean = String(name || joinName).trim().replace(/\s+/g, "-");
    if (!clean) return;
    rememberRoom(clean);
    navigate(`/besprechungen/raum/${clean}`);
  };

  const copyLink = async (name) => {
    const link = `${window.location.origin}/besprechungen/raum/${name}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(name);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* Zwischenablage kann blockiert sein */ }
  };

  const card = {
    background: t.raised, border: `1px solid ${t.borderSubtle}`,
    borderRadius: 16, padding: "20px 22px", boxShadow: t.shadow,
  };

  return (
    <div style={{
      padding: "28px 30px 60px", fontFamily: VIDEO_FONT, color: t.textPrimary,
      maxWidth: 900, margin: "0 auto",
    }}>
      <h1 style={{ fontSize: 25, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-.015em" }}>
        Besprechungen
      </h1>
      <p style={{ fontSize: 14, color: t.textSecondary, margin: "0 0 26px", maxWidth: "60ch" }}>
        Videogespräche direkt in smartis{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.
        Zurzeit für interne Gespräche — Kundenlinks folgen im nächsten Schritt.
      </p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={card}>
          <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: "0 0 6px" }}>Neue Besprechung</h2>
          <p style={{ fontSize: 13, color: t.textMuted, margin: "0 0 16px" }}>
            Öffnet sofort einen Raum. Den Link können Sie danach an Kolleginnen und Kollegen weitergeben.
          </p>
          <button
            onClick={start}
            style={{
              width: "100%", border: "none", borderRadius: 13, padding: 13,
              background: t.accentFill, color: "#fff", fontFamily: "inherit",
              fontSize: 14, fontWeight: 750, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "filter .15s ease-out",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          >
            <Cam size={17} /> Besprechung starten
          </button>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: "0 0 6px" }}>Beitreten</h2>
          <p style={{ fontSize: 13, color: t.textMuted, margin: "0 0 16px" }}>
            Raumname aus einer Einladung eingeben.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") join(); }}
              placeholder="z. B. artis-k4m9xq2p"
              aria-label="Raumname"
              style={{
                flex: 1, minWidth: 0, background: t.base,
                border: `1px solid ${t.borderSubtle}`, borderRadius: 11,
                padding: "11px 13px", fontFamily: "inherit", fontSize: 13.5, color: t.textPrimary,
              }}
            />
            <button
              onClick={() => join()}
              aria-label="Beitreten"
              style={{
                border: `1px solid ${t.borderStrong}`, background: t.base, color: t.textPrimary,
                borderRadius: 11, width: 46, cursor: "pointer", display: "grid", placeItems: "center",
              }}
            >
              <LogIn size={17} />
            </button>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <h2 style={{
            fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
            color: t.textMuted, margin: "0 0 10px",
          }}>Zuletzt benutzt</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {recent.map((r) => (
              <div key={r.name} style={{
                display: "flex", alignItems: "center", gap: 11, background: t.raised,
                border: `1px solid ${t.borderSubtle}`, borderRadius: 12, padding: "11px 14px",
              }}>
                <Clock size={15} style={{ color: t.textMuted, flexShrink: 0 }} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace',
                }}>{r.name}</span>
                <button
                  onClick={() => copyLink(r.name)}
                  title="Link kopieren"
                  aria-label="Link kopieren"
                  style={{
                    border: "none", background: "transparent", cursor: "pointer",
                    color: copied === r.name ? t.answer : t.textMuted,
                    display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8,
                  }}
                >
                  {copied === r.name ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button
                  onClick={() => join(r.name)}
                  style={{
                    border: "none", background: t.accentSoft, color: t.accent,
                    borderRadius: 9, padding: "7px 13px", cursor: "pointer",
                    fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                  }}
                >
                  Beitreten
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
