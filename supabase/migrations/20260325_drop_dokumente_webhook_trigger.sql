-- Fix: Entfernt den fehlerhaften Database-Webhook-Trigger auf dokumente.
-- Der Trigger rief net.http_post mit falschen Parametertypen auf und
-- blockierte dadurch jeden INSERT in die dokumente-Tabelle.
-- Das Indexieren erfolgt neu direkt vom Frontend via supabase.functions.invoke().

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Alle Trigger auf dokumente auflisten und die Webhook-Trigger entfernen
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_table = 'dokumente'
      AND event_object_schema = 'public'
      AND (
        trigger_name ILIKE '%webhook%'
        OR trigger_name ILIKE '%http%'
        OR trigger_name ILIKE '%index%'
        OR trigger_name ILIKE '%supabase_functions%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.dokumente', r.trigger_name);
    RAISE NOTICE 'Trigger entfernt: %', r.trigger_name;
  END LOOP;
END;
$$;

-- Explizit bekannte Trigger-Namen entfernen (falls vorhanden)
DROP TRIGGER IF EXISTS supabase_functions_index_document ON public.dokumente;
DROP TRIGGER IF EXISTS on_dokumente_insert             ON public.dokumente;
DROP TRIGGER IF EXISTS dokumente_index_trigger          ON public.dokumente;
DROP TRIGGER IF EXISTS index_on_insert                  ON public.dokumente;
