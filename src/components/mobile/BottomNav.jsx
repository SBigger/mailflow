import React from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { LayoutDashboard, Mail, CheckSquare, Building2, CalendarClock } from "lucide-react";
import { useContext } from "react";
import { ThemeContext } from "@/Layout";

const navItems = [
  { name: "Dashboard",  label: "Dashboard", icon: LayoutDashboard },
  { name: "MailKanban", label: "Mails",     icon: Mail },
  { name: "TaskBoard",  label: "Tasks",     icon: CheckSquare },
  { name: "Fristen",    label: "Fristen",   icon: CalendarClock },
  { name: "Kunden",     label: "Kunden",    icon: Building2 },
];

export default function BottomNav() {
  const location = useLocation();
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  const bg = isArtis ? '#eaf0ea' : isLight ? '#e8e8ef' : '#1c1c21';
  const border = isArtis ? '#bfcfbf' : isLight ? '#d0d0dc' : 'rgba(63,63,70,0.6)';
  const activeColor = isArtis ? '#7a9b7f' : '#7c3aed';
  const inactiveColor = isArtis ? '#4a5e4a' : isLight ? '#5a5a7a' : '#71717a';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 flex border-t z-50 md:hidden"
      style={{ backgroundColor: bg, borderColor: border, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {navItems.map(({ name, label, icon: Icon }) => {
        const isActive = location.pathname.includes(name);
        return (
          <Link
            key={name}
            to={createPageUrl(name)}
            className="flex-1 flex flex-col items-center py-2 gap-0.5 touch-manipulation"
            style={{ color: isActive ? activeColor : inactiveColor }}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
