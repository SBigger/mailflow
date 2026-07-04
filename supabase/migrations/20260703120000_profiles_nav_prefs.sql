-- Navigations-Einstellungen pro Benutzer (Favoriten, Gruppen-Zustände, Sidebar-Modus)
-- Wird vom Frontend debounced geschrieben (navPrefsSync.js) und beim Start gelesen,
-- damit die Einstellungen auf allen Geräten gleich sind.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nav_prefs jsonb;
