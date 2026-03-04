import React, { useContext } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function DateSeparator({ title, count, isCollapsed, onToggle }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const bg = isArtis
    ? 'rgba(122,155,127,0.14)'
    : isLight
    ? 'rgba(80,80,180,0.08)'
    : 'rgba(39,39,42,0.45)';

  const titleColor = isArtis
    ? '#1e4a28'
    : isLight
    ? '#2a2a5a'
    : '#c4c4cc';

  const chevronColor = isArtis
    ? '#4a7a5a'
    : isLight
    ? '#5050a0'
    : '#71717a';

  const countBg = isArtis
    ? 'rgba(122,155,127,0.22)'
    : isLight
    ? 'rgba(80,80,180,0.14)'
    : 'rgba(63,63,70,0.6)';

  const countColor = isArtis
    ? '#2d5c36'
    : isLight
    ? '#4040a0'
    : '#a1a1aa';

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors group mb-1.5"
      style={{ backgroundColor: bg }}
    >
      {isCollapsed ? (
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" style={{ color: chevronColor }} />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: chevronColor }} />
      )}
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: titleColor }}>
        {title}
      </span>
      <span
        className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
        style={{ backgroundColor: countBg, color: countColor }}
      >
        {count}
      </span>
    </button>
  );
}
