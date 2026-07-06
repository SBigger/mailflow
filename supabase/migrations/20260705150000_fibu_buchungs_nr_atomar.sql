-- ============================================================================
-- Atomare Fibu-Buchungsnummer (behebt Race Condition / Doppelnummern).
-- Bisher: SELECT max(buchungs_nr) ... FOR UPDATE SKIP LOCKED. Eine parallele
-- Transaktion ueberspringt die gesperrte Max-Zeile (SKIP LOCKED), liest ein zu
-- kleines Maximum und vergibt dieselbe naechste Nummer -> Doppelnummer.
--
-- Loesung: dedizierte Zaehler-Tabelle je (Mandant, Jahr) + INSERT ... ON CONFLICT
-- DO UPDATE ... RETURNING (Row-Lock -> atomar). Analog zu le_invoice_counter.
-- ============================================================================

create table if not exists public.fibu_buchungs_counter (
  mandant_id uuid not null,
  year       int  not null,
  value      int  not null default 0,
  primary key (mandant_id, year)
);

-- Seeding aus bestehenden Buchungsnummern (Format BU-YYYY-NNNNN), damit die
-- Nummerierung nahtlos weiterlaeuft. greatest() macht das Seeding idempotent.
insert into public.fibu_buchungs_counter (mandant_id, year, value)
select mandant_id,
       (split_part(buchungs_nr, '-', 2))::int              as year,
       max((split_part(buchungs_nr, '-', 3))::int)         as value
from public.fibu_buchungen
where buchungs_nr ~ 'BU-\d{4}-\d+'
group by mandant_id, (split_part(buchungs_nr, '-', 2))::int
on conflict (mandant_id, year) do update
  set value = greatest(public.fibu_buchungs_counter.value, excluded.value);

-- RLS an (Zugriff nur ueber die SECURITY-DEFINER-Funktion)
alter table public.fibu_buchungs_counter enable row level security;

create or replace function public.fibu_next_buchungs_nr(p_mandant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into public.fibu_buchungs_counter (mandant_id, year, value)
  values (p_mandant_id, y, 1)
  on conflict (mandant_id, year) do update
    set value = public.fibu_buchungs_counter.value + 1
  returning value into n;
  return 'BU-' || y || '-' || lpad(n::text, 5, '0');
end $$;
