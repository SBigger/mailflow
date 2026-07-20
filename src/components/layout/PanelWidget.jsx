import React, { Suspense } from "react";
import { WIDGETS } from "./workspaceRegistry";

class WidgetErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(err, info) {
    console.error("[PanelWidget]", this.props.appKey, err, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <div>Widget «{this.props.appKey}» konnte nicht geladen werden.</div>
          <button
            className="text-xs underline"
            onClick={() => this.setState({ error: null })}
          >
            Erneut versuchen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Rendert eine App aus der Widget-Registry innerhalb eines Widescreen-Panels.
 * `key={appKey}` auf der ErrorBoundary resettet lokalen State beim App-Wechsel.
 */
export default function PanelWidget({ appKey, onOpen }) {
  const def = WIDGETS[appKey];
  if (!def) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 text-sm text-muted-foreground">
        Unbekanntes Widget: {appKey}
      </div>
    );
  }
  const Comp = def.component;
  return (
    <div
      className="h-full w-full overflow-hidden relative"
      style={{ containerType: "inline-size" }}
    >
      <WidgetErrorBoundary appKey={appKey} key={appKey}>
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Lädt…</div>}>
          <Comp embedded onOpen={onOpen} />
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  );
}
