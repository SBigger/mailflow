-- ══════════════════════════════════════════════════════════════════════════
--  Zugriffsverwaltung — Gruppen + Mandanten-Zuordnung
--
--  ZWECK
--  1) Gruppen als wiederverwendbares Bündel: eine Gruppe kann eine Mitarbeiter-
--     Rolle vorgeben (staff_role) und/oder eine Menge von Kunden freigeben.
--  2) Ein Portal-Zugang darf ab jetzt MEHRERE Kunden sehen (bisher genau einen
--     über portal_users.customer_id).
--
--  SICHERHEITSMODELL (unverändert zu 20260708000001_kundenportal.sql)
--  Portal-Nutzer sind KEINE Supabase-Auth-User. Die effektive Kundenliste wird
--  ausschliesslich in der DB berechnet (portal_customer_ids) und von der Edge
--  Function `portal-api` mit service_role abgefragt. Damit gibt es genau EINE
--  Stelle, die entscheidet, wer welchen Kunden sieht — nicht zwei, die
--  auseinanderlaufen können.
--
--  BEWUSST NICHT ENTHALTEN
--  - Keine Gruppe „alle Kunden": für externe Portal-Nutzer wäre ein solcher
--    Schalter ein Einzeiler-Datenleck über alle Mandanten hinweg. Zugriff wird
--    immer explizit angehakt.
--  - Keine Mandanten-Einschränkung für Mitarbeiter ausserhalb der Fibu. Heute
--    sieht jeder authentifizierte Mitarbeiter alle Kunden; das umzustellen
--    berührt RLS auf sehr vielen Tabellen und gehört in eine eigene Welle.
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Gruppen ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  beschreibung text NOT NULL DEFAULT '',
  -- Für Mitarbeitergruppen: Rolle, die Mitglieder erhalten sollen.
  -- NULL = reine Kundengruppe (nur Mandanten-Bündel, keine Rollenwirkung).
  -- Werteliste muss zum profiles_role_check-Constraint passen
  -- (20260705100000_roles_foundation.sql).
  staff_role   text,
  aktiv        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_groups_staff_role_check
    CHECK (staff_role IS NULL OR staff_role IN
           ('admin','mandatsleiter','sachbearbeiter','readonly','task_user'))
);

CREATE UNIQUE INDEX IF NOT EXISTS access_groups_name_lower_uq
  ON public.access_groups (lower(name));

COMMENT ON TABLE  public.access_groups IS
  'Zugriffsgruppen. staff_role gesetzt = Mitarbeitergruppe (gibt Rolle vor); Kundenliste via access_group_customers.';
COMMENT ON COLUMN public.access_groups.staff_role IS
  'Rolle für Mitarbeiter-Mitglieder (muss zu profiles_role_check passen). NULL = reine Kundengruppe.';

CREATE OR REPLACE FUNCTION public.access_groups_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS access_groups_touch_trg ON public.access_groups;
CREATE TRIGGER access_groups_touch_trg
  BEFORE UPDATE ON public.access_groups
  FOR EACH ROW EXECUTE FUNCTION public.access_groups_touch();

-- 2) Welche Kunden gibt eine Gruppe frei ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_group_customers (
  group_id    uuid NOT NULL REFERENCES public.access_groups(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id)     ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);
CREATE INDEX IF NOT EXISTS access_group_customers_customer_idx
  ON public.access_group_customers (customer_id);

-- 3) Mitgliedschaften — zwei Tabellen, weil es zwei echte Subjekt-Tabellen gibt
--    (Mitarbeiter = auth.users, Kunden = portal_users). Ein polymorpher
--    subject_id ohne FK wäre kürzer, aber nicht referenzsicher.
CREATE TABLE IF NOT EXISTS public.access_group_staff (
  group_id   uuid NOT NULL REFERENCES public.access_groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS access_group_staff_user_idx ON public.access_group_staff (user_id);

CREATE TABLE IF NOT EXISTS public.access_group_portal (
  group_id       uuid NOT NULL REFERENCES public.access_groups(id)  ON DELETE CASCADE,
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id)   ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, portal_user_id)
);
CREATE INDEX IF NOT EXISTS access_group_portal_user_idx ON public.access_group_portal (portal_user_id);

