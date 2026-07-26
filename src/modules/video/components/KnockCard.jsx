import React from "react";
import { initials, personStyle } from "../theme";

// ===========================================================================
// KnockCard – "Jemand möchte herein".
//
// Bewusst im hellen App-Theme auf der dunklen Bühne: Der Kontrast ist der
// Punkt. Wer mitten im Gespräch ist, soll das hier NICHT übersehen — ein
// wartender Mandant, den niemand bemerkt, ist der peinlichste Fehler, den
// diese Funktion machen kann.
//
// Der Berater sieht den Namen VOR dem Zulassen. Das ist der eigentliche
// Schutz des geteilten Raumlinks: Wer den Link weitergibt, verschafft
// niemandem Zutritt — nur die Möglichkeit anzuklopfen.
// ===========================================================================
export default function KnockCard({ t, guests, onAdmit, onReject, busyId }) {
  if (!guests?.length) return null;

  return (
    <div style={{
      position: "absolute", top: 18, right: 18, zIndex: 25,
      display: "flex", flexDirection: "column", gap: 9, maxWidth: 300,
    }}>
      {guests.map((g) => {
        const tone = personStyle({ full_name: g.display_name });
        const busy = busyId === g.id;
        return (
          <div key={g.id} style={{
            width: 296, background: t.raised, border: `1px solid ${t.borderSubtle}`,
            borderRadius: 14, padding: "13px 15px",
            boxShadow: "0 24px 60px -18px rgba(0,0,0,.6)",
            animation: "vidKnock .25s ease-out",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                display: "grid", placeItems: "center", fontSize: 15, fontWeight: 700,
                background: tone.bg, color: tone.text,
              }}>{initials(g.display_name)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.25,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{g.display_name}</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>möchte beitreten</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => onAdmit(g.id)}
                disabled={busy}
                style={knopf(t.answer, busy)}
              >
                Zulassen
              </button>
              <button
                onClick={() => onReject(g.id)}
                disabled={busy}
                style={knopf(t.hangup, busy)}
              >
                Abweisen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function knopf(farbe, busy) {
  return {
    flex: 1, border: "none", borderRadius: 13, padding: 10,
    cursor: busy ? "default" : "pointer", opacity: busy ? .6 : 1,
    fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "#fff",
    background: farbe, transition: "filter .15s ease-out",
  };
}
