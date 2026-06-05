-- ============================================================
-- support_tickets.priority_id -- gleiches Konzept wie tasks.priority_id
-- ============================================================
-- Referenziert public.priorities (Dringend/Hoch/Mittel/Niedrig).
-- ON DELETE SET NULL: wenn Priority geloescht wird, Ticket behaelt
-- keinen invaliden Pointer.
-- ============================================================

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS priority_id uuid REFERENCES public.priorities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS support_tickets_priority_id_idx
  ON public.support_tickets(priority_id);

NOTIFY pgrst, 'reload schema';
