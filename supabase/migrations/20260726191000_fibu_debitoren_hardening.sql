-- ============================================================================
-- Fibu/Debitoren-Hardening aus dem Integrationsaudit
--
-- Behebt:
--   * Race Condition im Debitoren-Nummernkreis.
--   * Fehlende Buchhalter-Rollenpruefung beim Debitoren-Storno.
--   * Falsche Vorzeichen von Gutschriften/negativen Positionen in den
--     MWST-Auswertungen.
--   * Direkte oeffentliche Ausfuehrbarkeit des internen Buchungsnummernzaehlers.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Atomare Debitoren-Belegnummer
-- --------------------------------------------------------------------------
create table if not exists public.fibu_debitoren_counter (
  mandant_id uuid not null references public.fibu_mandanten(id) on delete cascade,
  year integer not null,
  value integer not null default 0 check (value >= 0),
  primary key (mandant_id, year)
);
alter table public.fibu_debitoren_counter enable row level security;

insert into public.fibu_debitoren_counter(mandant_id, year, value)
select mandant_id,
       split_part(beleg_nr, '-', 2)::integer,
       max(split_part(beleg_nr, '-', 3)::integer)
  from public.fibu_debitoren_belege
 where beleg_nr ~ '^DR-\d{4}-\d+$'
 group by mandant_id, split_part(beleg_nr, '-', 2)::integer
on conflict (mandant_id, year) do update
  set value = greatest(public.fibu_debitoren_counter.value, excluded.value);

create or replace function public.fibu_next_debitoren_nr(p_mandant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from current_date)::integer;
  n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_mandant_id) then
    raise exception 'Nur Admin/Buchhalter darf Debitoren-Belegnummern beziehen';
  end if;
  insert into public.fibu_debitoren_counter(mandant_id, year, value)
  values (p_mandant_id, y, 1)
  on conflict (mandant_id, year) do update
    set value = public.fibu_debitoren_counter.value + 1
  returning value into n;
  return 'DR-' || y || '-' || lpad(n::text, 4, '0');
end
$$;

