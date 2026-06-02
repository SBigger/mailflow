-- ============================================================
-- ticket_messages.created_by hinzufuegen
-- ============================================================
-- Der entities.create()-Wrapper in src/api/supabaseClient.js fuegt
-- automatisch created_by ein. Auf smartis fehlt die Spalte.
-- Idempotent: IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- PostgREST muss seinen Schema-Cache neu laden
NOTIFY pgrst, 'reload schema';
