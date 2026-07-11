-- ══════════════════════════════════════════════════════════════════════════
--  Kundenportal — Fundament
--  Read-only Dokumentenzugang für Kunden (Ansehen + Download, kein Ändern).
--
--  SICHERHEITSMODELL:
--  Portal-Nutzer sind KEINE Supabase-Auth-User. Der gesamte Zugriff läuft über
--  die Edge Function `portal-api` mit service_role. Diese Tabellen sind per RLS
--  für anon/authenticated komplett dicht → kein Einfluss auf bestehendes RLS.
--  Mitarbeiter (authenticated) dürfen nur die Verwaltungstabelle portal_users
--  + das Audit lesen/pflegen; Tokens/Sessions bleiben ausschließlich service_role.
-- ══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Portal-Nutzer (E-Mail steuert den Zugang) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  vorname       text NOT NULL DEFAULT '',
  nachname      text NOT NULL DEFAULT '',
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  is_active     boolean NOT NULL DEFAULT true,
  invited_by    uuid,                              -- auth.uid() des einladenden Mitarbeiters
  invited_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- E-Mail ist der Login-Schlüssel → case-insensitive eindeutig
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_email_lower_uq
  ON public.portal_users (lower(email));
CREATE INDEX IF NOT EXISTS portal_users_customer_idx
  ON public.portal_users (customer_id);

COMMENT ON TABLE  public.portal_users IS 'Kundenportal-Zugänge. E-Mail = Login. Sieht read-only alle Dokumente des customer_id (Mandant).';
COMMENT ON COLUMN public.portal_users.is_active IS 'false = sofort gesperrt, kein Login mehr möglich.';

-- updated_at automatisch pflegen
CREATE OR REPLACE FUNCTION public.portal_users_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS portal_users_touch_trg ON public.portal_users;
CREATE TRIGGER portal_users_touch_trg
  BEFORE UPDATE ON public.portal_users
  FOR EACH ROW EXECUTE FUNCTION public.portal_users_touch();

-- 2) Magic-Link-Tokens (Einmal-Login per E-Mail) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_magic_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,                    -- SHA-256 des Tokens; Klartext geht nur per Mail raus
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_magic_tokens_hash_idx ON public.portal_magic_tokens (token_hash);
CREATE INDEX IF NOT EXISTS portal_magic_tokens_user_idx ON public.portal_magic_tokens (portal_user_id);
COMMENT ON TABLE public.portal_magic_tokens IS 'Einmal-Login-Tokens (15 Min gültig). Nur SHA-256-Hash gespeichert.';

-- 3) Portal-Sessions (nach erfolgreichem Magic-Link) ────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,                    -- SHA-256 des Session-Tokens
  expires_at     timestamptz NOT NULL,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_sessions_hash_idx ON public.portal_sessions (token_hash);
CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON public.portal_sessions (portal_user_id);
COMMENT ON TABLE public.portal_sessions IS 'Aktive Portal-Sessions. Token nur als SHA-256-Hash.';

-- 4) Append-only Audit (wer hat wann was angesehen/heruntergeladen) ──────────
CREATE TABLE IF NOT EXISTS public.portal_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portal_user_id uuid,
  email          text,
  action         text NOT NULL,                    -- 'login' | 'list' | 'view' | 'download'
  doc_id         uuid,
  detail         text,
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_audit_user_idx ON public.portal_audit (portal_user_id, created_at DESC);
COMMENT ON TABLE public.portal_audit IS 'Append-only Zugriffsprotokoll Kundenportal.';

-- 5) RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.portal_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_magic_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_audit        ENABLE ROW LEVEL SECURITY;

-- portal_users: Mitarbeiter (authenticated) dürfen verwalten.
-- (Alle authenticated-User dieses Projekts sind Artis-Mitarbeiter; Kunden sind
--  KEINE Auth-User.) service_role umgeht RLS ohnehin (Edge Function).
DROP POLICY IF EXISTS "portal_users_staff_all" ON public.portal_users;
CREATE POLICY "portal_users_staff_all" ON public.portal_users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Audit: Mitarbeiter dürfen lesen; niemand (ausser service_role) darf ändern/löschen.
DROP POLICY IF EXISTS "portal_audit_staff_select" ON public.portal_audit;
CREATE POLICY "portal_audit_staff_select" ON public.portal_audit
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.portal_audit FROM anon, authenticated;

-- Tokens + Sessions: KEINE Policy für anon/authenticated → nur service_role.
REVOKE ALL ON public.portal_magic_tokens FROM anon, authenticated;
REVOKE ALL ON public.portal_sessions     FROM anon, authenticated;

-- 6) Aufräum-Helper: abgelaufene Tokens/Sessions (per Cron oder Edge Function) ─
CREATE OR REPLACE FUNCTION public.portal_cleanup_expired()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.portal_magic_tokens WHERE expires_at < now() - interval '1 day';
  DELETE FROM public.portal_sessions     WHERE expires_at < now() - interval '1 day';
$$;

COMMENT ON FUNCTION public.portal_cleanup_expired() IS 'Löscht abgelaufene Portal-Tokens/Sessions (>1 Tag alt).';
