-- Mitarbeiter-Fotos ueberall (Sascha-Wunsch 2026-07-26): chartis_list_staff
-- liefert zusaetzlich avatar_url mit -- die RPC ist die Personen-Quelle fuer
-- Chartis (Thread-Liste, Picker, Chat) und die Telefonie-Presence; ohne
-- diese Erweiterung haetten diese Stellen keine Foto-URL (Task-Welt bekommt
-- sie schon via getAllUsers). avatar_url ist unkritisch (oeffentlicher
-- Bucket), passt also zur "nur unkritische Felder"-Regel dieser Funktion.
--
-- ⚠️ Rueckgabetyp aendert sich -> CREATE OR REPLACE reicht nicht, die
-- Funktion muss ersetzt werden (DROP + CREATE, Grants neu setzen).
DROP FUNCTION IF EXISTS public.chartis_list_staff();

CREATE FUNCTION public.chartis_list_staff()
RETURNS TABLE (id uuid, full_name text, email text, role text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, full_name, email, role, avatar_url FROM public.profiles
  WHERE public.chartis_is_staff()
$$;
GRANT EXECUTE ON FUNCTION public.chartis_list_staff() TO authenticated;
