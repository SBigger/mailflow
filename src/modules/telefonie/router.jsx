import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";

// Einstieg des Telefonie-Moduls. Gemountet unter /telefonie/* in App.jsx —
// eigene Shell + Sub-Sidebar, kein MailFlow-Layout (analog zum FiBu-Modul).
const TelefonieShell = React.lazy(() => import("./TelefonieShell"));

const Spinner = () => (
  <div style={{ position: "fixed", inset: 0, background: "#f2f5f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Loader2 style={{ width: 28, height: 28, color: "#2d6a4f", animation: "spin 1s linear infinite" }} />
    <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
);

export default function TelefonieRouter() {
  return (
    <Suspense fallback={<Spinner />}>
      <TelefonieShell />
    </Suspense>
  );
}
