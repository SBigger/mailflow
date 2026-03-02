import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";

let listeners = [];
let currentTheme = localStorage.getItem("app_theme") || "dark";

export function setGlobalTheme(theme) {
  currentTheme = theme;
  localStorage.setItem("app_theme", theme);
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach(fn => fn(theme));
}

document.documentElement.setAttribute("data-theme", currentTheme);

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    const listener = (t) => setTheme(t);
    listeners.push(listener);
    return () => { listeners = listeners.filter(l => l !== listener); };
  }, []);

  const toggleTheme = async (newTheme) => {
    setGlobalTheme(newTheme);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ theme: newTheme }).eq('id', user.id);
      }
    } catch (e) { /* ignore */ }
  };

  return { theme, toggleTheme };
}
