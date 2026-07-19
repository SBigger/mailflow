import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "@/components/ui/resizable";
import { LayoutDashboard, Maximize2, Minimize2, Inbox, Receipt, CalendarClock, Save, Trash2 } from "lucide-react";
import { PANELS_FOR_CLASS } from "./useIsWidescreen";
import { WIDGET_KEYS, WIDGETS, defaultAppsForCount } from "./workspaceRegistry";
import { BUILTIN_PRESETS, loadCustomPresets, saveCustomPreset, deleteCustomPreset, resolvePresetApps } from "./workspacePresets";
import PanelHeader from "./PanelHeader";
import PanelWidget from "./PanelWidget";
import CollapsedPanelStrip from "./CollapsedPanelStrip";
import SavePresetDialog from "./SavePresetDialog";

const PRESET_ICONS = {
  "builtin:triage": Inbox,
  "builtin:fibu": Receipt,
  "builtin:planung": CalendarClock,
};

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Widescreen-Shell v3: Panel 0 = <Outlet/> (die aktuelle Route bleibt über
// die Sidebar navigierbar), Panels 1..n zeigen Widgets aus der Registry,
// per Dropdown im Panel-Header austauschbar. Persistiert wird pro
// Viewport-Klasse (2col/3col/4col) getrennt in localStorage.
//
// Focus-Mode: Klick auf den Expand-Button (oder Doppelklick auf den Header,
// oder Esc zum Verlassen) kollabiert alle anderen Panels über die
// imperative react-resizable-panels-API (collapse()/expand()) auf ~4%.
// Der Inhalt bleibt dabei gemountet (nur `invisible`, kein Unmount) — Scroll-
// Position und Formular-Zustand in den Widgets gehen beim Fokussieren nicht
// verloren. Die Größen vor dem Kollabieren merkt sich die Bibliothek selbst
// (panelSizeBeforeCollapse), Verlassen stellt sie exakt wieder her.
// Presets/Server-Sync folgen als eigene Commits.

const LS_KEY = (vc) => `workspace_v2_${vc}`;
const COLLAPSED_SIZE = 4;

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

export default function WorkspaceShell({ viewportClass, currentPageName, children }) {
  const panelCount = PANELS_FOR_CLASS[viewportClass] ?? 2;
  const [state, setState] = useState(() => loadState(viewportClass, panelCount));
  const [focusedIndex, setFocusedIndex] = useState(null);

  const panelRefs = useRef([]);
  const focusModeRef = useRef(false); // synchron VOR den imperativen collapse()/expand()-Aufrufen gesetzt

  const slotCount = panelCount - 1;
  const [customPresets, setCustomPresets] = useState(() => loadCustomPresets(viewportClass));
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  useEffect(() => {
    setState(loadState(viewportClass, panelCount));
    setCustomPresets(loadCustomPresets(viewportClass));
    setFocusedIndex(null);
    focusModeRef.current = false;
  }, [viewportClass, panelCount]);

  const handleLayout = useCallback((sizes) => {
    // Während des Focus-Mode feuert onLayout mehrfach mit Zwischenzuständen
    // (kollabierte Panels) — die dürfen die eigentlichen Nutzer-Größen nicht
    // überschreiben.
    if (focusModeRef.current) return;
    setState((prev) => {
      const next = { ...prev, sizes };
      try {
        localStorage.setItem(LS_KEY(viewportClass), JSON.stringify(next));
      } catch { /* egal */ }
      return next;
    });
  }, [viewportClass]);

  const handleSelectApp = useCallback((slotIndex, appKey) => {
    setState((prev) => {
      const apps = prev.apps.slice();
      apps[slotIndex] = appKey;
      const next = { ...prev, apps };
      try {
        localStorage.setItem(LS_KEY(viewportClass), JSON.stringify(next));
      } catch { /* egal */ }
      return next;
    });
  }, [viewportClass]);

  // Cross-Panel-Navigation: Widget A ruft onOpen(appKey) → falls die App
  // schon in einem Panel läuft, nichts tun; sonst Panel 1 darauf umschalten.
  // Runtime-Params (z.B. welcher Kunde) folgen mit dem Presets-/Kontext-Commit.
  const openApp = useCallback((appKey) => {
    setState((prev) => {
      if (prev.apps.includes(appKey)) return prev;
      const apps = prev.apps.slice();
      apps[0] = appKey;
      const next = { ...prev, apps };
      try {
        localStorage.setItem(LS_KEY(viewportClass), JSON.stringify(next));
      } catch { /* egal */ }
      return next;
    });
  }, [viewportClass]);

  const allPresets = useMemo(
    () => [...BUILTIN_PRESETS, ...customPresets.map((p) => ({ ...p, custom: true }))],
    [customPresets]
  );

  const activePresetId = useMemo(() => {
    const match = allPresets.find((p) => arraysEqual(resolvePresetApps(p, slotCount), state.apps));
    return match?.id ?? null;
  }, [allPresets, slotCount, state.apps]);

  const applyPreset = useCallback((preset) => {
    const apps = resolvePresetApps(preset, slotCount);
    setState((prev) => {
      const next = { ...prev, apps };
      try {
        localStorage.setItem(LS_KEY(viewportClass), JSON.stringify(next));
      } catch { /* egal */ }
      return next;
    });
  }, [slotCount, viewportClass]);

  const handleSaveCurrentPreset = useCallback((label) => {
    const next = saveCustomPreset(viewportClass, { label, apps: state.apps });
    setCustomPresets(next);
  }, [viewportClass, state.apps]);

  const handleDeleteCustomPreset = useCallback((presetId) => {
    const next = deleteCustomPreset(viewportClass, presetId);
    setCustomPresets(next);
  }, [viewportClass]);

  const toggleFocus = useCallback((idx) => {
    setFocusedIndex((prev) => {
      const entering = prev !== idx;
      focusModeRef.current = entering;
      if (!entering) {
        panelRefs.current.forEach((p) => p?.expand?.());
        return null;
      }
      panelRefs.current.forEach((p, i) => {
        if (i === idx) p?.expand?.();
        else p?.collapse?.();
      });
      return idx;
    });
  }, []);

  // Esc verlässt den Focus-Mode.
  useEffect(() => {
    if (focusedIndex === null) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") toggleFocus(focusedIndex);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedIndex, toggleFocus]);

  const isFocusMode = focusedIndex !== null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {!isFocusMode && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2">
          {allPresets.map((preset) => {
            const Icon = PRESET_ICONS[preset.id];
            const isActive = preset.id === activePresetId;
            return (
              <div key={preset.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60"
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                  {preset.label}
                </button>
                {preset.custom && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomPreset(preset.id)}
                    aria-label={`Layout «${preset.label}» löschen`}
                    title="Layout löschen"
                    className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background/60 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => setSaveDialogOpen(true)}
            title="Aktuelles Layout als Preset speichern"
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            Speichern
          </button>
        </div>
      )}

      <SavePresetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={handleSaveCurrentPreset}
      />

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={handleLayout}
          className="h-full w-full"
        >
          <ResizablePanel
            ref={(el) => { panelRefs.current[0] = el; }}
            defaultSize={state.sizes[0]}
            minSize={20}
            collapsible
            collapsedSize={COLLAPSED_SIZE}
            order={0}
          >
            <div className="relative h-full w-full overflow-hidden">
              <div className={`flex h-full w-full flex-col overflow-hidden ${isFocusMode && focusedIndex !== 0 ? "invisible" : ""}`}>
                <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2" onDoubleClick={() => toggleFocus(0)}>
                  <span className="flex items-center gap-1.5 px-1.5 text-sm font-medium text-muted-foreground">
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="truncate max-w-[160px]">{currentPageName || "Aktuelle Seite"}</span>
                  </span>
                  <div className="min-w-0 flex-1" />
                  <button
                    type="button"
                    onClick={() => toggleFocus(0)}
                    aria-label={focusedIndex === 0 ? "Panel verkleinern" : "Panel vergrössern"}
                    title={focusedIndex === 0 ? "Panel verkleinern (Esc)" : "Panel vergrössern"}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {focusedIndex === 0 ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              </div>
              {isFocusMode && focusedIndex !== 0 && (
                <div className="absolute inset-0">
                  <CollapsedPanelStrip
                    icon={LayoutDashboard}
                    label={currentPageName || "Seite"}
                    onExpand={() => toggleFocus(0)}
                  />
                </div>
              )}
            </div>
          </ResizablePanel>

          {state.apps.map((appKey, i) => {
            const idx = i + 1;
            const def = WIDGETS[appKey];
            const collapsedHere = isFocusMode && focusedIndex !== idx;
            return (
              <React.Fragment key={idx}>
                {isFocusMode ? (
                  <div className="w-px shrink-0 bg-border" />
                ) : (
                  <ResizableHandle withHandle />
                )}
                <ResizablePanel
                  ref={(el) => { panelRefs.current[idx] = el; }}
                  defaultSize={state.sizes[idx]}
                  minSize={15}
                  collapsible
                  collapsedSize={COLLAPSED_SIZE}
                  order={idx}
                >
                  <div className="relative h-full w-full overflow-hidden">
                    <div className={`flex h-full w-full flex-col overflow-hidden ${collapsedHere ? "invisible" : ""}`}>
                      <PanelHeader
                        appKey={appKey}
                        onSelectApp={(next) => handleSelectApp(i, next)}
                        isExpanded={focusedIndex === idx}
                        onToggleExpand={() => toggleFocus(idx)}
                      />
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <PanelWidget appKey={appKey} onOpen={openApp} />
                      </div>
                    </div>
                    {collapsedHere && (
                      <div className="absolute inset-0">
                        <CollapsedPanelStrip
                          icon={def?.icon}
                          label={def?.label ?? appKey}
                          color={def?.color}
                          onExpand={() => toggleFocus(idx)}
                        />
                      </div>
                    )}
                  </div>
                </ResizablePanel>
              </React.Fragment>
            );
          })}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
