import React from "react";
import { ChevronDown, Check, Maximize2, Minimize2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { WIDGETS } from "./workspaceRegistry";

// 36px Header, links App-Switcher-Dropdown, rechts Focus-Toggle.
// Doppelklick auf den Header (ausserhalb der Buttons) wirkt wie der Toggle.
export default function PanelHeader({ appKey, onSelectApp, isExpanded = false, onToggleExpand }) {
  const current = WIDGETS[appKey];
  const CurIcon = current?.icon;
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
      onDoubleClick={onToggleExpand}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {CurIcon && <CurIcon className="h-4 w-4 shrink-0" style={{ color: current.color }} />}
            <span className="truncate max-w-[140px]">{current?.label ?? "App wählen"}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {Object.entries(WIDGETS).map(([key, def]) => {
            const Icon = def.icon;
            const isCurrent = key === appKey;
            return (
              <DropdownMenuItem key={key} onSelect={() => onSelectApp(key)} className="gap-2">
                <Icon className="h-4 w-4 shrink-0" style={{ color: def.color }} />
                <span className="flex-1 truncate">{def.label}</span>
                {isCurrent && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="min-w-0 flex-1" />

      <button
        type="button"
        onClick={onToggleExpand}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={isExpanded ? "Panel verkleinern" : "Panel vergrössern"}
        title={isExpanded ? "Panel verkleinern (Esc)" : "Panel vergrössern"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
