import React from "react";

// 100%-breite/-hohe Overlay-Leiste über einem auf ~4% kollabierten Panel.
// Klick expandiert dieses Panel wieder (und kollabiert das bisher fokussierte).
export default function CollapsedPanelStrip({ icon: Icon, label, color, onExpand }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Panel «${label}» erweitern`}
      title={`Panel «${label}» erweitern`}
      className="h-full w-full flex flex-col items-center gap-3 py-3 bg-background hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color }} />}
      <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl] [text-orientation:mixed]">
        {label}
      </span>
    </button>
  );
}
