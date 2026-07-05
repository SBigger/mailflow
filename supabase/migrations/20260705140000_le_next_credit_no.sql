-- ============================================================================
-- Atomare Gutschriftsnummer-Vergabe (behebt moegliche Doppel-G-Nummern).
-- Bisher: createCreditFromInvoice las le_number_sequence, rechnete +1 in JS und
-- schrieb zurueck -> zwei parallele Gutschriften konnten dieselbe Nummer ziehen.
--
-- Loesung: RPC mit FOR UPDATE-Row-Lock auf die credit-Sequenz -> atomar.
-- Respektiert das konfigurierte Format, reset_yearly und padding_length.
-- ============================================================================

create or replace function public.le_next_credit_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq  record;
  y    int := extract(year  from current_date);
  m    int := extract(month from current_date);
  n    int;
begin
  -- Row-Lock auf die credit-Sequenz -> serialisiert gleichzeitige Aufrufe
  select * into seq from le_number_sequence where kind = 'credit' for update;
  if not found then
    return null;  -- keine credit-Sequenz konfiguriert
  end if;

  if seq.reset_yearly and coalesce(seq.last_year, y) <> y then
    n := 1;
  else
    n := coalesce(seq.current_value, 0) + 1;
  end if;

  update le_number_sequence
     set current_value = n, last_year = y
   where id = seq.id;

  return replace(replace(replace(replace(
           coalesce(seq.format, 'G-{YYYY}-{NNNN}'),
           '{YYYY}', y::text),
           '{YY}',   right(y::text, 2)),
           '{MM}',   lpad(m::text, 2, '0')),
           '{NNNN}', lpad(n::text, coalesce(seq.padding_length, 4), '0'));
end $$;

grant execute on function public.le_next_credit_no() to authenticated, service_role;
