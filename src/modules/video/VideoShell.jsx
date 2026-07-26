import React, { useMemo } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useAuth } from "@/lib/AuthContext";
import { videoTheme, VIDEO_FONT } from "./theme";
import VideoSidebar from "./components/VideoSidebar";
import Uebersicht from "./pages/Uebersicht";
import Raum from "./pages/Raum";

// Wie Telefonie und FiBu läuft dieses Modul AUSSERHALB des MailFlow-Layouts,
// darum ist der globale ThemeContext.Provider hier nicht im Baum. Wir lesen
// das Theme selbst aus derselben Quelle wie das Layout – sonst rendert alles
// im Default 'dark'.
function readTheme(profile) {
  try {
    return (
      localStorage.getItem("app_theme") ||
      document.documentElement.getAttribute("data-theme") ||
      profile?.theme ||
      "artis"
    );
  } catch {
    return profile?.theme || "artis";
  }
}

export default function VideoShell() {
  const { profile } = useAuth();
  const theme = useMemo(() => readTheme(profile), [profile]);
  const t = videoTheme(theme);
  const location = useLocation();

  // Im laufenden Gespräch verschwindet die Seitenleiste: Die Bühne soll die
  // ganze Breite haben, und der Ausstieg führt bewusst über "Verlassen",
  // nicht über einen Menüklick mitten im Gespräch.
  const inCall = /\/besprechungen\/raum\//.test(location.pathname);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: () => {} }}>
      <div style={{
        display: "flex", height: "100vh", overflow: "hidden",
        background: t.base, color: t.textPrimary, fontFamily: VIDEO_FONT,
      }}>
        {!inCall && <VideoSidebar />}
        <main style={{ flex: 1, minWidth: 0, overflow: inCall ? "hidden" : "auto", background: t.sunken }}>
          <Routes>
            <Route index element={<Uebersicht />} />
            <Route path="raum/:roomName" element={<Raum />} />
            <Route path="*" element={<Navigate to="/besprechungen" replace />} />
          </Routes>
        </main>
      </div>
    </ThemeContext.Provider>
  );
}
