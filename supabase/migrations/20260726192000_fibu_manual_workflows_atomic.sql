-- ============================================================================
-- FiBu: atomare manuelle Debitoren-/Kreditoren-Workflows
--
-- Ein fachlicher Vorgang ist genau eine DB-Transaktion:
--   * Kreditor/Debitor: Kopf + Positionen + Hauptbuch
--   * Entwurf stellen: Status + Hauptbuch
--   * Zahlung: Row-Lock + Saldo-Update
--   * Zahlungslauf: Lauf + Positionen + OP-Status
--   * Mahnung: Historie + Mahnstufe
--
-- Alle Geldsummen werden serverseitig aus den Positionen ermittelt.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Atomarer Kreditoren-Nummernkreis
-- --------------------------------------------------------------------------
create table if not exists public.fibu_kreditoren_counter (
  mandant_id uuid not null references public.fibu_mandanten(id) on delete cascade,
  year integer not null,
  value integer not null default 0 check (value >= 0),
  primary key (mandant_id, year)
);
alter table public.fibu_kreditoren_counter enable row level security;

insert into public.fibu_kreditoren_counter(mandant_id, year, value)
select mandant_id,
       split_part(beleg_nr, '-', 2)::integer,
       max(split_part(beleg_nr, '-', 3)::integer)
  from public.fibu_kreditoren_belege
 where beleg_nr ~ '^KR-\d{4}-\d+$'
 group by mandant_id, split_part(beleg_nr, '-', 2)::integer
on conflict (mandant_id, year) do update
  set value = greatest(public.fibu_kreditoren_counter.value, excluded.value);

create or replace function public.fibu_next_kreditoren_nr(p_mandant_id uuid)
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
    raise exception 'Nur Admin/Buchhalter darf Kreditoren-Belegnummern beziehen';
  end if;

  if not exists (
    select 1 from public.fibu_mandanten
     where id = p_mandant_id and aktiv
  ) then
    raise exception 'Aktiver FiBu-Mandant nicht gefunden';
  end if;

  insert into public.fibu_kreditoren_counter(mandant_id, year, value)
  values (p_mandant_id, y, 1)
  on conflict (mandant_id, year) do update
    set value = public.fibu_kreditoren_counter.value + 1
  returning value into n;

  return 'KR-' || y || '-' || lpad(n::text, 4, '0');
end
$$;

-- --------------------------------------------------------------------------
-- 2) Interne, validierende Positionsschreiber
-- --------------------------------------------------------------------------
create or replace function public.fibu_kreditoren_positionen_schreiben(
  p_mandant_id uuid,
  p_beleg_id uuid,
  p_positionen jsonb
) returns numeric[]
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  i integer := 0;
  netto numeric;
  mwst numeric;
  brutto numeric;
  sum_netto numeric := 0;
  sum_mwst numeric := 0;
  sum_brutto numeric := 0;
  code_rec public.fibu_mwst_codes%rowtype;
begin
  if jsonb_typeof(p_positionen) <> 'array'
     or jsonb_array_length(p_positionen) = 0 then
    raise exception 'Mindestens eine Kreditoren-Position ist erforderlich';
  end if;

  for e in select value from jsonb_array_elements(p_positionen)
  loop
    i := i + 1;
    netto := round(coalesce(nullif(e->>'betrag_netto', '')::numeric, 0), 2);
    mwst := round(coalesce(nullif(e->>'betrag_mwst', '')::numeric, 0), 2);
    brutto := round(coalesce(nullif(e->>'betrag_brutto', '')::numeric, 0), 2);

    if netto < 0 or mwst < 0 or brutto <= 0
       or abs(brutto - netto - mwst) > 0.02 then
      raise exception 'Ungueltige Betraege in Kreditoren-Position %', i;
    end if;

    if not exists (
      select 1 from public.fibu_konten
       where mandant_id = p_mandant_id
         and konto_nr = e->>'konto_nr'
         and konto_typ in ('aufwand', 'aktiv')
         and aktiv
    ) then
      raise exception 'Ungueltiges oder inaktives Aufwands-/Aktivkonto %',
        coalesce(e->>'konto_nr', '(leer)');
    end if;

    select * into code_rec
      from public.fibu_mwst_codes
     where mandant_id = p_mandant_id
       and code = e->>'mwst_code'
       and typ in ('vorsteuer', 'steuerbefreit')
       and aktiv;
    if not found then
      raise exception 'Ungueltiger Vorsteuer-Code %',
        coalesce(e->>'mwst_code', '(leer)');
    end if;
    if abs(mwst) > 0.005 and (
      code_rec.satz <= 0 or code_rec.konto_vorsteuer is null
      or not exists (
        select 1 from public.fibu_konten
         where mandant_id = p_mandant_id
           and konto_nr = code_rec.konto_vorsteuer
           and aktiv
      )
    ) then
      raise exception 'Vorsteuer-Code % hat kein gueltiges Steuerkonto', code_rec.code;
    end if;

    insert into public.fibu_kreditoren_positionen (
      mandant_id, beleg_id, position, konto_nr, bezeichnung,
      mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto,
      kostenstelle
    ) values (
      p_mandant_id, p_beleg_id, i, e->>'konto_nr',
      nullif(e->>'bezeichnung', ''), code_rec.code, code_rec.satz,
      netto, mwst, brutto, nullif(e->>'kostenstelle', '')
    );

    sum_netto := sum_netto + netto;
    sum_mwst := sum_mwst + mwst;
    sum_brutto := sum_brutto + brutto;
  end loop;

  return array[round(sum_netto, 2), round(sum_mwst, 2), round(sum_brutto, 2)];
end
$$;

create or replace function public.fibu_debitoren_positionen_schreiben(
  p_mandant_id uuid,
  p_beleg_id uuid,
  p_positionen jsonb
) returns numeric[]
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  i integer := 0;
  netto numeric;
  mwst numeric;
  brutto numeric;
  sum_netto numeric := 0;
  sum_mwst numeric := 0;
  sum_brutto numeric := 0;
  code_rec public.fibu_mwst_codes%rowtype;
  artikel_uuid uuid;
