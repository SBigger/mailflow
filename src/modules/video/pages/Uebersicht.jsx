import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Video as Cam, LogIn, Clock, UserPlus, Trash2 } from "lucide-react";
import EinladenPanel from "../components/EinladenPanel";
import { useAuth } from "@/lib/AuthContext";
import { functions } from "@/api/supabaseClient";
import { useAppTheme } from "@/modules/telefonie/theme";
import { videoTheme, VIDEO_FONT } from "../theme";

// ===========================================================================
// Übersicht – Einstieg ins Modul: Besprechung starten oder beitreten.
//
// Räume entstehen spontan (geplante Termine mit Outlook-Einladung kommen in
// Phase 2, Schritt 2). Gästezugang mit Warteraum ist da: pro Raum lassen sich
// der Kunden- und der interne Link getrennt holen.
//
// Die Liste "zuletzt benutzt" liegt bewusst lokal im Browser – sie ist eine
// Bequemlichkeit, kein Datenbestand. Die Wahrheit über offene Besprechungen
// steht in der Tabelle meetings; "Beenden" wirkt deshalb auf BEIDES: lokal
// verschwindet der Eintrag, serverseitig wird der Gästelink ungültig.
// ===========================================================================
const RECENT_KEY = "video_recent_rooms";

function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch { return []; }
}

export function rememberRoom(name) {
  try {
    const list = readRecent().filter((r) => r.name !== name);
    list.unshift({ name, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* ohne Verlauf lebt es sich auch */ }
}

function forgetRoom(name) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((r) => r.name !== name)));
  } catch { /* egal */ }
}

