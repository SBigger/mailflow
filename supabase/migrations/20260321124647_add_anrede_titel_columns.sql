-- Anrede (Herr/Frau) für Privatpersonen in customers-Tabelle
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS anrede TEXT DEFAULT '';

-- Titel (z.B. Dr., lic.iur.) für Benutzer in profiles-Tabelle (für Briefunterschrift)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS titel TEXT DEFAULT '';
