import React from "react";

// ── Paperboy-Symbol ────────────────────────────────────────────────
// Der gewählte Paperboy auf dem BMX (Schiebermütze, geworfene Zeitung,
// Fahrtwind). Monolinear, skaliert sauber vom Favicon bis zum Header.
// `color` färbt alle Striche, `size` ist Kantenlänge in px.
export default function PaperboyIcon({ color = "#5b8a5b", size = 40, style, className, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role="img"
      aria-label={title || "Paperboy"}
    >
      {title ? <title>{title}</title> : null}
      {/* Fahrtwind */}
      <path strokeWidth="1.6" opacity="0.75" d="M2 50 L10 50 M0 58 L9 58 M3 66 L10 66" />
      {/* Speichen */}
      <g strokeWidth="0.7" opacity="0.85">
        <path d="M24 58 L24 46 M24 58 L34.4 52 M24 58 L13.6 52 M24 58 L13.6 64 M24 58 L34.4 64 M24 58 L24 70 M60 58 L60 46 M60 58 L70.4 52 M60 58 L49.6 52 M60 58 L49.6 64 M60 58 L70.4 64 M60 58 L60 70" />
      </g>
      {/* Reifen */}
      <g strokeWidth="1.7">
        <circle cx="24" cy="58" r="12" />
        <circle cx="60" cy="58" r="12" />
      </g>
      {/* Antrieb */}
      <g strokeWidth="0.9">
        <circle cx="40" cy="58" r="3" />
        <circle cx="24" cy="58" r="2" />
        <path d="M24 56.4 L40 55.4 M24 59.6 L40 60.6" />
      </g>
      <circle cx="24" cy="58" r="1.4" fill={color} stroke="none" />
      <circle cx="60" cy="58" r="1.4" fill={color} stroke="none" />
      {/* Rahmen */}
      <path strokeWidth="1.7" d="M24 58 L40 58 M40 58 L34 40 M24 58 L34 40 M34 40 L54 40 M40 58 L54 41 M54 40 L60 58" />
      {/* Lenker, Sattel, Pedal */}
      <path strokeWidth="1.7" d="M54 40 L53 32 M49 32 L57 31 M30 39 L38 39 M40 58 L43 64 M40 64 L46 64" />
      {/* Beine + Rumpf */}
      <path strokeWidth="1.7" d="M35 41 L41 52 L43 64 M35 41 L33 52 L40 64 M35 41 L45 30" />
      {/* Arme + Hals */}
      <path strokeWidth="1.6" d="M45 31 L54 34 M45 30 L58 28 M45 30 L48 25" />
      {/* Kopf */}
      <circle cx="49" cy="23" r="5" strokeWidth="1.6" />
      <path strokeWidth="1.2" d="M52 24.5 L54 24.5" />
      {/* Schiebermütze */}
      <path strokeWidth="1.6" d="M43 22 Q44 14 51 15 Q55 15.5 54 21 M53 20 L59 19" />
      {/* geworfene Zeitung */}
      <rect x="61" y="24" width="9" height="5" rx="1.2" strokeWidth="1.3" transform="rotate(-15 65 26)" />
      <path strokeWidth="1.1" d="M65.5 24.4 L67.4 28.3" transform="rotate(-15 65 26)" />
    </svg>
  );
}
