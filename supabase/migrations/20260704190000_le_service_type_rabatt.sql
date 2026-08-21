-- Neue Leistungsarten für Vortrag-Import und laufende Erfassung:
--   RABATT: Fakturaliste-Kontogruppe 4900 "Rabatt". billable=true, damit Rabatt (negativer
--           Betrag) direkt gegen die abrechenbare Summe eines Projekts verrechnet wird.
--   SPES:   Spesen-Weiterbelastung. billable=true; Konto/Section kann später pro Bedarf
--           angepasst werden (heute alles auf 3400/honorar, Feinjustierung im UI).
insert into public.le_service_type (code, name, billable, sort_order, active, default_vat_code, default_section, ertragskonto)
select 'RABATT', 'Rabatt', true, (select coalesce(max(sort_order), 0) + 1 from public.le_service_type), true, 'STD', 'honorar', '3400'
where not exists (select 1 from public.le_service_type where code = 'RABATT');

insert into public.le_service_type (code, name, billable, sort_order, active, default_vat_code, default_section, ertragskonto)
select 'SPES', 'Spesen', true, (select coalesce(max(sort_order), 0) + 1 from public.le_service_type), true, 'STD', 'honorar', '3400'
where not exists (select 1 from public.le_service_type where code = 'SPES');
