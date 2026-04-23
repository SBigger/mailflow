-- ══════════════════════════════════════════════════════════════════════
-- Migration: dok_tag_learnings
-- Zweck:     Keyword → Tag/Kunde Lern-Tabelle für die Massenablage
-- Datum:     2026-04-22
-- Branch:    feat/massenablage
--
-- ADDITIV: keine bestehende Tabelle wird verändert.
-- Kann jederzeit via `drop table dok_tag_learnings cascade;` entfernt werden.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists dok_tag_learnings (
  id           uuid primary key default gen_random_uuid(),

  -- das erkannte Stichwort im Dateiinhalt oder Dateinamen (immer lowercase gespeichert)
  keyword      text not null,

  -- was das Stichwort zuordnen soll
  tag_id       uuid references dok_tags(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  category     text,  -- spiegelt dokumente.category, optional

  -- Qualität des Learnings
  hits         integer not null default 1,         -- wie oft vom Nutzer bestätigt
  source       text    not null default 'user_correction',  -- 'user_correction' | 'ai_confirmed' | 'seed'
  confidence   numeric(3,2) default 1.00,           -- 0.00–1.00

  -- Metadaten
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  -- Mindestens eines muss gesetzt sein — sonst bringt das Learning nichts
  constraint dok_tag_learnings_has_target check (
    tag_id is not null or customer_id is not null or category is not null
  )
);

comment on table  dok_tag_learnings is 'Lern-Tabelle: Keyword→Tag/Kunde für Massenablage-KI. Additiv, nicht in Einzelupload-Flow eingebunden.';
comment on column dok_tag_learnings.keyword     is 'Stichwort aus Dateiinhalt/Dateiname, immer lowercase';
comment on column dok_tag_learnings.hits        is 'Wie oft der Vorschlag vom Nutzer bestätigt wurde — höhere Werte = verlässlicher';
comment on column dok_tag_learnings.source      is 'user_correction | ai_confirmed | seed';
comment on column dok_tag_learnings.confidence  is 'Geschätzte Zuverlässigkeit 0–1';

-- ── Indizes ───────────────────────────────────────────────────────────
-- Primärer Lookup: Keyword (case-insensitive)
create index if not exists dok_tag_learnings_keyword_idx
  on dok_tag_learnings (lower(keyword));

-- Sekundär: Kunden-spezifische Keywords bevorzugen
create index if not exists dok_tag_learnings_customer_idx
  on dok_tag_learnings (customer_id) where customer_id is not null;

-- ── RLS (Row-Level-Security) ──────────────────────────────────────────
-- Folgt dem Muster der bestehenden dokumente-Tabelle:
-- jeder eingeloggte Nutzer darf lesen/schreiben (keine Mandanten-Trennung).
alter table dok_tag_learnings enable row level security;

create policy "dok_tag_learnings_select_authenticated"
  on dok_tag_learnings for select
  to authenticated
  using (true);

create policy "dok_tag_learnings_insert_authenticated"
  on dok_tag_learnings for insert
  to authenticated
  with check (true);

create policy "dok_tag_learnings_update_authenticated"
  on dok_tag_learnings for update
  to authenticated
  using (true);

create policy "dok_tag_learnings_delete_authenticated"
  on dok_tag_learnings for delete
  to authenticated
  using (true);

-- ── Trigger: updated_at automatisch aktualisieren ─────────────────────
create or replace function dok_tag_learnings_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger dok_tag_learnings_updated_at
  before update on dok_tag_learnings
  for each row execute function dok_tag_learnings_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK (zum Kopieren, falls die Tabelle wieder weg soll):
--
--   drop trigger if exists dok_tag_learnings_updated_at on dok_tag_learnings;
--   drop function if exists dok_tag_learnings_set_updated_at();
--   drop table   if exists dok_tag_learnings cascade;
-- ══════════════════════════════════════════════════════════════════════
