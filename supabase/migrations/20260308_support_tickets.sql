-- ============================================================
-- Support Ticket System
-- ============================================================

-- 1. Ticket-Spalten (Kanban Columns)
CREATE TABLE IF NOT EXISTS public.ticket_columns (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  color        TEXT DEFAULT '#6366f1',
  "order"      INTEGER NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ticket_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_columns_all_auth"
  ON public.ticket_columns FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Default-Spalten einfügen
INSERT INTO public.ticket_columns (name, color, "order") VALUES
  ('Neu',               '#ef4444', 0),
  ('In Bearbeitung',    '#f59e0b', 1),
  ('Warten auf Antwort','#6366f1', 2),
  ('Erledigt',          '#22c55e', 3);

-- 2. Support Tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  column_id     UUID REFERENCES public.ticket_columns(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,                          -- Betreff
  from_email    TEXT NOT NULL,
  from_name     TEXT,
  body          TEXT,                                    -- Erste Nachricht (Kundenanfrage)
  ticket_type   TEXT NOT NULL DEFAULT 'regular'          -- 'regular' | 'documents_only'
                  CHECK (ticket_type IN ('regular', 'documents_only')),
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id   UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  is_read       BOOLEAN DEFAULT FALSE,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_tickets_all_auth"
  ON public.support_tickets FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS support_tickets_column_id_idx ON public.support_tickets(column_id);
CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON public.support_tickets(created_at);
CREATE INDEX IF NOT EXISTS support_tickets_customer_id_idx ON public.support_tickets(customer_id);

-- Auto-Update updated_at
CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_support_tickets_updated_at();

-- 3. Ticket Nachrichten (Chat-Thread)
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id       UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  sender_type     TEXT NOT NULL DEFAULT 'staff'
                    CHECK (sender_type IN ('customer', 'staff', 'ai_suggestion')),
  sender_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_ai_suggestion BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_messages_all_auth"
  ON public.ticket_messages FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_id_idx ON public.ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_messages_created_at_idx ON public.ticket_messages(created_at);
