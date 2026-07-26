import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";

// Einstieg des Video-Moduls ("Besprechungen"). Gemountet unter
// /besprechungen/* in App.jsx — eigene Shell, kein MailFlow-Layout
// (analog Telefonie und FiBu).
//
// Die Shell wird zusätzlich lazy geladen: livekit-client wiegt rund 130 kB
// gepackt und hat im Hauptbündel nichts verloren — wer nie eine Besprechung
// öffnet, lädt es nie.
const VideoShell = React.lazy(() => import("./VideoShell"));

const Spinner = () => (
  <div style={{
    position: "fixed", inset: 0, background: "#f2f5f2",
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <Loader2 style={{ width: 28, height: 28, color: "#2d6a4f", animation: "spin 1s linear infinite" }} />
    <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
);

export default function VideoRouter() {
  return (
    <Suspense fallback={<Spinner />}>
      <VideoShell />
    </Suspense>
  );
}
