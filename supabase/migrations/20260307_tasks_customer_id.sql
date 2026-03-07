-- customer_id auf tasks: Kunden-Zuordnung für Tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

-- Index für schnelle Abfragen nach Kunde
CREATE INDEX IF NOT EXISTS tasks_customer_id_idx ON public.tasks(customer_id);
