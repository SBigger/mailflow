-- ===========================================================================
-- TicketBoard fuer interne 3-Wege-Kollaboration nutzbar machen
-- ===========================================================================
-- Problem auf smartis.me: ticket_columns ist leer -> Board zeigt nichts an,
-- AddTicketDialog hat keine Spalte zum Anhaengen. Zusaetzlich erlaubt der
-- CHECK-Constraint auf support_tickets.ticket_type nur 'regular' und
-- 'documents_only' -- wir brauchen 'internal' fuer Sascha/Roger/Claude.
-- ===========================================================================

BEGIN;

-- 1) Standard-Spalten seeden (idempotent) ----------------------------------
INSERT INTO public.ticket_columns (name, color, "order")
VALUES
  ('Neu',                  '#6366f1', 10),
  ('In Arbeit',            '#f59e0b', 20),
  ('Warten auf Antwort',   '#a855f7', 30),
  ('Erledigt',             '#10b981', 40)
ON CONFLICT DO NOTHING;

-- Falls Spaltennamen schon existieren aber in anderer Reihenfolge,
-- werden sie nicht doppelt eingefuegt (Name ist nicht UNIQUE -> wir matchen
-- ueber NOT EXISTS pro Name).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ticket_columns WHERE name = 'Neu') THEN
    INSERT INTO public.ticket_columns(name, color, "order") VALUES('Neu', '#6366f1', 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_columns WHERE name = 'In Arbeit') THEN
    INSERT INTO public.ticket_columns(name, color, "order") VALUES('In Arbeit', '#f59e0b', 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_columns WHERE name ILIKE 'Warten%') THEN
    INSERT INTO public.ticket_columns(name, color, "order") VALUES('Warten auf Antwort', '#a855f7', 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_columns WHERE name = 'Erledigt') THEN
    INSERT INTO public.ticket_columns(name, color, "order") VALUES('Erledigt', '#10b981', 40);
  END IF;
END $$;

-- 2) ticket_type 'internal' erlauben ---------------------------------------
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_ticket_type_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_ticket_type_check
  CHECK (ticket_type IN ('regular', 'documents_only', 'internal'));

COMMIT;

-- ===========================================================================
-- TEST nach dem Einspielen:
--   SELECT name, "order" FROM public.ticket_columns ORDER BY "order";
--     -> 4 Zeilen
--
--   SELECT consrc FROM pg_constraint WHERE conname = 'support_tickets_ticket_type_check';
--     -> sollte 'internal' enthalten
-- ===========================================================================
