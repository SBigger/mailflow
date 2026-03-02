import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function DateSeparator({ title, count, isCollapsed, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-1.5 bg-zinc-800/30 hover:bg-zinc-800/50 rounded-md transition-colors group mb-1.5"
    >
      {isCollapsed ? (
        <ChevronRight className="h-3 w-3 text-zinc-500 group-hover:text-zinc-400" />
      ) : (
        <ChevronDown className="h-3 w-3 text-zinc-500 group-hover:text-zinc-400" />
      )}
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
        {title}
      </span>
      <span className="ml-auto text-[10px] font-medium text-zinc-600 bg-zinc-700/40 px-1.5 py-0.5 rounded-full">
        {count}
      </span>
    </button>
  );
}