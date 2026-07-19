import React, { useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  CalendarDays, Phone, CheckSquare, MoreHorizontal,
  LayoutDashboard, Mail, CalendarClock, Building2,
  FolderArchive, CloudUpload, MessageSquare, Receipt,
  Settings as SettingsIcon,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

// Primäre Bottom-Tabs (max. 4 — Kalender + Kontakte primär, Tasks häufig,
// Rest im "Mehr"-Sheet). Priorisierung gemäss User-Wunsch: Kalender/Kontakte
// als Haupt-Use-Cases, Aufgaben als häufiger Zweit-Tab, Dashboard/Mail/Fristen
// wandern ins Sheet.
const primaryTabs = [
  { name: "Kalender",     label: "Kalender", icon: CalendarDays },
  { name: "Telefonliste", label: "Kontakte", icon: Phone },
  { name: "TaskBoard",    label: "Aufgaben", icon: CheckSquare },
];

// "Mehr"-Sheet: kuratierte 3x3-Auswahl der wichtigsten Sekundär-Apps.
// Bewusst nicht der komplette Katalog — auf Mobile ist Fokus wichtiger als
// Vollständigkeit; jede App bleibt via /-URL direkt erreichbar.
const moreItems = [
  { name: "Dashboard",   label: "Dashboard",     icon: LayoutDashboard },
  { name: "MailKanban",  label: "Mails",         icon: Mail },
  { name: "Fristen",     label: "Fristen",       icon: CalendarClock },
  { name: "Kunden",      label: "Kunden",        icon: Building2 },
  { name: "Dokumente",   label: "Dokumente",     icon: FolderArchive },
  { name: "Posteingang", label: "Paperboy",      icon: CloudUpload },
  { name: "Chartis",     label: "Chartis",       icon: MessageSquare },
  { name: "Settings",    label: "Einstellungen", icon: SettingsIcon },
];

// Fibu ist eine eigene Shell (/fibu/*), nicht Teil von createPageUrl —
// separater Eintrag, der direkt auf den Fibu-Root routet.
const fibuItem = { path: "/fibu", label: "Fibu", icon: Receipt };

function isTabActive(pathname, name) {
  const target = createPageUrl(name);
  return pathname === target || pathname.startsWith(target + "/");
}

export default function BottomNav() {
  const location = useLocation();
  const { theme } = useContext(ThemeContext);
  const [moreOpen, setMoreOpen] = useState(false);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const bg = isArtis ? "#eaf0ea" : isLight ? "#e8e8ef" : "#1c1c21";
  const border = isArtis ? "#bfcfbf" : isLight ? "#d0d0dc" : "rgba(63,63,70,0.6)";
  const activeColor = isArtis ? "#7a9b7f" : "#7c3aed";
  const inactiveColor = isArtis ? "#4a5e4a" : isLight ? "#5a5a7a" : "#71717a";
  const sheetBg = isArtis ? "#f7faf7" : isLight ? "#ffffff" : "#18181b";
  const gridItemBg = isArtis ? "#ffffff" : isLight ? "#f5f5fa" : "#27272e";
  const textPrimary = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";

  const moreActive =
    !primaryTabs.some((t) => isTabActive(location.pathname, t.name)) &&
    location.pathname !== "/";

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 flex border-t z-50 md:hidden"
        style={{ backgroundColor: bg, borderColor: border, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryTabs.map(({ name, label, icon: Icon }) => {
          const isActive = isTabActive(location.pathname, name);
          return (
            <Link
              key={name}
              to={createPageUrl(name)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 touch-manipulation"
              style={{ color: isActive ? activeColor : inactiveColor, minHeight: 56 }}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 touch-manipulation bg-transparent border-0"
          style={{ color: moreActive ? activeColor : inactiveColor, minHeight: 56 }}
          aria-label="Weitere Apps anzeigen"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium">Mehr</span>
        </button>
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-t px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5"
          style={{ backgroundColor: sheetBg, borderColor: border, color: textPrimary }}
        >
          <SheetHeader className="mb-4">
            <SheetTitle style={{ color: textPrimary }}>Weitere Apps</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-3">
            {moreItems.map(({ name, label, icon: Icon }) => (
              <Link
                key={name}
                to={createPageUrl(name)}
                onClick={() => setMoreOpen(false)}
                className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 touch-manipulation"
                style={{ backgroundColor: gridItemBg, color: textPrimary, minHeight: 84 }}
              >
                <Icon className="h-6 w-6" style={{ color: activeColor }} />
                <span className="text-xs font-medium text-center leading-tight">{label}</span>
              </Link>
            ))}
            <Link
              to={fibuItem.path}
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 touch-manipulation"
              style={{ backgroundColor: gridItemBg, color: textPrimary, minHeight: 84 }}
            >
              <fibuItem.icon className="h-6 w-6" style={{ color: activeColor }} />
              <span className="text-xs font-medium text-center leading-tight">{fibuItem.label}</span>
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
