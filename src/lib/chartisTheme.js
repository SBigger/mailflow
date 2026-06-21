// ===========================================================================
// CHARTIS – zentrale Theme-Tokens (artis-grün / light-weiss / dark)
// Inline-JS-Muster wie im Rest des Repos (KEINE CSS-Variablen).
// Drei Flächen-Tiefen: sunken < base < raised. 95% neutral, 5% Akzent.
// ===========================================================================

export function chartisTheme(theme) {
  if (theme === "artis") return {
    sunken: "#eef3ee", base: "#f6f9f6", raised: "#ffffff",
    borderSubtle: "#d7e2d7", borderStrong: "#bcccbc",
    textPrimary: "#233323", textSecondary: "#4a6a4a", textMuted: "#6b826b",
    accent: "#5b8a5b", accentFill: "#7a9b7f", accentSoft: "rgba(91,138,91,.12)",
    activeRow: "#e6ede6", shadow: "0 2px 10px rgba(40,60,40,.10)",
  };
  if (theme === "light") return {
    sunken: "#f5f6fa", base: "#ffffff", raised: "#ffffff",
    borderSubtle: "#e8e9f0", borderStrong: "#d4d6e2",
    textPrimary: "#15161d", textSecondary: "#4b4d63", textMuted: "#82859b",
    accent: "#5b21b6", accentFill: "#6366f1", accentSoft: "rgba(99,102,241,.10)",
    activeRow: "#eef0fb", shadow: "0 1px 2px rgba(16,24,40,.06),0 6px 16px rgba(16,24,40,.10)",
  };
  return {
    sunken: "#161618", base: "#1d1d20", raised: "#27272a",
    borderSubtle: "rgba(63,63,70,0.5)", borderStrong: "rgba(82,82,91,0.6)",
    textPrimary: "#e4e4e7", textSecondary: "#a1a1aa", textMuted: "#71717a",
    accent: "#a5b4fc", accentFill: "#6366f1", accentSoft: "rgba(99,102,241,.18)",
    activeRow: "rgba(99,102,241,0.14)", shadow: "0 2px 12px rgba(0,0,0,.4)",
  };
}

// Über beide Themes konstant
export const SEM = {
  missed: "#ef4444", missedSoft: "#fde8e8",
  away: "#f59e0b",
  extern: "#d97706", externSoft: "#fff3e6", externBorder: "#f0b76a", externText: "#b45309",
  presence: { online: "#22c55e", away: "#f59e0b", busy: "#ef4444", offline: "#9ca3af" },
};

// Autoren-Palette (3-Wege-Kollab), wie in ChartisPanel/detectAuthor
export const AUTHOR = {
  sascha: { bg: "#dbeafe", text: "#1e3a8a" },
  claude: { bg: "#d1fae5", text: "#065f46" },
  roger:  { bg: "#fef3c7", text: "#78350f" },
  staff:  { bg: "#e0e7ff", text: "#3730a3" },
  team:   { bg: "#dcfce7", text: "#166534" },
};

export function authorKey(user) {
  const email = (user?.email || "").toLowerCase();
  const name = (user?.full_name || "").toLowerCase();
  if (email.includes("claude") || name === "claude") return "claude";
  if (email.includes("roger") || name.startsWith("roger")) return "roger";
  if (email.includes("sascha") || name.startsWith("sascha")) return "sascha";
  return "staff";
}

// Deterministische Initialen + Farbe je User
export function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

// „verpasst" aus call_records ableiten (kein natives missed-Flag bis Migration)
export function isMissed(call) {
  if (call?.missed === true) return true;
  return call?.direction === "incoming" && (call?.duration_seconds == null || call.duration_seconds < 5);
}
