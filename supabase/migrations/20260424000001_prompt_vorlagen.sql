create table if not exists public.prompt_vorlagen (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  titel       text not null,
  kategorie   text,
  inhalt      text not null
);

alter table public.prompt_vorlagen enable row level security;

create policy "authenticated full access" on public.prompt_vorlagen
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
