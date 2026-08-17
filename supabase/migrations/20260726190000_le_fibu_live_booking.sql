-- ============================================================================
-- Leistungserfassung -> Fibu/Debitoren: revisionssichere Liveverbuchung
--
-- Fachliche Leitplanken:
--   * Der Fibu-Mandant wird genau einmal durch einen berechtigten Benutzer
--     gebunden. Eine spaetere Korrektur ist nur ueber die auditierte
--     eigentuemergebundene, auditierte Korrekturfunktion moeglich.
--   * Finalisierung, Debitorenbeleg und Hauptbuchbuchungen sind eine Transaktion.
--   * Leistungsartenkonten werden beim Binden, Aendern und Buchen validiert.
--   * Rechnungspositionen erhalten einen Konten-Snapshot, damit spaetere
--     Stammdaten-Aenderungen Gutschriften nicht auf ein anderes Konto buchen.
--   * Zahlungseingaenge synchronisieren nur den offenen Posten. Die Bank-
--     Hauptbuchbuchung bleibt bei der Bankabstimmung, weil erst dort das
--     konkrete Bankkonto bekannt ist.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Einmalige Mandantenbindung und Audit
-- --------------------------------------------------------------------------
create table if not exists public.le_fibu_binding (
  singleton                    boolean primary key default true check (singleton),
  mandant_id                   uuid not null references public.fibu_mandanten(id) on delete restrict,
  debitoren_konto_nr           text not null default '1100',
  default_ertragskonto_nr      text not null default '3400',
  bound_at                     timestamptz not null default now(),
  bound_by                     uuid references auth.users(id) on delete set null,
  owner_user_id                uuid not null references auth.users(id) on delete restrict,
  updated_at                   timestamptz not null default now(),
  constraint le_fibu_binding_debitoren_fk
    foreign key (mandant_id, debitoren_konto_nr)
    references public.fibu_konten(mandant_id, konto_nr)
    on update restrict on delete restrict,
  constraint le_fibu_binding_ertrag_fk
    foreign key (mandant_id, default_ertragskonto_nr)
    references public.fibu_konten(mandant_id, konto_nr)
    on update restrict on delete restrict
);

create table if not exists public.le_fibu_binding_audit (
  id                           bigint generated always as identity primary key,
  action                       text not null check (action in ('bind', 'rebind')),
  old_mandant_id               uuid references public.fibu_mandanten(id) on delete restrict,
  new_mandant_id               uuid not null references public.fibu_mandanten(id) on delete restrict,
  reason                       text,
  changed_by                   uuid references auth.users(id) on delete set null,
  changed_at                   timestamptz not null default now()
);

alter table public.le_fibu_binding enable row level security;
alter table public.le_fibu_binding_audit enable row level security;

drop policy if exists le_fibu_binding_read on public.le_fibu_binding;
create policy le_fibu_binding_read on public.le_fibu_binding
  for select to authenticated using (true);

drop policy if exists le_fibu_binding_audit_read on public.le_fibu_binding_audit;
create policy le_fibu_binding_audit_read on public.le_fibu_binding_audit
  for select to authenticated using (public.can_manage_stammdaten());

create or replace function public.le_guard_fibu_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.le_fibu_binding_write', true), '') <> 'on' then
    raise exception 'Der Fibu-Mandant ist gesperrt und kann nur ueber den autorisierten Bindungs-Workflow geaendert werden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_le_fibu_binding_guard on public.le_fibu_binding;
create trigger trg_le_fibu_binding_guard
  before insert or update or delete on public.le_fibu_binding
  for each row execute function public.le_guard_fibu_binding();

