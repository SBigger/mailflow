-- Telefonie-Rollout-Grundstein (2026-07-26): Zuordnung Mitarbeiter <->
-- peoplefone-vPBX-Benutzer. Gepflegt im neuen Einstellungen-Tab "Telefonie"
-- (Admin), Quelle der Auswahlliste ist live die Configuration API (Edge
-- Function telefonie-transfer, action "targets").
-- Kuenftige Nutzer dieser Zuordnung: peoplefone-Webhook (owner.identifier ->
-- profile fuer gezieltes targetUserId-Routing der Anruf-Karten), Keepalive
-- (eine Subscription je zugeordnetem Benutzer), Verbinden-Liste.
alter table public.profiles
  add column if not exists peoplefone_user_id text,
  add column if not exists internal_extension text;

comment on column public.profiles.peoplefone_user_id is
  'Numerische peoplefone-User-ID (vPBX-Benutzer, z.B. 163879) -- NICHT der SIP-Benutzername';
comment on column public.profiles.internal_extension is
  'Interne peoplefone-Nebenstelle (z.B. 20) -- Anzeige/Verbinden-Ziel';
