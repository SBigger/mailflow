-- =====================================================================
-- Leistungserfassung · Default-Seeds (optional)
-- =====================================================================
-- Legt die üblichen Leistungsarten + einen Default-Gruppenansatz an.
-- Idempotent (ON CONFLICT DO NOTHING).
-- =====================================================================

-- Leistungsarten
insert into public.le_service_type (code, name, billable, sort_order) values
  ('ABS',  'Abschlussarbeiten',  true,  10),
  ('BUCH', 'Buchhaltung',        true,  20),
  ('STEU', 'Steuern',            true,  30),
  ('REV',  'Revision',           true,  40),
  ('BER',  'Beratung',           true,  50),
  ('LOHN', 'Lohnadministration', true,  60),
  ('ADM',  'Administration',     true,  70),
  ('INT',  'Intern',             false, 90),
  ('WBD',  'Weiterbildung',      false, 95)
on conflict (code) do nothing;

-- Default-Satz-Historie pro Leistungsart (gültig ab 01.01.2026)
insert into public.le_service_rate_history (service_type_id, valid_from, rate)
select st.id, date '2026-01-01', r.rate
from public.le_service_type st
join (values
  ('ABS',  220.00),
  ('BUCH', 145.00),
  ('STEU', 220.00),
  ('REV',  260.00),
  ('BER',  260.00),
  ('LOHN', 120.00),
  ('ADM',   95.00)
) as r(code, rate) on r.code = st.code
on conflict (service_type_id, valid_from) do nothing;

-- Default-Gruppenansatz
insert into public.le_rate_group (name, description)
values ('Standard 2026', 'Regelsätze – Basis für Neukunden')
on conflict (name) do nothing;

-- Gruppen-Sätze = identisch zur Default-Satz-Historie
insert into public.le_rate_group_rate (rate_group_id, service_type_id, rate, valid_from)
select rg.id, st.id, r.rate, date '2026-01-01'
from public.le_rate_group rg
cross join public.le_service_type st
join (values
  ('ABS',  220.00),
  ('BUCH', 145.00),
  ('STEU', 220.00),
  ('REV',  260.00),
  ('BER',  260.00),
  ('LOHN', 120.00),
  ('ADM',   95.00)
) as r(code, rate) on r.code = st.code
where rg.name = 'Standard 2026'
on conflict (rate_group_id, service_type_id, valid_from) do nothing;
