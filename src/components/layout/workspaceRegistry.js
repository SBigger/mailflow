// ── Widget-Registry für Widescreen-Panels ──────────────────────────
// Eine Teilmenge des App-Katalogs, bewusst kuratiert statt vollständig:
// nur Seiten, die sich sicher in ein begrenztes Panel einbetten lassen
// (embedded-Prop, kein Vollbild-Zwang, keine URL-Nebenwirkungen).
//
// TABU: MailKanban.jsx (MS365-Mail-Integration) ist bewusst NICHT
// gelistet — siehe CLAUDE.md. `dokumente` zeigt NICHT src/pages/Dokumente.jsx
// (handleCheckout/handleCheckin dort sind tabu), sondern eine eigene
// Read-only-Komponente (DokumenteWidget.jsx) ohne Checkout-Codepfade.
import { lazy } from "react";
import { Phone, CheckSquare, CalendarDays, CloudUpload, FileText } from "lucide-react";

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
  dokumente: {
    label: "Dokumente",
    icon: FileText,
    color: "#0891b2",
    component: lazy(() => import("@/components/widgets/DokumenteWidget.jsx")),
  },
};

export const WIDGET_KEYS = Object.keys(WIDGETS);

export function defaultAppsForCount(count) {
  // Panel 0 ist immer die Route (kein Registry-Eintrag); hier nur 1..n.
  const order = ["kalender", "tasks", "telefonliste", "dokumente"];
  return order.slice(0, count);
}
