-- Leistungsarten bekommen ein eigenes Ertragskonto (analog fibu_artikel.ertragskonto),
-- für die spätere Buchung bei Rechnungsversand in den Fibu-Mandanten "Artis".
-- Kein FK auf fibu_konten (gleiches Muster wie fibu_artikel: Konto-Nr. als Text).

alter table public.le_service_type
  add column if not exists ertragskonto text not null default '3400';

comment on column public.le_service_type.ertragskonto is
  'Konto-Nr. aus fibu_konten (Mandant "Artis", konto_typ=ertrag) für die Buchung bei Rechnungsversand.';