create or replace function public.le_assert_fibu_accounts_ready(
  p_mandant_id uuid,
  p_debitoren_konto_nr text default '1100',
  p_default_ertragskonto_nr text default '3400'
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing_service_accounts text;
  mandate_currency text;
  mandate_vat_method text;
begin
  select upper(btrim(m.waehrung)), coalesce(m.mwst_methode, 'effektiv')
    into mandate_currency, mandate_vat_method
    from public.fibu_mandanten m
   where m.id = p_mandant_id
     and m.aktiv = true;
  if not found then
    raise exception 'Der ausgewaehlte Fibu-Mandant fehlt oder ist inaktiv';
  end if;
  if mandate_currency <> 'CHF' then
    raise exception 'Die Fibu-Liveverbuchung ist nur fuer CHF-Mandanten freigegeben; % verwendet %',
      p_mandant_id, mandate_currency;
  end if;
  if mandate_vat_method not in ('effektiv', 'saldosteuersatz') then
    raise exception 'Die MWST-Methode % wird von der Fibu-Liveverbuchung noch nicht unterstuetzt',
      mandate_vat_method;
  end if;

  if not exists (
    select 1
      from public.fibu_konten k
     where k.mandant_id = p_mandant_id
       and k.konto_nr = p_debitoren_konto_nr
       and k.konto_typ = 'aktiv'
       and k.aktiv = true
  ) then
    raise exception 'Das Debitorenkonto % fehlt, ist inaktiv oder kein Aktivkonto', p_debitoren_konto_nr;
  end if;

  if not exists (
    select 1
      from public.fibu_konten k
     where k.mandant_id = p_mandant_id
       and k.konto_nr = p_default_ertragskonto_nr
       and k.konto_typ = 'ertrag'
       and k.aktiv = true
  ) then
    raise exception 'Das Standard-Ertragskonto % fehlt, ist inaktiv oder kein Ertragskonto', p_default_ertragskonto_nr;
  end if;

  select string_agg(st.code || ' -> ' || coalesce(st.ertragskonto, '(leer)'), ', ' order by st.code)
    into missing_service_accounts
    from public.le_service_type st
   where st.active = true
     and st.billable = true
     and not exists (
       select 1
         from public.fibu_konten k
        where k.mandant_id = p_mandant_id
          and k.konto_nr = st.ertragskonto
          and k.konto_typ = 'ertrag'
          and k.aktiv = true
     );

  if missing_service_accounts is not null then
    raise exception 'Diese Leistungsarten haben im Mandanten kein aktives Ertragskonto: %', missing_service_accounts;
  end if;
end
$$;

create or replace function public.le_bind_fibu_mandant(p_mandant_id uuid)
returns public.le_fibu_binding
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.le_fibu_binding%rowtype;
  result public.le_fibu_binding%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Die Erstbindung muss interaktiv durch den kuenftigen fachlichen Eigentuemer erfolgen';
  end if;
  if not public.can_manage_stammdaten()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Nur Stammdaten-Verantwortliche duerfen den Fibu-Mandanten binden';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_mandant_id) then
    raise exception 'Der Mandant kann nur mit der Fibu-Rolle Admin oder Buchhalter gebunden werden';
  end if;

  select * into existing
    from public.le_fibu_binding
   where singleton = true
   for update;
  if found then
    if existing.mandant_id = p_mandant_id then return existing; end if;
    raise exception 'Der Fibu-Mandant ist bereits dauerhaft gebunden. Nur der festgelegte Eigentuemer kann ihn mit Begruendung korrigieren';
  end if;

  perform public.le_assert_fibu_accounts_ready(p_mandant_id, '1100', '3400');
  perform set_config('app.le_fibu_binding_write', 'on', true);

  insert into public.le_fibu_binding (
    singleton, mandant_id, debitoren_konto_nr, default_ertragskonto_nr,
    bound_by, owner_user_id
  ) values (
    true, p_mandant_id, '1100', '3400', auth.uid(), auth.uid()
  )
  returning * into result;

  insert into public.le_fibu_binding_audit (
    action, new_mandant_id, reason, changed_by
  ) values (
    'bind', p_mandant_id, 'Erstbindung in der Leistungserfassung', auth.uid()
  );
  return result;
end
$$;

-- Eine Korrektur ist nur fuer den bei der Erstbindung festgehaltenen
-- fachlichen Eigentuemer oder als technischer Service-Admin moeglich.
create or replace function public.le_rebind_fibu_mandant(
  p_new_mandant_id uuid,
  p_reason text
) returns public.le_fibu_binding
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.le_fibu_binding%rowtype;
  result public.le_fibu_binding%rowtype;
begin
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 10 then
    raise exception 'Die Korrektur braucht eine nachvollziehbare Begruendung (mindestens 10 Zeichen)';
  end if;

  select * into existing
    from public.le_fibu_binding
   where singleton = true
   for update;
  if not found then
    raise exception 'Es besteht noch keine Mandantenbindung; bitte Erstbindungsfunktion verwenden';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is distinct from existing.owner_user_id then
    raise exception 'Nur der bei der Erstbindung festgelegte Eigentuemer darf die Mandantenbindung korrigieren';
  end if;
  if existing.mandant_id = p_new_mandant_id then return existing; end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.fibu_can_write_for(p_new_mandant_id) then
    raise exception 'Der neue Mandant setzt die Fibu-Rolle Admin oder Buchhalter voraus';
  end if;

  perform public.le_assert_fibu_accounts_ready(
    p_new_mandant_id,
    existing.debitoren_konto_nr,
    existing.default_ertragskonto_nr
  );
  perform set_config('app.le_fibu_binding_write', 'on', true);

  update public.le_fibu_binding
     set mandant_id = p_new_mandant_id,
         bound_at = now(),
         bound_by = auth.uid(),
         updated_at = now()
   where singleton = true
   returning * into result;

  insert into public.le_fibu_binding_audit (
    action, old_mandant_id, new_mandant_id, reason, changed_by
  ) values (
    'rebind', existing.mandant_id, p_new_mandant_id, btrim(p_reason), auth.uid()
  );
  return result;
end
$$;

create or replace function public.le_get_fibu_binding()
returns table (
  mandant_id uuid,
  mandant_name text,
  debitoren_konto_nr text,
  default_ertragskonto_nr text,
  bound_at timestamptz,
  bound_by uuid,
  owner_user_id uuid,
  can_rebind boolean,
  posting_ready boolean,
  issues text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.le_fibu_binding%rowtype;
  m_name text;
  mandate_currency text;
  mandate_vat_method text;
  problem_list text[] := array[]::text[];
  missing_accounts text;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Anmeldung erforderlich';
  end if;
  select * into b from public.le_fibu_binding where singleton = true;
  if not found then return; end if;

  select m.name, upper(btrim(m.waehrung)), coalesce(m.mwst_methode, 'effektiv')
    into m_name, mandate_currency, mandate_vat_method
    from public.fibu_mandanten m
   where m.id = b.mandant_id;
  if mandate_currency <> 'CHF' then
    problem_list := array_append(problem_list, 'Mandantenwaehrung ' || mandate_currency || ' wird nicht unterstuetzt');
  end if;
  if mandate_vat_method not in ('effektiv', 'saldosteuersatz') then
    problem_list := array_append(problem_list, 'MWST-Methode ' || mandate_vat_method || ' wird nicht unterstuetzt');
  end if;
  if not exists (
    select 1 from public.fibu_konten k
     where k.mandant_id = b.mandant_id and k.konto_nr = b.debitoren_konto_nr
       and k.konto_typ = 'aktiv' and k.aktiv
  ) then
    problem_list := array_append(problem_list, 'Debitorenkonto ' || b.debitoren_konto_nr || ' fehlt/ist inaktiv');
  end if;
  if not exists (
    select 1 from public.fibu_konten k
     where k.mandant_id = b.mandant_id and k.konto_nr = b.default_ertragskonto_nr
       and k.konto_typ = 'ertrag' and k.aktiv
  ) then
    problem_list := array_append(problem_list, 'Standard-Ertragskonto ' || b.default_ertragskonto_nr || ' fehlt/ist inaktiv');
  end if;
  select string_agg(st.code || ':' || coalesce(st.ertragskonto, '(leer)'), ', ' order by st.code)
    into missing_accounts
    from public.le_service_type st
   where st.active and st.billable
     and not exists (
       select 1 from public.fibu_konten k
        where k.mandant_id = b.mandant_id and k.konto_nr = st.ertragskonto
          and k.konto_typ = 'ertrag' and k.aktiv
     );
  if missing_accounts is not null then
    problem_list := array_append(problem_list, 'Ungueltige Leistungsartenkonten: ' || missing_accounts);
  end if;

  return query select
    b.mandant_id, m_name, b.debitoren_konto_nr, b.default_ertragskonto_nr,
    b.bound_at, b.bound_by, b.owner_user_id,
    auth.uid() is not distinct from b.owner_user_id,
    cardinality(problem_list) = 0, problem_list;
end
$$;

create or replace function public.le_list_fibu_binding_candidates()
returns table (
  mandant_id uuid,
  mandant_name text,
  uid text,
  fibu_role text,
  currency text,
  vat_method text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.name, m.uid, a.role, upper(btrim(m.waehrung)),
         coalesce(m.mwst_methode, 'effektiv')
    from public.fibu_user_mandant_access a
    join public.fibu_mandanten m on m.id = a.mandant_id
   where a.user_id = auth.uid()
     and a.role in ('admin', 'buchhalter')
     and m.aktiv = true
     and public.can_manage_stammdaten()
   order by m.name;
$$;

create or replace function public.le_list_bound_fibu_revenue_accounts()
returns table (
  konto_nr text,
  bezeichnung text
)
language sql
stable
security definer
set search_path = public
as $$
  select k.konto_nr, k.bezeichnung
    from public.le_fibu_binding b
    join public.fibu_konten k on k.mandant_id = b.mandant_id
   where b.singleton = true
     and k.konto_typ = 'ertrag'
     and k.aktiv = true
     and public.can_manage_stammdaten()
   order by k.konto_nr;
$$;

-- --------------------------------------------------------------------------
-- 2) Konten gegen Stammdaten-Aenderungen absichern
-- --------------------------------------------------------------------------
create or replace function public.le_validate_service_type_fibu_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.le_fibu_binding%rowtype;
begin
  if not new.billable then return new; end if;
  select * into b from public.le_fibu_binding where singleton = true;
  if not found then return new; end if;
  if not exists (
    select 1 from public.fibu_konten k
     where k.mandant_id = b.mandant_id
       and k.konto_nr = new.ertragskonto
       and k.konto_typ = 'ertrag'
       and k.aktiv = true
  ) then
    raise exception 'Ertragskonto % der Leistungsart % fehlt oder ist im gebundenen Fibu-Mandanten nicht aktiv', new.ertragskonto, new.code;
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_service_type_fibu_account on public.le_service_type;
create trigger trg_le_service_type_fibu_account
  before insert or update of billable, ertragskonto on public.le_service_type
  for each row execute function public.le_validate_service_type_fibu_account();

create or replace function public.le_protect_linked_fibu_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.le_fibu_binding%rowtype;
  linked boolean := false;
  old_key text;
begin
  select * into b from public.le_fibu_binding where singleton = true;
  if not found or old.mandant_id <> b.mandant_id then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  old_key := old.konto_nr;
  linked := old_key in (b.debitoren_konto_nr, b.default_ertragskonto_nr)
    or exists (
      select 1 from public.le_service_type st
       where st.billable and st.ertragskonto = old_key
    );
  if not linked then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE'
     or new.mandant_id is distinct from old.mandant_id
     or new.konto_nr is distinct from old.konto_nr
     or new.aktiv is distinct from true
     or (
       old_key = b.debitoren_konto_nr and new.konto_typ <> 'aktiv'
     )
     or (
       old_key <> b.debitoren_konto_nr and new.konto_typ <> 'ertrag'
     ) then
    raise exception 'Konto % ist mit der Leistungserfassung verknuepft und darf nicht geloescht, umnummeriert, deaktiviert oder typveraendert werden', old_key;
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_protect_linked_fibu_account on public.fibu_konten;
create trigger trg_le_protect_linked_fibu_account
  before update or delete on public.fibu_konten
  for each row execute function public.le_protect_linked_fibu_account();

-- --------------------------------------------------------------------------
-- 3) Nachvollziehbare Quellverknuepfungen und Konten-Snapshots
-- --------------------------------------------------------------------------
alter table public.fibu_kunden
  add column if not exists crm_customer_id uuid references public.customers(id) on delete restrict;

create unique index if not exists fibu_kunden_crm_customer_uidx
  on public.fibu_kunden(mandant_id, crm_customer_id)
  where crm_customer_id is not null;

alter table public.fibu_debitoren_belege
  add column if not exists source_system text,
  add column if not exists source_id uuid;

create unique index if not exists fibu_debitoren_source_uidx
  on public.fibu_debitoren_belege(mandant_id, source_system, source_id)
  where source_system is not null and source_id is not null;
create unique index if not exists fibu_debitoren_mandant_id_uidx
  on public.fibu_debitoren_belege(mandant_id, id);

alter table public.le_invoice
  add column if not exists fibu_mandant_id uuid references public.fibu_mandanten(id) on delete restrict,
  add column if not exists fibu_debitoren_beleg_id uuid references public.fibu_debitoren_belege(id) on delete restrict,
  add column if not exists fibu_posted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'le_invoice_fibu_beleg_mandant_fk'
  ) then
    alter table public.le_invoice
      add constraint le_invoice_fibu_beleg_mandant_fk
      foreign key (fibu_mandant_id, fibu_debitoren_beleg_id)
      references public.fibu_debitoren_belege(mandant_id, id)
      on update restrict on delete restrict;
  end if;
