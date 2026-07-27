import React, { useState } from "react";
import { Copy, Check, Link2 } from "lucide-react";

// ===========================================================================
// InviteBox – der Link zum Weitergeben.
//
// ⚠️ ENTSTANDEN AUS EINEM ECHTEN FEHLSCHLAG (2026-07-27): Beim ersten Test
// mit Kolleginnen und Kollegen kam niemand herein. Der Grund war nicht die
// Technik – der Gästeweg funktionierte – sondern dass der Link aus der
// ADRESSZEILE geteilt wurde. Der ist der interne (/besprechungen/raum/…) und
// führt zwangsläufig zur Anmeldung. Der richtige Gästelink lag versteckt auf
// der Übersichtsseite, also genau dort, wo man während eines Gesprächs nicht
// ist.
//
// Lehre: Wenn es zwei Links gibt und einer davon in die Sackgasse führt, muss
// der richtige dort stehen, wo man ihn braucht – nicht eine Seite weiter.
// ===========================================================================
export default function InviteBox({ t, roomName, dunkel = false, kompakt = false }) {
  const [kopiert, setKopiert] = useState(false);
  const link = `${window.location.origin}/meet/${roomName}`;

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2200);
    } catch {
      // Zwischenablage kann gesperrt sein – dann bleibt das Feld zum
      // Markieren von Hand.
    }
  };

  const flaeche = dunkel ? "rgba(255,255,255,.06)" : t.base;
  const rand = dunkel ? t.stageLine : t.borderSubtle;
  const schrift = dunkel ? t.onStage : t.textPrimary;
  const gedaempft = dunkel ? t.onStageMuted : t.textMuted;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {!kompakt && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: gedaempft, fontSize: 11.5, fontWeight: 650 }}>
          <Link2 size={13} /> Link für Gäste
        </div>
      )}
      <div style={{ display: "flex", gap: 7, alignItems: "stretch", minWidth: 0 }}>
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          aria-label="Einladungslink für Gäste"
          style={{
            flex: 1, minWidth: 0, background: flaeche, border: `1px solid ${rand}`,
            borderRadius: 10, padding: "9px 11px", color: schrift,
            fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace',
            fontSize: 11.5, outline: "none",
          }}
        />
        <button
          onClick={kopieren}
          aria-label="Link kopieren"
          style={{
            flexShrink: 0, border: "none", borderRadius: 10, padding: "0 14px",
            cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
            background: kopiert ? t.answer : t.accentFill, color: "#fff",
            display: "flex", alignItems: "center", gap: 6,
            transition: "background .15s ease-out",
          }}
        >
          {kopiert ? <Check size={15} /> : <Copy size={15} />}
          {kopiert ? "Kopiert" : "Kopieren"}
        </button>
      </div>
      {!kompakt && (
        <p style={{ margin: 0, fontSize: 11, color: gedaempft, lineHeight: 1.45 }}>
          Diesen Link weitergeben — Gäste brauchen kein Konto. Sie klopfen an,
          und Sie lassen sie herein.
        </p>
      )}
    </div>
  );
}
