-- ============================================================================
-- Leistungserfassung: atomare Fakturierung, Storno, Gutschrift und Zahlung
-- ============================================================================

alter table public.le_invoice
  add column if not exists currency char(3) not null default 'CHF',
  add column if not exists skonto_pct numeric(5,2) not null default 0,
  add column if not exists skonto_days int;

create or replace function public.le_assert_billing_role()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.le_can_manage_billing()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Keine Berechtigung fuer die Fakturierung';
  end if;
end
$$;

-- Die frühere atomare Rechnungsnummer verwendete einen separaten Zähler und
-- ignorierte damit das im UI konfigurierbare Format. Der Zeilen-Lock auf dem
-- Nummernkreis ist ebenfalls atomar und macht wieder alle drei Kreise konsistent.
update public.le_number_sequence s
   set current_value = greatest(
         s.current_value,
         coalesce((
           select value
             from public.le_invoice_counter
            where year = extract(year from current_date)::int
         ), 0)
       ),
       last_year = extract(year from current_date)::int
 where s.kind = 'invoice';

create or replace function public.le_next_invoice_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq public.le_number_sequence%rowtype;
  y int := extract(year from current_date);
  m int := extract(month from current_date);
  n int;
begin
  select * into seq from public.le_number_sequence where kind = 'invoice' for update;
  if not found then raise exception 'Nummernkreis fuer Rechnungen fehlt'; end if;
  n := case when seq.reset_yearly and seq.last_year <> y
            then 1 else seq.current_value + 1 end;
  update public.le_number_sequence
     set current_value = n, last_year = y
   where id = seq.id;
  return replace(replace(replace(replace(
    coalesce(seq.format, 'R-{YYYY}-{NNNN}'),
    '{YYYY}', y::text), '{YY}', right(y::text, 2)),
    '{MM}', lpad(m::text, 2, '0')),
    '{NNNN}', lpad(n::text, seq.padding_length, '0'));
end
$$;

create or replace function public.le_update_number_sequence_settings(
  p_id uuid,
  p_format text,
  p_padding_length int,
  p_reset_yearly boolean
) returns public.le_number_sequence
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.le_number_sequence%rowtype;
begin
  if not public.can_manage_stammdaten()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Keine Berechtigung fuer Nummernkreise';
  end if;
  if nullif(btrim(p_format), '') is null
     or length(p_format) > 80
     or strpos(p_format, '{NNNN}') = 0 then
    raise exception 'Format muss {NNNN} enthalten und hoechstens 80 Zeichen lang sein';
  end if;
  if p_padding_length not between 1 and 10 then
    raise exception 'Padding muss zwischen 1 und 10 liegen';
  end if;
  update public.le_number_sequence
     set format = btrim(p_format),
         padding_length = p_padding_length,
         reset_yearly = coalesce(p_reset_yearly, true)
   where id = p_id
   returning * into result;
  if not found then raise exception 'Nummernkreis nicht gefunden'; end if;
  return result;
end
$$;

create or replace function public.le_qr_reference(
  p_customer_id uuid,
  p_invoice_no text
) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  base text;
  carry int := 0;
  digit text;
  mod_table int[] := array[0,9,4,6,8,2,7,1,3,5];
begin
  base :=
    lpad(left(regexp_replace(coalesce(p_customer_id::text, ''), '\D', '', 'g'), 8), 8, '0')
    || lpad(right(regexp_replace(coalesce(p_invoice_no, ''), '\D', '', 'g'), 18), 18, '0');
  base := left(base, 26);
  foreach digit in array regexp_split_to_array(base, '') loop
    carry := mod_table[((carry + digit::int) % 10) + 1];
  end loop;
  return base || ((10 - carry) % 10)::text;
end
$$;

create or replace function public.le_finalize_invoice(p_invoice_id uuid)
returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  next_no text;
  terms_days int;
begin
  perform public.le_assert_billing_role();
  perform set_config('app.le_billing_write', 'on', true);

  select * into inv
    from public.le_invoice
   where id = p_invoice_id
   for update;
  if not found then
    raise exception 'Rechnung nicht gefunden';
  end if;

  -- Idempotent bei Doppelclick/Parallelaufruf: keine zweite Nummer verbrauchen.
  if inv.status <> 'entwurf' then
    if inv.invoice_no is not null then
      return inv;
    end if;
    raise exception 'Nur Entwuerfe koennen finalisiert werden';
  end if;

  if not exists (
    select 1 from public.le_invoice_line where invoice_id = inv.id
  ) then
    raise exception 'Rechnung ohne Positionen kann nicht finalisiert werden';
  end if;

  next_no := public.le_next_invoice_no();
  select coalesce(
           (select payment_terms_days
              from public.le_customer_terms
             where customer_id = inv.customer_id),
           (select payment_terms_days
              from public.le_company_settings
             where is_active = true
             order by created_at
             limit 1),
           30
         )
    into terms_days;

  update public.le_invoice
     set invoice_no = next_no,
         qr_reference = public.le_qr_reference(inv.customer_id, next_no),
         status = 'definitiv',
         issue_date = coalesce(inv.issue_date, current_date),
         due_date = coalesce(inv.due_date, current_date + terms_days)
   where id = inv.id
   returning * into inv;
  return inv;
end
$$;

