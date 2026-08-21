-- Kunden: ABC-Klassierung (Unternehmen & Privatpersonen; Kontakte bleiben aussen vor)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS abc_klasse text;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_abc_klasse_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_abc_klasse_check CHECK (abc_klasse IS NULL OR abc_klasse IN ('A', 'B', 'C'));

-- TEST: SELECT abc_klasse, count(*) FROM public.customers GROUP BY abc_klasse;
