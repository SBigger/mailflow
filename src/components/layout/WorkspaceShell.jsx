import React, { useState, useEffect, useCallback } from "react";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "@/components/ui/resizable";
import { PANELS_FOR_CLASS } from "./useIsWidescreen";
import { WIDGET_KEYS, defaultAppsForCount } from "./workspaceRegistry";
import PanelHeader from "./PanelHeader";
import PanelWidget from "./PanelWidget";

// Widescreen-Shell v2: Panel 0 = <Outlet/> (die aktuelle Route bleibt über
// die Sidebar navigierbar), Panels 1..n zeigen Widgets aus der Registry,
// per Dropdown im Panel-Header austauschbar. Persistiert wird pro
// Viewport-Klasse (2col/3col/4col) getrennt in localStorage — Ultrawide-
// Layout im Büro und Laptop-Layout im Zug kommen sich so nicht in die Quere.
// Server-Sync/Presets/Focus-Mode folgen als eigene Commits.

const LS_KEY = (vc) => `workspace_v2_${vc}`;

function loadState(viewportClass, panelCount) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY(viewportClass)));
    if (
      raw &&
      Array.isArray(raw.apps) && raw.apps.length === panelCount - 1 &&
      Array.isArray(raw.sizes) && raw.sizes.length === panelCount &&
      raw.apps.every((a) => WIDGET_KEYS.includes(a))
    ) {
      return raw;
    }
  } catch { /* fallthrough */ }
  const first = 50;
  const rest = (100 - first) / (panelCount - 1);
  return {
    apps: defaultAppsForCount(panelCount - 1),
    sizes: [first, ...Array(panelCount - 1).fill(rest)],
  };
}

export default function WorkspaceShell({ viewportClass, children }) {
  const panelCount = PANELS_FOR_CLASS[viewportClass] ?? 2;
  const [state, setState] = useState(() => loadState(viewportClass, panelCount));

  useEffect(() => {
    setState(loadState(viewportClass, panelCount));
  }, [viewportClass, panelCount]);

  const persist = useCallback((next) => {
    setState(next);
    try {
      localStorage.setItem(LS_KEY(viewportClass), JSON.stringify(next));
    } catch { /* Quota / Privatmodus egal */ }
  }, [viewportClass]);

  const handleLayout = useCallback((sizes) => {
    persist({ ...state, sizes });
  }, [persist, state]);

  const handleSelectApp = useCallback((slotIndex, appKey) => {
    const apps = state.apps.slice();
    apps[slotIndex] = appKey;
    persist({ ...state, apps });
  }, [persist, state]);

  // Cross-Panel-Navigation: Widget A ruft onOpen(appKey, params) →
  // erstes Panel mit passender App wird fokussiert/ersetzt. In v2 ohne
  // Runtime-Params (die kommen mit dem Presets-/Kontext-Commit) reicht
  // "Panel auf diese App umschalten, falls noch nicht offen".
  const openApp = useCallback((appKey) => {
    const existingIdx = state.apps.indexOf(appKey);
    if (existingIdx >= 0) return; // schon offen, nichts zu tun in v2
    const apps = state.apps.slice();
    apps[0] = appKey;
    persist({ ...state, apps });
  }, [persist, state]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={handleLayout}
      className="h-full w-full"
    >
      <ResizablePanel defaultSize={state.sizes[0]} minSize={20} order={0}>
        <div className="h-full w-full overflow-hidden">{children}</div>
      </ResizablePanel>
      {state.apps.map((appKey, i) => (
        <React.Fragment key={i}>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={state.sizes[i + 1]} minSize={15} order={i + 1}>
            <div className="h-full w-full flex flex-col overflow-hidden">
              <PanelHeader appKey={appKey} onSelectApp={(next) => handleSelectApp(i, next)} />
              <div className="min-h-0 flex-1 overflow-hidden">
                <PanelWidget appKey={appKey} onOpen={openApp} />
              </div>
            </div>
          </ResizablePanel>
        </React.Fragment>
      ))}
    </ResizablePanelGroup>
  );
}
