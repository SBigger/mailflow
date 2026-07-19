// ── Widget-Registry für Widescreen-Panels ──────────────────────────
// Eine Teilmenge des App-Katalogs, bewusst kuratiert statt vollständig:
// nur Seiten, die sich sicher in ein begrenztes Panel einbetten lassen
// (embedded-Prop, kein Vollbild-Zwang, keine URL-Nebenwirkungen).
//
// TABU: Dokumente.jsx (handleCheckout/handleCheckin) und MailKanban.jsx
// (MS365-Mail-Integration) sind hier bewusst NICHT gelistet — siehe
// CLAUDE.md. Ein Dokumente-Widget müsste eine eigene Read-only-Komponente
// sein, kein Rendering der Originalseite; das folgt als eigener Commit.
import { lazy } from "react";
import { Phone, CheckSquare, CalendarDays, CloudUpload } from "lucide-react";

export const WIDGETS = {
  telefonliste: {
    label: "Kontakte",
    icon: Phone,
    color: "#7a9b7f",
    component: lazy(() => import("@/pages/Telefonliste.jsx")),
  },
  tasks: {
    label: "Aufgaben",
    icon: CheckSquare,
    color: "#7c3aed",
    component: lazy(() => import("@/pages/TaskBoard.jsx")),
  },
  kalender: {
    label: "Kalender",
    icon: CalendarDays,
    color: "#2563eb",
    component: lazy(() => import("@/pages/Kalender.jsx")),
  },
  posteingang: {
    label: "Paperboy",
    icon: CloudUpload,
    color: "#dc2626",
    component: lazy(() => import("@/pages/Posteingang.jsx")),
  },
};

export const WIDGET_KEYS = Object.keys(WIDGETS);

export function defaultAppsForCount(count) {
  // Panel 0 ist immer die Route (kein Registry-Eintrag); hier nur 1..n.
  const order = ["kalender", "tasks", "telefonliste", "posteingang"];
  return order.slice(0, count);
}