begin
  if jsonb_typeof(p_positionen) <> 'array'
     or jsonb_array_length(p_positionen) = 0 then
    raise exception 'Mindestens eine Debitoren-Position ist erforderlich';
  end if;

  for e in select value from jsonb_array_elements(p_positionen)
  loop
    i := i + 1;
    netto := round(coalesce(nullif(e->>'betrag_netto', '')::numeric, 0), 2);
    mwst := round(coalesce(nullif(e->>'betrag_mwst', '')::numeric, 0), 2);
    brutto := round(coalesce(nullif(e->>'betrag_brutto', '')::numeric, 0), 2);
    artikel_uuid := nullif(e->>'artikel_id', '')::uuid;

    if netto < 0 or mwst < 0 or brutto <= 0
       or abs(brutto - netto - mwst) > 0.02 then
      raise exception 'Ungueltige Betraege in Debitoren-Position %', i;
    end if;

    if not exists (
      select 1 from public.fibu_konten
       where mandant_id = p_mandant_id
         and konto_nr = e->>'konto_nr'
         and konto_typ = 'ertrag'
         and aktiv
    ) then
      raise exception 'Ungueltiges oder inaktives Ertragskonto %',
        coalesce(e->>'konto_nr', '(leer)');
    end if;

    select * into code_rec
      from public.fibu_mwst_codes
     where mandant_id = p_mandant_id
       and code = e->>'mwst_code'
       and typ in ('umsatzsteuer', 'steuerbefreit')
       and aktiv;
    if not found then
      raise exception 'Ungueltiger Umsatzsteuer-Code %',
        coalesce(e->>'mwst_code', '(leer)');
    end if;
    if abs(mwst) > 0.005 and (
      code_rec.satz <= 0 or code_rec.konto_umsatz is null
      or not exists (
        select 1 from public.fibu_konten
         where mandant_id = p_mandant_id
           and konto_nr = code_rec.konto_umsatz
           and aktiv
      )
    ) then
      raise exception 'Umsatzsteuer-Code % hat kein gueltiges Steuerkonto', code_rec.code;
    end if;

    if artikel_uuid is not null and not exists (
      select 1 from public.fibu_artikel
       where id = artikel_uuid and mandant_id = p_mandant_id
    ) then
      raise exception 'Artikel gehoert nicht zum FiBu-Mandanten';
    end if;

    insert into public.fibu_debitoren_positionen (
      mandant_id, beleg_id, position, artikel_id, bezeichnung,
      menge, einheit, einzelpreis, konto_nr, mwst_code, mwst_satz,
      betrag_netto, betrag_mwst, betrag_brutto, kostenstelle
    ) values (
      p_mandant_id, p_beleg_id, i, artikel_uuid,
      nullif(e->>'bezeichnung', ''),
      coalesce(nullif(e->>'menge', '')::numeric, 1),
      nullif(e->>'einheit', ''),
      round(coalesce(nullif(e->>'einzelpreis', '')::numeric, 0), 2),
      e->>'konto_nr', code_rec.code, code_rec.satz,
      netto, mwst, brutto, nullif(e->>'kostenstelle', '')
    );

    sum_netto := sum_netto + netto;
    sum_mwst := sum_mwst + mwst;
    sum_brutto := sum_brutto + brutto;
  end loop;

  return array[round(sum_netto, 2), round(sum_mwst, 2), round(sum_brutto, 2)];
end
$$;

