-- =====================================================================
-- Atomare Rechnungsnummer-Vergabe (behebt Doppelnummern bei gleichzeitigem
-- Finalisieren). Bisher: le_next_invoice_no() = max()+1 ueber le_invoice,
-- nicht atomar -> zwei parallele finalize() konnten dieselbe Nummer ziehen.
--
-- Loesung: dedizierte Zaehler-Tabelle je Jahr. INSERT ... ON CONFLICT DO
-- UPDATE ... RETURNING haelt eine Row-Lock und ist damit atomar.
-- Idempotent: kann gefahrlos mehrfach ausgefuehrt werden.
-- =====================================================================

create table if not exists public.le_invoice_counter (
  year  int primary key,
  value int not null default 0
);

-- Vorbefuellen aus bestehenden Rechnungsnummern (Format R-YYYY-NNNN), damit
-- die Nummerierung nahtlos weiterlaeuft. greatest() macht das Seeding idempotent.
insert into public.le_invoice_counter (year, value)
select y, mx from (
  select (regexp_match(invoice_no, 'R-(\d{4})-'))[1]::int            as y,
         max((regexp_match(invoice_no, 'R-\d{4}-(\d+)'))[1]::int)    as mx
  from public.le_invoice
  where invoice_no ~ 'R-\d{4}-\d+'
  group by 1
) s
on conflict (year) do update
  set value = greatest(public.le_invoice_counter.value, excluded.value);

-- RLS: Tabelle selbst gesperrt (keine Policy) – Zugriff NUR ueber die
-- SECURITY-DEFINER-Funktion unten, die als Owner laeuft und RLS umgeht.
alter table public.le_invoice_counter enable row level security;

-- Atomare Nachfolge-Funktion: reserviert die naechste Nummer per Row-Lock.
-- SECURITY DEFINER, damit der Schreibzugriff auf den Zaehler trotz RLS klappt.
create or replace function public.le_next_invoice_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from current_date);
  n int;
begin
  insert into public.le_invoice_counter (year, value)
  values (y, 1)
  on conflict (year) do update
    set value = public.le_invoice_counter.value + 1
  returning value into n;
  return 'R-' || y || '-' || lpad(n::text, 4, '0');
end $$;