create or replace function public.le_release_invoice_sources(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.le_billing_release', 'on', true);

  update public.le_time_entry
     set invoice_id = null,
         status = case
           when status = 'kulant_abgerechnet' then 'kulant'::public.le_time_entry_status
           else 'erfasst'::public.le_time_entry_status
         end
   where invoice_id = p_invoice_id
     and status in ('verrechnet', 'kulant_abgerechnet');

  update public.le_expense
     set invoiced_invoice_id = null,
         status = 'genehmigt'
   where invoiced_invoice_id = p_invoice_id;
end
$$;

create or replace function public.le_delete_invoice_draft(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
begin
  perform public.le_assert_billing_role();
  perform set_config('app.le_billing_delete', 'on', true);
  select * into inv from public.le_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if inv.status <> 'entwurf' then
    raise exception 'Nur Entwuerfe koennen geloescht werden';
  end if;

  perform public.le_release_invoice_sources(inv.id);
  delete from public.le_invoice_akonto_link where schluss_invoice_id = inv.id;
  delete from public.le_invoice where id = inv.id;
end
$$;

create or replace function public.le_guard_invoice_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.le_billing_delete', true), '') <> 'on' then
    raise exception 'Rechnungen duerfen nur ueber den fachlichen Loesch-/Storno-Workflow entfernt werden';
  end if;
  return old;
end
$$;

drop trigger if exists trg_le_invoice_delete_guard on public.le_invoice;
create trigger trg_le_invoice_delete_guard
  before delete on public.le_invoice
  for each row execute function public.le_guard_invoice_delete();

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

  update public.le_invoice set status = 'storniert'
   where id = inv.id returning * into inv;
  perform public.le_release_invoice_sources(inv.id);
  return inv;
end
$$;

-- Entwurfskopf und alle Positionen werden gemeinsam gespeichert und die
-- Kopfsummen ausschliesslich serverseitig aus den Positionen berechnet.
create or replace function public.le_save_invoice_draft(
  p_invoice_id uuid,
  p_header jsonb,
  p_lines jsonb
) returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  item jsonb;
  raw_subtotal numeric := 0;
  net_subtotal numeric := 0;
  vat_total numeric := 0;
  pct_discount numeric := 0;
  fixed_discount numeric := 0;
  factor numeric := 1;
  header_vat numeric := 0;
begin
  perform public.le_assert_billing_role();
  select * into inv from public.le_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if inv.status <> 'entwurf' then raise exception 'Nur Entwuerfe koennen bearbeitet werden'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Ungueltige Positionsdaten';
  end if;

  pct_discount := greatest(0, least(100, coalesce((p_header->>'discount_pct')::numeric, 0)));
  fixed_discount := greatest(0, coalesce((p_header->>'discount_amount')::numeric, 0));
  header_vat := greatest(0, coalesce((p_header->>'vat_pct')::numeric, inv.vat_pct, 0));

  delete from public.le_invoice_line where invoice_id = inv.id;
  for item in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if nullif(btrim(item->>'description'), '') is null then
      raise exception 'Jede Rechnungsposition braucht eine Beschreibung';
    end if;
    if coalesce((item->>'hours')::numeric, 0) < 0
       or coalesce((item->>'rate')::numeric, 0) < 0 then
      raise exception 'Stunden und Ansatz duerfen nicht negativ sein';
    end if;
    insert into public.le_invoice_line (
      invoice_id, service_type_id, description, hours, rate, amount, sort_order,
      is_kulant, vat_code, vat_pct, section, akonto_invoice_id
    ) values (
      inv.id,
      nullif(item->>'service_type_id', '')::uuid,
      btrim(item->>'description'),
      coalesce((item->>'hours')::numeric, 0),
      coalesce((item->>'rate')::numeric, 0),
      round(coalesce((item->>'amount')::numeric, 0), 2),
      coalesce((item->>'sort_order')::int, 100),
      coalesce((item->>'is_kulant')::boolean, false),
      coalesce(nullif(item->>'vat_code', ''), case when header_vat = 0 then 'EXP' else 'STD' end),
      coalesce((item->>'vat_pct')::numeric, header_vat),
      coalesce(nullif(item->>'section', '')::public.le_invoice_section, 'honorar'),
      nullif(item->>'akonto_invoice_id', '')::uuid
    );
  end loop;

  select coalesce(sum(amount), 0) into raw_subtotal
    from public.le_invoice_line
   where invoice_id = inv.id and is_kulant = false;
  net_subtotal := greatest(0, round(raw_subtotal * (1 - pct_discount / 100) - fixed_discount, 2));
  if raw_subtotal <> 0 then factor := net_subtotal / raw_subtotal; end if;
  select coalesce(sum(round(amount * factor * coalesce(vat_pct, 0) / 100, 2)), 0)
    into vat_total
    from public.le_invoice_line
   where invoice_id = inv.id and is_kulant = false;

  update public.le_invoice
     set period_from = nullif(p_header->>'period_from', '')::date,
         period_to = nullif(p_header->>'period_to', '')::date,
         due_date = nullif(p_header->>'due_date', '')::date,
         notes = nullif(p_header->>'notes', ''),
         discount_pct = pct_discount,
         discount_amount = fixed_discount,
         vat_pct = header_vat,
         subtotal = net_subtotal,
         vat_amount = round(vat_total, 2),
         total = round(net_subtotal + vat_total, 2)
   where id = inv.id
   returning * into inv;
  return inv;
end
$$;

create or replace function public.le_recalculate_invoice_totals(p_invoice_id uuid)
returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  raw_subtotal numeric;
  net_subtotal numeric;
  vat_total numeric;
  factor numeric := 1;
begin
  select * into inv from public.le_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if inv.status <> 'entwurf' then raise exception 'Nur Entwuerfe koennen neu berechnet werden'; end if;
  select coalesce(sum(amount), 0) into raw_subtotal
    from public.le_invoice_line where invoice_id = inv.id and is_kulant = false;
  net_subtotal := greatest(
    0,
    round(raw_subtotal * (1 - inv.discount_pct / 100) - inv.discount_amount, 2)
  );
  if raw_subtotal <> 0 then factor := net_subtotal / raw_subtotal; end if;
  select coalesce(sum(round(amount * factor * coalesce(vat_pct, 0) / 100, 2)), 0)
    into vat_total
    from public.le_invoice_line where invoice_id = inv.id and is_kulant = false;
  update public.le_invoice
     set subtotal = net_subtotal, vat_amount = vat_total,
         total = round(net_subtotal + vat_total, 2)
   where id = inv.id returning * into inv;
  return inv;
end
$$;

do $$
begin
  if exists (
    select 1
      from public.le_invoice_akonto_link
     group by akonto_invoice_id
    having count(*) > 1
  ) then
    raise exception
      'Akonto-Dubletten in le_invoice_akonto_link vor Migration bereinigen';
  end if;
end
$$;

create unique index if not exists le_invoice_akonto_once_uidx
  on public.le_invoice_akonto_link(akonto_invoice_id);

create or replace function public.le_apply_akonto_links(
  p_schluss_invoice_id uuid,
  p_akonto_invoice_ids uuid[]
) returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  schluss public.le_invoice%rowtype;
  akonto public.le_invoice%rowtype;
  akonto_id uuid;
  n int;
begin
  perform public.le_assert_billing_role();
  select * into schluss from public.le_invoice
   where id = p_schluss_invoice_id for update;
  if not found or schluss.status <> 'entwurf' then
    raise exception 'Schlussrechnung ist kein bearbeitbarer Entwurf';
  end if;
  n := coalesce((select max(sort_order) from public.le_invoice_line
                 where invoice_id = schluss.id), 0);
  foreach akonto_id in array coalesce(p_akonto_invoice_ids, array[]::uuid[]) loop
    select * into akonto from public.le_invoice where id = akonto_id for update;
    if not found
       or akonto.invoice_type <> 'akonto'
       or akonto.status not in ('definitiv', 'versendet', 'bezahlt')
       or akonto.customer_id is distinct from schluss.customer_id then
      raise exception 'Ungueltige oder nicht passende Akonto-Rechnung';
    end if;
    insert into public.le_invoice_akonto_link (
      schluss_invoice_id, akonto_invoice_id, amount_net, amount_vat
    ) values (schluss.id, akonto.id, akonto.subtotal, akonto.vat_amount);
    n := n + 10;
    insert into public.le_invoice_line (
      invoice_id, akonto_invoice_id, description, hours, rate, amount,
      sort_order, vat_code, vat_pct, section
    ) values (
      schluss.id, akonto.id,
      'Abzug Akonto ' || coalesce(akonto.invoice_no, '')
        || case when akonto.issue_date is null then ''
                else ' vom ' || to_char(akonto.issue_date, 'DD.MM.YYYY') end,
      0, 0, -akonto.subtotal, n,
      case when akonto.vat_pct = 0 then 'EXP' else 'STD' end,
      akonto.vat_pct, 'honorar'
    );
  end loop;
  return public.le_recalculate_invoice_totals(schluss.id);
end
$$;

create or replace function public.le_remove_akonto_link(
  p_schluss_invoice_id uuid,
  p_akonto_invoice_id uuid
) returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.le_assert_billing_role();
  perform 1 from public.le_invoice
   where id = p_schluss_invoice_id and status = 'entwurf' for update;
  if not found then raise exception 'Schlussrechnung ist kein bearbeitbarer Entwurf'; end if;
  delete from public.le_invoice_akonto_link
   where schluss_invoice_id = p_schluss_invoice_id
     and akonto_invoice_id = p_akonto_invoice_id;
  delete from public.le_invoice_line
   where invoice_id = p_schluss_invoice_id
     and akonto_invoice_id = p_akonto_invoice_id;
  return public.le_recalculate_invoice_totals(p_schluss_invoice_id);
end
$$;

-- --------------------------------------------------------------------------
-- Atomare Entwurfserstellung fuer mehrere Projekte in EINER Transaktion.
-- --------------------------------------------------------------------------
create or replace function public.le_create_invoice_drafts(
  p_entry_ids uuid[],
  p_project_ids uuid[],
  p_period_from date default null,
  p_period_to date default null,
  p_direct boolean default false,
  p_include_kulant boolean default true,
  p_include_expenses boolean default false
) returns setof public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  proj public.le_project%rowtype;
  inv public.le_invoice%rowtype;
  company public.le_company_settings%rowtype;
  terms public.le_customer_terms%rowtype;
  expected_entries int := 0;
  actual_entries int := 0;
  default_vat numeric := 8.10;
  v_discount_pct numeric := 0;
  raw_subtotal numeric := 0;
  net_subtotal numeric := 0;
  vat_total numeric := 0;
  has_kulant boolean := false;
  has_source boolean := false;
  line_sort int := 10;
begin
  perform public.le_assert_billing_role();
  perform set_config('app.le_billing_write', 'on', true);
  perform set_config('app.le_billing_delete', 'on', true);

  if coalesce(cardinality(p_project_ids), 0) = 0 then
    return;
  end if;

  select count(*) into expected_entries
    from (select distinct unnest(coalesce(p_entry_ids, array[]::uuid[])) id) requested;

  if expected_entries > 0 then
    perform 1
      from public.le_time_entry
     where id = any(p_entry_ids)
     for update;

    select count(*) into actual_entries
      from public.le_time_entry te
     where te.id = any(p_entry_ids)
       and te.project_id = any(p_project_ids)
       and te.invoice_id is null
       and te.status in ('erfasst', 'freigegeben', 'kulant');

    if actual_entries <> expected_entries then
      raise exception 'Rapporte wurden zwischenzeitlich geaendert oder bereits verrechnet';
    end if;
  end if;

  select * into company
    from public.le_company_settings
   where is_active = true
   order by created_at
   limit 1;
  default_vat := coalesce(company.vat_default_pct, 8.10);

  foreach v_project_id in array p_project_ids loop
    select * into proj
      from public.le_project
     where id = v_project_id
     for update;
    if not found then raise exception 'Projekt % nicht gefunden', v_project_id; end if;

    select * into terms
      from public.le_customer_terms
     where customer_id = proj.customer_id;
    v_discount_pct := greatest(0, least(100, coalesce(terms.discount_pct, 0)));

    if p_include_expenses then
      perform 1
        from public.le_expense
       where project_id = proj.id
         and rebillable = true
         and status = 'genehmigt'
         and invoiced_invoice_id is null
         and (p_period_from is null or expense_date >= p_period_from)
         and (p_period_to is null or expense_date <= p_period_to)
       for update;
    end if;

    select
      exists (
        select 1
          from public.le_time_entry te
          join public.le_service_type st on st.id = te.service_type_id
         where te.id = any(coalesce(p_entry_ids, array[]::uuid[]))
           and te.project_id = proj.id
           and st.billable = true
           and te.status <> 'kulant'
      )
      or (
        p_include_kulant and exists (
          select 1 from public.le_time_entry te
           where te.id = any(coalesce(p_entry_ids, array[]::uuid[]))
             and te.project_id = proj.id and te.status = 'kulant'
        )
      )
      or (
        p_include_expenses and exists (
          select 1 from public.le_expense e
           where e.project_id = proj.id and e.rebillable = true
             and e.status = 'genehmigt' and e.invoiced_invoice_id is null
             and (p_period_from is null or e.expense_date >= p_period_from)
             and (p_period_to is null or e.expense_date <= p_period_to)
        )
      )
      into has_source;
    if not has_source then continue; end if;

    insert into public.le_invoice (
      project_id, customer_id, status, period_from, period_to,
      subtotal, discount_pct, discount_amount, vat_pct, vat_amount, total,
      currency, skonto_pct, skonto_days, created_by
    ) values (
      proj.id, proj.customer_id, 'entwurf', p_period_from, p_period_to,
      0, v_discount_pct, 0, default_vat, 0, 0,
      coalesce(terms.currency, 'CHF'), coalesce(terms.skonto_pct, 0),
      terms.skonto_days, auth.uid()
    )
    returning * into inv;

    line_sort := 10;
    if proj.billing_mode = 'pauschal' then
      insert into public.le_invoice_line (
        invoice_id, description, hours, rate, amount, sort_order,
        vat_code, vat_pct, section
      ) values (
        inv.id,
        trim('Pauschale ' || coalesce(proj.name, ''))
          || case when proj.pauschal_cycle is null then '' else ' (' || proj.pauschal_cycle || ')' end,
        0, 0, round(coalesce(proj.pauschal_amount, 0)::numeric, 2), line_sort,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 'EXP' else 'STD' end,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 0 else default_vat end,
        'honorar'
      );
      line_sort := line_sort + 10;
    else
      insert into public.le_invoice_line (
        invoice_id, service_type_id, description, hours, rate, amount,
        sort_order, vat_code, vat_pct, section
      )
      select
        inv.id,
        te.service_type_id,
        max(st.name),
        round(sum(coalesce(te.hours_external, te.hours_internal))::numeric, 2),
        case when sum(coalesce(te.hours_external, te.hours_internal)) = 0 then 0
             else round(
               sum(coalesce(te.hours_external, te.hours_internal) * te.rate_snapshot)
               / sum(coalesce(te.hours_external, te.hours_internal)), 2
             ) end,
        round(sum(coalesce(te.hours_external, te.hours_internal) * te.rate_snapshot)::numeric, 2),
        line_sort + (row_number() over (order by min(st.sort_order), max(st.name)))::int * 10,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 'EXP' else coalesce(max(st.default_vat_code), 'STD') end,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 0
             else public.le_resolve_vat_rate(coalesce(max(st.default_vat_code), 'STD'), current_date)
        end,
        coalesce(min(st.default_section::text)::public.le_invoice_section, 'honorar')
      from public.le_time_entry te
      join public.le_service_type st on st.id = te.service_type_id
      where te.id = any(coalesce(p_entry_ids, array[]::uuid[]))
        and te.project_id = proj.id
        and te.status <> 'kulant'
        and st.billable = true
      group by te.service_type_id;
      get diagnostics line_sort = row_count;
      line_sort := (line_sort + 1) * 10;
    end if;

    if p_include_expenses then
      insert into public.le_invoice_line (
        invoice_id, description, hours, rate, amount, sort_order,
        vat_code, vat_pct, section
      )
      select
        inv.id,
        'Spesen: ' || coalesce(e.description, e.category::text)
          || ' (' || to_char(e.expense_date, 'DD.MM.YYYY') || ')',
        0, 0, round(e.amount_gross::numeric, 2),
        line_sort + (row_number() over (order by e.expense_date, e.id))::int * 10,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 'EXP' else 'STD' end,
        case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
             then 0 else default_vat end,
        'spesen'
      from public.le_expense e
      where e.project_id = proj.id
        and e.rebillable = true
        and e.status = 'genehmigt'
        and e.invoiced_invoice_id is null
        and (p_period_from is null or e.expense_date >= p_period_from)
        and (p_period_to is null or e.expense_date <= p_period_to);
    end if;

    select
      coalesce(sum(l.amount), 0),
      coalesce(sum(round(
        l.amount * (1 - v_discount_pct / 100) * coalesce(l.vat_pct, 0) / 100, 2
      )), 0)
      into raw_subtotal, vat_total
      from public.le_invoice_line l
     where l.invoice_id = inv.id
       and l.is_kulant = false;
    net_subtotal := round(raw_subtotal * (1 - v_discount_pct / 100), 2);

    select exists (
      select 1 from public.le_time_entry te
       where te.id = any(coalesce(p_entry_ids, array[]::uuid[]))
         and te.project_id = proj.id and te.status = 'kulant'
    ) into has_kulant;

    if raw_subtotal <= 0 and not (p_include_kulant and has_kulant) then
      delete from public.le_invoice where id = inv.id;
      continue;
    end if;

    update public.le_invoice
       set subtotal = net_subtotal,
           discount_pct = v_discount_pct,
           vat_amount = round(vat_total, 2),
           total = round(net_subtotal + vat_total, 2)
     where id = inv.id
     returning * into inv;

    update public.le_time_entry te
       set invoice_id = inv.id,
           status = case when te.status = 'kulant'
                         then 'kulant_abgerechnet'::public.le_time_entry_status
                         else 'verrechnet'::public.le_time_entry_status end
     where te.id = any(coalesce(p_entry_ids, array[]::uuid[]))
       and te.project_id = proj.id
       and te.invoice_id is null
       and (
         (te.status <> 'kulant' and exists (
           select 1 from public.le_service_type st
            where st.id = te.service_type_id and st.billable = true
         ))
         or (p_include_kulant and te.status = 'kulant')
       );

    if p_include_expenses then
      update public.le_expense
         set status = 'abgerechnet', invoiced_invoice_id = inv.id
       where project_id = proj.id
         and rebillable = true
         and status = 'genehmigt'
         and invoiced_invoice_id is null
         and (p_period_from is null or expense_date >= p_period_from)
         and (p_period_to is null or expense_date <= p_period_to);
    end if;

    if p_direct then
      inv := public.le_finalize_invoice(inv.id);
    end if;
    return next inv;
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- Akonto in einer Transaktion
-- --------------------------------------------------------------------------
create or replace function public.le_create_akonto_invoice(
  p_project_id uuid,
  p_customer_id uuid,
  p_amount_net numeric,
  p_vat_pct numeric default 8.1,
  p_period_from date default null,
  p_period_to date default null,
  p_description text default null
) returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  terms public.le_customer_terms%rowtype;
  vat numeric;
  effective_vat numeric;
begin
  perform public.le_assert_billing_role();
  if p_amount_net <= 0 then raise exception 'Akonto-Betrag muss positiv sein'; end if;
  select * into terms from public.le_customer_terms where customer_id = p_customer_id;
  effective_vat := case
    when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export' then 0
    else coalesce(p_vat_pct, 0)
  end;
  vat := round(p_amount_net * effective_vat / 100, 2);
  insert into public.le_invoice (
    project_id, customer_id, status, invoice_type, period_from, period_to,
    subtotal, vat_pct, vat_amount, total, currency,
    skonto_pct, skonto_days, notes, created_by
  ) values (
    p_project_id, p_customer_id, 'entwurf', 'akonto', p_period_from, p_period_to,
    round(p_amount_net, 2), effective_vat, vat,
    round(p_amount_net + vat, 2), coalesce(terms.currency, 'CHF'),
    coalesce(terms.skonto_pct, 0), terms.skonto_days,
    'Akonto-Rechnung - wird in Schlussrechnung verrechnet.', auth.uid()
  ) returning * into inv;
  insert into public.le_invoice_line (
    invoice_id, description, hours, rate, amount, sort_order, vat_code, vat_pct, section
  ) values (
    inv.id, coalesce(nullif(btrim(p_description), ''), 'Akonto auf Honorar'),
    0, 0, round(p_amount_net, 2), 10,
    case when effective_vat = 0 then 'EXP' else 'STD' end, effective_vat, 'honorar'
  );
  return inv;
end
$$;

-- Ausgewaehlte Spesen werden kundenweise und atomar fakturiert.
create or replace function public.le_create_expense_invoices(p_expense_ids uuid[])
returns setof public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  inv public.le_invoice%rowtype;
  terms public.le_customer_terms%rowtype;
  company public.le_company_settings%rowtype;
  expected int;
  actual int;
  v_project_id uuid;
  v_discount numeric;
  v_vat numeric;
  raw_subtotal numeric;
  net_subtotal numeric;
  vat_total numeric;
begin
  perform public.le_assert_billing_role();
  if coalesce(cardinality(p_expense_ids), 0) = 0 then return; end if;

  select count(*) into expected
    from (select distinct unnest(p_expense_ids) id) requested;
  perform 1 from public.le_expense where id = any(p_expense_ids) for update;
  select count(*) into actual
    from public.le_expense
   where id = any(p_expense_ids)
     and status = 'genehmigt'
     and rebillable = true
     and invoiced_invoice_id is null;
  if actual <> expected then
    raise exception 'Spesen wurden zwischenzeitlich geaendert oder bereits abgerechnet';
  end if;
  if exists (
    select 1
      from public.le_expense e
      left join public.le_project p on p.id = e.project_id
     where e.id = any(p_expense_ids)
       and coalesce(e.customer_id, p.customer_id) is null
  ) then
    raise exception 'Mindestens eine Spese hat keinen Kunden';
  end if;

  select * into company from public.le_company_settings
   where is_active = true order by created_at limit 1;

  for v_customer_id in
    select distinct coalesce(e.customer_id, p.customer_id)
      from public.le_expense e
      left join public.le_project p on p.id = e.project_id
     where e.id = any(p_expense_ids)
  loop
    select * into terms
      from public.le_customer_terms ct
     where ct.customer_id = v_customer_id;
    v_discount := greatest(0, least(100, coalesce(terms.discount_pct, 0)));
    v_vat := case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
                  then 0 else coalesce(company.vat_default_pct, 8.1) end;
    select case when count(distinct e.project_id) = 1
                then (array_agg(e.project_id) filter (where e.project_id is not null))[1]
                else null end
      into v_project_id
      from public.le_expense e
      left join public.le_project p on p.id = e.project_id
     where e.id = any(p_expense_ids)
       and coalesce(e.customer_id, p.customer_id) = v_customer_id;

    insert into public.le_invoice (
      customer_id, project_id, status, subtotal, discount_pct,
      vat_pct, vat_amount, total, currency, skonto_pct, skonto_days, notes, created_by
    ) values (
      v_customer_id, v_project_id, 'entwurf', 0, v_discount,
      v_vat, 0, 0, coalesce(terms.currency, 'CHF'),
      coalesce(terms.skonto_pct, 0), terms.skonto_days,
      'Spesen-Verrechnung', auth.uid()
    ) returning * into inv;

    insert into public.le_invoice_line (
      invoice_id, description, hours, rate, amount, sort_order,
      vat_code, vat_pct, section
    )
    select
      inv.id,
      initcap(e.category::text) || ': ' || e.description
        || ' (' || to_char(e.expense_date, 'DD.MM.YYYY') || ')',
      0, 0, round(e.amount_gross, 2),
      (row_number() over (order by e.expense_date, e.id))::int * 10,
      case when v_vat = 0 then 'EXP' else 'STD' end,
      v_vat, 'spesen'
      from public.le_expense e
      left join public.le_project p on p.id = e.project_id
     where e.id = any(p_expense_ids)
       and coalesce(e.customer_id, p.customer_id) = v_customer_id;

    select coalesce(sum(amount), 0) into raw_subtotal
      from public.le_invoice_line where invoice_id = inv.id;
    net_subtotal := round(raw_subtotal * (1 - v_discount / 100), 2);
    select coalesce(sum(round(amount * (1 - v_discount / 100) * vat_pct / 100, 2)), 0)
      into vat_total from public.le_invoice_line where invoice_id = inv.id;
    update public.le_invoice
       set subtotal = net_subtotal, vat_amount = vat_total,
           total = round(net_subtotal + vat_total, 2)
     where id = inv.id returning * into inv;
    update public.le_expense e
       set status = 'abgerechnet', invoiced_invoice_id = inv.id
      from public.le_project p
     where e.id = any(p_expense_ids)
       and p.id = e.project_id
       and coalesce(e.customer_id, p.customer_id) = v_customer_id;
    -- Spesen mit direktem Kunden aber ohne Projekt.
    update public.le_expense e
       set status = 'abgerechnet', invoiced_invoice_id = inv.id
     where e.id = any(p_expense_ids)
       and e.project_id is null
       and e.customer_id = v_customer_id;
    return next inv;
  end loop;
end
$$;

-- Faellige wiederkehrende Vorlagen und deren Terminfortschreibung in einer
-- gemeinsamen Transaktion. Ein Fehler laesst keine halbe Serie zurueck.
create or replace function public.le_generate_recurring_drafts(p_recurring_ids uuid[])
returns setof public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  recurring public.le_recurring_invoice%rowtype;
  inv public.le_invoice%rowtype;
  terms public.le_customer_terms%rowtype;
  company public.le_company_settings%rowtype;
  item jsonb;
  raw_subtotal numeric;
  net_subtotal numeric;
  vat_total numeric;
  v_discount numeric;
  v_vat numeric;
  v_months int;
  n int;
begin
  perform public.le_assert_billing_role();
  if coalesce(cardinality(p_recurring_ids), 0) = 0 then return; end if;
  perform 1 from public.le_recurring_invoice
   where id = any(p_recurring_ids) for update;
  if (
    select count(*) from public.le_recurring_invoice where id = any(p_recurring_ids)
  ) <> (
    select count(*) from (select distinct unnest(p_recurring_ids)) requested
  ) then
    raise exception 'Wiederkehrende Vorlage wurde nicht gefunden';
  end if;
  select * into company from public.le_company_settings
   where is_active = true order by created_at limit 1;

  for recurring in
    select * from public.le_recurring_invoice
     where id = any(p_recurring_ids)
     order by next_date, id
  loop
    if recurring.paused or not recurring.active
       or recurring.next_date > current_date
       or (recurring.end_date is not null and recurring.end_date < recurring.next_date) then
      raise exception 'Vorlage % ist nicht faellig', recurring.title;
    end if;
    select * into terms from public.le_customer_terms
     where customer_id = recurring.customer_id;
    v_discount := greatest(0, least(100, coalesce(terms.discount_pct, 0)));
    v_vat := case when coalesce(terms.vat_required, true) = false or terms.vat_mode = 'export'
                  then 0 else coalesce(company.vat_default_pct, 8.1) end;

    insert into public.le_invoice (
      project_id, customer_id, status, issue_date, due_date,
      subtotal, discount_pct, vat_pct, vat_amount, total,
      currency, skonto_pct, skonto_days, notes, created_by
    ) values (
      recurring.project_id, recurring.customer_id, 'entwurf',
      recurring.next_date,
      recurring.next_date + coalesce(recurring.payment_terms_days, terms.payment_terms_days, 30),
      0, v_discount, v_vat, 0, 0, coalesce(terms.currency, 'CHF'),
      coalesce(terms.skonto_pct, 0), terms.skonto_days,
      'Auto-generiert aus Wiederkehrende: ' || recurring.title, auth.uid()
    ) returning * into inv;

    n := 0;
    for item in select value from jsonb_array_elements(recurring.template_lines) loop
      n := n + 1;
      insert into public.le_invoice_line (
        invoice_id, description, hours, rate, amount, sort_order,
        vat_code, vat_pct, section
      ) values (
        inv.id, btrim(item->>'description'),
        coalesce(nullif(item->>'hours', '')::numeric, 0),
        coalesce(nullif(item->>'rate', '')::numeric, 0),
        round(coalesce(
          nullif(item->>'amount', '')::numeric,
          coalesce(nullif(item->>'hours', '')::numeric, 0)
            * coalesce(nullif(item->>'rate', '')::numeric, 0)
        ), 2),
        n * 10,
        case when v_vat = 0 then 'EXP' else coalesce(nullif(item->>'vat_code', ''), 'STD') end,
        case when v_vat = 0 then 0 else coalesce(nullif(item->>'vat_pct', '')::numeric, v_vat) end,
        coalesce(nullif(item->>'section', '')::public.le_invoice_section, 'honorar')
      );
    end loop;
    select coalesce(sum(amount), 0) into raw_subtotal
      from public.le_invoice_line where invoice_id = inv.id;
    if raw_subtotal <= 0 then raise exception 'Vorlage % hat keinen positiven Betrag', recurring.title; end if;
    net_subtotal := round(raw_subtotal * (1 - v_discount / 100), 2);
    select coalesce(sum(round(amount * (1 - v_discount / 100) * vat_pct / 100, 2)), 0)
      into vat_total from public.le_invoice_line where invoice_id = inv.id;
    update public.le_invoice
       set subtotal = net_subtotal, vat_amount = vat_total,
           total = round(net_subtotal + vat_total, 2)
     where id = inv.id returning * into inv;

    v_months := case recurring.cycle
      when 'monthly' then 1 when 'quarterly' then 3 when 'semi' then 6
      when 'yearly' then 12 else greatest(1, recurring.interval_months) end;
    update public.le_recurring_invoice
       set last_run_at = recurring.next_date,
           last_invoice_id = inv.id,
           next_date = (recurring.next_date + make_interval(months => v_months))::date
     where id = recurring.id;
    return next inv;
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- Gutschrift: Positionen und Kopf entstehen atomar. Bei Teilgutschrift wird
-- der effektive Rabattfaktor des Originals proportional angewandt.
-- p_lines: null = voll; sonst [{id, amount}] mit Original-Positions-ID.
-- --------------------------------------------------------------------------
create or replace function public.le_create_credit(
  p_original_invoice_id uuid,
  p_reason text default null,
  p_lines jsonb default null
) returns public.le_invoice
language plpgsql
security definer
set search_path = public
as $$
declare
  orig public.le_invoice%rowtype;
  credit public.le_invoice%rowtype;
  src public.le_invoice_line%rowtype;
  item jsonb;
  credit_no text;
  is_partial boolean := p_lines is not null;
  original_raw numeric := 0;
  factor numeric := 1;
  requested numeric;
  raw_credit numeric := 0;
  net_credit numeric := 0;
  vat_credit numeric := 0;
  n int := 0;
begin
  perform public.le_assert_billing_role();
  perform set_config('app.le_billing_write', 'on', true);
  select * into orig from public.le_invoice
   where id = p_original_invoice_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if orig.status in ('entwurf', 'storniert') then
    raise exception 'Diese Rechnung kann nicht gutgeschrieben werden';
  end if;
  if orig.invoice_type = 'gutschrift' then
    raise exception 'Eine Gutschrift kann nicht nochmals gutgeschrieben werden';
  end if;
  if is_partial and jsonb_array_length(p_lines) = 0 then
    raise exception 'Keine Position fuer Teilgutschrift gewaehlt';
  end if;

  select coalesce(sum(amount), 0) into original_raw
    from public.le_invoice_line where invoice_id = orig.id and is_kulant = false;
  if original_raw <> 0 then factor := orig.subtotal / original_raw; end if;

  if not is_partial then
    net_credit := abs(orig.subtotal);
    vat_credit := abs(orig.vat_amount);
  else
    for item in select value from jsonb_array_elements(p_lines) loop
      select * into src
        from public.le_invoice_line
       where id = (item->>'id')::uuid
         and invoice_id = orig.id
         and is_kulant = false;
      if not found then raise exception 'Ungueltige Gutschriftposition'; end if;
      requested := round((item->>'amount')::numeric, 2);
      if requested <= 0 or requested > abs(src.amount) then
        raise exception 'Gutschriftbetrag muss zwischen 0 und Originalbetrag liegen';
      end if;
      raw_credit := raw_credit + requested;
      net_credit := net_credit + round(requested * factor, 2);
      vat_credit := vat_credit + round(requested * factor * coalesce(src.vat_pct, orig.vat_pct, 0) / 100, 2);
    end loop;
  end if;

  credit_no := public.le_next_credit_no();
  if credit_no is null then raise exception 'Nummernkreis fuer Gutschriften fehlt'; end if;

  insert into public.le_invoice (
    invoice_no, project_id, customer_id, parent_invoice_id, invoice_type,
    status, issue_date, due_date, period_from, period_to,
    subtotal, vat_pct, vat_amount, discount_pct, discount_amount, total,
    currency, skonto_pct, skonto_days, notes, created_by
  ) values (
    credit_no, orig.project_id, orig.customer_id, orig.id, 'gutschrift',
    'definitiv', current_date, current_date, orig.period_from, orig.period_to,
    -net_credit, orig.vat_pct, -vat_credit,
    case when is_partial then 0 else orig.discount_pct end,
    case when is_partial then 0 else orig.discount_amount end,
    -(net_credit + vat_credit), orig.currency, 0, null,
    'Gutschrift zu Rechnung ' || coalesce(orig.invoice_no, '')
      || case when nullif(btrim(p_reason), '') is null then '' else ': ' || btrim(p_reason) end
      || case when is_partial then ' (Teilgutschrift)' else '' end,
    auth.uid()
  ) returning * into credit;

  if not is_partial then
    insert into public.le_invoice_line (
      invoice_id, service_type_id, description, hours, rate, amount, sort_order,
      is_kulant, vat_code, vat_pct, section, akonto_invoice_id
    )
    select
      credit.id, service_type_id, description, -hours, rate, -amount, sort_order,
      is_kulant, vat_code, vat_pct, section, akonto_invoice_id
      from public.le_invoice_line
     where invoice_id = orig.id;
  else
    for item in select value from jsonb_array_elements(p_lines) loop
      select * into src from public.le_invoice_line
       where id = (item->>'id')::uuid and invoice_id = orig.id;
      requested := round((item->>'amount')::numeric, 2);
      n := n + 1;
      insert into public.le_invoice_line (
        invoice_id, service_type_id, description, hours, rate, amount, sort_order,
        vat_code, vat_pct, section
      ) values (
        credit.id, src.service_type_id, src.description,
        case when src.amount = 0 then 0 else round(-src.hours * requested / abs(src.amount), 2) end,
        src.rate, -requested, n * 10, src.vat_code, src.vat_pct, src.section
      );
    end loop;
  end if;

  if not is_partial then
    update public.le_invoice set status = 'storniert' where id = orig.id;
    perform public.le_release_invoice_sources(orig.id);
  end if;
  return credit;
end
$$;

-- --------------------------------------------------------------------------
-- Zahlungen: Saldo und Rechnungsstatus immer innerhalb derselben Transaktion.
-- --------------------------------------------------------------------------
create or replace function public.le_recompute_invoice_payment(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.le_invoice%rowtype;
  paid numeric;
  latest_date date;
  required_total numeric;
begin
  if p_invoice_id is null then return; end if;
  perform set_config('app.le_billing_write', 'on', true);
  select * into inv from public.le_invoice where id = p_invoice_id for update;
  if not found then return; end if;
  select coalesce(sum(amount), 0), max(paid_at)
    into paid, latest_date
    from public.le_payment where invoice_id = p_invoice_id;
  required_total := inv.total;
  if coalesce(inv.skonto_pct, 0) > 0
     and inv.skonto_days is not null
     and inv.issue_date is not null
     and latest_date is not null
     and latest_date <= inv.issue_date + inv.skonto_days then
    required_total := round(inv.total * (1 - inv.skonto_pct / 100), 2);
  end if;

  update public.le_invoice
     set paid_amount = paid,
         paid_at = case when required_total > 0 and paid + 0.005 >= required_total then latest_date else null end,
         status = case
           when inv.status = 'storniert' then inv.status
           when required_total > 0 and paid + 0.005 >= required_total then 'bezahlt'::public.le_invoice_status
           when inv.status = 'bezahlt' and inv.sent_at is not null then 'versendet'::public.le_invoice_status
           when inv.status = 'bezahlt' then 'definitiv'::public.le_invoice_status
           else inv.status
         end
   where id = p_invoice_id;
end
$$;

create or replace function public.le_payment_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.le_recompute_invoice_payment(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.le_recompute_invoice_payment(new.invoice_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_le_payment_recompute_invoice on public.le_payment;
create trigger trg_le_payment_recompute_invoice
  after insert or update or delete on public.le_payment
  for each row execute function public.le_payment_after_change();

-- --------------------------------------------------------------------------
-- Mahnnummer und Finalisierung atomar.
-- --------------------------------------------------------------------------
create or replace function public.le_next_dunning_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq public.le_number_sequence%rowtype;
  y int := extract(year from current_date);
  m int := extract(month from current_date);
  n int;
begin
  select * into seq from public.le_number_sequence where kind = 'dunning' for update;
  if not found then raise exception 'Nummernkreis fuer Mahnungen fehlt'; end if;
  n := case when seq.reset_yearly and seq.last_year <> y
            then 1 else seq.current_value + 1 end;
  update public.le_number_sequence set current_value = n, last_year = y where id = seq.id;
  return replace(replace(replace(replace(
    coalesce(seq.format, 'M-{YYYY}-{NNNN}'),
    '{YYYY}', y::text), '{YY}', right(y::text, 2)),
    '{MM}', lpad(m::text, 2, '0')),
    '{NNNN}', lpad(n::text, seq.padding_length, '0'));
end
$$;

create or replace function public.le_reserve_dunning_no(p_dunning_id uuid)
returns public.le_dunning
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.le_dunning%rowtype;
begin
  perform public.le_assert_billing_role();
  select * into result from public.le_dunning where id = p_dunning_id for update;
  if not found then raise exception 'Mahnung nicht gefunden'; end if;
  if result.dunning_no is null then
    update public.le_dunning
       set dunning_no = public.le_next_dunning_no()
     where id = result.id
     returning * into result;
  end if;
  return result;
end
$$;

create or replace function public.le_create_dunning_drafts(p_invoice_ids uuid[])
returns setof public.le_dunning
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  inv public.le_invoice%rowtype;
  result public.le_dunning%rowtype;
  next_level int;
  outstanding numeric;
  interest numeric;
  fee numeric;
  due_days int;
begin
  perform public.le_assert_billing_role();
  if coalesce(cardinality(p_invoice_ids), 0) = 0 then return; end if;

  for v_invoice_id in
    select distinct unnest(p_invoice_ids) order by 1
  loop
    select * into inv from public.le_invoice where id = v_invoice_id for update;
    if not found
       or inv.status not in ('definitiv', 'versendet')
       or inv.due_date is null
       or inv.due_date >= current_date
       or inv.total - coalesce(inv.paid_amount, 0) <= 0 then
      raise exception 'Rechnung ist nicht mehr mahnfaehig';
    end if;
    if exists (
      select 1 from public.le_customer_terms
       where customer_id = inv.customer_id and dunning_disabled = true
    ) then
      raise exception 'Mahnwesen ist fuer diesen Kunden deaktiviert';
    end if;
    if exists (
      select 1 from public.le_dunning
       where invoice_id = inv.id and status = 'entwurf'
    ) then
      raise exception 'Fuer diese Rechnung besteht bereits ein Mahnentwurf';
    end if;

    select least(3, coalesce(max(level), 0) + 1)
      into next_level
      from public.le_dunning
     where invoice_id = inv.id
       and status in ('versendet', 'eskaliert');
    next_level := greatest(1, next_level);
    outstanding := round(inv.total - coalesce(inv.paid_amount, 0), 2);
    interest := round(
      outstanding * 0.05 * greatest(0, current_date - inv.due_date) / 365,
      2
    );
    fee := case next_level when 1 then 20 when 2 then 30 else 50 end;
    due_days := case next_level when 1 then 14 else 10 end;

    insert into public.le_dunning (
      invoice_id, customer_id, level, dunning_date, new_due_date, fee,
      interest_rate_pct, interest_from, interest_amount, outstanding_amount,
      total_amount, is_betreibungsandrohung, status, created_by
    ) values (
      inv.id, inv.customer_id, next_level, current_date, current_date + due_days,
      fee, 5, inv.due_date, interest, outstanding,
      round(outstanding + fee + interest, 2), next_level = 3, 'entwurf', auth.uid()
    ) returning * into result;
    return next result;
  end loop;
end
$$;

create or replace function public.le_escalate_dunning(p_dunning_id uuid)
returns public.le_dunning
language plpgsql
security definer
set search_path = public
as $$
declare
  previous public.le_dunning%rowtype;
  inv public.le_invoice%rowtype;
  result public.le_dunning%rowtype;
  next_level int;
  outstanding numeric;
  interest numeric;
  fee numeric;
begin
  perform public.le_assert_billing_role();
  select * into previous from public.le_dunning where id = p_dunning_id for update;
  if not found or previous.status <> 'versendet' or previous.level >= 3 then
    raise exception 'Diese Mahnung kann nicht eskaliert werden';
  end if;
  select * into inv from public.le_invoice where id = previous.invoice_id for update;
  outstanding := round(inv.total - coalesce(inv.paid_amount, 0), 2);
  if inv.status in ('bezahlt', 'storniert') or outstanding <= 0 then
    raise exception 'Rechnung ist nicht mehr mahnfaehig';
  end if;
  if exists (
    select 1 from public.le_dunning
     where invoice_id = inv.id and status = 'entwurf'
  ) then
    raise exception 'Fuer diese Rechnung besteht bereits ein Mahnentwurf';
  end if;

  next_level := previous.level + 1;
  interest := round(
    outstanding * 0.05
      * greatest(0, current_date - coalesce(previous.interest_from, inv.due_date, current_date))
      / 365,
    2
  );
  fee := case next_level when 2 then 30 else 50 end;
  update public.le_dunning set status = 'eskaliert' where id = previous.id;
  insert into public.le_dunning (
    invoice_id, customer_id, level, dunning_date, new_due_date, fee,
    interest_rate_pct, interest_from, interest_amount, outstanding_amount,
    total_amount, is_betreibungsandrohung, status, created_by
  ) values (
    inv.id, inv.customer_id, next_level, current_date, current_date + 10,
    fee, 5, coalesce(previous.interest_from, inv.due_date), interest, outstanding,
    round(outstanding + fee + interest, 2), next_level = 3, 'entwurf', auth.uid()
  ) returning * into result;
  return result;
end
$$;

create or replace function public.le_finalize_dunning(p_dunning_id uuid)
returns public.le_dunning
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.le_dunning%rowtype;
begin
  perform public.le_assert_billing_role();
  result := public.le_reserve_dunning_no(p_dunning_id);
  if result.status <> 'entwurf' then return result; end if;
  update public.le_dunning
     set status = 'versendet',
         sent_at = now()
   where id = result.id returning * into result;
  return result;
end
$$;

-- Clients duerfen nur die fachlichen Transaktions-RPCs ausfuehren, nie Zaehler
-- oder interne Hilfsfunktionen direkt.
revoke all on function public.le_next_invoice_no() from public, authenticated;
revoke all on function public.le_next_credit_no() from public, authenticated;
revoke all on function public.le_next_dunning_no() from public, authenticated;
revoke all on function public.le_release_invoice_sources(uuid) from public, authenticated;
revoke all on function public.le_assert_billing_role() from public, authenticated;
revoke all on function public.le_recompute_invoice_payment(uuid) from public, authenticated;
revoke all on function public.le_recalculate_invoice_totals(uuid) from public, authenticated;
revoke all on function public.le_guard_invoice_delete() from public;
revoke all on function public.le_update_number_sequence_settings(uuid, text, int, boolean)
  from public;

grant execute on function public.le_finalize_invoice(uuid) to authenticated, service_role;
grant execute on function public.le_delete_invoice_draft(uuid) to authenticated, service_role;
grant execute on function public.le_storno_invoice(uuid) to authenticated, service_role;
grant execute on function public.le_save_invoice_draft(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.le_apply_akonto_links(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.le_remove_akonto_link(uuid, uuid) to authenticated, service_role;
grant execute on function public.le_create_invoice_drafts(uuid[], uuid[], date, date, boolean, boolean, boolean)
  to authenticated, service_role;
grant execute on function public.le_create_akonto_invoice(uuid, uuid, numeric, numeric, date, date, text)
  to authenticated, service_role;
grant execute on function public.le_create_expense_invoices(uuid[]) to authenticated, service_role;
grant execute on function public.le_generate_recurring_drafts(uuid[]) to authenticated, service_role;
grant execute on function public.le_create_credit(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.le_finalize_dunning(uuid) to authenticated, service_role;
grant execute on function public.le_reserve_dunning_no(uuid) to authenticated, service_role;
grant execute on function public.le_create_dunning_drafts(uuid[]) to authenticated, service_role;
grant execute on function public.le_escalate_dunning(uuid) to authenticated, service_role;
grant execute on function public.le_update_number_sequence_settings(uuid, text, int, boolean)
  to authenticated, service_role;