-- 4) Direkte Häkchenliste pro Portal-Zugang (zusätzlich zu Gruppen) ──────────
CREATE TABLE IF NOT EXISTS public.portal_user_customers (
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES public.customers(id)    ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (portal_user_id, customer_id)
);
CREATE INDEX IF NOT EXISTS portal_user_customers_customer_idx
  ON public.portal_user_customers (customer_id);

COMMENT ON TABLE public.portal_user_customers IS
  'Direkt angehakte Kunden eines Portal-Zugangs. Ergänzt (nicht ersetzt) die Gruppenzugehörigkeit.';

-- 5) Bestandsdaten übernehmen: bisheriger Einzel-Mandant wird angehakt ───────
--    portal_users.customer_id bleibt bestehen (= Hauptmandant, Vorauswahl für
--    Upload/Chat) und zählt weiterhin immer zur effektiven Liste dazu.
INSERT INTO public.portal_user_customers (portal_user_id, customer_id)
SELECT pu.id, pu.customer_id
  FROM public.portal_users pu
 WHERE pu.customer_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.portal_users.customer_id IS
  'Hauptmandant (Vorauswahl für Upload/Chat). Sichtbarkeit ergibt sich aus portal_customer_ids(), nicht allein aus dieser Spalte.';

-- 6) DIE eine Stelle, die Sichtbarkeit entscheidet ───────────────────────────
-- RETURNS SETOF uuid (nicht RETURNS TABLE(customer_id …)): ein OUT-Parameter
-- namens customer_id würde im Rumpf mit den gleichnamigen Spalten kollidieren.
CREATE OR REPLACE FUNCTION public.portal_customer_ids(p_portal_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT x.customer_id FROM (
    -- a) Hauptmandant des Zugangs
    SELECT pu.customer_id
      FROM public.portal_users pu
     WHERE pu.id = p_portal_user_id AND pu.customer_id IS NOT NULL
    UNION
    -- b) direkt angehakte Kunden
    SELECT puc.customer_id
      FROM public.portal_user_customers puc
     WHERE puc.portal_user_id = p_portal_user_id
    UNION
    -- c) Kunden aus aktiven Gruppen
    SELECT gc.customer_id
      FROM public.access_group_portal m
      JOIN public.access_groups g       ON g.id = m.group_id AND g.aktiv
      JOIN public.access_group_customers gc ON gc.group_id = g.id
     WHERE m.portal_user_id = p_portal_user_id
  ) x
  -- Nur existierende Kunden; gesperrte Zugänge liefern gar nichts.
  WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.id = x.customer_id)
    AND EXISTS (SELECT 1 FROM public.portal_users pu2
                 WHERE pu2.id = p_portal_user_id AND pu2.is_active);
$$;

COMMENT ON FUNCTION public.portal_customer_ids(uuid) IS
  'Effektive Kundenliste eines Portal-Zugangs (Hauptmandant + direkte Häkchen + aktive Gruppen). Gesperrter Zugang = leer.';

REVOKE ALL ON FUNCTION public.portal_customer_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_customer_ids(uuid) TO authenticated, service_role;

-- 7) RLS ────────────────────────────────────────────────────────────────────
--    Lesen: alle Mitarbeiter. Ändern: nur admin/mandatsleiter
--    (can_manage_stammdaten() aus 20260705100000_roles_foundation.sql).
ALTER TABLE public.access_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_group_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_group_staff     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_group_portal    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_user_customers  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['access_groups','access_group_customers','access_group_staff',
                           'access_group_portal','portal_user_customers']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_staff_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_staff_write',  t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_staff_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.can_manage_stammdaten()) WITH CHECK (public.can_manage_stammdaten())',
      t || '_staff_write', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- 8) portal_users härten ─────────────────────────────────────────────────────
--    Bisher: FOR ALL USING(true) für jeden authenticated User — d.h. jeder
--    Mitarbeiter konnte Portal-Zugänge anlegen, umhängen und löschen. Lesen
--    bleibt offen, Ändern wird auf admin/mandatsleiter eingegrenzt.
DROP POLICY IF EXISTS "portal_users_staff_all"    ON public.portal_users;
DROP POLICY IF EXISTS "portal_users_staff_select" ON public.portal_users;
DROP POLICY IF EXISTS "portal_users_staff_write"  ON public.portal_users;

CREATE POLICY "portal_users_staff_select" ON public.portal_users
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "portal_users_staff_write" ON public.portal_users
  FOR ALL TO authenticated
  USING (public.can_manage_stammdaten())
  WITH CHECK (public.can_manage_stammdaten());