-- --------------------------------------------------------------------------
-- 3) Kreditoren-Hauptbuch: Row-Lock, Buchungsdatum und Service-Role
-- --------------------------------------------------------------------------
create or replace function public.fibu_kreditoren_verbuchen(p_beleg_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  beleg record;
  pos record;
  buchungs_nr text;
  ist_gutschrift boolean;
  methode text;
  kurstyp text;
  ist_saldo boolean;
  v_kurs numeric;
  fw text;
  fw_basis numeric;
  fw_mwst numeric;
  chf_basis numeric;
  chf_mwst numeric;
  buchungsdatum date;
  sum_netto numeric;
  sum_mwst numeric;
  sum_brutto numeric;
  vorzeichen integer;
  anzahl integer := 0;
begin
  select b.*, l.name as lieferant_name
    into beleg
    from public.fibu_kreditoren_belege b
    join public.fibu_lieferanten l on l.id = b.lieferant_id
   where b.id = p_beleg_id
   for update of b;
  if not found then raise exception 'Kreditoren-Beleg nicht gefunden'; end if;
  if beleg.verbucht then return; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(beleg.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if not exists (
    select 1 from public.fibu_konten
     where mandant_id = beleg.mandant_id
       and konto_nr = '2000' and konto_typ = 'passiv' and aktiv
  ) then
    raise exception 'Aktives Kreditorenkonto 2000 fehlt';
  end if;

  select mwst_methode, fw_buchungskurs
    into methode, kurstyp
    from public.fibu_mandanten
   where id = beleg.mandant_id and aktiv;
  if not found then raise exception 'Aktiver FiBu-Mandant nicht gefunden'; end if;
  if coalesce(methode, 'effektiv') not in ('effektiv', 'saldosteuersatz') then
    raise exception 'Nicht unterstuetzte MWST-Methode %', methode;
  end if;

  ist_saldo := coalesce(methode, 'effektiv') = 'saldosteuersatz';
  ist_gutschrift := beleg.belegtyp = 'gutschrift';
  vorzeichen := case when ist_gutschrift then -1 else 1 end;
  buchungsdatum := coalesce(beleg.buchungsdatum, beleg.belegdatum);
  kurstyp := coalesce(kurstyp, 'monat');

  select count(*)::integer,
         round(coalesce(sum(p.betrag_netto), 0), 2),
         round(coalesce(sum(p.betrag_mwst), 0), 2),
         round(coalesce(sum(p.betrag_brutto), 0), 2)
    into anzahl, sum_netto, sum_mwst, sum_brutto
    from public.fibu_kreditoren_positionen p
   where p.beleg_id = beleg.id and p.mandant_id = beleg.mandant_id;
  if anzahl = 0 then raise exception 'Kreditoren-Beleg hat keine Positionen'; end if;
  if abs(beleg.betrag_netto - vorzeichen * sum_netto) > 0.02
     or abs(beleg.betrag_mwst - vorzeichen * sum_mwst) > 0.02
     or abs(beleg.betrag_brutto - vorzeichen * sum_brutto) > 0.02 then
    raise exception 'Kreditoren-Kopfsummen stimmen nicht mit den Positionen ueberein';
  end if;
  anzahl := 0;

  if coalesce(beleg.waehrung, 'CHF') = 'CHF' then
    v_kurs := 1;
    fw := null;
  else
    fw := beleg.waehrung;
    select wk.kurs into v_kurs
      from public.fibu_wechselkurse wk
     where wk.waehrung = fw and wk.typ = kurstyp
       and wk.datum <= buchungsdatum
     order by wk.datum desc limit 1;
    if v_kurs is null then
      select wk.kurs into v_kurs
        from public.fibu_wechselkurse wk
       where wk.waehrung = fw and wk.datum <= buchungsdatum
       order by wk.datum desc limit 1;
    end if;
    if v_kurs is null then
      raise exception 'Kein Wechselkurs fuer % per % vorhanden', fw, buchungsdatum;
    end if;
  end if;

  for pos in
    select p.*, mc.konto_vorsteuer, mc.typ as mwst_typ
      from public.fibu_kreditoren_positionen p
      join public.fibu_mwst_codes mc
        on mc.mandant_id = p.mandant_id and mc.code = p.mwst_code
     where p.beleg_id = p_beleg_id and p.mandant_id = beleg.mandant_id
     order by p.position
  loop
    anzahl := anzahl + 1;
    if pos.mwst_typ not in ('vorsteuer', 'steuerbefreit')
       or not exists (
         select 1 from public.fibu_konten
          where mandant_id = beleg.mandant_id
            and konto_nr = pos.konto_nr
            and konto_typ in ('aufwand', 'aktiv')
       ) then
      raise exception 'Ungueltige historische Kreditoren-Kontierung';
    end if;
    fw_basis := case when ist_saldo then pos.betrag_brutto else pos.betrag_netto end;
    fw_mwst := coalesce(pos.betrag_mwst, 0);
    chf_basis := round(fw_basis * v_kurs, 2);
    chf_mwst := round(fw_mwst * v_kurs, 2);

    buchungs_nr := public.fibu_next_buchungs_nr(beleg.mandant_id);
    insert into public.fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
    ) values (
      beleg.mandant_id, buchungs_nr, buchungsdatum, beleg.beleg_nr,
      case when ist_gutschrift then '2000' else pos.konto_nr end,
      case when ist_gutschrift then pos.konto_nr else '2000' end,
      chf_basis,
      case when ist_saldo then null else pos.mwst_code end,
      case when ist_saldo then null
           when ist_gutschrift then -chf_mwst else chf_mwst end,
      coalesce(pos.bezeichnung, beleg.lieferant_name || ' / ' || beleg.beleg_nr)
        || case when ist_gutschrift then ' (Gutschrift)' else '' end,
      'kreditoren', beleg.id, coalesce(beleg.gebucht_von, auth.uid()),
      fw, case when fw is null then null else fw_basis end
    );

    if not ist_saldo and chf_mwst > 0 then
      if pos.konto_vorsteuer is null then
        raise exception 'Vorsteuerkonto fehlt fuer Code %', pos.mwst_code;
      end if;
      if not exists (
        select 1 from public.fibu_konten
         where mandant_id = beleg.mandant_id and konto_nr = pos.konto_vorsteuer
      ) then
        raise exception 'Vorsteuerkonto % existiert nicht', pos.konto_vorsteuer;
      end if;
      buchungs_nr := public.fibu_next_buchungs_nr(beleg.mandant_id);
      insert into public.fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
      ) values (
        beleg.mandant_id, buchungs_nr, buchungsdatum, beleg.beleg_nr,
        case when ist_gutschrift then '2000' else pos.konto_vorsteuer end,
        case when ist_gutschrift then pos.konto_vorsteuer else '2000' end,
        chf_mwst, null, null,
        'Vorsteuer ' || pos.mwst_code || ' / ' || beleg.beleg_nr,
        'kreditoren', beleg.id, coalesce(beleg.gebucht_von, auth.uid()),
        fw, case when fw is null then null else fw_mwst end
      );
    end if;
  end loop;

  if anzahl = 0 then raise exception 'Kreditoren-Beleg hat keine Positionen'; end if;
  update public.fibu_kreditoren_belege
     set kurs = v_kurs, verbucht = true, gebucht_am = now(), updated_at = now()
   where id = beleg.id;
end
$$;

-- --------------------------------------------------------------------------
-- 4) Atomare Kreditoren-Neuanlage und -Bearbeitung
-- --------------------------------------------------------------------------
create or replace function public.fibu_kreditoren_erstellen(
  p_mandant_id uuid,
  p_beleg jsonb,
  p_positionen jsonb
) returns public.fibu_kreditoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_kreditoren_belege%rowtype;
  totals numeric[];
  belegtyp text := coalesce(nullif(p_beleg->>'belegtyp', ''), 'rechnung');
  vorzeichen integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if belegtyp not in ('rechnung', 'gutschrift') then
    raise exception 'Ungueltiger Belegtyp';
  end if;
  if not exists (
    select 1 from public.fibu_lieferanten
     where id = nullif(p_beleg->>'lieferant_id', '')::uuid
       and mandant_id = p_mandant_id and aktiv
  ) then
    raise exception 'Aktiver Lieferant gehoert nicht zum FiBu-Mandanten';
  end if;
  if nullif(p_beleg->>'belegdatum', '') is null
     or nullif(p_beleg->>'faelligkeit', '') is null then
    raise exception 'Belegdatum und Faelligkeit sind erforderlich';
  end if;

  insert into public.fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, lieferant_beleg_nr,
    belegdatum, buchungsdatum, valutadatum, faelligkeit,
    zahlungsbedingung_tage, waehrung, belegtyp,
    betrag_netto, betrag_mwst, betrag_brutto,
    zahlungsreferenz, status, notiz, scan_url, scan_ocr_text,
    belegreferenz, gruppe, belegtext, gebucht_von
  ) values (
    p_mandant_id, public.fibu_next_kreditoren_nr(p_mandant_id),
    (p_beleg->>'lieferant_id')::uuid, nullif(p_beleg->>'lieferant_beleg_nr', ''),
    (p_beleg->>'belegdatum')::date,
    coalesce(nullif(p_beleg->>'buchungsdatum', '')::date, (p_beleg->>'belegdatum')::date),
    nullif(p_beleg->>'valutadatum', '')::date,
    (p_beleg->>'faelligkeit')::date,
    nullif(p_beleg->>'zahlungsbedingung_tage', '')::smallint,
    coalesce(nullif(p_beleg->>'waehrung', ''), 'CHF'), belegtyp,
    0, 0, 0, nullif(p_beleg->>'zahlungsreferenz', ''),
    'offen',
    nullif(p_beleg->>'notiz', ''), nullif(p_beleg->>'scan_url', ''),
    nullif(p_beleg->>'scan_ocr_text', ''), nullif(p_beleg->>'belegreferenz', ''),
    nullif(p_beleg->>'gruppe', ''), nullif(p_beleg->>'belegtext', ''), auth.uid()
  ) returning * into result;

  totals := public.fibu_kreditoren_positionen_schreiben(
    p_mandant_id, result.id, p_positionen
  );
  vorzeichen := case when belegtyp = 'gutschrift' then -1 else 1 end;
  update public.fibu_kreditoren_belege
     set betrag_netto = vorzeichen * totals[1],
         betrag_mwst = vorzeichen * totals[2],
         betrag_brutto = vorzeichen * totals[3]
   where id = result.id;

  perform public.fibu_kreditoren_verbuchen(result.id);

  update public.fibu_lieferanten
     set standard_konto_nr = p_positionen->0->>'konto_nr',
         mwst_code = p_positionen->0->>'mwst_code',
         updated_at = now()
   where id = result.lieferant_id and mandant_id = p_mandant_id;

  select * into result from public.fibu_kreditoren_belege where id = result.id;
  return result;
