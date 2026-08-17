import React, { useState } from "react";
import { personStyle, initials } from "@/lib/chartisTheme";

// ── Zentraler Personen-Avatar (2026-07-26) ─────────────────────────────
// EIN Baustein fuer alle Stellen, die bisher eigene Initialen-Kreise
// zeichneten (TaskBoard, Chartis, Telefonie-Presence, Settings, Layout):
// zeigt profiles.avatar_url als Foto; ohne Foto (oder wenn das Bild nicht
// laedt) die gewohnten Initialen mit deterministischer personStyle-Farbe.
//
// props:
//   user     { id?, email?, full_name?, avatar_url? } -- Farb-/Foto-Quelle
//   name     optionales Anzeige-Label (ueberstimmt user.full_name)
//   size     Kantenlaenge px (Default 32)
//   radius   CSS-Radius (Default "50%"; z.B. 11 fuer die eckigen Telefonie-Kreise)
//   children Slot fuer Presence-Dots o.ae. -- wird UEBER dem Kreis gerendert
//            (absolute Positionierung macht der Aufrufer), wird NICHT vom
//            Foto-Clipping abgeschnitten.
export default function PersonAvatar({ user, name, size = 32, radius, style, title, children }) {
  const [broken, setBroken] = useState(false);
  const label = name || user?.full_name || user?.email || "?";
  const url = !broken && user?.avatar_url ? user.avatar_url : null;
  const r = radius ?? "50%";

  const inner = url ? (
    <img
      src={url}
      alt={label}
      onError={() => setBroken(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  ) : (
    (() => {
      const tone = personStyle(user && (user.id || user.email || user.full_name) ? user : { full_name: label });
      return (
        <span
          style={{
            width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            background: tone.bg, color: tone.text, fontWeight: 700,
            fontSize: Math.max(9, Math.round(size * 0.38)), letterSpacing: ".02em",
          }}
        >
          {initials(label)}
        </span>
      );
    })()
  );

  return (
    <span
      title={title}
      style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0, ...style }}
    >
      <span style={{ width: "100%", height: "100%", borderRadius: r, overflow: "hidden", display: "block" }}>
        {inner}
      </span>
      {children}
    </span>
  );
}
