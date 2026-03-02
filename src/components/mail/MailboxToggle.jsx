import React, { useContext } from "react";
import { Users, User } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function MailboxToggle({ activeMailbox, onChange }) {
  const { theme } = useContext(ThemeContext) || { theme: 'dark' };
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const isLightish = isLight || isArtis;

  return (
    <div className={`flex rounded-xl p-1 border ${isLightish ? 'bg-gray-100 border-gray-200' : 'bg-zinc-900/60 border-zinc-800/50'}`}>
      <button
        onClick={() => onChange("group")}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeMailbox === "group"
            ? "bg-indigo-600/20 text-indigo-600 shadow-sm"
            : isLightish ? "text-gray-500 hover:text-gray-800 hover:bg-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
        }`}
      >
        <Users className="h-4 w-4" />
        <span>Gruppenpostfach</span>
      </button>
      <button
        onClick={() => onChange("personal")}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeMailbox === "personal"
            ? "bg-cyan-600/20 text-cyan-700 shadow-sm"
            : isLightish ? "text-gray-500 hover:text-gray-800 hover:bg-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
        }`}
      >
        <User className="h-4 w-4" />
        <span>Mein Postfach</span>
      </button>
    </div>
  );
}