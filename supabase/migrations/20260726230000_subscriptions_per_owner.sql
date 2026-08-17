-- Rollout-Vorbereitung 2026-07-26: ab jetzt gibt es eine peoplefone-
-- Subscription PRO Mitarbeitendem (bisher genau eine, fest fuer Sascha).
-- Die Spalte ordnet jede Subscription ihrem vPBX-Benutzer zu, damit der
-- Keepalive je Person aufraeumen und erneuern kann.
alter table public.telefonie_subscriptions
  add column if not exists peoplefone_user_id text;

comment on column public.telefonie_subscriptions.peoplefone_user_id is
  'Numerische peoplefone-User-ID des Besitzers (profiles.peoplefone_user_id)';

-- Bestehende Zeilen gehoerten alle Sascha (einziger registrierter Benutzer
-- bis zu dieser Migration) -- ohne diese Zuordnung wuerde der neue Keepalive
-- sie nie mehr aufraeumen.
update public.telefonie_subscriptions
   set peoplefone_user_id = '163879'
 where peoplefone_user_id is null;

create index if not exists idx_telefonie_subscriptions_owner_open
  on public.telefonie_subscriptions (peoplefone_user_id, created_at)
  where cleaned_up_at is null;