-- --------------------------------------------------------------------------
-- 2) Debitoren-Storno: Row-Lock + echte Schreibrolle + Gegenbuchung
-- --------------------------------------------------------------------------
create or replace function public.fibu_debitoren_storno(
  p_beleg_id uuid,
  p_storno_datum date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.fibu_debitoren_belege%rowtype;
  storno_id uuid;
  storno_nr text;
begin
  select * into original
    from public.fibu_debitoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Beleg nicht gefunden'; end if;
  if not (original.mandant_id = any(public.fibu_mandant_ids_for_user()))
     or not public.fibu_can_write_for(original.mandant_id) then
    raise exception 'Kein Zugriff / keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if p_storno_datum is null then raise exception 'Storno-Datum fehlt'; end if;
  if original.belegtyp <> 'rechnung' then
    raise exception 'Nur Rechnungen koennen storniert werden';
  end if;
  if original.status = 'storniert' or original.storno_beleg_id is not null then
    raise exception 'Beleg % ist bereits storniert', original.beleg_nr;
  end if;
  if not original.verbucht then
    raise exception 'Nur gebuchte Debitoren-Rechnungen koennen storniert werden';
  end if;
  if abs(coalesce(original.betrag_bezahlt, 0)) > 0.005 then
    raise exception 'Rechnung % ist bereits (teil)bezahlt und kann nicht storniert werden', original.beleg_nr;
  end if;

  storno_nr := public.fibu_next_debitoren_nr(original.mandant_id);
  insert into public.fibu_debitoren_belege (
    mandant_id, beleg_nr, kunde_id, titel,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von,
    source_system, source_id
  ) values (
    original.mandant_id, storno_nr, original.kunde_id,
    'Storno zu ' || original.beleg_nr,
    p_storno_datum, p_storno_datum, p_storno_datum, 0,
    original.waehrung, -original.betrag_netto,
    -original.betrag_mwst, -original.betrag_brutto,
    'gutschrift', 'storniert',
    'Storno zu ' || original.beleg_nr || coalesce(' - ' || original.notiz, ''),
    auth.uid(), 'fibu_storno', original.id
  )
  returning id into storno_id;

  insert into public.fibu_debitoren_positionen (
    mandant_id, beleg_id, position, artikel_id, bezeichnung, menge, einheit,
    einzelpreis, konto_nr, mwst_code, mwst_satz,
    betrag_netto, betrag_mwst, betrag_brutto, kostenstelle
  )
  select mandant_id, storno_id, position, artikel_id, bezeichnung, menge, einheit,
         einzelpreis, konto_nr, mwst_code, mwst_satz,
         betrag_netto, betrag_mwst, betrag_brutto, kostenstelle
    from public.fibu_debitoren_positionen
   where beleg_id = original.id;

  perform public.fibu_debitoren_verbuchen(storno_id);
  update public.fibu_debitoren_belege
     set status = 'storniert', storno_beleg_id = storno_id, updated_at = now()
   where id = original.id;
  return storno_id;
end
$$;

-- --------------------------------------------------------------------------
-- 3) MWST-Auswertungen: Richtung aus Soll/Haben und Kontotyp ableiten
-- --------------------------------------------------------------------------
create or replace function public.fibu_mwst_booking_sign(
  p_mandant_id uuid,
  p_konto_soll text,
  p_konto_haben text,
  p_mwst_code text,
  p_mwst_typ text
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Vorsteuer/steuerbefreiter Einkauf: Aufwand/Aktivkonto im Soll = positiv.
    when p_mwst_typ = 'vorsteuer'
      or (p_mwst_typ = 'steuerbefreit' and p_mwst_code ~ '^(M|I)') then
      case
        when ks.konto_typ in ('aufwand', 'aktiv') and p_konto_soll <> '2000' then 1
        when kh.konto_typ in ('aufwand', 'aktiv') and p_konto_haben <> '2000' then -1
        else 1
      end
    -- Umsatz/steuerbefreiter Verkauf: Ertragskonto im Haben = positiv.
    when p_mwst_typ in ('umsatzsteuer', 'steuerbefreit') then
      case
        when kh.konto_typ = 'ertrag' then 1
        when ks.konto_typ = 'ertrag' then -1
        else 1
      end
    else 1
  end
  from (select 1) seed
  left join public.fibu_konten ks
    on ks.mandant_id = p_mandant_id and ks.konto_nr = p_konto_soll
  left join public.fibu_konten kh
    on kh.mandant_id = p_mandant_id and kh.konto_nr = p_konto_haben;
$$;

create or replace function public.fibu_mwst_reporting_konto(
  p_mandant_id uuid,
  p_konto_soll text,
  p_konto_haben text,
  p_mwst_code text,
  p_mwst_typ text
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_mwst_typ = 'vorsteuer'
      or (p_mwst_typ = 'steuerbefreit' and p_mwst_code ~ '^(M|I)') then
      case
        when ks.konto_typ in ('aufwand', 'aktiv') and p_konto_soll <> '2000' then p_konto_soll
        when kh.konto_typ in ('aufwand', 'aktiv') and p_konto_haben <> '2000' then p_konto_haben
        else p_konto_soll
      end
    when p_mwst_typ in ('umsatzsteuer', 'steuerbefreit') then
      case
        when kh.konto_typ = 'ertrag' then p_konto_haben
        when ks.konto_typ = 'ertrag' then p_konto_soll
        else p_konto_haben
      end
    else p_konto_soll
  end
  from (select 1) seed
  left join public.fibu_konten ks
    on ks.mandant_id = p_mandant_id and ks.konto_nr = p_konto_soll
  left join public.fibu_konten kh
    on kh.mandant_id = p_mandant_id and kh.konto_nr = p_konto_haben;
$$;

drop function if exists public.fibu_mwst_summary(uuid,date,date);
create function public.fibu_mwst_summary(
  p_mandant_id uuid,
  p_von date,
  p_bis date
) returns table (
  mwst_code text,
  mwst_satz numeric,
  typ text,
  bezeichnung text,
  abrechnung_ziffer text,
  anzahl_buchungen bigint,
  sum_netto numeric,
  sum_mwst numeric,
  sum_brutto numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with signed as (
    select b.*, mc.satz, mc.typ, mc.bezeichnung, mc.abrechnung_ziffer, mc.sortierung,
           public.fibu_mwst_booking_sign(
             b.mandant_id, b.konto_soll, b.konto_haben, b.mwst_code, mc.typ
           ) as sign
      from public.fibu_buchungen b
      join public.fibu_mwst_codes mc
        on mc.mandant_id = b.mandant_id and mc.code = b.mwst_code
     where b.mandant_id = p_mandant_id
       and p_mandant_id = any(public.fibu_mandant_ids_for_user())
       and b.buchungsdatum between p_von and p_bis
       and b.mwst_code is not null
       and not b.storniert
  )
  select s.mwst_code, s.satz, s.typ, s.bezeichnung, s.abrechnung_ziffer,
         count(*)::bigint,
         round(sum(s.sign * s.betrag), 2),
         round(sum(s.sign * abs(coalesce(s.mwst_betrag, 0))), 2),
         round(sum(
           s.sign * s.betrag
           + s.sign * abs(coalesce(s.mwst_betrag, 0))
         ), 2)
    from signed s
   group by s.mwst_code, s.satz, s.typ, s.bezeichnung, s.abrechnung_ziffer, s.sortierung
   order by s.sortierung nulls last, s.mwst_code;
$$;

create or replace function public.fibu_mwst_by_konto(
  p_mandant_id uuid,
  p_von date,
  p_bis date
) returns table (
  konto_nr text,
  konto_bez text,
  mwst_code text,
  mwst_satz numeric,
  anzahl bigint,
  sum_netto numeric,
  sum_mwst numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with signed as (
    select b.*, mc.satz, mc.typ,
           public.fibu_mwst_booking_sign(
             b.mandant_id, b.konto_soll, b.konto_haben, b.mwst_code, mc.typ
           ) as sign,
           public.fibu_mwst_reporting_konto(
             b.mandant_id, b.konto_soll, b.konto_haben, b.mwst_code, mc.typ
           ) as report_konto
      from public.fibu_buchungen b
      join public.fibu_mwst_codes mc
        on mc.mandant_id = b.mandant_id and mc.code = b.mwst_code
     where b.mandant_id = p_mandant_id
       and p_mandant_id = any(public.fibu_mandant_ids_for_user())
       and b.buchungsdatum between p_von and p_bis
       and b.mwst_code is not null
       and not b.storniert
  )
  select s.report_konto, k.bezeichnung, s.mwst_code, s.satz,
         count(*)::bigint,
         round(sum(s.sign * s.betrag), 2),
         round(sum(s.sign * abs(coalesce(s.mwst_betrag, 0))), 2)
    from signed s
    left join public.fibu_konten k
      on k.mandant_id = p_mandant_id and k.konto_nr = s.report_konto
   group by s.report_konto, k.bezeichnung, s.mwst_code, s.satz
   order by s.report_konto, s.mwst_code;
$$;

drop function if exists public.fibu_mwst_detail(uuid,date,date);
create function public.fibu_mwst_detail(
  p_mandant_id uuid,
  p_von date,
  p_bis date
) returns table (
  buchungs_nr text,
  buchungsdatum date,
  beleg_ref text,
  konto_soll text,
  konto_soll_bez text,
  mwst_code text,
  mwst_satz numeric,
  betrag_netto numeric,
  mwst_betrag numeric,
  mwst_erwartet numeric,
  differenz numeric,
  text text,
  quelle text
)
language sql
stable
security definer
set search_path = public
as $$
  with signed as (
    select b.*, mc.satz,
           public.fibu_mwst_booking_sign(
             b.mandant_id, b.konto_soll, b.konto_haben, b.mwst_code, mc.typ
           ) as sign,
           public.fibu_mwst_reporting_konto(
             b.mandant_id, b.konto_soll, b.konto_haben, b.mwst_code, mc.typ
           ) as report_konto
      from public.fibu_buchungen b
      join public.fibu_mwst_codes mc
        on mc.mandant_id = b.mandant_id and mc.code = b.mwst_code
     where b.mandant_id = p_mandant_id
       and p_mandant_id = any(public.fibu_mandant_ids_for_user())
       and b.buchungsdatum between p_von and p_bis
       and b.mwst_code is not null
       and not b.storniert
  )
  select s.buchungs_nr, s.buchungsdatum, s.beleg_ref,
         s.report_konto, k.bezeichnung, s.mwst_code, s.satz,
         round(s.sign * s.betrag, 2),
         round(s.sign * abs(coalesce(s.mwst_betrag, 0)), 2),
         round(s.sign * s.betrag * coalesce(s.satz, 0) / 100, 2),
         round(
           s.sign * abs(coalesce(s.mwst_betrag, 0))
           - s.sign * s.betrag * coalesce(s.satz, 0) / 100,
           2
         ),
         s.text, s.quelle
    from signed s
    left join public.fibu_konten k
      on k.mandant_id = p_mandant_id and k.konto_nr = s.report_konto
   order by s.buchungsdatum, s.buchungs_nr;
$$;

-- --------------------------------------------------------------------------
-- 4) Ausfuehrungsrechte
-- --------------------------------------------------------------------------
revoke all on table public.fibu_debitoren_counter from anon, authenticated;
revoke all on function public.fibu_next_buchungs_nr(uuid) from public, anon, authenticated;
grant execute on function public.fibu_next_buchungs_nr(uuid) to service_role;

revoke all on function public.fibu_next_debitoren_nr(uuid) from public, anon;
grant execute on function public.fibu_next_debitoren_nr(uuid) to authenticated, service_role;

revoke all on function public.fibu_debitoren_storno(uuid,date) from public, anon;
grant execute on function public.fibu_debitoren_storno(uuid,date) to authenticated, service_role;

revoke all on function public.fibu_mwst_booking_sign(uuid,text,text,text,text) from public;
revoke all on function public.fibu_mwst_reporting_konto(uuid,text,text,text,text) from public;
revoke all on function public.fibu_mwst_summary(uuid,date,date) from public, anon;
revoke all on function public.fibu_mwst_by_konto(uuid,date,date) from public, anon;
revoke all on function public.fibu_mwst_detail(uuid,date,date) from public, anon;
grant execute on function public.fibu_mwst_summary(uuid,date,date),
  public.fibu_mwst_by_konto(uuid,date,date),
  public.fibu_mwst_detail(uuid,date,date)
  to authenticated, service_role;