end
$$;

alter table public.le_invoice_line
  add column if not exists fibu_konto_nr text;

create or replace function public.le_guard_fibu_snapshots()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.le_fibu_posting', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'le_invoice' then
    if (tg_op = 'INSERT' and (
          new.fibu_mandant_id is not null
          or new.fibu_debitoren_beleg_id is not null
          or new.fibu_posted_at is not null
        ))
       or (tg_op = 'UPDATE' and (
          new.fibu_mandant_id is distinct from old.fibu_mandant_id
          or new.fibu_debitoren_beleg_id is distinct from old.fibu_debitoren_beleg_id
          or new.fibu_posted_at is distinct from old.fibu_posted_at
        )) then
      raise exception 'Fibu-Verknuepfungen werden ausschliesslich vom Liveverbuchungs-Workflow gesetzt';
    end if;
  elsif tg_table_name = 'le_invoice_line' then
    if (tg_op = 'INSERT' and new.fibu_konto_nr is not null)
       or (tg_op = 'UPDATE' and new.fibu_konto_nr is distinct from old.fibu_konto_nr) then
      raise exception 'Der Fibu-Kontensnapshot wird ausschliesslich bei der Liveverbuchung gesetzt';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_le_invoice_fibu_snapshot_guard on public.le_invoice;