end
$$;

create or replace function public.fibu_kreditoren_bearbeiten(
  p_beleg_id uuid,
  p_beleg jsonb,
  p_positionen jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  alt public.fibu_kreditoren_belege%rowtype;
  totals numeric[];
  neuer_lieferant uuid;
  vorzeichen integer;
begin
  select * into alt
    from public.fibu_kreditoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Kreditoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(alt.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if alt.status in ('storniert', 'ebanking')
     or alt.storno_beleg_id is not null
     or abs(coalesce(alt.betrag_bezahlt, 0)) > 0.005 then
    raise exception 'Beleg ist storniert, im Zahlungslauf oder bereits bezahlt';
  end if;
  if coalesce(alt.mwst_abgerechnet, false) then
    raise exception 'MWST dieses Belegs ist bereits abgerechnet';
  end if;

  neuer_lieferant := coalesce(
    nullif(p_beleg->>'lieferant_id', '')::uuid, alt.lieferant_id
  );
  if not exists (
    select 1 from public.fibu_lieferanten
     where id = neuer_lieferant and mandant_id = alt.mandant_id
  ) then
    raise exception 'Lieferant gehoert nicht zum FiBu-Mandanten';
  end if;

  delete from public.fibu_buchungen
   where quelle = 'kreditoren' and quelle_id = alt.id;
  delete from public.fibu_kreditoren_positionen where beleg_id = alt.id;

  update public.fibu_kreditoren_belege
     set lieferant_id = neuer_lieferant,
         lieferant_beleg_nr = coalesce(
           nullif(p_beleg->>'lieferant_beleg_nr', ''), lieferant_beleg_nr
         ),
         belegdatum = coalesce(nullif(p_beleg->>'belegdatum', '')::date, belegdatum),
         buchungsdatum = coalesce(
           nullif(p_beleg->>'buchungsdatum', '')::date,
           nullif(p_beleg->>'belegdatum', '')::date,
           buchungsdatum, belegdatum
         ),
         valutadatum = coalesce(nullif(p_beleg->>'valutadatum', '')::date, valutadatum),
         faelligkeit = coalesce(nullif(p_beleg->>'faelligkeit', '')::date, faelligkeit),
         zahlungsbedingung_tage = coalesce(
           nullif(p_beleg->>'zahlungsbedingung_tage', '')::smallint,
           zahlungsbedingung_tage
         ),
         waehrung = coalesce(nullif(p_beleg->>'waehrung', ''), waehrung),
         zahlungsreferenz = nullif(p_beleg->>'zahlungsreferenz', ''),
         notiz = nullif(p_beleg->>'notiz', ''),
         belegreferenz = nullif(p_beleg->>'belegreferenz', ''),
         gruppe = nullif(p_beleg->>'gruppe', ''),
         belegtext = nullif(p_beleg->>'belegtext', ''),
         verbucht = false, kurs = null, updated_at = now()
   where id = alt.id;

  totals := public.fibu_kreditoren_positionen_schreiben(
    alt.mandant_id, alt.id, p_positionen
  );
  vorzeichen := case when alt.belegtyp = 'gutschrift' then -1 else 1 end;
  update public.fibu_kreditoren_belege
     set betrag_netto = vorzeichen * totals[1],
         betrag_mwst = vorzeichen * totals[2],
         betrag_brutto = vorzeichen * totals[3]
   where id = alt.id;

  perform public.fibu_kreditoren_verbuchen(alt.id);
  update public.fibu_lieferanten
     set standard_konto_nr = p_positionen->0->>'konto_nr',
         mwst_code = p_positionen->0->>'mwst_code',
         updated_at = now()
   where id = neuer_lieferant and mandant_id = alt.mandant_id;
end
$$;

-- --------------------------------------------------------------------------
-- 5) Debitoren: QR-Referenz, Hauptbuch, Erstellen/Bearbeiten/Stellen
-- --------------------------------------------------------------------------
create or replace function public.fibu_qr_reference(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  basis text := right(lpad(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 26, '0'), 26);
  carry integer := 0;
  digit text;
  table_values integer[] := array[0,9,4,6,8,2,7,1,3,5];
begin
  for digit in select regexp_split_to_table(basis, '')
  loop
    carry := table_values[((carry + digit::integer) % 10) + 1];
  end loop;
  return basis || ((10 - carry) % 10)::text;
end
$$;

create or replace function public.fibu_debitoren_verbuchen(p_beleg_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  beleg public.fibu_debitoren_belege%rowtype;
  pos record;
  kunde_name text;
  methode text;
  ist_saldo boolean;
  ist_gutschrift boolean;
  buchungs_nr text;
  sum_netto numeric;
  sum_mwst numeric;
  sum_brutto numeric;
  vorzeichen integer;
  anzahl integer := 0;
begin
  select * into beleg
    from public.fibu_debitoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if beleg.verbucht then return; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(beleg.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if beleg.waehrung <> 'CHF' then
    raise exception 'Debitoren-Hauptbuch unterstuetzt aktuell nur CHF';
  end if;
  if not exists (
    select 1 from public.fibu_konten
     where mandant_id = beleg.mandant_id
       and konto_nr = '1100' and konto_typ = 'aktiv' and aktiv
  ) then
    raise exception 'Aktives Debitorenkonto 1100 fehlt';
  end if;

  select m.mwst_methode into methode
    from public.fibu_mandanten m
   where m.id = beleg.mandant_id and m.aktiv;
  if coalesce(methode, 'effektiv') not in ('effektiv', 'saldosteuersatz') then
    raise exception 'Nicht unterstuetzte MWST-Methode %', methode;
  end if;
  ist_saldo := coalesce(methode, 'effektiv') = 'saldosteuersatz';
  ist_gutschrift := beleg.belegtyp = 'gutschrift';
  vorzeichen := case when ist_gutschrift then -1 else 1 end;
  select name into kunde_name from public.fibu_kunden where id = beleg.kunde_id;

  select count(*)::integer,
         round(coalesce(sum(p.betrag_netto), 0), 2),
         round(coalesce(sum(p.betrag_mwst), 0), 2),
         round(coalesce(sum(p.betrag_brutto), 0), 2)
    into anzahl, sum_netto, sum_mwst, sum_brutto
    from public.fibu_debitoren_positionen p
   where p.beleg_id = beleg.id and p.mandant_id = beleg.mandant_id;
  if anzahl = 0 then raise exception 'Debitoren-Beleg hat keine Positionen'; end if;
  if abs(beleg.betrag_netto - vorzeichen * sum_netto) > 0.02
     or abs(beleg.betrag_mwst - vorzeichen * sum_mwst) > 0.02
     or abs(beleg.betrag_brutto - vorzeichen * sum_brutto) > 0.02 then
    raise exception 'Debitoren-Kopfsummen stimmen nicht mit den Positionen ueberein';
  end if;
  anzahl := 0;

  for pos in
    select p.*, mc.konto_umsatz, mc.typ as mwst_typ
      from public.fibu_debitoren_positionen p
      join public.fibu_mwst_codes mc
        on mc.mandant_id = p.mandant_id and mc.code = p.mwst_code
     where p.beleg_id = beleg.id and p.mandant_id = beleg.mandant_id
     order by p.position
  loop
    anzahl := anzahl + 1;
    if pos.mwst_typ not in ('umsatzsteuer', 'steuerbefreit')
       or not exists (
         select 1 from public.fibu_konten
          where mandant_id = beleg.mandant_id
            and konto_nr = pos.konto_nr and konto_typ = 'ertrag'
       ) then
      raise exception 'Ungueltige historische Debitoren-Kontierung';
    end if;
    buchungs_nr := public.fibu_next_buchungs_nr(beleg.mandant_id);
    insert into public.fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by
    ) values (
      beleg.mandant_id, buchungs_nr, beleg.belegdatum, beleg.beleg_nr,
      case when ist_gutschrift then pos.konto_nr else '1100' end,
      case when ist_gutschrift then '1100' else pos.konto_nr end,
      case when ist_saldo then pos.betrag_brutto else pos.betrag_netto end,
      case when ist_saldo then null else pos.mwst_code end,
      case when ist_saldo then null
           when ist_gutschrift then -pos.betrag_mwst else pos.betrag_mwst end,
      coalesce(kunde_name, '') || ' / ' || beleg.beleg_nr,
      'debitoren', beleg.id, coalesce(beleg.gebucht_von, auth.uid())
    );

    if not ist_saldo and pos.betrag_mwst > 0 then
      if pos.konto_umsatz is null then
        raise exception 'Umsatzsteuerkonto fehlt fuer Code %', pos.mwst_code;
      end if;
      if not exists (
        select 1 from public.fibu_konten
         where mandant_id = beleg.mandant_id and konto_nr = pos.konto_umsatz
      ) then
        raise exception 'Umsatzsteuerkonto % existiert nicht', pos.konto_umsatz;
      end if;
      buchungs_nr := public.fibu_next_buchungs_nr(beleg.mandant_id);
      insert into public.fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by
      ) values (
        beleg.mandant_id, buchungs_nr, beleg.belegdatum, beleg.beleg_nr,
        case when ist_gutschrift then pos.konto_umsatz else '1100' end,
        case when ist_gutschrift then '1100' else pos.konto_umsatz end,
        pos.betrag_mwst, null, null,
        'Umsatzsteuer ' || pos.mwst_code || ' / ' || beleg.beleg_nr,
        'debitoren', beleg.id, coalesce(beleg.gebucht_von, auth.uid())
      );
    end if;
  end loop;

  if anzahl = 0 then raise exception 'Debitoren-Beleg hat keine Positionen'; end if;
  update public.fibu_debitoren_belege
     set verbucht = true, gebucht_am = now(), updated_at = now()
   where id = beleg.id;
end
$$;

create or replace function public.fibu_debitoren_erstellen(
  p_mandant_id uuid,
  p_beleg jsonb,
  p_positionen jsonb
) returns public.fibu_debitoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_debitoren_belege%rowtype;
  totals numeric[];
  beleg_nr text;
  belegtyp text := coalesce(nullif(p_beleg->>'belegtyp', ''), 'rechnung');
  status_value text := coalesce(nullif(p_beleg->>'status', ''), 'entwurf');
  vorzeichen integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if belegtyp not in ('rechnung', 'gutschrift')
     or status_value not in ('entwurf', 'offen') then
    raise exception 'Ungueltiger Debitoren-Belegtyp oder Status';
  end if;
  if not exists (
    select 1 from public.fibu_kunden
     where id = nullif(p_beleg->>'kunde_id', '')::uuid
       and mandant_id = p_mandant_id and aktiv
  ) then
    raise exception 'Aktiver Kunde gehoert nicht zum FiBu-Mandanten';
  end if;

  beleg_nr := public.fibu_next_debitoren_nr(p_mandant_id);
  insert into public.fibu_debitoren_belege (
    mandant_id, beleg_nr, kunde_id, belegtyp, titel, belegdatum,
    valutadatum, faelligkeit, zahlungsbedingung_tage, waehrung,
    betrag_netto, betrag_mwst, betrag_brutto, zahlungsreferenz,
    status, notiz, pdf_url, gebucht_von, source_system, source_id
  ) values (
    p_mandant_id, beleg_nr, (p_beleg->>'kunde_id')::uuid, belegtyp,
    nullif(p_beleg->>'titel', ''), (p_beleg->>'belegdatum')::date,
    nullif(p_beleg->>'valutadatum', '')::date, (p_beleg->>'faelligkeit')::date,
    nullif(p_beleg->>'zahlungsbedingung_tage', '')::smallint,
    coalesce(nullif(p_beleg->>'waehrung', ''), 'CHF'),
    0, 0, 0,
    coalesce(nullif(p_beleg->>'zahlungsreferenz', ''), public.fibu_qr_reference(beleg_nr)),
    status_value, nullif(p_beleg->>'notiz', ''), nullif(p_beleg->>'pdf_url', ''),
    auth.uid(), nullif(p_beleg->>'source_system', ''),
    nullif(p_beleg->>'source_id', '')::uuid
  ) returning * into result;

  totals := public.fibu_debitoren_positionen_schreiben(
    p_mandant_id, result.id, p_positionen
  );
  vorzeichen := case when belegtyp = 'gutschrift' then -1 else 1 end;
  update public.fibu_debitoren_belege
     set betrag_netto = vorzeichen * totals[1],
         betrag_mwst = vorzeichen * totals[2],
         betrag_brutto = vorzeichen * totals[3]
   where id = result.id;
  if status_value = 'offen' then
    perform public.fibu_debitoren_verbuchen(result.id);
  end if;

  select * into result from public.fibu_debitoren_belege where id = result.id;
  return result;
end
$$;

create or replace function public.fibu_debitoren_entwurf_speichern(
  p_beleg_id uuid,
  p_beleg jsonb,
  p_positionen jsonb,
  p_stellen boolean default false
) returns public.fibu_debitoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_debitoren_belege%rowtype;
  totals numeric[];
  neuer_kunde uuid;
  vorzeichen integer;
begin
  select * into result
    from public.fibu_debitoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(result.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if result.status <> 'entwurf' or result.verbucht then
    raise exception 'Nur ungebuchte Entwuerfe koennen bearbeitet werden';
  end if;

  neuer_kunde := coalesce(nullif(p_beleg->>'kunde_id', '')::uuid, result.kunde_id);
  if not exists (
    select 1 from public.fibu_kunden
     where id = neuer_kunde and mandant_id = result.mandant_id
  ) then
    raise exception 'Kunde gehoert nicht zum FiBu-Mandanten';
  end if;

  delete from public.fibu_debitoren_positionen where beleg_id = result.id;
  update public.fibu_debitoren_belege
     set kunde_id = neuer_kunde,
         titel = nullif(p_beleg->>'titel', ''),
         belegdatum = coalesce(nullif(p_beleg->>'belegdatum', '')::date, belegdatum),
         valutadatum = coalesce(nullif(p_beleg->>'valutadatum', '')::date, valutadatum),
         faelligkeit = coalesce(nullif(p_beleg->>'faelligkeit', '')::date, faelligkeit),
         zahlungsbedingung_tage = coalesce(
           nullif(p_beleg->>'zahlungsbedingung_tage', '')::smallint,
           zahlungsbedingung_tage
         ),
         waehrung = coalesce(nullif(p_beleg->>'waehrung', ''), waehrung),
         notiz = nullif(p_beleg->>'notiz', ''),
         updated_at = now()
   where id = result.id;

  totals := public.fibu_debitoren_positionen_schreiben(
    result.mandant_id, result.id, p_positionen
  );
  vorzeichen := case when result.belegtyp = 'gutschrift' then -1 else 1 end;
  update public.fibu_debitoren_belege
     set betrag_netto = vorzeichen * totals[1],
         betrag_mwst = vorzeichen * totals[2],
         betrag_brutto = vorzeichen * totals[3],
         status = case when p_stellen then 'offen' else 'entwurf' end
   where id = result.id;
  if p_stellen then
    perform public.fibu_debitoren_verbuchen(result.id);
  end if;

  select * into result from public.fibu_debitoren_belege where id = result.id;
  return result;
end
$$;

create or replace function public.fibu_debitoren_stellen(p_beleg_id uuid)
returns public.fibu_debitoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_debitoren_belege%rowtype;
begin
  select * into result
    from public.fibu_debitoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(result.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if result.status <> 'entwurf' or result.verbucht then
    raise exception 'Nur ein ungebuchter Entwurf kann gestellt werden';
  end if;
  update public.fibu_debitoren_belege set status = 'offen' where id = result.id;
  perform public.fibu_debitoren_verbuchen(result.id);
  select * into result from public.fibu_debitoren_belege where id = result.id;
  return result;
end
$$;

create or replace function public.fibu_debitoren_entwurf_loeschen(p_beleg_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  beleg public.fibu_debitoren_belege%rowtype;
begin
  select * into beleg
    from public.fibu_debitoren_belege
   where id = p_beleg_id
   for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(beleg.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if beleg.status <> 'entwurf' or beleg.verbucht
     or abs(coalesce(beleg.betrag_bezahlt, 0)) > 0.005 then
    raise exception 'Nur ungebuchte, unbezahlte Debitoren-Entwuerfe koennen geloescht werden';
  end if;
  delete from public.fibu_debitoren_belege where id = beleg.id;
end
$$;

-- --------------------------------------------------------------------------
-- 6) Race-sichere manuelle Zahlungen (ohne erfundene Bankbuchung)
-- --------------------------------------------------------------------------
create or replace function public.fibu_kreditoren_zahlung_erfassen(
  p_beleg_id uuid,
  p_betrag numeric,
  p_datum date default current_date,
  p_zahlungsreferenz text default null,
  p_mandant_id uuid default null
) returns public.fibu_kreditoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_kreditoren_belege%rowtype;
  neu numeric;
begin
  select * into result from public.fibu_kreditoren_belege
   where id = p_beleg_id for update;
  if not found then raise exception 'Kreditoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') = 'service_role'
     and (p_mandant_id is null or result.mandant_id <> p_mandant_id) then
    raise exception 'Service-Aufruf ohne passenden FiBu-Mandanten';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(result.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if result.belegtyp <> 'rechnung' or not result.verbucht
     or result.freigabe_status <> 'freigegeben'
     or result.status not in ('offen', 'teilbezahlt') then
    raise exception 'Zahlung ist fuer diesen Belegstatus nicht erlaubt';
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Zahlungsbetrag muss positiv sein';
  end if;
  neu := round(coalesce(result.betrag_bezahlt, 0) + p_betrag, 2);
  if neu > result.betrag_brutto + 0.005 then
    raise exception 'Zahlung uebersteigt den offenen Betrag';
  end if;
  update public.fibu_kreditoren_belege
     set betrag_bezahlt = neu, bezahlt_am = coalesce(p_datum, current_date),
         zahlungsreferenz = coalesce(p_zahlungsreferenz, zahlungsreferenz),
         status = case when neu >= betrag_brutto - 0.005
                       then 'bezahlt' else 'teilbezahlt' end,
         updated_at = now()
   where id = result.id
   returning * into result;
  return result;
end
$$;

create or replace function public.fibu_debitoren_zahlung_erfassen(
  p_beleg_id uuid,
  p_betrag numeric,
  p_datum date default current_date
) returns public.fibu_debitoren_belege
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_debitoren_belege%rowtype;
  neu numeric;
begin
  select * into result from public.fibu_debitoren_belege
   where id = p_beleg_id for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(result.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if result.belegtyp <> 'rechnung' or not result.verbucht
     or result.status not in ('offen', 'teilbezahlt') then
    raise exception 'Zahlung ist fuer diesen Belegstatus nicht erlaubt';
  end if;
  if p_betrag is null or p_betrag <= 0 then
    raise exception 'Zahlungsbetrag muss positiv sein';
  end if;
  neu := round(coalesce(result.betrag_bezahlt, 0) + p_betrag, 2);
  if neu > result.betrag_brutto + 0.005 then
    raise exception 'Zahlung uebersteigt den offenen Betrag';
  end if;
  update public.fibu_debitoren_belege
     set betrag_bezahlt = neu, bezahlt_am = coalesce(p_datum, current_date),
         status = case when neu >= betrag_brutto - 0.005
                       then 'bezahlt' else 'teilbezahlt' end,
         updated_at = now()
   where id = result.id
   returning * into result;
  return result;
end
$$;

-- --------------------------------------------------------------------------
-- 7) Zahlungslauf und Mahnung atomar
-- --------------------------------------------------------------------------
create or replace function public.fibu_zahlungslauf_erstellen(
  p_mandant_id uuid,
  p_lauf jsonb,
  p_positionen jsonb
) returns public.fibu_zahlungslaeufe
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.fibu_zahlungslaeufe%rowtype;
  beleg public.fibu_kreditoren_belege%rowtype;
  e jsonb;
  betrag numeric;
  skonto numeric;
  lieferant_iban text;
  lauf_status text := coalesce(nullif(p_lauf->>'status', ''), 'entwurf');
  total numeric := 0;
  anzahl integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if jsonb_typeof(p_positionen) <> 'array'
     or jsonb_array_length(p_positionen) = 0 then
    raise exception 'Zahlungslauf benoetigt mindestens eine Position';
  end if;
  if lauf_status not in ('entwurf', 'exportiert')
     or nullif(p_lauf->>'lauf_nr', '') is null
     or nullif(p_lauf->>'valutadatum', '') is null
     or not exists (
       select 1 from public.fibu_konten
        where mandant_id = p_mandant_id
          and konto_nr = p_lauf->>'zahlungskonto_nr'
          and konto_typ = 'aktiv' and aktiv
     ) then
    raise exception 'Ungueltiger Zahlungslauf-Kopf oder Zahlungskonto';
  end if;

  insert into public.fibu_zahlungslaeufe (
    mandant_id, lauf_nr, valutadatum, zahlungskonto_nr,
    zahlungskonto_iban, total_betrag, anzahl_zahlungen,
    status, pain001_xml, exportiert_am, created_by
  ) values (
    p_mandant_id, p_lauf->>'lauf_nr', (p_lauf->>'valutadatum')::date,
    p_lauf->>'zahlungskonto_nr', nullif(p_lauf->>'zahlungskonto_iban', ''),
    0, 0, lauf_status,
    nullif(p_lauf->>'pain001_xml', ''),
    nullif(p_lauf->>'exportiert_am', '')::timestamptz, auth.uid()
  ) returning * into result;

  for e in select value from jsonb_array_elements(p_positionen)
  loop
    select * into beleg
      from public.fibu_kreditoren_belege
     where id = (e->>'beleg_id')::uuid
     for update;
    if not found or beleg.mandant_id <> p_mandant_id then
      raise exception 'Zahlungslauf-Beleg gehoert nicht zum Mandanten';
    end if;
    if beleg.belegtyp <> 'rechnung' or not beleg.verbucht
       or beleg.status not in ('offen', 'teilbezahlt')
       or beleg.freigabe_status <> 'freigegeben' then
      raise exception 'Beleg % ist nicht zahlbar', beleg.beleg_nr;
    end if;
    if beleg.lieferant_id <> (e->>'lieferant_id')::uuid then
      raise exception 'Lieferant stimmt bei Beleg % nicht ueberein', beleg.beleg_nr;
    end if;
    select regexp_replace(coalesce(l.iban, ''), '\s', '', 'g')
      into lieferant_iban
      from public.fibu_lieferanten l
     where l.id = beleg.lieferant_id and l.mandant_id = p_mandant_id;
    betrag := round(coalesce(nullif(e->>'betrag', '')::numeric, 0), 2);
    skonto := round(coalesce(nullif(e->>'skonto_betrag', '')::numeric, 0), 2);
    if betrag <= 0 or skonto < 0
       or betrag + skonto >
          beleg.betrag_brutto - coalesce(beleg.betrag_bezahlt, 0) + 0.005 then
      raise exception 'Ungueltiger Zahlbetrag fuer Beleg %', beleg.beleg_nr;
    end if;
    if nullif(lieferant_iban, '') is null
       or lieferant_iban <> regexp_replace(coalesce(e->>'iban', ''), '\s', '', 'g') then
      raise exception 'IBAN stimmt bei Beleg % nicht mit dem Lieferanten ueberein',
        beleg.beleg_nr;
    end if;

    insert into public.fibu_zahlungslauf_positionen (
      mandant_id, zahlungslauf_id, beleg_id, lieferant_id, iban,
      betrag, zahlungsreferenz, zahlungsmitteilung, skonto_betrag
    ) values (
      p_mandant_id, result.id, beleg.id, beleg.lieferant_id,
      regexp_replace(e->>'iban', '\s', '', 'g'), betrag,
      nullif(e->>'zahlungsreferenz', ''), nullif(e->>'zahlungsmitteilung', ''),
      skonto
    );
    update public.fibu_kreditoren_belege
       set status = 'ebanking', updated_at = now()
     where id = beleg.id;
    total := total + betrag;
    anzahl := anzahl + 1;
  end loop;

  update public.fibu_zahlungslaeufe
     set total_betrag = round(total, 2), anzahl_zahlungen = anzahl
   where id = result.id
   returning * into result;
  return result;
end
$$;

create or replace function public.fibu_debitoren_mahnung_erstellen(
  p_beleg_id uuid,
  p_stufe smallint,
  p_gebuehr numeric default 0,
  p_faellig_am date default null,
  p_pdf_url text default null,
  p_gesendet_an text default null
) returns public.fibu_debitoren_mahnungen
language plpgsql
security definer
set search_path = public
as $$
declare
  beleg public.fibu_debitoren_belege%rowtype;
  result public.fibu_debitoren_mahnungen%rowtype;
begin
  select * into beleg from public.fibu_debitoren_belege
   where id = p_beleg_id for update;
  if not found then raise exception 'Debitoren-Beleg nicht gefunden'; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(beleg.mandant_id) then
    raise exception 'Keine Buchungsberechtigung fuer diesen Mandanten';
  end if;
  if beleg.belegtyp <> 'rechnung'
     or beleg.status not in ('offen', 'teilbezahlt')
     or p_stufe not between 1 and 3
     or p_stufe <= coalesce(beleg.mahnstufe, 0) then
    raise exception 'Beleg oder Mahnstufe ist nicht mahnfaehig';
  end if;

  insert into public.fibu_debitoren_mahnungen (
    mandant_id, beleg_id, stufe, mahndatum, faellig_am, gebuehr,
    betrag_offen, pdf_url, gesendet_an, gesendet_am, created_by
  ) values (
    beleg.mandant_id, beleg.id, p_stufe, current_date, p_faellig_am,
    greatest(coalesce(p_gebuehr, 0), 0),
    round(beleg.betrag_brutto - coalesce(beleg.betrag_bezahlt, 0), 2),
    p_pdf_url, p_gesendet_an,
    case when p_gesendet_an is null then null else now() end, auth.uid()
  ) returning * into result;
  update public.fibu_debitoren_belege
     set mahnstufe = p_stufe, letzte_mahnung_am = current_date, updated_at = now()
   where id = beleg.id;
  return result;
end
$$;

-- Debitoren/Mahnungen fehlten in der allgemeinen restriktiven Rollen-Migration.
do $$
declare
  t text;
begin
  foreach t in array array[
    'fibu_debitoren_belege', 'fibu_debitoren_positionen',
    'fibu_debitoren_mahnungen'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_wguard_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_wguard_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_wguard_del', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert with check (public.fibu_can_write_for(mandant_id))',
      t || '_wguard_ins', t
    );
    execute format(
      'create policy %I on public.%I as restrictive for update using (public.fibu_can_write_for(mandant_id)) with check (public.fibu_can_write_for(mandant_id))',
      t || '_wguard_upd', t
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete using (public.fibu_can_write_for(mandant_id))',
      t || '_wguard_del', t
    );
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- 8) Rechte: nur die fachlichen Fassaden sind aus dem Client aufrufbar
-- --------------------------------------------------------------------------
revoke all on table public.fibu_kreditoren_counter from anon, authenticated;
revoke all on function public.fibu_kreditoren_positionen_schreiben(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fibu_debitoren_positionen_schreiben(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fibu_qr_reference(text)
  from public, anon, authenticated, service_role;

revoke all on function public.fibu_next_kreditoren_nr(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fibu_next_debitoren_nr(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fibu_kreditoren_erstellen(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.fibu_kreditoren_bearbeiten(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.fibu_debitoren_erstellen(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.fibu_debitoren_entwurf_speichern(uuid,jsonb,jsonb,boolean)
  from public, anon;
revoke all on function public.fibu_debitoren_stellen(uuid) from public, anon;
revoke all on function public.fibu_debitoren_entwurf_loeschen(uuid) from public, anon;
revoke all on function public.fibu_kreditoren_zahlung_erfassen(uuid,numeric,date,text,uuid)
  from public, anon;
revoke all on function public.fibu_debitoren_zahlung_erfassen(uuid,numeric,date)
  from public, anon;
revoke all on function public.fibu_zahlungslauf_erstellen(uuid,jsonb,jsonb)
  from public, anon;
revoke all on function public.fibu_debitoren_mahnung_erstellen(
  uuid,smallint,numeric,date,text,text
) from public, anon;

grant execute on function public.fibu_kreditoren_erstellen(uuid,jsonb,jsonb),
  public.fibu_kreditoren_bearbeiten(uuid,jsonb,jsonb),
  public.fibu_debitoren_erstellen(uuid,jsonb,jsonb),
  public.fibu_debitoren_entwurf_speichern(uuid,jsonb,jsonb,boolean),
  public.fibu_debitoren_stellen(uuid),
  public.fibu_debitoren_entwurf_loeschen(uuid),
  public.fibu_kreditoren_zahlung_erfassen(uuid,numeric,date,text,uuid),
  public.fibu_debitoren_zahlung_erfassen(uuid,numeric,date),
  public.fibu_zahlungslauf_erstellen(uuid,jsonb,jsonb),
  public.fibu_debitoren_mahnung_erstellen(uuid,smallint,numeric,date,text,text)
  to authenticated, service_role;
