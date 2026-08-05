-- =====================================================================
-- Storage für Belege + Audit-Trigger
-- Migration: 20260804220000
--
-- Belege sind Steuerdokumente. Der Bucket ist privat, und der Zugriff
-- läuft über dieselbe Mandantenlogik wie die Tabellen: der erste Ordner
-- im Pfad ist die mandant_id.
--
-- Pfadkonvention:  <mandant_id>/<deklaration_id>/<beleg_id>-<dateiname>
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('belege', 'belege', false)
ON CONFLICT (id) DO NOTHING;

-- Der erste Pfadsegment ist die mandant_id — daran hängt die Berechtigung.
CREATE OR REPLACE FUNCTION storage_mandant_ok(objektname TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  erster TEXT;
BEGIN
  erster := split_part(objektname, '/', 1);
  -- Kein gültiges UUID im ersten Segment → kein Zugriff, statt zu werfen
  IF erster !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN false;
  END IF;
  RETURN erster::uuid = ANY(mandant_ids_for_user());
END;
$$;

DROP POLICY IF EXISTS belege_read   ON storage.objects;
DROP POLICY IF EXISTS belege_insert ON storage.objects;
DROP POLICY IF EXISTS belege_update ON storage.objects;
DROP POLICY IF EXISTS belege_delete ON storage.objects;

CREATE POLICY belege_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'belege' AND storage_mandant_ok(name));

CREATE POLICY belege_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'belege' AND storage_mandant_ok(name));

CREATE POLICY belege_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'belege' AND storage_mandant_ok(name));

-- Löschen bewusst nur für Admins: ein Beleg, der einmal im Dossier war,
-- verschwindet nicht auf Zuruf.
CREATE POLICY belege_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'belege'
    AND storage_mandant_ok(name)
    AND darf_einreichen(split_part(name, '/', 1)::uuid)
  );

-- ── Audit-Trigger ─────────────────────────────────────────────────
-- Der Audit-Trail darf nicht davon abhängen, dass die App daran denkt.
-- Deshalb schreiben Trigger mit, nicht das Frontend.

CREATE OR REPLACE FUNCTION audit_schreiben()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  dek_id UUID;
  m_id   UUID;
BEGIN
  IF TG_TABLE_NAME = 'deklarationen' THEN
    dek_id := COALESCE(NEW.id, OLD.id);
  ELSE
    dek_id := COALESCE(NEW.deklaration_id, OLD.deklaration_id);
  END IF;
  m_id := COALESCE(NEW.mandant_id, OLD.mandant_id);

  INSERT INTO audit_log (mandant_id, deklaration_id, user_id, aktion, entitaet, entitaet_id, alt, neu)
  VALUES (
    m_id,
    dek_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER deklarationen_audit
  AFTER INSERT OR UPDATE OR DELETE ON deklarationen
  FOR EACH ROW EXECUTE FUNCTION audit_schreiben();

CREATE TRIGGER belege_audit
  AFTER INSERT OR UPDATE OR DELETE ON belege
  FOR EACH ROW EXECUTE FUNCTION audit_schreiben();

CREATE TRIGGER positionen_audit
  AFTER INSERT OR UPDATE OR DELETE ON positionen
  FOR EACH ROW EXECUTE FUNCTION audit_schreiben();

CREATE TRIGGER einreichungen_audit
  AFTER INSERT ON einreichungen
  FOR EACH ROW EXECUTE FUNCTION audit_schreiben();

-- ── Erster Mandant beim Onboarding ────────────────────────────────
-- Ohne Zugriffszeile sieht ein neuer Nutzer nichts und kann sich auch
-- keine anlegen (mandanten hat nur eine SELECT-Policy). Diese Funktion
-- legt Mandant und Zugriff in einem Schritt an — als SECURITY DEFINER,
-- damit sie die Policies nicht umgehen muss, sondern gar nicht erst
-- daran scheitert.
CREATE OR REPLACE FUNCTION mandant_anlegen(p_name TEXT, p_uid TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  neu_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet';
  END IF;
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'Mandantenname darf nicht leer sein';
  END IF;

  INSERT INTO mandanten (name, uid) VALUES (TRIM(p_name), NULLIF(TRIM(p_uid), ''))
  RETURNING id INTO neu_id;

  INSERT INTO user_mandant_access (user_id, mandant_id, role)
  VALUES (auth.uid(), neu_id, 'admin');

  RETURN neu_id;
END;
$$;

REVOKE ALL ON FUNCTION mandant_anlegen(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mandant_anlegen(TEXT, TEXT) TO authenticated;
