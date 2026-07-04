-- Externe (verrechnete) Stunden pro Zeiteintrag.
-- hours_internal bleibt der Ist-Rapport des Mitarbeiters (Mitarbeiter-Rapport,
-- Produktivität); hours_external übersteuert, was fakturiert wird.
-- NULL = es wird hours_internal verrechnet (Normalfall).
alter table public.le_time_entry
  add column if not exists hours_external numeric(6,2);

comment on column public.le_time_entry.hours_external is
  'Verrechnete Stunden (extern). NULL = hours_internal wird verrechnet.';
