-- =====================================================================
-- Leistungserfassung · Status-Erweiterung "Kulant" + Lock
-- =====================================================================
-- Neue Status-Werte:
--   kulant              → wird erfasst aber NICHT abgerechnet (Gutwillen)
--   kulant_abgerechnet  → kulanter Eintrag wurde mit auf der Rechnung
--                          ausgewiesen (zur Info/Transparenz, ohne Wert)
--
-- Bestehende Werte bleiben:
--   erfasst (= Default beim Erfassen, abrechenbar)
--   freigegeben
--   verrechnet (= abgerechnet, abrechenbar wurde verrechnet)
--   storniert
-- =====================================================================

-- Neue Enum-Werte
do $$ begin
  if not exists (select 1 from pg_enum where enumtypid = 'le_time_entry_status'::regtype and enumlabel = 'kulant') then
    alter type le_time_entry_status add value 'kulant';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum where enumtypid = 'le_time_entry_status'::regtype and enumlabel = 'kulant_abgerechnet') then
    alter type le_time_entry_status add value 'kulant_abgerechnet';
  end if;
end $$;

-- =====================================================================
-- le_invoice_line · is_kulant flag (separater Beiblatt-Bereich auf PDF)
-- =====================================================================
alter table public.le_invoice_line
  add column if not exists is_kulant boolean not null default false;

create index if not exists idx_le_invoice_line_kulant
  on public.le_invoice_line(invoice_id)
  where is_kulant = true;

-- =====================================================================
-- LOCK: abgerechnete Time-Entries dürfen nicht mehr verändert werden
-- (außer Status-Reset via Storno → erlaubt durch Service-Role Bypass)
-- =====================================================================
create or replace function public.le_block_locked_time_entry()
returns trigger language plpgsql as $$
begin
  -- Erlaubt: Status-Reset via Storno (geht zurück auf 'erfasst' / 'kulant')
  if (tg_op = 'UPDATE') and old.status in ('verrechnet', 'kulant_abgerechnet')
     and new.status not in ('verrechnet', 'kulant_abgerechnet') then
    return new;  -- Storno-Reset durchlassen
  end if;

  if (tg_op = 'UPDATE') and old.status in ('verrechnet', 'kulant_abgerechnet') then
    raise exception 'Eintrag vom %.%.% (% h, %) ist bereits abgerechnet (%) und kann nicht mehr verändert werden. Bitte stattdessen die zugehörige Rechnung stornieren.',
      extract(day from old.entry_date), extract(month from old.entry_date), extract(year from old.entry_date),
      old.hours_internal, old.description, old.status;
  end if;

  if (tg_op = 'DELETE') and old.status in ('verrechnet', 'kulant_abgerechnet') then
    raise exception 'Eintrag vom %.%.% (% h, %) ist bereits abgerechnet (%) und kann nicht gelöscht werden.',
      extract(day from old.entry_date), extract(month from old.entry_date), extract(year from old.entry_date),
      old.hours_internal, old.description, old.status;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_le_time_entry_lock_billed on public.le_time_entry;
create trigger trg_le_time_entry_lock_billed
  before update or delete on public.le_time_entry
  for each row execute function public.le_block_locked_time_entry();