create trigger trg_le_invoice_fibu_snapshot_guard
  before insert or update on public.le_invoice
  for each row execute function public.le_guard_fibu_snapshots();

drop trigger if exists trg_le_invoice_line_fibu_snapshot_guard on public.le_invoice_line;
create trigger trg_le_invoice_line_fibu_snapshot_guard
  before insert or update of fibu_konto_nr on public.le_invoice_line
  for each row execute function public.le_guard_fibu_snapshots();

-- Atomarer eigener Nummernkreis fuer automatisch erzeugte Fibu-Kunden.
create table if not exists public.le_fibu_customer_counter (
  mandant_id uuid primary key references public.fibu_mandanten(id) on delete cascade,
  value integer not null default 0 check (value >= 0)
);
alter table public.le_fibu_customer_counter enable row level security;

insert into public.le_fibu_customer_counter(mandant_id, value)
select mandant_id,
       max((regexp_match(nr, '^LE-(\d+)$'))[1]::integer)
  from public.fibu_kunden
 where nr ~ '^LE-\d+$'
 group by mandant_id
on conflict (mandant_id) do update
  set value = greatest(public.le_fibu_customer_counter.value, excluded.value);

create or replace function public.le_next_fibu_customer_nr(p_mandant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.le_fibu_customer_counter(mandant_id, value)
  values (p_mandant_id, 1)
  on conflict (mandant_id) do update
    set value = public.le_fibu_customer_counter.value + 1
  returning value into n;
  return 'LE-' || lpad(n::text, 6, '0');
end
$$;

create or replace function public.le_sync_fibu_customer(
  p_mandant_id uuid,
  p_customer_id uuid,
  p_default_ertragskonto text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_json jsonb;
  result_id uuid;
  terms_days smallint := 30;
  customer_name text;
  customer_address text;
begin
  select to_jsonb(c) into customer_json
    from public.customers c
   where c.id = p_customer_id;
  if customer_json is null then raise exception 'CRM-Kunde nicht gefunden'; end if;

  customer_name := coalesce(
    nullif(btrim(customer_json->>'company_name'), ''),
    nullif(btrim(concat_ws(' ', customer_json->>'vorname', customer_json->>'nachname')), ''),
    'Kunde ' || left(p_customer_id::text, 8)
  );
  customer_address := nullif(btrim(concat_ws(
    ' ', customer_json->>'street', customer_json->>'building_number'
  )), '');
  select least(32767, greatest(0, coalesce(t.payment_terms_days, 30)))::smallint
    into terms_days
    from public.le_customer_terms t
   where t.customer_id = p_customer_id;
  terms_days := coalesce(terms_days, 30);

  select k.id into result_id
    from public.fibu_kunden k
   where k.mandant_id = p_mandant_id
     and k.crm_customer_id = p_customer_id
   for update;

  if result_id is null then
    insert into public.fibu_kunden (
      mandant_id, nr, name, uid, adresse, plz, ort, land, email,
      zahlungsbedingung_tage, standard_konto_nr, mwst_code,
      crm_customer_id
    ) values (
      p_mandant_id, public.le_next_fibu_customer_nr(p_mandant_id),
      customer_name, nullif(customer_json->>'uid_nr', ''),
      customer_address, nullif(customer_json->>'zip', ''),
      nullif(customer_json->>'city', ''),
      coalesce(nullif(customer_json->>'country', ''), 'CH'),
      nullif(customer_json->>'billing_email', ''),
      terms_days, p_default_ertragskonto, 'U81', p_customer_id
    )
    returning id into result_id;
  else
    update public.fibu_kunden
       set name = customer_name,
           uid = nullif(customer_json->>'uid_nr', ''),
           adresse = customer_address,
           plz = nullif(customer_json->>'zip', ''),
           ort = nullif(customer_json->>'city', ''),
           land = coalesce(nullif(customer_json->>'country', ''), 'CH'),
           email = nullif(customer_json->>'billing_email', ''),
           zahlungsbedingung_tage = terms_days,
           standard_konto_nr = p_default_ertragskonto,
           aktiv = true,
           updated_at = now()
     where id = result_id;
  end if;
  return result_id;
end
$$;

create or replace function public.le_resolve_fibu_sales_tax(
  p_mandant_id uuid,
  p_le_vat_code text,
  p_vat_pct numeric
) returns table (fibu_code text, konto_umsatz text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  preferred_code text;
begin
  preferred_code := case
    when coalesce(p_vat_pct, 0) = 0 and upper(coalesce(p_le_vat_code, '')) = 'EXEMPT' then 'U0A'
    when coalesce(p_vat_pct, 0) = 0 then 'U0'
    when p_vat_pct = 8.1 then 'U81'
    when p_vat_pct = 2.6 then 'U26'
    when p_vat_pct = 3.8 then 'U38'
    else null
  end;

  return query
  select mc.code, mc.konto_umsatz
    from public.fibu_mwst_codes mc
   where mc.mandant_id = p_mandant_id
     and mc.aktiv = true
     and (
       (coalesce(p_vat_pct, 0) > 0 and mc.typ = 'umsatzsteuer' and mc.satz = p_vat_pct)
       or
       (coalesce(p_vat_pct, 0) = 0 and mc.typ = 'steuerbefreit')
     )
   order by
     (mc.code = preferred_code) desc,
     (mc.code like 'U%') desc,
     mc.sortierung,
     mc.code
   limit 1;
end
$$;

-- --------------------------------------------------------------------------
-- 4) Atomare Liveverbuchung
-- --------------------------------------------------------------------------
create or replace function public.le_post_invoice_to_fibu(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  binding public.le_fibu_binding%rowtype;
  customer_id_fibu uuid;
  v_beleg_id uuid;
  parent_beleg_id uuid;
  beleg_type text;
  document_direction integer;
  line_record record;
  position_record record;
  line_count integer := 0;
  line_index integer := 0;
  raw_subtotal numeric := 0;
  factor numeric := 1;
  effective_net numeric;
  effective_vat numeric;
  remaining_net numeric;
  vat_difference numeric;
  existing_vat numeric;
  stored_net numeric;
  stored_vat numeric;
  revenue_account text;
  tax_code text;
  tax_account text;
  booking_no text;
  mandate_vat_method text;
  effective_gross numeric;
  paid numeric := 0;
  paid_date date;
  fibu_status text := 'offen';
begin
  perform set_config('app.le_fibu_posting', 'on', true);
  perform set_config('app.le_billing_write', 'on', true);

  select * into inv
    from public.le_invoice
   where id = p_invoice_id
   for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if inv.fibu_debitoren_beleg_id is not null then
    return inv.fibu_debitoren_beleg_id;
  end if;
  if inv.status = 'entwurf' then
    raise exception 'Ein Rechnungsentwurf darf nicht in die Fibu gebucht werden';
  end if;
  if inv.invoice_no is null then raise exception 'Rechnungsnummer fehlt'; end if;
  if inv.customer_id is null then raise exception 'Rechnung hat keinen Kunden'; end if;
  if inv.currency <> 'CHF' then
    raise exception 'Fibu-Liveverbuchung unterstuetzt aktuell nur CHF; Rechnung % ist %', inv.invoice_no, inv.currency;
  end if;

  select * into binding
    from public.le_fibu_binding
   where singleton = true
   for share;
  if not found then
    raise exception 'Vor der Finalisierung muss unter Stammdaten > Firma einmalig ein Fibu-Mandant gebunden werden';
  end if;
  perform public.le_assert_fibu_accounts_ready(
    binding.mandant_id, binding.debitoren_konto_nr, binding.default_ertragskonto_nr
  );
  select coalesce(m.mwst_methode, 'effektiv')
    into mandate_vat_method
    from public.fibu_mandanten m
   where m.id = binding.mandant_id;

  select b.id into v_beleg_id
    from public.fibu_debitoren_belege b
   where b.mandant_id = binding.mandant_id
     and b.source_system = 'mailflow_le'
     and b.source_id = inv.id
   for update;
  if v_beleg_id is not null then
    update public.le_invoice
       set fibu_mandant_id = binding.mandant_id,
           fibu_debitoren_beleg_id = v_beleg_id,
           fibu_posted_at = coalesce(fibu_posted_at, now())
     where id = inv.id;
    return v_beleg_id;
  end if;

  select count(*), coalesce(sum(l.amount), 0)
    into line_count, raw_subtotal
    from public.le_invoice_line l
   where l.invoice_id = inv.id
     and coalesce(l.is_kulant, false) = false
     and l.amount <> 0;
  if line_count = 0 or raw_subtotal = 0 then
    raise exception 'Rechnung % hat keine buchbaren Positionen', inv.invoice_no;
  end if;

  customer_id_fibu := public.le_sync_fibu_customer(
    binding.mandant_id, inv.customer_id, binding.default_ertragskonto_nr
  );
  beleg_type := case when inv.invoice_type = 'gutschrift' or inv.total < 0
                     then 'gutschrift' else 'rechnung' end;
  document_direction := case when beleg_type = 'gutschrift' then -1 else 1 end;

  select coalesce(sum(p.amount), 0), max(p.paid_at)
    into paid, paid_date
    from public.le_payment p
   where p.invoice_id = inv.id;
  if abs(paid) > 0.005 then
    fibu_status := case when abs(paid) + 0.005 >= abs(inv.total)
                        then 'bezahlt' else 'teilbezahlt' end;
  end if;

  insert into public.fibu_debitoren_belege (
    mandant_id, beleg_nr, kunde_id, belegtyp, titel,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    betrag_bezahlt, bezahlt_am, zahlungsreferenz, status, notiz,
    verbucht, gebucht_von, source_system, source_id
  ) values (
    binding.mandant_id, inv.invoice_no, customer_id_fibu, beleg_type,
    case when beleg_type = 'gutschrift' then 'Gutschrift ' else 'Rechnung ' end || inv.invoice_no,
    coalesce(inv.issue_date, current_date), coalesce(inv.issue_date, current_date),
    coalesce(inv.due_date, inv.issue_date, current_date),
    greatest(0, coalesce(inv.due_date, current_date) - coalesce(inv.issue_date, current_date))::smallint,
    inv.currency, inv.subtotal, inv.vat_amount, inv.total,
    paid, paid_date, inv.qr_reference, fibu_status, inv.notes,
    false, auth.uid(), 'mailflow_le', inv.id
  )
  returning id into v_beleg_id;

  factor := inv.subtotal / raw_subtotal;
  remaining_net := inv.subtotal;
  for line_record in
    select l.*, st.ertragskonto as service_ertragskonto
      from public.le_invoice_line l
      left join public.le_service_type st on st.id = l.service_type_id
     where l.invoice_id = inv.id
       and coalesce(l.is_kulant, false) = false
       and l.amount <> 0
     order by l.sort_order, l.id
  loop
    line_index := line_index + 1;
    effective_net := case
      when line_index = line_count then remaining_net
      else round(line_record.amount * factor, 2)
    end;
    remaining_net := remaining_net - effective_net;

    revenue_account := coalesce(
      line_record.fibu_konto_nr,
      (
        select original_line.fibu_konto_nr
          from public.le_invoice_line original_line
         where original_line.invoice_id = inv.parent_invoice_id
           and original_line.description = line_record.description
           and original_line.service_type_id is not distinct from line_record.service_type_id
           and original_line.fibu_konto_nr is not null
         order by abs(abs(original_line.amount) - abs(line_record.amount)), original_line.sort_order
         limit 1
      ),
      line_record.service_ertragskonto,
      binding.default_ertragskonto_nr
    );
    if not exists (
      select 1 from public.fibu_konten k
       where k.mandant_id = binding.mandant_id
         and k.konto_nr = revenue_account
         and k.konto_typ = 'ertrag'
         and k.aktiv = true
    ) then
      raise exception 'Ertragskonto % der Position "%" fehlt oder ist inaktiv', revenue_account, line_record.description;
    end if;

    select r.fibu_code, r.konto_umsatz into tax_code, tax_account
      from public.le_resolve_fibu_sales_tax(
        binding.mandant_id, line_record.vat_code, coalesce(line_record.vat_pct, 0)
      ) r;
    if tax_code is null then
      raise exception 'Kein aktiver Fibu-MWST-Code fuer LE-Code % / % Prozent', line_record.vat_code, line_record.vat_pct;
    end if;
    if mandate_vat_method = 'effektiv' and coalesce(line_record.vat_pct, 0) > 0 then
      if tax_account is null or not exists (
        select 1 from public.fibu_konten k
         where k.mandant_id = binding.mandant_id
           and k.konto_nr = tax_account and k.aktiv = true
      ) then
        raise exception 'Umsatzsteuerkonto fuer MWST-Code % fehlt oder ist inaktiv', tax_code;
      end if;
    end if;

    effective_vat := round(effective_net * coalesce(line_record.vat_pct, 0) / 100, 2);
    stored_net := effective_net * document_direction;
    stored_vat := effective_vat * document_direction;

    insert into public.fibu_debitoren_positionen (
      mandant_id, beleg_id, position, bezeichnung, menge, einheit,
      einzelpreis, konto_nr, mwst_code, mwst_satz,
      betrag_netto, betrag_mwst, betrag_brutto
    ) values (
      binding.mandant_id, v_beleg_id, line_index::smallint, line_record.description,
      case when abs(line_record.hours) > 0 then abs(line_record.hours) else 1 end,
      case when abs(line_record.hours) > 0 then 'Std' else 'Stk' end,
      abs(line_record.rate), revenue_account, tax_code, coalesce(line_record.vat_pct, 0),
      stored_net, stored_vat, stored_net + stored_vat
    );

    update public.le_invoice_line
       set fibu_konto_nr = revenue_account
     where id = line_record.id;
  end loop;

  -- Rappen-Rest auf die letzte steuerbare Position legen, damit Debitorenbeleg
  -- und rechtsgueltiger Rechnungskopf exakt uebereinstimmen.
  select coalesce(sum(p.betrag_mwst * document_direction), 0)
    into existing_vat
    from public.fibu_debitoren_positionen p
   where p.beleg_id = v_beleg_id;
  vat_difference := round(inv.vat_amount - existing_vat, 2);
  if vat_difference <> 0 then
    update public.fibu_debitoren_positionen p
       set betrag_mwst = p.betrag_mwst + vat_difference * document_direction,
           betrag_brutto = p.betrag_brutto + vat_difference * document_direction
     where p.id = (
       select p2.id
         from public.fibu_debitoren_positionen p2
        where p2.beleg_id = v_beleg_id and p2.mwst_satz > 0
        order by p2.position desc
        limit 1
     );
    if not found then
      raise exception 'Rechnung weist MWST aus, hat aber keine steuerbare Position';
    end if;
  end if;

  -- Hauptbuch: positive Betraege, Richtung aus dem effektiven Vorzeichen.
  for position_record in
    select p.*,
           p.betrag_netto * document_direction as effective_net,
           p.betrag_mwst * document_direction as effective_vat,
           mc.konto_umsatz
      from public.fibu_debitoren_positionen p
      join public.fibu_mwst_codes mc
        on mc.mandant_id = p.mandant_id and mc.code = p.mwst_code
     where p.beleg_id = v_beleg_id
     order by p.position
  loop
    effective_gross := position_record.effective_net + position_record.effective_vat;
    if mandate_vat_method = 'saldosteuersatz' and effective_gross <> 0 then
      -- Bei der Saldosteuersatz-Methode wird der Bruttoumsatz auf das
      -- Ertragskonto gebucht. Die Steuer wird spaeter mit dem hinterlegten
      -- Saldosteuersatz auf dem Bruttoumsatz abgerechnet.
      booking_no := public.fibu_next_buchungs_nr(binding.mandant_id);
      insert into public.fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by
      ) values (
        binding.mandant_id, booking_no, coalesce(inv.issue_date, current_date), inv.invoice_no,
        case when effective_gross > 0
             then binding.debitoren_konto_nr else position_record.konto_nr end,
        case when effective_gross > 0
             then position_record.konto_nr else binding.debitoren_konto_nr end,
        abs(effective_gross), null, null,
        coalesce(position_record.bezeichnung, '') || ' / ' || inv.invoice_no,
        'debitoren', v_beleg_id, auth.uid()
      );
    else
      if position_record.effective_net <> 0 then
        booking_no := public.fibu_next_buchungs_nr(binding.mandant_id);
        insert into public.fibu_buchungen (
          mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
          konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
          text, quelle, quelle_id, created_by
        ) values (
          binding.mandant_id, booking_no, coalesce(inv.issue_date, current_date), inv.invoice_no,
          case when position_record.effective_net > 0
               then binding.debitoren_konto_nr else position_record.konto_nr end,
          case when position_record.effective_net > 0
               then position_record.konto_nr else binding.debitoren_konto_nr end,
          abs(position_record.effective_net), position_record.mwst_code,
          abs(position_record.effective_vat),
          coalesce(position_record.bezeichnung, '') || ' / ' || inv.invoice_no,
          'debitoren', v_beleg_id, auth.uid()
        );
      end if;

      if position_record.effective_vat <> 0 then
        if position_record.konto_umsatz is null then
          raise exception 'Umsatzsteuerkonto fuer MWST-Code % fehlt', position_record.mwst_code;
        end if;
        booking_no := public.fibu_next_buchungs_nr(binding.mandant_id);
        insert into public.fibu_buchungen (
          mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
          konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
          text, quelle, quelle_id, created_by
        ) values (
          binding.mandant_id, booking_no, coalesce(inv.issue_date, current_date), inv.invoice_no,
          case when position_record.effective_vat > 0
               then binding.debitoren_konto_nr else position_record.konto_umsatz end,
          case when position_record.effective_vat > 0
               then position_record.konto_umsatz else binding.debitoren_konto_nr end,
          abs(position_record.effective_vat), null, null,
          'Umsatzsteuer ' || position_record.mwst_code || ' / ' || inv.invoice_no,
          'debitoren', v_beleg_id, auth.uid()
        );
      end if;
    end if;
  end loop;

  update public.fibu_debitoren_belege
     set verbucht = true, gebucht_am = now()
   where id = v_beleg_id;

  update public.le_invoice
     set fibu_mandant_id = binding.mandant_id,
         fibu_debitoren_beleg_id = v_beleg_id,
         fibu_posted_at = now()
   where id = inv.id;

  -- Eine Vollgutschrift schliesst Original und Gegenbeleg gemeinsam. Eine
  -- Teilgutschrift bleibt als negativer offener Posten zur Verrechnung offen.
  if inv.invoice_type = 'gutschrift' and inv.parent_invoice_id is not null then
    select parent.fibu_debitoren_beleg_id into parent_beleg_id
      from public.le_invoice parent
     where parent.id = inv.parent_invoice_id;
    if parent_beleg_id is not null and exists (
      select 1 from public.le_invoice parent
       where parent.id = inv.parent_invoice_id and parent.status = 'storniert'
    ) then
      update public.fibu_debitoren_belege
         set status = 'storniert', storno_beleg_id = v_beleg_id
       where id = parent_beleg_id;
      update public.fibu_debitoren_belege
         set status = 'storniert'
       where id = v_beleg_id;
    end if;
  end if;
  return v_beleg_id;
end
$$;

create or replace function public.le_post_final_invoice_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.le_post_invoice_to_fibu(new.id);
  return null;
end
$$;

-- Deferred ist fuer le_create_credit entscheidend: Der Kopf wird dort bereits
-- definitiv angelegt, die Positionen folgen aber erst innerhalb derselben RPC.
drop trigger if exists trg_le_fibu_post_on_insert on public.le_invoice;
create constraint trigger trg_le_fibu_post_on_insert
  after insert on public.le_invoice
  deferrable initially deferred
  for each row
  when (new.status = 'definitiv')
  execute function public.le_post_final_invoice_trigger();

drop trigger if exists trg_le_fibu_post_on_finalize on public.le_invoice;
create constraint trigger trg_le_fibu_post_on_finalize
  after update of status on public.le_invoice
  deferrable initially deferred
  for each row
  when (new.status = 'definitiv' and old.status is distinct from new.status)
  execute function public.le_post_final_invoice_trigger();

-- Direktstorno wird buchhalterisch als Vollgutschrift/Gegenbuchung umgesetzt.
create or replace function public.le_storno_invoice(p_invoice_id uuid)
returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
begin
  perform public.le_assert_billing_role();
  perform set_config('app.le_billing_write', 'on', true);
  select * into inv from public.le_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if inv.status = 'storniert' then return inv; end if;
  if inv.status <> 'definitiv' then
    raise exception 'Nur noch nicht versendete definitive Rechnungen koennen direkt storniert werden';
  end if;

  perform public.le_create_credit(
    p_invoice_id,
    'Direktstorno vor Versand',
    null
  );
  select * into inv from public.le_invoice where id = p_invoice_id;
  return inv;
end
$$;

-- --------------------------------------------------------------------------
-- 5) LE-Zahlung -> Debitoren-OP synchronisieren (ohne erfundene Bankbuchung)
-- --------------------------------------------------------------------------
create or replace function public.le_sync_fibu_payment(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  paid numeric := 0;
  latest_date date;
  new_status text;
begin
  if p_invoice_id is null then return; end if;
  select * into inv from public.le_invoice where id = p_invoice_id;
  if not found or inv.fibu_debitoren_beleg_id is null then return; end if;
  select coalesce(sum(p.amount), 0), max(p.paid_at)
    into paid, latest_date
    from public.le_payment p
   where p.invoice_id = p_invoice_id;

  new_status := case
    when inv.status = 'storniert' then 'storniert'
    when abs(paid) <= 0.005 then 'offen'
    when abs(paid) + 0.005 >= abs(inv.total) then 'bezahlt'
    else 'teilbezahlt'
  end;
  update public.fibu_debitoren_belege
     set betrag_bezahlt = paid,
         bezahlt_am = case when abs(paid) > 0.005 then latest_date else null end,
         status = new_status,
         updated_at = now()
   where id = inv.fibu_debitoren_beleg_id;
end
$$;

create or replace function public.le_sync_fibu_payment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.le_sync_fibu_payment(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.le_sync_fibu_payment(new.invoice_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_le_payment_fibu_sync on public.le_payment;
create trigger trg_le_payment_fibu_sync
  after insert or update or delete on public.le_payment
  for each row execute function public.le_sync_fibu_payment_trigger();

-- --------------------------------------------------------------------------
-- 6) Rechte: oeffentlich nur Status/Erstbindung, keine internen Buchungshelfer
-- --------------------------------------------------------------------------
revoke all on table public.le_fibu_binding, public.le_fibu_binding_audit,
  public.le_fibu_customer_counter from anon;
grant select on table public.le_fibu_binding to authenticated, service_role;
grant select on table public.le_fibu_binding_audit to authenticated, service_role;

revoke all on function public.le_guard_fibu_binding() from public;
revoke all on function public.le_assert_fibu_accounts_ready(uuid,text,text) from public;
revoke all on function public.le_bind_fibu_mandant(uuid) from public, anon;
revoke all on function public.le_get_fibu_binding() from public, anon;
revoke all on function public.le_rebind_fibu_mandant(uuid,text) from public, anon;
revoke all on function public.le_list_fibu_binding_candidates() from public;
revoke all on function public.le_list_bound_fibu_revenue_accounts() from public;
revoke all on function public.le_validate_service_type_fibu_account() from public;
revoke all on function public.le_protect_linked_fibu_account() from public;
revoke all on function public.le_guard_fibu_snapshots() from public;
revoke all on function public.le_next_fibu_customer_nr(uuid) from public;
revoke all on function public.le_sync_fibu_customer(uuid,uuid,text) from public;
revoke all on function public.le_resolve_fibu_sales_tax(uuid,text,numeric) from public;
revoke all on function public.le_post_invoice_to_fibu(uuid) from public, anon, authenticated;
revoke all on function public.le_post_final_invoice_trigger() from public;
revoke all on function public.le_sync_fibu_payment(uuid) from public;
revoke all on function public.le_sync_fibu_payment_trigger() from public;

grant execute on function public.le_bind_fibu_mandant(uuid)
  to authenticated, service_role;
grant execute on function public.le_get_fibu_binding()
  to authenticated, service_role;
grant execute on function public.le_list_fibu_binding_candidates()
  to authenticated, service_role;
grant execute on function public.le_list_bound_fibu_revenue_accounts()
  to authenticated, service_role;
grant execute on function public.le_rebind_fibu_mandant(uuid,text)
  to authenticated, service_role;
grant execute on function public.le_post_invoice_to_fibu(uuid)
  to service_role;

comment on table public.le_fibu_binding is
  'Einmalige, revisionssichere Bindung der Leistungserfassung an einen Fibu-Mandanten.';
comment on column public.le_invoice_line.fibu_konto_nr is
  'Beim ersten Fibu-Posting eingefrorenes Ertragskonto; Basis fuer spaetere Gegenbuchungen.';
comment on column public.le_service_type.ertragskonto is
  'Aktives Ertragskonto des dauerhaft gebundenen Fibu-Mandanten fuer die Liveverbuchung.';
comment on column public.fibu_debitoren_belege.source_id is
  'Idempotenz-/Auditreferenz auf das Quellsystem; fuer Mailflow LE = le_invoice.id.';
