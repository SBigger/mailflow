import React, { useContext } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeContext } from "@/Layout";
import { tele } from "./theme";
import { TelephonyProvider } from "./context/TelephonyContext";
import TelefonieSidebar from "./components/TelefonieSidebar";
import Softphone from "./components/Softphone";
import Cockpit from "./pages/Cockpit";
import { Verlauf, Rufgruppen, TeamPresence, Voicemail, Einstellungen } from "./pages/MorePages";

export default function TelefonieShell() {
  const { theme } = useContext(ThemeContext);
  const t = tele(theme);

  return (
    <TelephonyProvider>
      <div
        style={{
          display: "flex", height: "100vh", overflow: "hidden",
          background: t.base, color: t.textPrimary,
          fontFamily: '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
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
  );
}
