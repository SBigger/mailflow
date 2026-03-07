-- Unterlagen erhalten: Datum wann Unterlagen vom Kunden empfangen wurden
ALTER TABLE public.fristen
  ADD COLUMN IF NOT EXISTS unterlagen_datum DATE;
