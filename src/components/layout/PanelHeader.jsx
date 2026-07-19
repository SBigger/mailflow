import React from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { WIDGETS } from "./workspaceRegistry";

// 36px Header, links App-Switcher-Dropdown. Ganzer Header ist Drag-Handle
// nur in Kombination mit dem Splitter darunter (kein eigenes Reorder-DnD in v2).
export default function PanelHeader({ appKey, onSelectApp }) {
  const current = WIDGETS[appKey];
  const CurIcon = current?.icon;
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-background px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
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
    </div>
  );
}
