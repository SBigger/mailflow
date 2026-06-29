-- Kunden: Feld "keine_frist" (Unternehmen & Personen von der Fristen-Generierung ausschliessen)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS keine_frist boolean NOT NULL DEFAULT false;

-- TEST: SELECT count(*) FROM public.customers WHERE keine_frist;
