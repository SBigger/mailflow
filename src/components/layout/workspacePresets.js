// ── Presets für den Widescreen-Modus ────────────────────────────────
// Default-Presets sind Client-Konstanten (nicht in der DB) — sie
// versionieren mit dem Frontend-Deploy und referenzieren nur Keys aus
// workspaceRegistry.js. Eigene Presets werden pro Viewport-Klasse in
// localStorage gespeichert (kein Server-Sync in v1 — siehe Kommentar
// in WorkspaceShell.jsx).
import { WIDGET_KEYS } from "./workspaceRegistry";

export const BUILTIN_PRESETS = [
  {
    id: "builtin:triage",
    label: "Triage",
    description: "Post morgens abarbeiten",
    apps: ["posteingang", "kalender", "tasks"],
  },
  {
    id: "builtin:fibu",
    label: "Fibu",
    description: "Belege erfassen und buchen",
    apps: ["posteingang", "tasks", "telefonliste"],
  },
  {
    id: "builtin:planung",
    label: "Planung",
    description: "Woche und Aufgaben planen",
    apps: ["kalender", "tasks", "telefonliste"],
  },
];

const LS_CUSTOM_KEY = (viewportClass) => `workspace_presets_${viewportClass}`;

export function loadCustomPresets(viewportClass) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CUSTOM_KEY(viewportClass)));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p) => p && typeof p.id === "string" && typeof p.label === "string" &&
        Array.isArray(p.apps) && p.apps.every((a) => WIDGET_KEYS.includes(a))
    );
  } catch {
    return [];
  }
}

export function saveCustomPreset(viewportClass, { label, apps }) {
  const existing = loadCustomPresets(viewportClass);
  const preset = { id: `custom:${Date.now()}`, label, apps: apps.slice() };
  const next = [...existing, preset];
  try {
    localStorage.setItem(LS_CUSTOM_KEY(viewportClass), JSON.stringify(next));
  } catch { /* Quota / Privatmodus egal */ }
  return next;
}

export function deleteCustomPreset(viewportClass, presetId) {
  const next = loadCustomPresets(viewportClass).filter((p) => p.id !== presetId);
  try {
    localStorage.setItem(LS_CUSTOM_KEY(viewportClass), JSON.stringify(next));
  } catch { /* egal */ }
  return next;
}

// Panel-Slots ist panelCount-1 (Panel 0 ist die Route). Presets werden auf
// die verfügbare Slot-Zahl gekürzt oder mit ihrem letzten Eintrag aufgefüllt.
export function resolvePresetApps(preset, slotCount) {
  const apps = preset.apps.slice(0, slotCount);
  const fallback = apps[apps.length - 1] ?? WIDGET_KEYS[0];
  while (apps.length < slotCount) apps.push(fallback);
  return apps;
}
