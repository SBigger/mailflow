import React, { useContext } from "react";
import { ThemeContext } from "@/Layout";

export default function MobileMailColumnNav({ columns, activeId, onChangeId, getCount }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const pageBg = isLight ? '#f0f0f6' : isArtis ? '#f2f5f2' : '#2a2a2f';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(113,113,122,0.3)';
  const inactiveText = isArtis ? '#6b826b' : isLight ? '#4a4a6a' : '#a1a1aa';
  const activeText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7';

  return (
    <div
      className="flex-shrink-0 overflow-x-auto border-b flex"
      style={{ backgroundColor: pageBg, borderColor }}
    >
      {columns.map((col) => {
        const isActive = col.id === activeId;
        const count = getCount?.(col) ?? 0;
        const accentColor = col.color || '#7c3aed';
        return (
          <button
            key={col.id}
            onClick={() => onChangeId(col.id)}
            className="px-4 py-2.5 flex flex-col items-center gap-0.5 flex-shrink-0 relative touch-manipulation"
            style={{ color: isActive ? activeText : inactiveText }}
          >
            <span className="text-sm font-semibold whitespace-nowrap">{col.name}</span>
            <span className="text-xs">{count}</span>
            {isActive && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ backgroundColor: accentColor }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}