export default function Uebersicht() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const theme = useAppTheme();
  const t = videoTheme(theme);

  const [joinName, setJoinName] = useState("");
  const [startet, setStartet] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [recent, setRecent] = useState(() => readRecent());
  const [offen, setOffen] = useState(null);      // aufgeklappter Raum
  const [schliesst, setSchliesst] = useState(null);
  const [zustand, setZustand] = useState({});    // Raumname -> "offen" | "beendet"

  // Die Liste stammt aus dem Browser, die Wahrheit steht auf dem Server: Ein
  // Raum kann längst geschlossen sein (von Hand oder nachts automatisch).
  // Ohne diesen Abgleich verschickt man ahnungslos einen toten Gästelink.
  useEffect(() => {
    if (recent.length === 0) return;
    let weg = false;
    (async () => {
      try {
        const { data } = await functions.invoke("meeting-api", {
          action: "list", rooms: recent.map((r) => r.name),
        });
        if (weg) return;
        // Was der Server nicht zurückgibt, existiert nicht mehr (nach 30 Tagen
        // gelöscht) — für den Gästelink ist das dasselbe wie beendet.
        const karte = Object.fromEntries(recent.map((r) => [r.name, "beendet"]));
        for (const m of data?.meetings || []) karte[m.room_name] = m.status;
        setZustand(karte);
      } catch { /* ohne Abgleich bleibt die Liste benutzbar */ }
    })();
    return () => { weg = true; };
  }, [recent]);

  const istBeendet = (name) => zustand[name] === "beendet" || zustand[name] === "abgesagt";

  // Beenden: macht den Gästelink endgültig unbrauchbar und nimmt den Raum aus
  // der Liste. Bewusst mit Rückfrage — ein versehentliches Beenden während
  // eines laufenden Gesprächs wäre unangenehm. Bei bereits beendeten Räumen
  // gibt es nichts zu warnen, da wird nur die lokale Zeile entfernt.
  const beenden = async (name) => {
    const zu = istBeendet(name);
    if (!zu && !window.confirm(
      `Besprechung "${name}" beenden?\n\nDer Gästelink wird damit ungültig — wer ihn hat, kommt nicht mehr herein.`
    )) return;
    setSchliesst(name);
    if (!zu) {
      try {
        await functions.invoke("meeting-api", { action: "close", room: name });
      } catch { /* lokal trotzdem aufräumen */ }
    }
    forgetRoom(name);
    setRecent(readRecent());
    setOffen(null);
    setSchliesst(null);
  };

  // Der Raumname entsteht SERVERSEITIG (Edge Function "create"): So ist er
  // eindeutig, wird nie wiederverwendet, und die Besprechung existiert in der
  // Datenbank — ohne die könnte ein Gast über seinen Link nichts finden.
  const start = async () => {
    setStartet(true);
    setFehler(null);
    try {
      const { data } = await functions.invoke("meeting-api", { action: "create", title: "Besprechung" });
      const name = data?.meeting?.room_name;
      if (!name) throw new Error(data?.error || "Besprechung konnte nicht angelegt werden.");
      rememberRoom(name);
      navigate(`/besprechungen/raum/${name}`);
    } catch (e) {
      setFehler(e?.message?.includes("non-2xx")
        ? "Der Videodienst antwortet nicht. Bitte in einem Moment nochmals versuchen."
        : (e?.message || "Besprechung konnte nicht angelegt werden."));
      setStartet(false);
    }
  };

  const join = (name) => {
    const clean = String(name || joinName).trim().replace(/\s+/g, "-");
    if (!clean) return;
    rememberRoom(clean);
    navigate(`/besprechungen/raum/${clean}`);
  };

  // (Das Kopieren der Links liegt jetzt im EinladenPanel — dort stehen der
  // Gäste- und der interne Link getrennt beschriftet nebeneinander, damit
  // niemand mehr den falschen erwischt.)

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
        Kunden nehmen ohne Konto teil — Sie lassen sie aus dem Warteraum herein.
      </p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={card}>
          <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: "0 0 6px" }}>Neue Besprechung</h2>
          <p style={{ fontSize: 13, color: t.textMuted, margin: "0 0 16px" }}>
            Öffnet sofort einen Raum. Danach unter «Einladen» den passenden Link holen — für Kunden oder fürs Team.
          </p>
          <button
            onClick={start}
            disabled={startet}
            style={{
              width: "100%", border: "none", borderRadius: 13, padding: 13,
              background: t.accentFill, color: "#fff", fontFamily: "inherit",
              fontSize: 14, fontWeight: 750, cursor: startet ? "default" : "pointer",
              opacity: startet ? .7 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "filter .15s ease-out",
            }}
            onMouseEnter={(e) => { if (!startet) e.currentTarget.style.filter = "brightness(1.08)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          >
            <Cam size={17} /> {startet ? "Wird angelegt…" : "Besprechung starten"}
          </button>
          {fehler && (
            <p style={{ fontSize: 12, color: t.missed, margin: "10px 0 0" }}>{fehler}</p>
          )}
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
            {recent.map((r) => {
              const zu = istBeendet(r.name);
              return (
              <div key={r.name} style={{
                background: t.raised, border: `1px solid ${offen === r.name ? t.accentFill : t.borderSubtle}`,
                borderRadius: 12, overflow: "hidden", transition: "border-color .15s",
                opacity: zu ? .62 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px" }}>
                  <Clock size={15} style={{ color: t.textMuted, flexShrink: 0 }} />
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace',
                    textDecoration: zu ? "line-through" : "none",
                  }}>{r.name}</span>

                  {zu && (
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, color: t.textMuted,
                      background: t.base, border: `1px solid ${t.borderSubtle}`,
                      borderRadius: 999, padding: "3px 9px",
                    }}>beendet</span>
                  )}

                  <button
                    onClick={() => setOffen((o) => (o === r.name ? null : r.name))}
                    disabled={zu}
                    title={zu ? "Diese Besprechung ist beendet — der Gästelink funktioniert nicht mehr" : "Link holen"}
                    style={{
                      border: "none", background: offen === r.name ? t.accentFill : t.accentSoft,
                      color: offen === r.name ? "#fff" : t.accent,
                      borderRadius: 9, padding: "7px 13px", cursor: zu ? "not-allowed" : "pointer",
                      fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                      display: zu ? "none" : "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <UserPlus size={14} /> Einladen
                  </button>
                  <button
                    onClick={() => join(r.name)}
                    style={{
                      border: "none", background: zu ? t.base : t.accentFill,
                      color: zu ? t.textSecondary : "#fff",
                      borderRadius: 9, padding: "7px 13px", cursor: "pointer",
                      fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                    }}
                  >
                    Beitreten
                  </button>
                  <button
                    onClick={() => beenden(r.name)}
                    disabled={schliesst === r.name}
                    title={zu ? "Aus der Liste entfernen" : "Besprechung beenden — Gästelink wird ungültig"}
                    aria-label={zu ? "Aus der Liste entfernen" : "Besprechung beenden"}
                    style={{
                      border: "none", background: "transparent", cursor: "pointer",
                      color: t.textMuted, display: "grid", placeItems: "center",
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.missed)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.textMuted)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {offen === r.name && (
                  <div style={{ padding: "4px 14px 16px", borderTop: `1px solid ${t.borderSubtle}` }}>
                    <div style={{ paddingTop: 14 }}>
                      <EinladenPanel t={t} roomName={r.name} />
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
