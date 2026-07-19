import React, { useState, useEffect } from "react";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "@/components/ui/resizable";
import { PANELS_FOR_CLASS } from "./useIsWidescreen";
import { LayoutGrid } from "lucide-react";

// Widescreen-Foundation v1: eine minimale Shell mit
// - Panel 0 = <Outlet/> (die aktuelle Route bleibt navigierbar über die Sidebar)
// - Panels 1..n = Platzhalter mit App-Switcher-Callout (kommt in v2)
//
// Fokus/Presets/Widgets/Registry: alles Phase 2. v1 beweist nur, dass das
// Layout additiv funktioniert — kein Widget läuft noch, keine Persistenz.
// LayoutStorage-Key pro Viewport-Klasse, damit Ultrawide-/Laptop-Layouts
// getrennt bleiben.

const LS_LAYOUT = (vc) => `workspace_layout_${vc}`;

function loadSizes(viewportClass, panelCount) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LAYOUT(viewportClass)));
    if (Array.isArray(raw) && raw.length === panelCount && raw.every((n) => typeof n === "number")) {
      return raw;
    }
  } catch { /* fallthrough */ }
  // Default: Outlet-Panel etwas breiter, Rest gleichverteilt.
  const first = 50;
  const rest = (100 - first) / (panelCount - 1);
  return [first, ...Array(panelCount - 1).fill(rest)];
}

export default function WorkspaceShell({ viewportClass, children }) {
  const panelCount = PANELS_FOR_CLASS[viewportClass] ?? 2;
  const [sizes, setSizes] = useState(() => loadSizes(viewportClass, panelCount));

  // Beim Wechsel der Viewport-Klasse neu laden (Panels ändern Anzahl).
  useEffect(() => {
    setSizes(loadSizes(viewportClass, panelCount));
  }, [viewportClass, panelCount]);

  const handleLayout = (next) => {
    setSizes(next);
    try {
      localStorage.setItem(LS_LAYOUT(viewportClass), JSON.stringify(next));
    } catch { /* Quota / Privatmodus egal */ }
  };

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={handleLayout}
      className="h-full w-full"
    >
      <ResizablePanel defaultSize={sizes[0]} minSize={20} order={0}>
        <div className="h-full w-full overflow-hidden">{children}</div>
      </ResizablePanel>
      {Array.from({ length: panelCount - 1 }, (_, i) => (
        <React.Fragment key={i + 1}>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={sizes[i + 1]} minSize={15} order={i + 1}>
            <PlaceholderPanel index={i + 2} />
          </ResizablePanel>
        </React.Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function PlaceholderPanel({ index }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground border-l border-border">
      <LayoutGrid className="h-8 w-8 opacity-50" />
      <div className="font-medium">Panel {index}</div>
      <div className="text-xs max-w-[280px]">
        App-Auswahl folgt im nächsten Update. Der Widescreen-Modus ist bereits aktiv —
        Panel-Breiten links per Splitter anpassen wird gespeichert.
      </div>
    </div>
  );
}
