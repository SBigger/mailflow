import React, { useMemo } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { useAuth } from "@/lib/AuthContext";
import { tele } from "./theme";
import { TelephonyProvider } from "./context/TelephonyContext";
import TelefonieSidebar from "./components/TelefonieSidebar";
import Softphone from "./components/Softphone";
import Cockpit from "./pages/Cockpit";
import { Verlauf, Rufgruppen, TeamPresence, Voicemail, Einstellungen } from "./pages/MorePages";

// Das Modul läuft (wie FiBu) AUSSERHALB des MailFlow-Layouts, daher ist der
// globale ThemeContext.Provider hier nicht im Baum. Wir lesen das aktuelle
// Theme selbst (gleiche Quelle wie Layout: localStorage 'app_theme' bzw.
// das data-theme am <html>) und stellen den Context fürs ganze Modul bereit —
// sonst würde alles im Default 'dark' rendern.
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

export default function TelefonieShell() {
  const { profile } = useAuth();
  const theme = useMemo(() => readTheme(profile), [profile]);
  const t = tele(theme);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: () => {} }}>
      <TelephonyProvider>
        <div
          style={{
            display: "flex", height: "100vh", overflow: "hidden",
            background: t.base, color: t.textPrimary,
            // Haus-Schriftstack aus tailwind.config.js (Century Gothic Std),
            // damit Telefonie exakt wie der Rest von smartis aussieht.
            fontFamily: '"Century Gothic Std", "Century Gothic", Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
        >
          <TelefonieSidebar />
          <main style={{ flex: 1, minWidth: 0, overflow: "auto", background: t.sunken }}>
            <Routes>
              <Route index element={<Cockpit />} />
              <Route path="verlauf" element={<Verlauf />} />
              <Route path="rufgruppen" element={<Rufgruppen />} />
              <Route path="team" element={<TeamPresence />} />
              <Route path="voicemail" element={<Voicemail />} />
              <Route path="einstellungen" element={<Einstellungen />} />
              <Route path="*" element={<Navigate to="/telefonie" replace />} />
            </Routes>
          </main>
          <Softphone />
        </div>
      </TelephonyProvider>
    </ThemeContext.Provider>
  );
}
