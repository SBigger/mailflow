


SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."abschluss_status" AS ENUM (
    'in_arbeit',
    'abgeschlossen',
    'genehmigt'
);


ALTER TYPE "public"."abschluss_status" OWNER TO "postgres";


CREATE TYPE "public"."le_absence_category" AS ENUM (
    'ferien',
    'krankheit',
    'unfall',
    'militaer',
    'mutterschaft',
    'vaterschaft',
    'weiterbildung',
    'unbezahlt',
    'kurzabsenz',
    'kompensation',
    'feiertag'
);


ALTER TYPE "public"."le_absence_category" OWNER TO "postgres";


CREATE TYPE "public"."le_absence_status" AS ENUM (
    'beantragt',
    'genehmigt',
    'abgelehnt',
    'storniert'
);


ALTER TYPE "public"."le_absence_status" OWNER TO "postgres";


CREATE TYPE "public"."le_dunning_status" AS ENUM (
    'entwurf',
    'versendet',
    'bezahlt',
    'eskaliert'
);


ALTER TYPE "public"."le_dunning_status" OWNER TO "postgres";


CREATE TYPE "public"."le_expense_category" AS ENUM (
    'km',
    'oev',
    'verpflegung',
    'uebernachtung',
    'telefon',
    'material',
    'weiterbildung',
    'repraesentation',
    'behoerden',
    'sonstiges'
);


ALTER TYPE "public"."le_expense_category" OWNER TO "postgres";


CREATE TYPE "public"."le_expense_status" AS ENUM (
    'entwurf',
    'eingereicht',
    'genehmigt',
    'abgelehnt',
    'abgerechnet'
);


ALTER TYPE "public"."le_expense_status" OWNER TO "postgres";


CREATE TYPE "public"."le_invoice_section" AS ENUM (
    'honorar',
    'spesen',
    'drittleistungen',
    'kulant'
);


ALTER TYPE "public"."le_invoice_section" OWNER TO "postgres";


CREATE TYPE "public"."le_invoice_status" AS ENUM (
    'entwurf',
    'definitiv',
    'versendet',
    'bezahlt',
    'storniert'
);


ALTER TYPE "public"."le_invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."le_invoice_type" AS ENUM (
    'normal',
    'akonto',
    'schluss',
    'gutschrift'
);


ALTER TYPE "public"."le_invoice_type" OWNER TO "postgres";


CREATE TYPE "public"."le_payment_source" AS ENUM (
    'manual',
    'camt054',
    'camt053',
    'esr'
);


ALTER TYPE "public"."le_payment_source" OWNER TO "postgres";


CREATE TYPE "public"."le_project_billing_mode" AS ENUM (
    'effektiv',
    'pauschal'
);


ALTER TYPE "public"."le_project_billing_mode" OWNER TO "postgres";


CREATE TYPE "public"."le_project_status" AS ENUM (
    'offen',
    'archiviert'
);


ALTER TYPE "public"."le_project_status" OWNER TO "postgres";


CREATE TYPE "public"."le_rate_mode" AS ENUM (
    'service_type',
    'employee',
    'employee_group',
    'special'
);


ALTER TYPE "public"."le_rate_mode" OWNER TO "postgres";


CREATE TYPE "public"."le_recurring_cycle" AS ENUM (
    'monthly',
    'quarterly',
    'semi',
    'yearly',
    'custom'
);


ALTER TYPE "public"."le_recurring_cycle" OWNER TO "postgres";


CREATE TYPE "public"."le_time_entry_status" AS ENUM (
    'erfasst',
    'freigegeben',
    'verrechnet',
    'storniert',
    'kulant',
    'kulant_abgerechnet'
);


ALTER TYPE "public"."le_time_entry_status" OWNER TO "postgres";


CREATE TYPE "public"."le_vat_mode" AS ENUM (
    'inland',
    'export',
    'manuell'
);


ALTER TYPE "public"."le_vat_mode" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_fibu_mwst_perioden_set_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."_fibu_mwst_perioden_set_updated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."call_notes_pending_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."call_notes_pending_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."call_records_protect_manual_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Wenn bestehender Record manuell zugeordnet war
  -- UND der neue Update will das ändern (aber customer_id_manual nicht selbst auf false setzt),
  -- dann halte die alte Zuordnung fest.
  IF OLD.customer_id_manual = TRUE
     AND NEW.customer_id_manual = TRUE
     AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    NEW.customer_id := OLD.customer_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."call_records_protect_manual_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."call_records_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."call_records_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dok_tag_learnings_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."dok_tag_learnings_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) RETURNS "tsvector"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT
    setweight(to_tsvector('german', coalesce(p_name,     '')), 'A') ||
    setweight(to_tsvector('german', coalesce(p_filename, '')), 'B') ||
    setweight(to_tsvector('german', coalesce(p_notes,    '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(p_category, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(p_year::TEXT, '')), 'D');
$$;


ALTER FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dokumente_update_search_vector"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.search_vector :=
    dokumente_build_search_vector(NEW.name, NEW.filename, NEW.notes, NEW.category, NEW.year)
    || setweight(to_tsvector('german', coalesce(NEW.content_text, '')), 'C');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."dokumente_update_search_vector"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_bank_match_kreditor"("p_tx_id" "uuid", "p_beleg_id" "uuid", "p_betrag" numeric, "p_datum" "date", "p_confidence" numeric, "p_methode" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_lauf_id UUID;
BEGIN
  -- TX als gematcht markieren
  UPDATE fibu_bank_transaktionen SET
    status           = 'gematcht',
    matched_beleg_id = p_beleg_id,
    matched_typ      = 'kreditor',
    match_confidence = p_confidence,
    match_methode    = p_methode
  WHERE id = p_tx_id;

  -- Kreditoren-Beleg: bezahlt_am + status aktualisieren
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_betrag,
    bezahlt_am     = p_datum,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_betrag >= betrag_brutto THEN 'bezahlt'
      ELSE 'teilbezahlt'
    END
  WHERE id = p_beleg_id;

  -- Passende offene Zahlungslauf-Position rückmelden
  -- (bevorzugt betragsgleiche Position, sonst älteste offene)
  WITH kandidat AS (
    SELECT zlp.id
    FROM fibu_zahlungslauf_positionen zlp
    JOIN fibu_zahlungslaeufe zl ON zl.id = zlp.zahlungslauf_id
    WHERE zlp.beleg_id = p_beleg_id AND NOT zlp.rueckgemeldet
    ORDER BY (ABS(zlp.betrag - p_betrag) < 0.05) DESC, zl.created_at ASC
    LIMIT 1
  )
  UPDATE fibu_zahlungslauf_positionen zlp
  SET rueckgemeldet = true, rueckgemeldet_am = NOW(), bank_tx_id = p_tx_id
  FROM kandidat WHERE zlp.id = kandidat.id;

  -- Betroffene Läufe: verbucht sobald alle Positionen rückgemeldet sind
  FOR v_lauf_id IN
    SELECT DISTINCT zahlungslauf_id
    FROM fibu_zahlungslauf_positionen
    WHERE beleg_id = p_beleg_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM fibu_zahlungslauf_positionen
      WHERE zahlungslauf_id = v_lauf_id AND NOT rueckgemeldet
    ) THEN
      UPDATE fibu_zahlungslaeufe
      SET status = 'verbucht', verbucht_am = NOW()
      WHERE id = v_lauf_id AND status <> 'verbucht';
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fibu_bank_match_kreditor"("p_tx_id" "uuid", "p_beleg_id" "uuid", "p_betrag" numeric, "p_datum" "date", "p_confidence" numeric, "p_methode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_beleg_freigeben"("p_beleg_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mandant UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_mandant IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_mandant = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_kreditoren_belege
  SET freigabe_status = 'freigegeben',
      freigegeben_am  = NOW(),
      freigegeben_von = auth.uid(),
      updated_at      = NOW()
  WHERE id = p_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_beleg_freigeben"("p_beleg_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_bilanz"("p_mandant_id" "uuid", "p_stichtag" "date") RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "konto_typ" "text", "saldo" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    ROUND(COALESCE(SUM(
      CASE
        WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
        WHEN b.konto_haben = k.konto_nr THEN -b.betrag
        ELSE 0
      END
    ), 0), 2) AS saldo
  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum <= p_stichtag
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
    AND k.konto_typ IN ('aktiv', 'passiv')
    AND k.aktiv = true
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  HAVING ROUND(COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
      WHEN b.konto_haben = k.konto_nr THEN -b.betrag
      ELSE 0
    END
  ), 0), 2) <> 0
  ORDER BY k.konto_nr;
$$;


ALTER FUNCTION "public"."fibu_bilanz"("p_mandant_id" "uuid", "p_stichtag" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_buchung_mwst_code_aendern"("p_mandant_id" "uuid", "p_buchungs_nr" "text", "p_mwst_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE fibu_buchungen
  SET mwst_code = p_mwst_code
  WHERE mandant_id = p_mandant_id
    AND buchungs_nr = p_buchungs_nr;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung % nicht gefunden', p_buchungs_nr;
  END IF;
END;
$$;


ALTER FUNCTION "public"."fibu_buchung_mwst_code_aendern"("p_mandant_id" "uuid", "p_buchungs_nr" "text", "p_mwst_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_buchung_serie_erzeugen"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_s        fibu_buchung_serien;
  v_periode  INTEGER;
  v_pro      NUMERIC;
  v_betrag   NUMERIC;
  v_text     TEXT;
  v_beleg_id UUID;
BEGIN
  SELECT * INTO v_s FROM fibu_buchung_serien WHERE id = p_id;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Buchungsserie nicht gefunden';
  END IF;
  IF NOT (v_s.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_s.erzeugt_anzahl >= v_s.anzahl_perioden THEN
    RAISE EXCEPTION 'Serie „%" ist vollständig erzeugt', v_s.bezeichnung;
  END IF;

  v_periode := v_s.erzeugt_anzahl + 1;
  v_pro     := ROUND(v_s.betrag_total / v_s.anzahl_perioden, 2);
  -- letzte Periode nimmt den Rundungsrest → Summe = Gesamtbetrag
  IF v_periode < v_s.anzahl_perioden THEN
    v_betrag := v_pro;
  ELSE
    v_betrag := v_s.betrag_total - v_pro * (v_s.anzahl_perioden - 1);
  END IF;
  v_text := v_s.bezeichnung || ' (' || v_periode || '/' || v_s.anzahl_perioden || ')';

  v_beleg_id := fibu_manuelle_buchung_erstellen(
    v_s.mandant_id, v_s.naechstes_datum, v_text, NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_s.konto_soll, 'konto_haben', v_s.konto_haben,
      'betrag', v_betrag, 'text', v_text)));

  UPDATE fibu_buchung_serien SET
    erzeugt_anzahl   = v_periode,
    letzte_erzeugung = v_s.naechstes_datum,
    naechstes_datum  = (v_s.naechstes_datum + CASE intervall
        WHEN 'monatlich' THEN INTERVAL '1 month'
        WHEN 'quartal'   THEN INTERVAL '3 months'
        ELSE INTERVAL '1 year' END)::DATE,
    aktiv            = (v_periode < v_s.anzahl_perioden),
    updated_at       = NOW()
  WHERE id = p_id;

  RETURN v_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_buchung_serie_erzeugen"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_buchung_serien_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id    UUID;
  v_s     fibu_buchung_serien;
  v_count INTEGER := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR v_id IN
    SELECT id FROM fibu_buchung_serien
    WHERE mandant_id = p_mandant_id AND aktiv AND naechstes_datum <= p_bis
  LOOP
    LOOP
      SELECT * INTO v_s FROM fibu_buchung_serien WHERE id = v_id;
      EXIT WHEN NOT v_s.aktiv OR v_s.naechstes_datum > p_bis
                OR v_s.erzeugt_anzahl >= v_s.anzahl_perioden;
      PERFORM fibu_buchung_serie_erzeugen(v_id);
      v_count := v_count + 1;
      EXIT WHEN v_count > 500;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."fibu_buchung_serien_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_buchungssperre_setzen"("p_mandant_id" "uuid", "p_datum" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_mandanten SET gesperrt_bis = p_datum WHERE id = p_mandant_id;
END;
$$;


ALTER FUNCTION "public"."fibu_buchungssperre_setzen"("p_mandant_id" "uuid", "p_datum" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_budget_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_zeilen" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  z JSONB;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR z IN SELECT * FROM jsonb_array_elements(p_zeilen)
  LOOP
    INSERT INTO fibu_budget (mandant_id, jahr, konto_nr, betrag, updated_at)
    VALUES (p_mandant_id, p_jahr, z->>'konto_nr',
            COALESCE(NULLIF(z->>'betrag', '')::NUMERIC, 0), NOW())
    ON CONFLICT (mandant_id, jahr, konto_nr)
    DO UPDATE SET betrag = EXCLUDED.betrag, updated_at = NOW();
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fibu_budget_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_zeilen" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_budget_uebersicht"("p_mandant_id" "uuid", "p_jahr" integer) RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "konto_typ" "text", "ist_vj2" numeric, "ist_vj1" numeric, "budget" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH konten AS (
    SELECT k.konto_nr, k.bezeichnung, k.konto_typ
    FROM fibu_konten k
    WHERE k.mandant_id = p_mandant_id
      AND k.konto_typ IN ('ertrag', 'aufwand')
      AND k.aktiv
  ),
  bew AS (
    SELECT k.konto_nr,
           EXTRACT(YEAR FROM b.buchungsdatum)::INT AS jahr,
           k.konto_typ,
           SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END) AS soll,
           SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END) AS haben
    FROM konten k
    JOIN fibu_buchungen b
      ON (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
     AND b.mandant_id = p_mandant_id
     AND NOT b.storniert
     AND EXTRACT(YEAR FROM b.buchungsdatum) IN (p_jahr - 1, p_jahr - 2)
    GROUP BY k.konto_nr, EXTRACT(YEAR FROM b.buchungsdatum), k.konto_typ
  ),
  saldo AS (
    SELECT konto_nr, jahr,
           CASE WHEN konto_typ = 'ertrag' THEN haben - soll ELSE soll - haben END AS wert
    FROM bew
  )
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    COALESCE((SELECT wert FROM saldo s WHERE s.konto_nr = k.konto_nr AND s.jahr = p_jahr - 2), 0),
    COALESCE((SELECT wert FROM saldo s WHERE s.konto_nr = k.konto_nr AND s.jahr = p_jahr - 1), 0),
    COALESCE((SELECT bg.betrag FROM fibu_budget bg
               WHERE bg.mandant_id = p_mandant_id AND bg.jahr = p_jahr
                 AND bg.konto_nr = k.konto_nr), 0)
  FROM konten k
  ORDER BY k.konto_nr;
$$;


ALTER FUNCTION "public"."fibu_budget_uebersicht"("p_mandant_id" "uuid", "p_jahr" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_check_buchung_mwst_periode"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status TEXT;
  v_mid    UUID;
  v_datum  DATE;
BEGIN
  v_mid   := COALESCE(NEW.mandant_id, OLD.mandant_id);
  v_datum := COALESCE(NEW.buchungsdatum, OLD.buchungsdatum);

  SELECT status INTO v_status
  FROM fibu_mwst_abrechnungsperioden
  WHERE mandant_id = v_mid
    AND v_datum BETWEEN periode_von AND periode_bis
    AND status IN ('eingereicht', 'abgerechnet')
  LIMIT 1;

  IF v_status IS NOT NULL THEN
    RAISE EXCEPTION
      'MWST_PERIODE_GESPERRT: Buchungsdatum % liegt in einer gesperrten Periode (Status: %). Zuerst Periode zurücksetzen.',
      v_datum, v_status
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fibu_check_buchung_mwst_periode"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_check_buchungssperre"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_sperre  DATE;
  v_mandant UUID;
  v_datum   DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_mandant := OLD.mandant_id; v_datum := OLD.buchungsdatum;
  ELSE
    v_mandant := NEW.mandant_id; v_datum := NEW.buchungsdatum;
  END IF;

  SELECT gesperrt_bis INTO v_sperre FROM fibu_mandanten WHERE id = v_mandant;
  IF v_sperre IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_datum <= v_sperre THEN
    RAISE EXCEPTION 'Buchungssperre aktiv: Das Datum % liegt in der gesperrten Periode (gesperrt bis %).', v_datum, v_sperre
      USING ERRCODE = 'check_violation';
  END IF;
  -- Beim Verschieben einer Buchung aus der Sperre heraus: altes Datum prüfen
  IF TG_OP = 'UPDATE' AND OLD.buchungsdatum <= v_sperre THEN
    RAISE EXCEPTION 'Buchungssperre aktiv: Die Buchung vom % ist gesperrt.', OLD.buchungsdatum
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


ALTER FUNCTION "public"."fibu_check_buchungssperre"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_create_mandant"("p_name" "text", "p_uid" "text" DEFAULT NULL::"text", "p_mwst_nr" "text" DEFAULT NULL::"text", "p_ort" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_mandant_id UUID;
  v_user_id    UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'fibu_create_mandant: Nicht authentifiziert (auth.uid() ist NULL)';
  END IF;

  -- 1. Mandant anlegen
  INSERT INTO fibu_mandanten (name, uid, mwst_nr, ort)
  VALUES (
    p_name,
    NULLIF(TRIM(p_uid), ''),
    NULLIF(TRIM(p_mwst_nr), ''),
    NULLIF(TRIM(p_ort), '')
  )
  RETURNING id INTO v_mandant_id;

  -- 2. User als Admin eintragen
  INSERT INTO fibu_user_mandant_access (mandant_id, user_id, role)
  VALUES (v_mandant_id, v_user_id, 'admin');

  -- 3. Kontenplan seeden (~85 Konten)
  PERFORM fibu_seed_kontenplan_ch_kmu(v_mandant_id);

  -- 4. MWST-Codes seeden
  PERFORM fibu_seed_mwst_codes(v_mandant_id);

  RETURN v_mandant_id;
END;
$$;


ALTER FUNCTION "public"."fibu_create_mandant"("p_name" "text", "p_uid" "text", "p_mwst_nr" "text", "p_ort" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_dauerbeleg_erzeugen"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_t        fibu_kreditoren_dauerbelege;
  v_satz     NUMERIC;
  v_netto    NUMERIC;
  v_mwst     NUMERIC;
  v_year     TEXT;
  v_last     TEXT;
  v_num      INTEGER;
  v_nr       TEXT;
  v_beleg_id UUID;
BEGIN
  SELECT * INTO v_t FROM fibu_kreditoren_dauerbelege WHERE id = p_id;
  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'Dauerbeleg nicht gefunden';
  END IF;
  IF NOT (v_t.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  SELECT satz INTO v_satz
  FROM fibu_mwst_codes WHERE mandant_id = v_t.mandant_id AND code = v_t.mwst_code;
  v_satz  := COALESCE(v_satz, 0);
  v_netto := ROUND(v_t.betrag_brutto / (1 + v_satz / 100), 2);
  v_mwst  := v_t.betrag_brutto - v_netto;

  -- Beleg-Nr.  DR-YYYY-NNNN
  v_year := TO_CHAR(v_t.naechstes_belegdatum, 'YYYY');
  SELECT beleg_nr INTO v_last
  FROM fibu_kreditoren_belege
  WHERE mandant_id = v_t.mandant_id AND beleg_nr LIKE 'DR-' || v_year || '-%'
  ORDER BY beleg_nr DESC LIMIT 1;
  v_num := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER, 0) + 1;
  v_nr  := 'DR-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');

  INSERT INTO fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, belegdatum, faelligkeit,
    zahlungsbedingung_tage, waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_t.mandant_id, v_nr, v_t.lieferant_id, v_t.naechstes_belegdatum,
    v_t.naechstes_belegdatum + v_t.zahlungsbedingung_tage,
    v_t.zahlungsbedingung_tage, v_t.waehrung, v_netto, v_mwst, v_t.betrag_brutto,
    'rechnung', 'offen', 'Wiederkehrend: ' || v_t.bezeichnung, auth.uid()
  ) RETURNING id INTO v_beleg_id;

  INSERT INTO fibu_kreditoren_positionen (
    mandant_id, beleg_id, position, konto_nr, bezeichnung,
    mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  ) VALUES (
    v_t.mandant_id, v_beleg_id, 1, v_t.konto_nr, v_t.bezeichnung,
    v_t.mwst_code, v_satz, v_netto, v_mwst, v_t.betrag_brutto
  );

  PERFORM fibu_kreditoren_verbuchen(v_beleg_id);

  UPDATE fibu_kreditoren_dauerbelege SET
    naechstes_belegdatum = (naechstes_belegdatum + CASE intervall
      WHEN 'monatlich' THEN INTERVAL '1 month'
      WHEN 'quartal'   THEN INTERVAL '3 months'
      WHEN 'halbjahr'  THEN INTERVAL '6 months'
      ELSE INTERVAL '1 year' END)::DATE,
    letzte_erzeugung = v_t.naechstes_belegdatum,
    updated_at = NOW()
  WHERE id = p_id;

  RETURN v_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_dauerbeleg_erzeugen"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_dauerbelege_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id    UUID;
  v_datum DATE;
  v_count INTEGER := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  FOR v_id IN
    SELECT id FROM fibu_kreditoren_dauerbelege
    WHERE mandant_id = p_mandant_id AND aktiv AND naechstes_belegdatum <= p_bis
  LOOP
    LOOP
      SELECT naechstes_belegdatum INTO v_datum
      FROM fibu_kreditoren_dauerbelege WHERE id = v_id;
      EXIT WHEN v_datum > p_bis;
      PERFORM fibu_dauerbeleg_erzeugen(v_id);
      v_count := v_count + 1;
      EXIT WHEN v_count > 200;   -- Sicherung gegen Endlosschleife
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."fibu_dauerbelege_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_delete_kreditoren_beleg"("p_beleg_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_beleg fibu_kreditoren_belege%ROWTYPE;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;

  IF NOT (fibu_user_is_admin_for(v_beleg.mandant_id) OR EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE mandant_id = v_beleg.mandant_id
      AND user_id = auth.uid()
      AND role IN ('admin','buchhalter')
  )) THEN
    RAISE EXCEPTION 'Keine Berechtigung';
  END IF;

  IF v_beleg.status IN ('bezahlt','teilbezahlt','ebanking') THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – Zahlung bereits verbucht oder in Disposition (Status: %)', v_beleg.status;
  END IF;
  IF COALESCE(v_beleg.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – Zahlung bereits verbucht (CHF %)', v_beleg.betrag_bezahlt;
  END IF;
  IF v_beleg.mwst_abgerechnet THEN
    RAISE EXCEPTION 'Beleg kann nicht gelöscht werden – in MWST-Abrechnung % enthalten', v_beleg.mwst_abrechnung_ref;
  END IF;

  -- Buchungen via quelle_id löschen (korrekte Spalte)
  DELETE FROM fibu_buchungen WHERE quelle_id = p_beleg_id;
  DELETE FROM fibu_kreditoren_positionen WHERE beleg_id = p_beleg_id;
  DELETE FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_delete_kreditoren_beleg"("p_beleg_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_delete_mandant"("p_mandant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Nur Admins dürfen löschen
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können einen Mandanten löschen';
  END IF;

  -- Löschen — ON DELETE CASCADE übernimmt alle Abhängigkeiten
  DELETE FROM fibu_mandanten WHERE id = p_mandant_id;
END;
$$;


ALTER FUNCTION "public"."fibu_delete_mandant"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_erfolgsrechnung"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "konto_typ" "text", "saldo" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    ROUND(COALESCE(SUM(
      CASE
        WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
        WHEN b.konto_haben = k.konto_nr THEN -b.betrag
        ELSE 0
      END
    ), 0), 2) AS saldo
  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
    AND k.konto_typ IN ('ertrag', 'aufwand')
    AND k.aktiv = true
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  HAVING ROUND(COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = k.konto_nr THEN  b.betrag
      WHEN b.konto_haben = k.konto_nr THEN -b.betrag
      ELSE 0
    END
  ), 0), 2) <> 0
  ORDER BY k.konto_nr;
$$;


ALTER FUNCTION "public"."fibu_erfolgsrechnung"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_gutschrift_verrechnen"("p_mandant_id" "uuid", "p_gutschrift_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_gs    RECORD;
  v_offen NUMERIC;     -- noch zu verrechnender Gutschrift-Betrag (positiv)
  v_rest  NUMERIC;
  v_x     NUMERIC;
  v_r     RECORD;
  v_total NUMERIC := 0;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  SELECT * INTO v_gs FROM fibu_kreditoren_belege
  WHERE id = p_gutschrift_id AND mandant_id = p_mandant_id AND belegtyp = 'gutschrift';
  IF v_gs.id IS NULL THEN
    RAISE EXCEPTION 'Gutschrift nicht gefunden';
  END IF;

  -- offener Gutschrift-Betrag (Beträge sind bei Gutschriften negativ)
  v_offen := ABS(v_gs.betrag_brutto) - ABS(COALESCE(v_gs.betrag_bezahlt, 0));
  IF v_offen <= 0.005 THEN
    RAISE EXCEPTION 'Gutschrift ist bereits vollständig verrechnet';
  END IF;

  FOR v_r IN
    SELECT * FROM fibu_kreditoren_belege
    WHERE mandant_id = p_mandant_id
      AND lieferant_id = v_gs.lieferant_id
      AND belegtyp = 'rechnung'
      AND status IN ('offen', 'teilbezahlt')
    ORDER BY belegdatum, beleg_nr
  LOOP
    EXIT WHEN v_offen <= 0.005;
    v_rest := v_r.betrag_brutto - COALESCE(v_r.betrag_bezahlt, 0);
    CONTINUE WHEN v_rest <= 0.005;

    v_x := LEAST(v_rest, v_offen);

    -- Rechnung: betrag_bezahlt erhöhen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + v_x,
      status = CASE WHEN COALESCE(betrag_bezahlt, 0) + v_x >= betrag_brutto - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_r.id;

    -- Gutschrift: betrag_bezahlt (negativ) Richtung betrag_brutto bewegen
    UPDATE fibu_kreditoren_belege SET
      betrag_bezahlt = COALESCE(betrag_bezahlt, 0) - v_x,
      status = CASE WHEN ABS(COALESCE(betrag_bezahlt, 0) - v_x) >= ABS(betrag_brutto) - 0.005
                    THEN 'bezahlt' ELSE 'teilbezahlt' END,
      updated_at = NOW()
    WHERE id = v_gs.id;

    INSERT INTO fibu_kreditoren_verrechnungen
      (mandant_id, gutschrift_beleg_id, rechnung_beleg_id, betrag, created_by)
    VALUES (p_mandant_id, v_gs.id, v_r.id, v_x, auth.uid());

    v_offen := v_offen - v_x;
    v_total := v_total + v_x;
  END LOOP;

  RETURN v_total;
END;
$$;


ALTER FUNCTION "public"."fibu_gutschrift_verrechnen"("p_mandant_id" "uuid", "p_gutschrift_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_inbox_insert"("p_inbox_code" "text", "p_sender" "text", "p_sender_name" "text", "p_betreff" "text", "p_body" "text", "p_pdf_path" "text", "p_pdf_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_mandant_id UUID;
  v_inbox_id   UUID;
BEGIN
  -- Mandant via inbox_code finden
  SELECT id INTO v_mandant_id
  FROM fibu_mandanten
  WHERE inbox_code = p_inbox_code AND aktiv = true;

  IF v_mandant_id IS NULL THEN
    RAISE EXCEPTION 'fibu_inbox_insert: Kein Mandant mit inbox_code % gefunden', p_inbox_code;
  END IF;

  INSERT INTO fibu_rechnung_inbox
    (mandant_id, inbox_code, sender_email, sender_name, betreff, email_body, pdf_path, pdf_name)
  VALUES
    (v_mandant_id, p_inbox_code, p_sender, p_sender_name, p_betreff, p_body, p_pdf_path, p_pdf_name)
  RETURNING id INTO v_inbox_id;

  RETURN v_inbox_id;
END;
$$;


ALTER FUNCTION "public"."fibu_inbox_insert"("p_inbox_code" "text", "p_sender" "text", "p_sender_name" "text", "p_betreff" "text", "p_body" "text", "p_pdf_path" "text", "p_pdf_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  -- Jahresabschluss-Record
  v_ja                RECORD;

  -- Abschluss-Konten (aus fibu_jahresabschluss)
  v_kto_jahresergebnis  TEXT;
  v_kto_gewinnvortrag   TEXT;
  v_kto_verlustvortrag  TEXT;
  v_kto_eroeffnung      TEXT;

  -- Iteration
  v_konto             RECORD;

  -- Buchungsnummer + gemeinsame Felder
  v_nr                TEXT;
  v_datum_abschluss   DATE;   -- 31.12.p_jahr
  v_datum_eroeffnung  DATE;   -- 01.01.(p_jahr+1)

  -- Salden-Aggregation
  v_saldo_soll        NUMERIC;
  v_saldo_haben       NUMERIC;
  v_saldo             NUMERIC;

  -- Gesamt-Gewinn / -Verlust (Habennatur: positiv = Gewinn)
  v_gewinn            NUMERIC := 0;

  -- Zähler für Rückgabe
  v_cnt_abschluss     INT := 0;
  v_cnt_eb            INT := 0;
BEGIN
  -- ── Vorab-Validierung ─────────────────────────────────────────────

  -- Bereits abgeschlossen?
  IF EXISTS (
    SELECT 1 FROM fibu_jahresabschluss
    WHERE mandant_id = p_mandant_id
      AND jahr = p_jahr
      AND status = 'abgeschlossen'
  ) THEN
    RAISE EXCEPTION
      'Jahresabschluss % für Mandant % ist bereits abgeschlossen.',
      p_jahr, p_mandant_id;
  END IF;

  -- ── Jahresabschluss-Record laden oder anlegen ─────────────────────
  INSERT INTO fibu_jahresabschluss (mandant_id, jahr)
  VALUES (p_mandant_id, p_jahr)
  ON CONFLICT (mandant_id, jahr) DO NOTHING;

  SELECT * INTO v_ja
  FROM fibu_jahresabschluss
  WHERE mandant_id = p_mandant_id AND jahr = p_jahr;

  -- Abschluss-Konten lokal zwischenspeichern
  v_kto_jahresergebnis := v_ja.konto_jahresergebnis;
  v_kto_gewinnvortrag  := v_ja.konto_gewinnvortrag;
  v_kto_verlustvortrag := v_ja.konto_verlustvortrag;
  v_kto_eroeffnung     := v_ja.konto_eroeffnung;

  -- Buchungsdaten
  v_datum_abschluss  := make_date(p_jahr,     12, 31);
  v_datum_eroeffnung := make_date(p_jahr + 1,  1,  1);

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT A: Erfolgskonten schliessen (Ertrag + Aufwand)
  --
  -- Ertragskonten (Habennatur):
  --   Buchung: Soll = Ertragskonto, Haben = Jahresergebnis
  --   Begründung: Ertragssaldo liegt auf der Habenseite → zum Ausgleich
  --               muss das Konto auf der Sollseite belastet werden.
  --
  -- Aufwandkonten (Sollnatur):
  --   Buchung: Soll = Jahresergebnis, Haben = Aufwandskonto
  --   Begründung: Aufwandssaldo liegt auf der Sollseite → Ausgleich
  --               über Haben-Buchung auf das Konto.
  -- ══════════════════════════════════════════════════════════════════

  FOR v_konto IN
    SELECT
      k.konto_nr,
      k.bezeichnung,
      k.konto_typ,
      -- Saldo in Kontonatur berechnen (ohne Eröffnungsbuchungen)
      CASE k.konto_typ
        WHEN 'ertrag' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'aufwand' THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END AS saldo
    FROM fibu_konten k
    LEFT JOIN fibu_buchungen b
      ON  b.mandant_id   = k.mandant_id
      AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
      AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
      AND NOT b.storniert
      AND b.periode_art != 'eroeffnung'
    WHERE k.mandant_id = p_mandant_id
      AND k.aktiv      = true
      AND k.konto_typ IN ('ertrag', 'aufwand')
    GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
    HAVING
      -- Nur Konten mit echtem Saldo (≠ 0) verarbeiten
      CASE k.konto_typ
        WHEN 'ertrag' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'aufwand' THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END > 0
    ORDER BY k.konto_nr
  LOOP
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_konto.konto_typ = 'ertrag' THEN
      -- Ertragskonto SOLL / Jahresergebnis HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,            konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_abschluss,
        v_konto.konto_nr,      v_kto_jahresergebnis,
        v_konto.saldo,
        'Jahresabschluss Ertrag: ' || v_konto.bezeichnung,
        'abschluss', 'abschluss', auth.uid()
      );
      -- Gewinn akkumulieren (Ertrag erhöht Gewinn)
      v_gewinn := v_gewinn + v_konto.saldo;

    ELSE
      -- Aufwandskonto: Jahresergebnis SOLL / Aufwandskonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,              konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_abschluss,
        v_kto_jahresergebnis,    v_konto.konto_nr,
        v_konto.saldo,
        'Jahresabschluss Aufwand: ' || v_konto.bezeichnung,
        'abschluss', 'abschluss', auth.uid()
      );
      -- Gewinn mindern (Aufwand reduziert Gewinn)
      v_gewinn := v_gewinn - v_konto.saldo;

    END IF;

    v_cnt_abschluss := v_cnt_abschluss + 1;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT B: Jahresergebnis → Gewinnvortrag / Verlustvortrag
  --
  -- v_gewinn > 0: Gewinn  → Jahresergebnis SOLL / Gewinnvortrag HABEN
  -- v_gewinn < 0: Verlust → Verlustvortrag SOLL / Jahresergebnis HABEN
  -- v_gewinn = 0: kein Eintrag nötig (Nullergebnis)
  -- ══════════════════════════════════════════════════════════════════

  IF v_gewinn > 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum,
      konto_soll,              konto_haben,
      betrag,
      text,
      quelle, periode_art, created_by
    ) VALUES (
      p_mandant_id, v_nr, v_datum_abschluss,
      v_kto_jahresergebnis,    v_kto_gewinnvortrag,
      v_gewinn,
      'Jahresgewinn ' || p_jahr::TEXT,
      'abschluss', 'abschluss', auth.uid()
    );
    v_cnt_abschluss := v_cnt_abschluss + 1;

  ELSIF v_gewinn < 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum,
      konto_soll,              konto_haben,
      betrag,
      text,
      quelle, periode_art, created_by
    ) VALUES (
      p_mandant_id, v_nr, v_datum_abschluss,
      v_kto_verlustvortrag,    v_kto_jahresergebnis,
      ABS(v_gewinn),
      'Jahresverlust ' || p_jahr::TEXT,
      'abschluss', 'abschluss', auth.uid()
    );
    v_cnt_abschluss := v_cnt_abschluss + 1;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT C: Eröffnungsbuchungen für das neue Geschäftsjahr
  --
  -- Bilanzkonten (Aktiv/Passiv) übertragen ihren Saldo — NACH den
  -- Abschlussbuchungen — als Eröffnungssaldo ins neue Jahr.
  -- Dabei gilt das Eröffnungsbilanzkonto (9900) als Gegenkonto.
  --
  -- Aktivkonto (Sollnatur, Saldo positiv = Sollsaldo):
  --   Soll = Aktivkonto, Haben = Eröffnungsbilanzkonto
  --
  -- Passivkonto (Habennatur, Saldo positiv = Habensaldo):
  --   Soll = Eröffnungsbilanzkonto, Haben = Passivkonto
  --
  -- Wichtig: Der Saldo der Bilanzkonten NACH Schritt A/B muss hier
  -- berücksichtigt werden. Für Aktiv/Passiv-Konten ändert sich durch
  -- Schritt A nichts (Erfolgskonten wurden dort gebucht). Gewinn/Verlust
  -- haben sich jedoch auf dem Vortragskonto (2970/2979) niederschlagen,
  -- deshalb werden diese separat als EB-Buchungen erfasst.
  -- ══════════════════════════════════════════════════════════════════

  FOR v_konto IN
    SELECT
      k.konto_nr,
      k.bezeichnung,
      k.konto_typ,
      -- Saldo inkl. aller Buchungen des Jahres (auch Abschlussbuchungen aus Schritt A/B)
      -- Die periode_art-Filter müssen hier fehlen, da die Abschlussbuchungen relevant sind.
      -- Eröffnungsbuchungen weiterhin ausschliessen (gehören zum Vorjahr).
      CASE k.konto_typ
        WHEN 'aktiv'  THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'passiv' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END AS saldo
    FROM fibu_konten k
    LEFT JOIN fibu_buchungen b
      ON  b.mandant_id   = k.mandant_id
      AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
      AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
      AND NOT b.storniert
      AND b.periode_art != 'eroeffnung'   -- Vorjahres-EB ausschliessen
    WHERE k.mandant_id = p_mandant_id
      AND k.aktiv      = true
      AND k.konto_typ IN ('aktiv', 'passiv')
    GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
    HAVING
      CASE k.konto_typ
        WHEN 'aktiv'  THEN
          COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        WHEN 'passiv' THEN
          COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        ELSE 0
      END > 0
    ORDER BY k.konto_nr
  LOOP
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_konto.konto_typ = 'aktiv' THEN
      -- Aktivkonto SOLL / Eröffnungsbilanzkonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,       konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_konto.konto_nr, v_kto_eroeffnung,
        v_konto.saldo,
        'Eröffnungssaldo: ' || v_konto.bezeichnung,
        'abschluss', 'eroeffnung', auth.uid()
      );
    ELSE
      -- Eröffnungsbilanzkonto SOLL / Passivkonto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,        konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_eroeffnung,  v_konto.konto_nr,
        v_konto.saldo,
        'Eröffnungssaldo: ' || v_konto.bezeichnung,
        'abschluss', 'eroeffnung', auth.uid()
      );
    END IF;

    v_cnt_eb := v_cnt_eb + 1;
  END LOOP;

  -- Gewinn-/Verlustvortrag als EB-Buchung ins neue Jahr übertragen
  -- (Schritt B hat das Konto auf dem Abschlussdatum belastet; hier
  --  wird der gleiche Betrag als Eröffnung auf 01.01. ins neue Jahr gebucht)
  IF v_gewinn != 0 THEN
    v_nr := fibu_next_buchungs_nr(p_mandant_id);

    IF v_gewinn > 0 THEN
      -- Gewinnvortrag als Passivkonto (Habennatur): EB-Konto SOLL / Gewinnvortrag HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,        konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_eroeffnung,    v_kto_gewinnvortrag,
        v_gewinn,
        'Eröffnungssaldo Gewinnvortrag ' || p_jahr::TEXT,
        'abschluss', 'eroeffnung', auth.uid()
      );
    ELSE
      -- Verlustvortrag als Aktivkonto (Sollnatur): Verlustvortrag SOLL / EB-Konto HABEN
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum,
        konto_soll,            konto_haben,
        betrag,
        text,
        quelle, periode_art, created_by
      ) VALUES (
        p_mandant_id, v_nr, v_datum_eroeffnung,
        v_kto_verlustvortrag,  v_kto_eroeffnung,
        ABS(v_gewinn),
        'Eröffnungssaldo Verlustvortrag ' || p_jahr::TEXT,
        'abschluss', 'eroeffnung', auth.uid()
      );
    END IF;

    v_cnt_eb := v_cnt_eb + 1;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- SCHRITT D: Status setzen und Geschäftsjahr vorrücken
  -- ══════════════════════════════════════════════════════════════════

  UPDATE fibu_jahresabschluss
  SET
    status           = 'abgeschlossen',
    gewinn_verlust   = v_gewinn,
    abgeschlossen_am = NOW(),
    abgeschlossen_von = auth.uid()
  WHERE mandant_id = p_mandant_id AND jahr = p_jahr;

  -- Mandant: Geschäftsjahr auf das nächste Jahr vorrücken
  UPDATE fibu_mandanten
  SET geschaeftsjahr = p_jahr + 1
  WHERE id = p_mandant_id;

  -- ── Ergebnis-JSON zurückgeben ──────────────────────────────────────
  RETURN jsonb_build_object(
    'jahr',                    p_jahr,
    'neues_jahr',              p_jahr + 1,
    'gewinn_verlust',          v_gewinn,
    'anzahl_abschluss_buchungen', v_cnt_abschluss,
    'anzahl_eb_buchungen',     v_cnt_eb
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Alle Änderungen werden durch den umschliessenden Transaktions-
    -- rollback automatisch rückgängig gemacht (Supabase/PostgREST RPC
    -- läuft in einer einzelnen Transaktion).
    RAISE;
END;
$$;


ALTER FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) IS 'Führt vollständigen Jahresabschluss durch: Erfolgskonten schliessen, Gewinn/Verlust buchen, Eröffnungsbuchungen erstellen, Geschäftsjahr vorrücken. Transaktional – bei Fehler vollständiger Rollback.';



CREATE OR REPLACE FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "konto_typ" "text", "saldo_soll" numeric, "saldo_haben" numeric, "saldo" numeric, "anzahl_buchungen" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,

    -- Rohe Seiten-Summen
    COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0) AS saldo_soll,
    COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0) AS saldo_haben,

    -- Saldo in Kontonatur
    CASE k.konto_typ
      WHEN 'aktiv'   THEN
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'aufwand' THEN
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'passiv'  THEN
        COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      WHEN 'ertrag'  THEN
        COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
      ELSE  -- 'abschluss' und unbekannte Typen: Sollnatur
        COALESCE(SUM(CASE WHEN b.konto_soll  = k.konto_nr THEN b.betrag ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE 0 END), 0)
    END                                                                              AS saldo,

    COUNT(b.id)::BIGINT                                                              AS anzahl_buchungen

  FROM fibu_konten k
  LEFT JOIN fibu_buchungen b
    ON  b.mandant_id   = k.mandant_id
    AND (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND EXTRACT(YEAR FROM b.buchungsdatum)::INT = p_jahr
    AND NOT b.storniert
    AND b.periode_art != 'eroeffnung'   -- Eröffnungsbuchungen ignorieren

  WHERE k.mandant_id = p_mandant_id
    AND k.aktiv = true

  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  ORDER BY k.konto_nr;
$$;


ALTER FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) IS 'Gibt aggregierte Konten-Salden für ein Geschäftsjahr zurück (ohne Eröffnungsbuchungen). Verwendung für Abschluss-Vorschau und Reporting.';



CREATE OR REPLACE FUNCTION "public"."fibu_konten_mit_bewegungen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "konto_typ" "text", "anzahl" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    k.konto_nr,
    k.bezeichnung,
    k.konto_typ,
    COUNT(DISTINCT b.buchungs_nr) AS anzahl
  FROM fibu_konten k
  JOIN fibu_buchungen b ON
    (b.konto_soll = k.konto_nr OR b.konto_haben = k.konto_nr)
    AND b.mandant_id = k.mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND NOT b.storniert
  WHERE k.mandant_id = p_mandant_id
  GROUP BY k.konto_nr, k.bezeichnung, k.konto_typ
  ORDER BY k.konto_nr;
$$;


ALTER FUNCTION "public"."fibu_konten_mit_bewegungen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_kontoblatt"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_von" "date", "p_bis" "date") RETURNS TABLE("buchungs_nr" "text", "buchungsdatum" "date", "gegenkonto" "text", "gegenkonto_bez" "text", "beleg_ref" "text", "quelle_id" "uuid", "buch_text" "text", "lieferant_name" "text", "mwst_code" "text", "mwst_betrag" numeric, "konto_vorsteuer" "text", "soll" numeric, "haben" numeric, "saldo_lfd" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_eroeffnung NUMERIC := 0;
BEGIN
  -- Eröffnungssaldo: alle Buchungen vor p_von auf diesem Konto
  SELECT COALESCE(SUM(
    CASE
      WHEN b.konto_soll  = p_konto_nr THEN  b.betrag
      WHEN b.konto_haben = p_konto_nr THEN -b.betrag
    END
  ), 0)
  INTO v_eroeffnung
  FROM fibu_buchungen b
  WHERE b.mandant_id = p_mandant_id
    AND (b.konto_soll = p_konto_nr OR b.konto_haben = p_konto_nr)
    AND b.buchungsdatum < p_von
    AND NOT b.storniert;

  RETURN QUERY
  WITH pos AS (
    SELECT
      b.buchungs_nr,
      b.buchungsdatum,
      CASE
        WHEN b.konto_soll  = p_konto_nr THEN b.konto_haben
        WHEN b.konto_haben = p_konto_nr THEN b.konto_soll
      END                                                   AS gegenkonto,
      CASE
        WHEN b.konto_soll  = p_konto_nr THEN kh.bezeichnung
        WHEN b.konto_haben = p_konto_nr THEN ks.bezeichnung
      END                                                   AS gegenkonto_bez,
      b.beleg_ref,
      b.quelle_id,
      b.text                                                AS buch_text,
      lf.name                                               AS lieferant_name,
      b.mwst_code,
      ROUND(COALESCE(b.mwst_betrag, 0), 2)                 AS mwst_betrag,
      mc.konto_vorsteuer,
      CASE WHEN b.konto_soll  = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS soll,
      CASE WHEN b.konto_haben = p_konto_nr THEN ROUND(b.betrag,2) ELSE 0 END AS haben
    FROM fibu_buchungen b
    LEFT JOIN fibu_konten           ks ON ks.konto_nr = b.konto_soll  AND ks.mandant_id = b.mandant_id
    LEFT JOIN fibu_konten           kh ON kh.konto_nr = b.konto_haben AND kh.mandant_id = b.mandant_id
    LEFT JOIN fibu_mwst_codes       mc ON mc.code = b.mwst_code       AND mc.mandant_id = b.mandant_id
    LEFT JOIN fibu_kreditoren_belege kb ON kb.id = b.quelle_id
    LEFT JOIN fibu_lieferanten      lf ON lf.id = kb.lieferant_id
    WHERE b.mandant_id = p_mandant_id
      AND (b.konto_soll = p_konto_nr OR b.konto_haben = p_konto_nr)
      AND b.buchungsdatum BETWEEN p_von AND p_bis
      AND NOT b.storniert
    ORDER BY b.buchungsdatum, b.buchungs_nr
  )
  SELECT
    pos.buchungs_nr,
    pos.buchungsdatum,
    pos.gegenkonto,
    pos.gegenkonto_bez,
    pos.beleg_ref,
    pos.quelle_id,
    pos.buch_text,
    pos.lieferant_name,
    pos.mwst_code,
    pos.mwst_betrag,
    pos.konto_vorsteuer,
    pos.soll,
    pos.haben,
    v_eroeffnung + SUM(pos.soll - pos.haben)
      OVER (ORDER BY pos.buchungsdatum, pos.buchungs_nr
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_lfd
  FROM pos;
END;
$$;


ALTER FUNCTION "public"."fibu_kontoblatt"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_kontoblatt_eroeffnung"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_stichtag" "date") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN konto_soll  = p_konto_nr THEN  betrag
      WHEN konto_haben = p_konto_nr THEN -betrag
    END
  ), 0)
  FROM fibu_buchungen
  WHERE mandant_id = p_mandant_id
    AND (konto_soll = p_konto_nr OR konto_haben = p_konto_nr)
    AND buchungsdatum < p_stichtag
    AND NOT storniert;
$$;


ALTER FUNCTION "public"."fibu_kontoblatt_eroeffnung"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_stichtag" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_kreditoren_storno"("p_beleg_id" "uuid", "p_storno_datum" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_r        fibu_kreditoren_belege;
  v_storno   UUID;
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_r FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_r.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF v_r.belegtyp <> 'rechnung' THEN
    RAISE EXCEPTION 'Nur Rechnungen können storniert werden';
  END IF;
  IF v_r.status = 'storniert' OR v_r.storno_beleg_id IS NOT NULL THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_r.beleg_nr;
  END IF;
  IF COALESCE(v_r.betrag_bezahlt, 0) <> 0 THEN
    RAISE EXCEPTION 'Rechnung % ist bereits (teil)bezahlt oder verrechnet und kann nicht storniert werden', v_r.beleg_nr;
  END IF;

  -- eindeutige Beleg-Nr. für die Storno-Gutschrift
  v_nr := v_r.beleg_nr || '-S';
  IF EXISTS (SELECT 1 FROM fibu_kreditoren_belege
             WHERE mandant_id = v_r.mandant_id AND beleg_nr = v_nr) THEN
    v_nr := v_r.beleg_nr || '-S' || TO_CHAR(NOW(), 'SSSS');
  END IF;

  -- Storno-Gutschrift anlegen (gespiegelte, negative Beträge)
  INSERT INTO fibu_kreditoren_belege (
    mandant_id, beleg_nr, lieferant_id, lieferant_beleg_nr,
    belegdatum, valutadatum, faelligkeit, zahlungsbedingung_tage,
    waehrung, betrag_netto, betrag_mwst, betrag_brutto,
    belegtyp, status, notiz, gebucht_von
  ) VALUES (
    v_r.mandant_id, v_nr, v_r.lieferant_id, v_r.lieferant_beleg_nr,
    p_storno_datum, p_storno_datum, p_storno_datum, 0,
    v_r.waehrung, -v_r.betrag_netto, -v_r.betrag_mwst, -v_r.betrag_brutto,
    'gutschrift', 'storniert',
    'Storno zu ' || v_r.beleg_nr || COALESCE(' – ' || v_r.notiz, ''),
    auth.uid()
  ) RETURNING id INTO v_storno;

  -- Positionen 1:1 kopieren (positiv – die Verbuchung dreht die Richtung)
  INSERT INTO fibu_kreditoren_positionen (
    mandant_id, beleg_id, position, konto_nr, bezeichnung,
    mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  )
  SELECT mandant_id, v_storno, position, konto_nr, bezeichnung,
         mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
  FROM fibu_kreditoren_positionen
  WHERE beleg_id = p_beleg_id;

  -- Storno-Gutschrift verbuchen (Gegenbuchung, datiert auf Storno-Datum)
  PERFORM fibu_kreditoren_verbuchen(v_storno);

  -- Original-Rechnung als storniert markieren
  UPDATE fibu_kreditoren_belege
  SET status = 'storniert', storno_beleg_id = v_storno, updated_at = NOW()
  WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;


ALTER FUNCTION "public"."fibu_kreditoren_storno"("p_beleg_id" "uuid", "p_storno_datum" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_kreditoren_verbuchen"("p_beleg_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_beleg      RECORD;
  v_pos        RECORD;
  v_nr         TEXT;
  v_gutschrift BOOLEAN;
  v_methode    TEXT;
  v_kurstyp    TEXT;
  v_saldo      BOOLEAN;
  v_aufw_soll  TEXT;
  v_aufw_haben TEXT;
  v_vst_soll   TEXT;
  v_vst_haben  TEXT;
  v_mwst_sign  NUMERIC;
  v_kurs       NUMERIC;
  v_fw         TEXT;
  v_fw_betrag  NUMERIC;
  v_fw_mwst    NUMERIC;
  v_chf_betrag NUMERIC;
  v_chf_mwst   NUMERIC;
BEGIN
  SELECT b.*, l.name AS lieferant_name
  INTO v_beleg
  FROM fibu_kreditoren_belege b
  JOIN fibu_lieferanten l ON l.id = b.lieferant_id
  WHERE b.id = p_beleg_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Beleg % nicht gefunden', p_beleg_id;
  END IF;
  IF v_beleg.verbucht THEN
    RAISE EXCEPTION 'Beleg % ist bereits verbucht', p_beleg_id;
  END IF;

  SELECT mwst_methode, fw_buchungskurs
  INTO v_methode, v_kurstyp
  FROM fibu_mandanten WHERE id = v_beleg.mandant_id;
  v_saldo      := (COALESCE(v_methode, 'effektiv') = 'saldosteuersatz');
  v_kurstyp    := COALESCE(v_kurstyp, 'monat');
  v_gutschrift := (v_beleg.belegtyp = 'gutschrift');
  v_mwst_sign  := CASE WHEN v_gutschrift THEN -1 ELSE 1 END;

  -- Wechselkurs bestimmen (Buchungskurs-Art des Mandanten)
  IF v_beleg.waehrung IS NULL OR v_beleg.waehrung = 'CHF' THEN
    v_kurs := 1;
    v_fw   := NULL;
  ELSE
    v_fw := v_beleg.waehrung;
    SELECT kurs INTO v_kurs
    FROM fibu_wechselkurse
    WHERE waehrung = v_beleg.waehrung AND typ = v_kurstyp AND datum <= v_beleg.belegdatum
    ORDER BY datum DESC LIMIT 1;
    IF v_kurs IS NULL THEN
      SELECT kurs INTO v_kurs
      FROM fibu_wechselkurse
      WHERE waehrung = v_beleg.waehrung
      ORDER BY datum DESC LIMIT 1;
    END IF;
    IF v_kurs IS NULL THEN
      RAISE EXCEPTION 'Kein Wechselkurs für % vorhanden – bitte unter Stammdaten › Wechselkurse importieren', v_beleg.waehrung;
    END IF;
  END IF;

  UPDATE fibu_kreditoren_belege SET kurs = v_kurs WHERE id = p_beleg_id;

  FOR v_pos IN
    SELECT p.*, mc.konto_vorsteuer
    FROM fibu_kreditoren_positionen p
    LEFT JOIN fibu_mwst_codes mc
      ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
    WHERE p.beleg_id = p_beleg_id
    ORDER BY p.position
  LOOP
    IF v_gutschrift THEN
      v_aufw_soll  := '2000';                 v_aufw_haben := v_pos.konto_nr;
      v_vst_soll   := '2000';                 v_vst_haben  := v_pos.konto_vorsteuer;
    ELSE
      v_aufw_soll  := v_pos.konto_nr;         v_aufw_haben := '2000';
      v_vst_soll   := v_pos.konto_vorsteuer;  v_vst_haben  := '2000';
    END IF;

    v_fw_betrag := CASE WHEN v_saldo THEN v_pos.betrag_brutto ELSE v_pos.betrag_netto END;
    v_fw_mwst   := COALESCE(v_pos.betrag_mwst, 0);
    v_chf_betrag := ROUND(v_fw_betrag * v_kurs, 2);
    v_chf_mwst   := ROUND(v_fw_mwst   * v_kurs, 2);

    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
    ) VALUES (
      v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
      v_aufw_soll, v_aufw_haben,
      v_chf_betrag,
      CASE WHEN v_saldo THEN NULL ELSE v_pos.mwst_code END,
      CASE WHEN v_saldo THEN 0 ELSE v_mwst_sign * v_chf_mwst END,
      COALESCE(v_pos.bezeichnung, v_beleg.lieferant_name || ' / ' || v_beleg.beleg_nr)
        || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
      'kreditoren', p_beleg_id, v_beleg.gebucht_von,
      v_fw, CASE WHEN v_fw IS NULL THEN NULL ELSE v_fw_betrag END
    );

    IF NOT v_saldo AND v_fw_mwst > 0 AND v_pos.konto_vorsteuer IS NOT NULL THEN
      v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
      INSERT INTO fibu_buchungen (
        mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
        konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
        text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag
      ) VALUES (
        v_beleg.mandant_id, v_nr, v_beleg.belegdatum, v_beleg.beleg_nr,
        v_vst_soll, v_vst_haben,
        v_chf_mwst,
        v_pos.mwst_code, v_mwst_sign * v_chf_mwst,
        'Vorsteuer ' || v_pos.mwst_code || ' / ' || v_beleg.beleg_nr
          || CASE WHEN v_gutschrift THEN ' (Gutschrift)' ELSE '' END,
        'kreditoren', p_beleg_id, v_beleg.gebucht_von,
        v_fw, CASE WHEN v_fw IS NULL THEN NULL ELSE v_fw_mwst END
      );
    END IF;
  END LOOP;

  UPDATE fibu_kreditoren_belege
  SET verbucht = true, updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_kreditoren_verbuchen"("p_beleg_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_kursbewertung_buchen"("p_mandant_id" "uuid", "p_stichtag" "date", "p_konto" "text", "p_betrag" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_soll   TEXT;
  v_haben  TEXT;
  v_abs    NUMERIC;
  v_beleg  UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  v_abs := ROUND(ABS(p_betrag), 2);
  IF v_abs < 0.01 THEN
    RETURN NULL;   -- keine nennenswerte Differenz
  END IF;

  -- Kursverlust: Aufwand Soll / Kreditoren Haben · Kursgewinn umgekehrt
  IF p_betrag > 0 THEN
    v_soll := p_konto; v_haben := '2000';
  ELSE
    v_soll := '2000';  v_haben := p_konto;
  END IF;

  -- Bewertungsbuchung per Stichtag
  v_beleg := fibu_manuelle_buchung_erstellen(
    p_mandant_id, p_stichtag,
    'FW-Kursbewertung per ' || TO_CHAR(p_stichtag, 'DD.MM.YYYY'),
    NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_soll, 'konto_haben', v_haben,
      'betrag', v_abs, 'text', 'FW-Kursbewertung')));

  -- Storno am Folgetag – Bewertung gilt nur zum Stichtag
  PERFORM fibu_manuelle_buchung_erstellen(
    p_mandant_id, p_stichtag + 1,
    'Storno FW-Kursbewertung per ' || TO_CHAR(p_stichtag, 'DD.MM.YYYY'),
    NULL, NULL, 'normal',
    jsonb_build_array(jsonb_build_object(
      'konto_soll', v_haben, 'konto_haben', v_soll,
      'betrag', v_abs, 'text', 'Storno FW-Kursbewertung')));

  RETURN v_beleg;
END;
$$;


ALTER FUNCTION "public"."fibu_kursbewertung_buchen"("p_mandant_id" "uuid", "p_stichtag" "date", "p_konto" "text", "p_betrag" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_lieferant_buchungshistorie"("p_mandant_id" "uuid", "p_lieferant_id" "uuid", "p_limit" integer DEFAULT 10) RETURNS TABLE("konto_nr" "text", "bezeichnung" "text", "mwst_code" "text", "mwst_satz" numeric, "betrag_netto" numeric, "anzahl" bigint, "zuletzt" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    p.konto_nr,
    k.bezeichnung,
    p.mwst_code,
    p.mwst_satz,
    AVG(p.betrag_netto)::NUMERIC(14,2) AS betrag_netto,
    COUNT(*)::BIGINT AS anzahl,
    MAX(b.belegdatum) AS zuletzt
  FROM fibu_kreditoren_positionen p
  JOIN fibu_kreditoren_belege b ON b.id = p.beleg_id
  LEFT JOIN fibu_konten k ON k.mandant_id = b.mandant_id AND k.konto_nr = p.konto_nr
  WHERE b.mandant_id = p_mandant_id
    AND b.lieferant_id = p_lieferant_id
    AND b.status != 'storniert'
  GROUP BY p.konto_nr, k.bezeichnung, p.mwst_code, p.mwst_satz
  ORDER BY anzahl DESC, zuletzt DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION "public"."fibu_lieferant_buchungshistorie"("p_mandant_id" "uuid", "p_lieferant_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_list_mandant_users"("p_mandant_id" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "display_name" "text", "role" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzer verwalten';
  END IF;

  RETURN QUERY
  SELECT
    a.user_id,
    u.email::TEXT,
    COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email, '@', 1)
    )::TEXT AS display_name,
    a.role,
    a.created_at
  FROM fibu_user_mandant_access a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.mandant_id = p_mandant_id
  ORDER BY a.created_at;
END;
$$;


ALTER FUNCTION "public"."fibu_list_mandant_users"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mandant_belegfreigabe_setzen"("p_mandant_id" "uuid", "p_aktiv" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  UPDATE fibu_mandanten
  SET belegfreigabe_aktiv = COALESCE(p_aktiv, false), updated_at = NOW()
  WHERE id = p_mandant_id;
END;
$$;


ALTER FUNCTION "public"."fibu_mandant_belegfreigabe_setzen"("p_mandant_id" "uuid", "p_aktiv" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mandant_has_no_access"("p_mandant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access WHERE mandant_id = p_mandant_id
  );
$$;


ALTER FUNCTION "public"."fibu_mandant_has_no_access"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mandant_ids_for_user"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(ARRAY_AGG(mandant_id), '{}')
  FROM fibu_user_mandant_access
  WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."fibu_mandant_ids_for_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mandant_mwst_methode_setzen"("p_mandant_id" "uuid", "p_methode" "text", "p_sss" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF p_methode NOT IN ('effektiv', 'saldosteuersatz') THEN
    RAISE EXCEPTION 'Ungültige MWST-Methode: %', p_methode;
  END IF;
  UPDATE fibu_mandanten
  SET mwst_methode = p_methode,
      saldosteuersatz_prozent = CASE WHEN p_methode = 'saldosteuersatz' THEN p_sss ELSE saldosteuersatz_prozent END,
      updated_at = NOW()
  WHERE id = p_mandant_id;
END;
$$;


ALTER FUNCTION "public"."fibu_mandant_mwst_methode_setzen"("p_mandant_id" "uuid", "p_methode" "text", "p_sss" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_manuelle_buchung_erstellen"("p_mandant_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_art" "text", "p_zeilen" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_beleg_id UUID;
  v_beleg_nr TEXT;
  v_year     TEXT := TO_CHAR(p_datum, 'YYYY');
  v_last     TEXT;
  v_num      INTEGER;
  v_quelle   TEXT;
  z          JSONB;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  v_quelle := CASE WHEN p_art = 'saldovortrag' THEN 'abschluss' ELSE 'manuell' END;

  SELECT beleg_nr INTO v_last
  FROM fibu_buchung_belege
  WHERE mandant_id = p_mandant_id AND beleg_nr LIKE 'MB-' || v_year || '-%'
  ORDER BY beleg_nr DESC LIMIT 1;
  v_num := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER, 0) + 1;
  v_beleg_nr := 'MB-' || v_year || '-' || LPAD(v_num::TEXT, 4, '0');

  INSERT INTO fibu_buchung_belege
    (mandant_id, beleg_nr, buchungsdatum, text, art, pdf_path, pdf_name, created_by)
  VALUES
    (p_mandant_id, v_beleg_nr, p_datum, p_text, COALESCE(p_art, 'normal'),
     p_pdf_path, p_pdf_name, auth.uid())
  RETURNING id INTO v_beleg_id;

  FOR z IN SELECT * FROM jsonb_array_elements(p_zeilen)
  LOOP
    INSERT INTO fibu_buchungen
      (mandant_id, buchungs_nr, buchungsdatum, beleg_ref, konto_soll, konto_haben,
       betrag, mwst_code, mwst_betrag, text, quelle, quelle_id, created_by,
       fw_waehrung, fw_betrag)
    VALUES (
      p_mandant_id, fibu_next_buchungs_nr(p_mandant_id), p_datum, v_beleg_nr,
      z->>'konto_soll', z->>'konto_haben',
      (z->>'betrag')::NUMERIC,
      NULLIF(z->>'mwst_code', ''),
      NULLIF(z->>'mwst_betrag', '')::NUMERIC,
      COALESCE(NULLIF(z->>'text', ''), p_text),
      v_quelle, v_beleg_id, auth.uid(),
      NULLIF(z->>'fw_waehrung', ''),
      NULLIF(z->>'fw_betrag', '')::NUMERIC
    );
  END LOOP;

  RETURN v_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_manuelle_buchung_erstellen"("p_mandant_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_art" "text", "p_zeilen" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_manuelle_buchung_korrigieren"("p_beleg_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_zeilen" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mandant UUID;
  v_neu     UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_buchung_belege WHERE id = p_beleg_id;
  IF v_mandant IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;

  PERFORM fibu_manuelle_buchung_stornieren(p_beleg_id, p_datum);

  v_neu := fibu_manuelle_buchung_erstellen(
    v_mandant, p_datum, p_text, p_pdf_path, p_pdf_name, 'normal', p_zeilen);
  UPDATE fibu_buchung_belege SET original_beleg_id = p_beleg_id WHERE id = v_neu;

  RETURN v_neu;
END;
$$;


ALTER FUNCTION "public"."fibu_manuelle_buchung_korrigieren"("p_beleg_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_zeilen" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_manuelle_buchung_stornieren"("p_beleg_id" "uuid", "p_storno_datum" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_orig     fibu_buchung_belege;
  v_storno   UUID;
  v_zeilen   JSONB;
BEGIN
  SELECT * INTO v_orig FROM fibu_buchung_belege WHERE id = p_beleg_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF v_orig.storniert THEN
    RAISE EXCEPTION 'Beleg % ist bereits storniert', v_orig.beleg_nr;
  END IF;

  -- Gegenbuchungen: Soll/Haben vertauscht → Originalwirkung auf 0
  SELECT jsonb_agg(jsonb_build_object(
           'konto_soll',  b.konto_haben,
           'konto_haben', b.konto_soll,
           'betrag',      b.betrag,
           'mwst_code',   b.mwst_code,
           'mwst_betrag', b.mwst_betrag,
           'text',        'Storno: ' || COALESCE(b.text, '')))
  INTO v_zeilen
  FROM fibu_buchungen b
  WHERE b.quelle_id = p_beleg_id AND NOT b.storniert;

  v_storno := fibu_manuelle_buchung_erstellen(
    v_orig.mandant_id, p_storno_datum,
    'Storno zu ' || v_orig.beleg_nr || COALESCE(' – ' || v_orig.text, ''),
    NULL, NULL, 'storno', COALESCE(v_zeilen, '[]'::jsonb));

  UPDATE fibu_buchung_belege SET original_beleg_id = p_beleg_id WHERE id = v_storno;
  UPDATE fibu_buchung_belege
    SET storniert = true, storno_beleg_id = v_storno
    WHERE id = p_beleg_id;

  RETURN v_storno;
END;
$$;


ALTER FUNCTION "public"."fibu_manuelle_buchung_stornieren"("p_beleg_id" "uuid", "p_storno_datum" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mwst_by_konto"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS TABLE("konto_nr" "text", "konto_bez" "text", "mwst_code" "text", "mwst_satz" numeric, "anzahl" bigint, "sum_netto" numeric, "sum_mwst" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    b.konto_soll                                AS konto_nr,
    k.bezeichnung                               AS konto_bez,
    b.mwst_code,
    mc.satz                                     AS mwst_satz,
    COUNT(*)::BIGINT                            AS anzahl,
    ROUND(SUM(b.betrag), 2)                     AS sum_netto,
    ROUND(SUM(COALESCE(b.mwst_betrag, 0)), 2)   AS sum_mwst
  FROM fibu_buchungen b
  LEFT JOIN fibu_konten k
    ON k.mandant_id = b.mandant_id AND k.konto_nr = b.konto_soll
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  GROUP BY b.konto_soll, k.bezeichnung, b.mwst_code, mc.satz
  ORDER BY b.konto_soll, b.mwst_code;
$$;


ALTER FUNCTION "public"."fibu_mwst_by_konto"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mwst_detail"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS TABLE("buchungs_nr" "text", "buchungsdatum" "date", "beleg_ref" "text", "quelle_id" "uuid", "konto_soll" "text", "konto_soll_bez" "text", "mwst_code" "text", "mwst_satz" numeric, "betrag_netto" numeric, "mwst_betrag" numeric, "mwst_erwartet" numeric, "differenz" numeric, "text" "text", "quelle" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    b.buchungs_nr,
    b.buchungsdatum,
    b.beleg_ref,
    b.quelle_id,
    b.konto_soll,
    k.bezeichnung                                    AS konto_soll_bez,
    b.mwst_code,
    mc.satz                                          AS mwst_satz,
    ROUND(b.betrag, 2)                               AS betrag_netto,
    ROUND(COALESCE(b.mwst_betrag, 0), 2)             AS mwst_betrag,
    ROUND(b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS mwst_erwartet,
    ROUND(COALESCE(b.mwst_betrag, 0) - b.betrag * COALESCE(mc.satz, 0) / 100, 2) AS differenz,
    b.text,
    b.quelle
  FROM fibu_buchungen b
  LEFT JOIN fibu_konten k
    ON k.mandant_id = b.mandant_id AND k.konto_nr = b.konto_soll
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  ORDER BY b.buchungsdatum, b.buchungs_nr;
$$;


ALTER FUNCTION "public"."fibu_mwst_detail"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."fibu_mwst_abrechnungsperioden" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "periode_von" "date" NOT NULL,
    "periode_bis" "date" NOT NULL,
    "status" "text" DEFAULT 'offen'::"text" NOT NULL,
    "zahllast_chf" numeric(15,2),
    "eingereicht_am" timestamp with time zone,
    "abgerechnet_am" timestamp with time zone,
    "benutzer_id" "uuid",
    "notizen" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_mwst_abrechnungsperioden_status_check" CHECK (("status" = ANY (ARRAY['offen'::"text", 'eingereicht'::"text", 'abgerechnet'::"text"])))
);


ALTER TABLE "public"."fibu_mwst_abrechnungsperioden" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mwst_periode_abschliessen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date", "p_status" "text", "p_zahllast" numeric DEFAULT NULL::numeric, "p_notizen" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."fibu_mwst_abrechnungsperioden"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result fibu_mwst_abrechnungsperioden;
BEGIN
  IF p_status NOT IN ('offen', 'eingereicht', 'abgerechnet') THEN
    RAISE EXCEPTION 'Ungültiger Status: %', p_status;
  END IF;

  INSERT INTO fibu_mwst_abrechnungsperioden
    (mandant_id, periode_von, periode_bis, status, zahllast_chf, notizen, benutzer_id,
     eingereicht_am, abgerechnet_am)
  VALUES
    (p_mandant_id, p_von, p_bis, p_status, p_zahllast, p_notizen, auth.uid(),
     CASE WHEN p_status IN ('eingereicht','abgerechnet') THEN now() ELSE NULL END,
     CASE WHEN p_status = 'abgerechnet' THEN now() ELSE NULL END)
  ON CONFLICT (mandant_id, periode_von, periode_bis) DO UPDATE SET
    status         = EXCLUDED.status,
    zahllast_chf   = COALESCE(p_zahllast, fibu_mwst_abrechnungsperioden.zahllast_chf),
    notizen        = COALESCE(p_notizen,  fibu_mwst_abrechnungsperioden.notizen),
    benutzer_id    = auth.uid(),
    eingereicht_am = CASE
      WHEN EXCLUDED.status IN ('eingereicht','abgerechnet')
        THEN COALESCE(fibu_mwst_abrechnungsperioden.eingereicht_am, now())
      ELSE NULL END,
    abgerechnet_am = CASE
      WHEN EXCLUDED.status = 'abgerechnet'
        THEN COALESCE(fibu_mwst_abrechnungsperioden.abgerechnet_am, now())
      ELSE NULL END,
    updated_at     = now()
  RETURNING * INTO v_result;

  -- Buchungssperre an die MWST-Perioden koppeln:
  -- gesperrt_bis = Ende der spätesten eingereichten/abgerechneten Periode.
  UPDATE fibu_mandanten m
  SET gesperrt_bis = (
        SELECT MAX(periode_bis)
        FROM fibu_mwst_abrechnungsperioden
        WHERE mandant_id = p_mandant_id
          AND status IN ('eingereicht', 'abgerechnet')
      ),
      updated_at = now()
  WHERE m.id = p_mandant_id;

  RETURN NEXT v_result;
END;
$$;


ALTER FUNCTION "public"."fibu_mwst_periode_abschliessen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date", "p_status" "text", "p_zahllast" numeric, "p_notizen" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mwst_periode_get"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS SETOF "public"."fibu_mwst_abrechnungsperioden"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM fibu_mwst_abrechnungsperioden
  WHERE mandant_id = p_mandant_id
    AND periode_von = p_von
    AND periode_bis = p_bis
  LIMIT 1;
$$;


ALTER FUNCTION "public"."fibu_mwst_periode_get"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_mwst_summary"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") RETURNS TABLE("mwst_code" "text", "mwst_satz" numeric, "typ" "text", "bezeichnung" "text", "anzahl_buchungen" bigint, "sum_netto" numeric, "sum_mwst" numeric, "sum_brutto" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    b.mwst_code,
    mc.satz                                     AS mwst_satz,
    mc.typ                                      AS typ,
    mc.bezeichnung                              AS bezeichnung,
    COUNT(*)::BIGINT                            AS anzahl_buchungen,
    ROUND(SUM(b.betrag), 2)                     AS sum_netto,
    ROUND(SUM(COALESCE(b.mwst_betrag, 0)), 2)   AS sum_mwst,
    ROUND(SUM(b.betrag + COALESCE(b.mwst_betrag,0)), 2) AS sum_brutto
  FROM fibu_buchungen b
  LEFT JOIN fibu_mwst_codes mc
    ON mc.mandant_id = b.mandant_id AND mc.code = b.mwst_code
  WHERE b.mandant_id = p_mandant_id
    AND b.buchungsdatum BETWEEN p_von AND p_bis
    AND b.mwst_code IS NOT NULL
    AND NOT b.storniert
  GROUP BY b.mwst_code, mc.satz, mc.typ, mc.bezeichnung, mc.sortierung
  ORDER BY mc.sortierung NULLS LAST, b.mwst_code;
$$;


ALTER FUNCTION "public"."fibu_mwst_summary"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_next_buchungs_nr"("p_mandant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_year TEXT := TO_CHAR(NOW(), 'YYYY');
  v_last TEXT;
  v_num  INTEGER;
BEGIN
  SELECT buchungs_nr INTO v_last
  FROM fibu_buchungen
  WHERE mandant_id = p_mandant_id
    AND buchungs_nr LIKE 'BU-' || v_year || '-%'
  ORDER BY buchungs_nr DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  v_num := COALESCE(
    NULLIF(SPLIT_PART(COALESCE(v_last, ''), '-', 3), '')::INTEGER,
    0
  ) + 1;

  RETURN 'BU-' || v_year || '-' || LPAD(v_num::TEXT, 5, '0');
END;
$$;


ALTER FUNCTION "public"."fibu_next_buchungs_nr"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_remove_mandant_user"("p_mandant_id" "uuid", "p_target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_count INT;
  v_target_role TEXT;
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzer entfernen';
  END IF;

  SELECT role INTO v_target_role
  FROM fibu_user_mandant_access
  WHERE mandant_id = p_mandant_id AND user_id = p_target_user_id;

  IF v_target_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM fibu_user_mandant_access
    WHERE mandant_id = p_mandant_id AND role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Der letzte Administrator kann nicht entfernt werden';
    END IF;
  END IF;

  DELETE FROM fibu_user_mandant_access
  WHERE mandant_id = p_mandant_id AND user_id = p_target_user_id;
END;
$$;


ALTER FUNCTION "public"."fibu_remove_mandant_user"("p_mandant_id" "uuid", "p_target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_saldovortrag_lesen"("p_mandant_id" "uuid", "p_jahr" integer) RETURNS TABLE("konto_nr" "text", "saldo" numeric, "fw_saldo" numeric, "fw_waehrung" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    k.konto_nr,
    CASE WHEN k.konto_typ = 'aktiv'
         THEN SUM(CASE WHEN b.konto_soll = k.konto_nr THEN b.betrag ELSE -b.betrag END)
         ELSE SUM(CASE WHEN b.konto_haben = k.konto_nr THEN b.betrag ELSE -b.betrag END)
    END AS saldo,
    CASE WHEN k.konto_typ = 'aktiv'
         THEN SUM(CASE WHEN b.konto_soll = k.konto_nr THEN COALESCE(b.fw_betrag,0) ELSE -COALESCE(b.fw_betrag,0) END)
         ELSE SUM(CASE WHEN b.konto_haben = k.konto_nr THEN COALESCE(b.fw_betrag,0) ELSE -COALESCE(b.fw_betrag,0) END)
    END AS fw_saldo,
    MAX(b.fw_waehrung) AS fw_waehrung
  FROM fibu_buchung_belege bel
  JOIN fibu_buchungen b ON b.quelle_id = bel.id
  JOIN fibu_konten     k ON k.mandant_id = bel.mandant_id
                        AND k.konto_nr IN (b.konto_soll, b.konto_haben)
                        AND k.konto_nr <> '9100'
  WHERE bel.mandant_id = p_mandant_id
    AND bel.art = 'saldovortrag'
    AND bel.buchungsdatum = MAKE_DATE(p_jahr, 1, 1)
  GROUP BY k.konto_nr, k.konto_typ;
$$;


ALTER FUNCTION "public"."fibu_saldovortrag_lesen"("p_mandant_id" "uuid", "p_jahr" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_saldovortrag_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_salden" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_datum    DATE := MAKE_DATE(p_jahr, 1, 1);
  v_old      UUID;
  v_zeilen   JSONB := '[]'::jsonb;
  s          JSONB;
  v_typ      TEXT;
  v_saldo    NUMERIC;
  v_konto    TEXT;
  v_fw_saldo NUMERIC;
  v_fw_waehr TEXT;
  v_fw_abs   NUMERIC;
  v_beleg    UUID;
BEGIN
  IF NOT (p_mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;

  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, aktiv)
  VALUES (p_mandant_id, '9100', 'Eröffnungsbilanz', 'abschluss', true)
  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;

  FOR v_old IN
    SELECT id FROM fibu_buchung_belege
    WHERE mandant_id = p_mandant_id AND art = 'saldovortrag' AND buchungsdatum = v_datum
  LOOP
    DELETE FROM fibu_buchungen      WHERE quelle_id = v_old;
    DELETE FROM fibu_buchung_belege WHERE id = v_old;
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(p_salden)
  LOOP
    v_konto    := s->>'konto_nr';
    v_saldo    := COALESCE(NULLIF(s->>'saldo', '')::NUMERIC, 0);
    v_fw_saldo := NULLIF(s->>'fw_saldo', '')::NUMERIC;
    v_fw_waehr := NULLIF(s->>'fw_waehrung', '');
    CONTINUE WHEN v_saldo = 0 AND COALESCE(v_fw_saldo, 0) = 0;

    v_fw_abs := CASE WHEN v_fw_saldo IS NULL THEN NULL ELSE ABS(v_fw_saldo) END;

    SELECT konto_typ INTO v_typ
    FROM fibu_konten WHERE mandant_id = p_mandant_id AND konto_nr = v_konto;

    IF v_typ = 'aktiv' THEN
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    ELSE
      IF v_saldo >= 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', '9100', 'konto_haben', v_konto, 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      ELSE
        v_zeilen := v_zeilen || jsonb_build_object(
          'konto_soll', v_konto, 'konto_haben', '9100', 'betrag', ABS(v_saldo),
          'text', 'Saldovortrag', 'fw_betrag', v_fw_abs, 'fw_waehrung', v_fw_waehr);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_zeilen) = 0 THEN
    RETURN NULL;
  END IF;

  v_beleg := fibu_manuelle_buchung_erstellen(
    p_mandant_id, v_datum, 'Saldovortrag ' || p_jahr,
    NULL, NULL, 'saldovortrag', v_zeilen);
  RETURN v_beleg;
END;
$$;


ALTER FUNCTION "public"."fibu_saldovortrag_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_salden" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_seed_kontenplan_ch_kmu"("p_mandant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, mwst_code, aktiv) VALUES

    -- ═══ KLASSE 1: AKTIVEN ════════════════════════════════════════
    -- Umlaufvermögen – Flüssige Mittel
    (p_mandant_id, '1000', 'Kasse',                               'aktiv', NULL,  true),
    (p_mandant_id, '1020', 'Bank',                                'aktiv', NULL,  true),
    (p_mandant_id, '1025', 'Fremdwährungskonto',                  'aktiv', NULL,  false),
    (p_mandant_id, '1060', 'Wertschriften (kurzfristig)',         'aktiv', NULL,  false),
    -- Forderungen
    (p_mandant_id, '1100', 'Debitoren',                           'aktiv', NULL,  true),
    (p_mandant_id, '1109', 'Delkredere',                          'aktiv', NULL,  true),
    (p_mandant_id, '1140', 'Übrige kurzfristige Forderungen',     'aktiv', NULL,  true),
    -- MWST / Steuern
    (p_mandant_id, '1170', 'Vorsteuer MWST (Materialien/DL)',     'aktiv', NULL,  true),
    (p_mandant_id, '1171', 'Vorsteuer MWST (Investitionen)',      'aktiv', NULL,  true),
    (p_mandant_id, '1176', 'Verrechnungssteuer',                  'aktiv', NULL,  false),
    -- Vorräte
    (p_mandant_id, '1200', 'Handelswaren',                        'aktiv', NULL,  true),
    (p_mandant_id, '1210', 'Rohstoffe und Hilfsstoffe',           'aktiv', NULL,  false),
    (p_mandant_id, '1260', 'Fertige Erzeugnisse',                 'aktiv', NULL,  false),
    -- Rechnungsabgrenzung
    (p_mandant_id, '1300', 'Aktive Rechnungsabgrenzung',          'aktiv', NULL,  true),
    -- Anlagevermögen – Sachanlagen
    (p_mandant_id, '1500', 'Maschinen und Geräte',                'aktiv', 'I81', true),
    (p_mandant_id, '1509', 'WB Maschinen und Geräte',             'aktiv', NULL,  true),
    (p_mandant_id, '1520', 'Fahrzeuge',                           'aktiv', 'I81', true),
    (p_mandant_id, '1529', 'WB Fahrzeuge',                        'aktiv', NULL,  true),
    (p_mandant_id, '1530', 'Mobiliar und Einrichtungen',          'aktiv', 'I81', true),
    (p_mandant_id, '1539', 'WB Mobiliar und Einrichtungen',       'aktiv', NULL,  true),
    (p_mandant_id, '1540', 'Büromaschinen / IT-Ausrüstung',       'aktiv', 'I81', true),
    (p_mandant_id, '1549', 'WB Büromaschinen / IT-Ausrüstung',   'aktiv', NULL,  true),
    (p_mandant_id, '1570', 'Immaterielle Anlagen (Software etc.)', 'aktiv', 'I81', false),
    (p_mandant_id, '1579', 'WB Immaterielle Anlagen',             'aktiv', NULL,  false),
    (p_mandant_id, '1600', 'Immobilien (Grundstücke, Gebäude)',   'aktiv', 'I81', false),
    (p_mandant_id, '1609', 'WB Immobilien',                       'aktiv', NULL,  false),
    -- Finanzanlagen
    (p_mandant_id, '1400', 'Finanzanlagen (langfristig)',         'aktiv', NULL,  false),

    -- ═══ KLASSE 2: PASSIVEN ═══════════════════════════════════════
    (p_mandant_id, '2000', 'Kreditoren',                          'passiv', NULL, true),
    (p_mandant_id, '2100', 'Bankverbindlichkeiten (kurzfristig)', 'passiv', NULL, true),
    (p_mandant_id, '2200', 'Geschuldete MWST',                    'passiv', NULL, true),
    (p_mandant_id, '2206', 'MWST-Abrechnungskonto',               'passiv', NULL, true),
    (p_mandant_id, '2270', 'Sozialversicherungsverbindlichkeiten', 'passiv', NULL, true),
    (p_mandant_id, '2280', 'Direkte Steuerverbindlichkeiten',     'passiv', NULL, true),
    (p_mandant_id, '2300', 'Passive Rechnungsabgrenzung',         'passiv', NULL, true),
    (p_mandant_id, '2320', 'Rückstellungen',                      'passiv', NULL, false),
    (p_mandant_id, '2400', 'Langfristige Bankschulden',           'passiv', NULL, false),
    (p_mandant_id, '2420', 'Hypotheken',                          'passiv', NULL, false),
    (p_mandant_id, '2450', 'Darlehen (langfristig)',              'passiv', NULL, false),
    (p_mandant_id, '2800', 'Aktienkapital / Stammkapital',        'passiv', NULL, true),
    (p_mandant_id, '2850', 'Gesetzliche Kapitalreserven',         'passiv', NULL, false),
    (p_mandant_id, '2860', 'Freiwillige Gewinnreserven',          'passiv', NULL, false),
    (p_mandant_id, '2900', 'Gewinnvortrag / Verlustvortrag',      'passiv', NULL, true),
    (p_mandant_id, '2979', 'Jahresgewinn / Jahresverlust',        'passiv', NULL, true),

    -- ═══ KLASSE 3: BETRIEBSERTRAG ═════════════════════════════════
    (p_mandant_id, '3000', 'Umsatzerlöse Produkte',               'ertrag', 'U81', true),
    (p_mandant_id, '3200', 'Umsatzerlöse Handel',                 'ertrag', 'U81', true),
    (p_mandant_id, '3400', 'Umsatzerlöse Dienstleistungen',       'ertrag', 'U81', true),
    (p_mandant_id, '3600', 'Sonstige Betriebserträge',            'ertrag', 'U81', true),
    (p_mandant_id, '3700', 'Eigenleistungen und Eigenverbrauch',  'ertrag', NULL,  false),
    (p_mandant_id, '3800', 'Ertragsminderungen (Rabatte, Retouren)', 'ertrag', 'U81', true),

    -- ═══ KLASSE 4: MATERIAL- / WARENAUFWAND ══════════════════════
    (p_mandant_id, '4000', 'Materialaufwand (Produktion)',        'aufwand', 'M81', true),
    (p_mandant_id, '4200', 'Warenaufwand (Handel)',               'aufwand', 'M81', true),
    (p_mandant_id, '4400', 'Bezogene Dienstleistungen',           'aufwand', 'M81', true),
    (p_mandant_id, '4500', 'Energieaufwand (Produktion)',         'aufwand', 'M81', false),
    (p_mandant_id, '4900', 'Bestandesänderungen',                 'aufwand', NULL,  false),

    -- ═══ KLASSE 5: PERSONALAUFWAND ════════════════════════════════
    (p_mandant_id, '5000', 'Löhne und Gehälter',                  'aufwand', 'M0', true),
    (p_mandant_id, '5700', 'AHV / IV / EO / ALV (Arbeitgeberanteil)', 'aufwand', 'M0', true),
    (p_mandant_id, '5710', 'Pensionskasse BVG (Arbeitgeberanteil)', 'aufwand', 'M0', true),
    (p_mandant_id, '5730', 'UVG / KTG',                           'aufwand', 'M0', true),
    (p_mandant_id, '5740', 'Kinderzulagen',                       'aufwand', 'M0', false),
    (p_mandant_id, '5800', 'Übriger Personalaufwand',             'aufwand', 'M81', true),
    (p_mandant_id, '5820', 'Personalspesen (pauschal)',           'aufwand', 'M81', false),
    (p_mandant_id, '5900', 'Temporäre Arbeitskräfte / Freelancer','aufwand', 'M81', false),

    -- ═══ KLASSE 6: ÜBRIGER BETRIEBLICHER AUFWAND ═════════════════
    (p_mandant_id, '6000', 'Miete / Raumaufwand',                 'aufwand', 'M81', true),
    (p_mandant_id, '6020', 'Nebenkosten (Heizung, Strom)',        'aufwand', 'M81', true),
    (p_mandant_id, '6040', 'Reinigung und Pflege',                'aufwand', 'M81', false),
    (p_mandant_id, '6100', 'Unterhalt, Reparaturen, Ersatz',      'aufwand', 'M81', true),
    (p_mandant_id, '6200', 'Fahrzeug- und Transportaufwand',      'aufwand', 'M81', true),
    (p_mandant_id, '6220', 'Treibstoff',                          'aufwand', 'M81', false),
    (p_mandant_id, '6260', 'Reise- und Spesenaufwand',            'aufwand', 'M81', true),
    (p_mandant_id, '6261', 'Geschäftsessen (50 % Abzug)',         'aufwand', 'M26', true),
    (p_mandant_id, '6300', 'Sachversicherungen',                  'aufwand', 'M0',  true),
    (p_mandant_id, '6320', 'Haftpflicht- und Betriebsversicherungen','aufwand', 'M0', false),
    (p_mandant_id, '6400', 'Energie und Entsorgung (Büro)',       'aufwand', 'M81', false),
    (p_mandant_id, '6500', 'Büromaterial und Drucksachen',        'aufwand', 'M81', true),
    (p_mandant_id, '6510', 'Telefon und Internet',                'aufwand', 'M81', true),
    (p_mandant_id, '6520', 'EDV / IT-Aufwand (Software, Lizenzen)','aufwand', 'M81', true),
    (p_mandant_id, '6530', 'Beratung, Treuhand, Rechtsberatung',  'aufwand', 'M81', true),
    (p_mandant_id, '6540', 'Buchführung und Revision',            'aufwand', 'M81', true),
    (p_mandant_id, '6560', 'Gebühren, Abgaben, Handelsregister',  'aufwand', 'M0',  true),
    (p_mandant_id, '6570', 'Aus- und Weiterbildung',              'aufwand', 'M81', true),
    (p_mandant_id, '6580', 'Bücher und Zeitschriften',            'aufwand', 'M26', false),
    (p_mandant_id, '6600', 'Werbe- und Marketingaufwand',         'aufwand', 'M81', true),
    (p_mandant_id, '6640', 'Messen, Ausstellungen, Events',       'aufwand', 'M81', false),
    (p_mandant_id, '6700', 'Sonstiger Betriebsaufwand',           'aufwand', 'M81', true),
    (p_mandant_id, '6800', 'Abschreibungen auf Anlagevermögen',   'aufwand', NULL,  true),
    (p_mandant_id, '6850', 'Wertberichtigungen Umlaufvermögen',   'aufwand', NULL,  false),
    (p_mandant_id, '6900', 'Zinsaufwand',                         'aufwand', 'M0',  true),
    (p_mandant_id, '6910', 'Bankspesen und Kommissionen',         'aufwand', 'M0',  true),
    (p_mandant_id, '6940', 'Kursdifferenzen (Verlust)',           'aufwand', NULL,  false),
    (p_mandant_id, '6960', 'Finanzertrag (Zinsen, Dividenden)',   'ertrag',  NULL,  true),

    -- ═══ KLASSE 7: NEBENBETRIEB / LIEGENSCHAFTEN ══════════════════
    (p_mandant_id, '7000', 'Ertrag Nebenbetrieb',                 'ertrag',  'U81', false),
    (p_mandant_id, '7010', 'Aufwand Nebenbetrieb',                'aufwand', 'M81', false),
    (p_mandant_id, '7500', 'Liegenschaftsertrag',                 'ertrag',  'U81', false),
    (p_mandant_id, '7510', 'Liegenschaftsaufwand',                'aufwand', 'M81', false),

    -- ═══ KLASSE 8: BETRIEBSFREMDES / AUSSERORDENTLICHES ══════════
    (p_mandant_id, '8000', 'Betriebsfremder Aufwand',             'aufwand', NULL,  false),
    (p_mandant_id, '8100', 'Betriebsfremder Ertrag',              'ertrag',  NULL,  false),
    (p_mandant_id, '8500', 'Ausserordentlicher Aufwand',          'aufwand', NULL,  false),
    (p_mandant_id, '8510', 'Ausserordentlicher Ertrag',           'ertrag',  NULL,  false),
    (p_mandant_id, '8900', 'Direkte Steuern (Ertragssteuer)',     'aufwand', NULL,  true),

    -- ═══ KLASSE 9: ABSCHLUSSKONTEN ════════════════════════════════
    (p_mandant_id, '9200', 'Jahresgewinn / Jahresverlust',        'abschluss', NULL, true)

  ON CONFLICT (mandant_id, konto_nr) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."fibu_seed_kontenplan_ch_kmu"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_seed_mwst_codes"("p_mandant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO fibu_mwst_codes
    (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung)
  VALUES
    -- Vorsteuer (Einkauf / Kreditoren) ──────────────────────────
    (p_mandant_id, 'M81', 'Vorsteuer 8.1 % (Normalsteuersatz)',           8.1, 'vorsteuer',     '1170', NULL,   10),
    (p_mandant_id, 'M26', 'Vorsteuer 2.6 % (Reduziertensatz)',            2.6, 'vorsteuer',     '1170', NULL,   20),
    (p_mandant_id, 'M38', 'Vorsteuer 3.8 % (Beherbergung)',               3.8, 'vorsteuer',     '1170', NULL,   30),
    (p_mandant_id, 'I81', 'Vorsteuer Investitionen 8.1 %',                8.1, 'vorsteuer',     '1171', NULL,   40),
    (p_mandant_id, 'M0',  'Kein MWST (steuerbefreit / nicht steuerpfl.)', 0.0, 'steuerbefreit', NULL,   NULL,   50),
    -- Umsatzsteuer (Verkauf / Debitoren) ─────────────────────────
    (p_mandant_id, 'U81', 'Umsatzsteuer 8.1 % (Normalsteuersatz)',        8.1, 'umsatzsteuer',  NULL,  '2200',  60),
    (p_mandant_id, 'U26', 'Umsatzsteuer 2.6 % (Reduziertensatz)',         2.6, 'umsatzsteuer',  NULL,  '2200',  70),
    (p_mandant_id, 'U38', 'Umsatzsteuer 3.8 % (Beherbergung)',            3.8, 'umsatzsteuer',  NULL,  '2200',  80),
    (p_mandant_id, 'U0',  'Steuerbefreite Umsätze (Export, etc.)',        0.0, 'steuerbefreit', NULL,   NULL,   90)
  ON CONFLICT (mandant_id, code) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."fibu_seed_mwst_codes"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_set_freigabe_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_aktiv BOOLEAN;
BEGIN
  -- Gutschriften (inkl. Storno) brauchen keine Freigabe
  IF NEW.belegtyp = 'gutschrift' THEN
    NEW.freigabe_status := 'freigegeben';
    RETURN NEW;
  END IF;
  SELECT belegfreigabe_aktiv INTO v_aktiv FROM fibu_mandanten WHERE id = NEW.mandant_id;
  NEW.freigabe_status := CASE WHEN COALESCE(v_aktiv, false)
                              THEN 'ausstehend' ELSE 'freigegeben' END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fibu_set_freigabe_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_set_mandant_user_role"("p_mandant_id" "uuid", "p_target_user_id" "uuid", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzerrollen ändern';
  END IF;

  IF p_role NOT IN ('admin', 'buchhalter', 'readonly') THEN
    RAISE EXCEPTION 'Ungültige Rolle: %', p_role;
  END IF;

  INSERT INTO fibu_user_mandant_access (mandant_id, user_id, role)
  VALUES (p_mandant_id, p_target_user_id, p_role)
  ON CONFLICT (user_id, mandant_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;


ALTER FUNCTION "public"."fibu_set_mandant_user_role"("p_mandant_id" "uuid", "p_target_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."fibu_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_skonto_buchen"("p_beleg_id" "uuid", "p_skonto_betrag" numeric, "p_datum" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_beleg    RECORD;
  v_methode  TEXT;
  v_saldo    BOOLEAN;
  v_pos      RECORD;
  v_vs       NUMERIC;       -- Vorsteuer-Anteil des Skontos
  v_netto    NUMERIC;       -- Netto-Anteil des Skontos
  v_nr       TEXT;
BEGIN
  SELECT * INTO v_beleg FROM fibu_kreditoren_belege WHERE id = p_beleg_id;
  IF v_beleg.id IS NULL THEN
    RAISE EXCEPTION 'Beleg nicht gefunden';
  END IF;
  IF NOT (v_beleg.mandant_id = ANY(fibu_mandant_ids_for_user())) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten';
  END IF;
  IF p_skonto_betrag IS NULL OR p_skonto_betrag <= 0 THEN
    RETURN;
  END IF;

  SELECT mwst_methode INTO v_methode FROM fibu_mandanten WHERE id = v_beleg.mandant_id;
  v_saldo := (COALESCE(v_methode, 'effektiv') = 'saldosteuersatz');

  -- Hauptposition: liefert Aufwandskonto + Vorsteuer-Konto
  SELECT p.*, mc.konto_vorsteuer INTO v_pos
  FROM fibu_kreditoren_positionen p
  LEFT JOIN fibu_mwst_codes mc ON mc.mandant_id = p.mandant_id AND mc.code = p.mwst_code
  WHERE p.beleg_id = p_beleg_id
  ORDER BY p.position
  LIMIT 1;
  IF v_pos.konto_nr IS NULL THEN
    RAISE EXCEPTION 'Beleg % hat keine Positionen', v_beleg.beleg_nr;
  END IF;

  -- Vorsteuer-Anteil (nur effektive Methode, anteilig zum MWST-Satz des Belegs)
  IF NOT v_saldo
     AND COALESCE(v_beleg.betrag_mwst, 0) > 0
     AND COALESCE(v_beleg.betrag_brutto, 0) <> 0
     AND v_pos.konto_vorsteuer IS NOT NULL THEN
    v_vs := ROUND(p_skonto_betrag * ABS(v_beleg.betrag_mwst) / ABS(v_beleg.betrag_brutto), 2);
  ELSE
    v_vs := 0;
  END IF;
  v_netto := p_skonto_betrag - v_vs;

  -- ── Buchung 1: Kreditoren SOLL / Aufwand HABEN (Netto-Anteil) ──────
  v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
  INSERT INTO fibu_buchungen (
    mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
    konto_soll, konto_haben, betrag, text, quelle, quelle_id, created_by
  ) VALUES (
    v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
    '2000', v_pos.konto_nr, v_netto,
    'Skonto ' || v_beleg.beleg_nr, 'kreditoren', p_beleg_id, auth.uid()
  );

  -- ── Buchung 2: Vorsteuer-Korrektur (nur effektiv, wenn MWST) ──────
  IF v_vs > 0 THEN
    v_nr := fibu_next_buchungs_nr(v_beleg.mandant_id);
    INSERT INTO fibu_buchungen (
      mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
      konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
      text, quelle, quelle_id, created_by
    ) VALUES (
      v_beleg.mandant_id, v_nr, p_datum, v_beleg.beleg_nr,
      '2000', v_pos.konto_vorsteuer, v_vs,
      v_pos.mwst_code, -v_vs,
      'Skonto Vorsteuer-Korrektur ' || v_beleg.beleg_nr,
      'kreditoren', p_beleg_id, auth.uid()
    );
  END IF;

  -- ── Beleg: Skonto-Betrag als bezahlt gutschreiben ─────────────────
  UPDATE fibu_kreditoren_belege SET
    betrag_bezahlt = COALESCE(betrag_bezahlt, 0) + p_skonto_betrag,
    status = CASE
      WHEN COALESCE(betrag_bezahlt, 0) + p_skonto_betrag >= betrag_brutto - 0.005
        THEN 'bezahlt' ELSE 'teilbezahlt' END,
    updated_at = NOW()
  WHERE id = p_beleg_id;
END;
$$;


ALTER FUNCTION "public"."fibu_skonto_buchen"("p_beleg_id" "uuid", "p_skonto_betrag" numeric, "p_datum" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_user_has_any_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access WHERE user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."fibu_user_has_any_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_user_is_admin_for"("p_mandant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE user_id = auth.uid()
      AND mandant_id = p_mandant_id
      AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."fibu_user_is_admin_for"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_user_is_any_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM fibu_user_mandant_access
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."fibu_user_is_any_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_zahlstelle_set_standard"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mandant UUID;
BEGIN
  SELECT mandant_id INTO v_mandant FROM fibu_zahlstellen WHERE id = p_id;
  IF v_mandant IS NULL THEN
    RETURN;
  END IF;
  UPDATE fibu_zahlstellen
    SET ist_standard = false
    WHERE mandant_id = v_mandant AND ist_standard AND id <> p_id;
  UPDATE fibu_zahlstellen
    SET ist_standard = true
    WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."fibu_zahlstelle_set_standard"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fibu_zahlungslauf_historie"("p_mandant_id" "uuid") RETURNS TABLE("id" "uuid", "lauf_nr" "text", "valutadatum" "date", "zahlungskonto_nr" "text", "total_betrag" numeric, "anzahl_zahlungen" smallint, "status" "text", "exportiert_am" timestamp with time zone, "verbucht_am" timestamp with time zone, "created_at" timestamp with time zone, "anzahl_bezahlt" bigint, "hat_xml" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    z.id, z.lauf_nr, z.valutadatum, z.zahlungskonto_nr,
    z.total_betrag, z.anzahl_zahlungen, z.status,
    z.exportiert_am, z.verbucht_am, z.created_at,
    (SELECT COUNT(*) FROM fibu_zahlungslauf_positionen zlp
       WHERE zlp.zahlungslauf_id = z.id AND zlp.rueckgemeldet)  AS anzahl_bezahlt,
    (z.pain001_xml IS NOT NULL)                                 AS hat_xml
  FROM fibu_zahlungslaeufe z
  WHERE z.mandant_id = p_mandant_id
  ORDER BY z.created_at DESC;
$$;


ALTER FUNCTION "public"."fibu_zahlungslauf_historie"("p_mandant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customers_for_addin"() RETURNS TABLE("id" "uuid", "company_name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT id, company_name FROM customers ORDER BY company_name LIMIT 500; $$;


ALTER FUNCTION "public"."get_customers_for_addin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tags_for_addin"() RETURNS TABLE("id" "uuid", "name" "text", "parent_id" "uuid", "color" "text", "category" "text", "sort_order" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT id, name, parent_id, color, category, sort_order FROM dok_tags ORDER BY sort_order LIMIT 500; $$;


ALTER FUNCTION "public"."get_tags_for_addin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_customer_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  c_proj int;
  c_inv int;
  c_pay int;
  c_dun int;
  c_rec int;
  c_exp int;
begin
  select count(*) into c_proj from public.le_project           where customer_id = old.id;
  select count(*) into c_inv  from public.le_invoice           where customer_id = old.id;
  select count(*) into c_pay  from public.le_payment           where customer_id = old.id;
  select count(*) into c_dun  from public.le_dunning           where customer_id = old.id;
  select count(*) into c_rec  from public.le_recurring_invoice where customer_id = old.id;
  select count(*) into c_exp  from public.le_expense           where customer_id = old.id;

  if (c_proj + c_inv + c_pay + c_dun + c_rec + c_exp) > 0 then
    raise exception 'Kunde "%" kann nicht gelöscht werden: % Projekt(e), % Rechnung(en), % Zahlung(en), % Mahnung(en), % Wiederkehrende, % Spesen verknüpft. Bitte stattdessen den Kunden im CRM auf "inaktiv" setzen.',
      coalesce(old.company_name, old.id::text), c_proj, c_inv, c_pay, c_dun, c_rec, c_exp;
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."le_block_customer_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_employee_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  cnt_entries int;
  cnt_expenses int;
  cnt_absences int;
begin
  select count(*) into cnt_entries  from public.le_time_entry where employee_id = old.id;
  select count(*) into cnt_expenses from public.le_expense    where employee_id = old.id;
  select count(*) into cnt_absences from public.le_absence    where employee_id = old.id;

  if (cnt_entries + cnt_expenses + cnt_absences) > 0 then
    raise exception 'Mitarbeiter "%" kann nicht gelöscht werden: % Rapport(e), % Spesen, % Abwesenheit(en) sind verknüpft. Bitte stattdessen inaktivieren oder archivieren (active=false).',
      old.full_name, cnt_entries, cnt_expenses, cnt_absences
      using errcode = '23P01';  -- "exclusion_violation" – wir nutzen dies als generischen "blocked"-Code
  end if;

  return old;
end $$;


ALTER FUNCTION "public"."le_block_employee_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_employee_group_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare c_emp int;
begin
  select count(*) into c_emp from public.le_employee where employee_group_id = old.id;
  if c_emp > 0 then
    raise exception 'Mitarbeitergruppe "%" kann nicht gelöscht werden: % Mitarbeiter sind zugewiesen.', old.name, c_emp;
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."le_block_employee_group_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_locked_time_entry"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."le_block_locked_time_entry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_project_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  c_entries int;
  c_invoices int;
  c_recurring int;
  c_expenses int;
begin
  select count(*) into c_entries   from public.le_time_entry        where project_id = old.id;
  select count(*) into c_invoices  from public.le_invoice           where project_id = old.id;
  select count(*) into c_recurring from public.le_recurring_invoice where project_id = old.id;
  select count(*) into c_expenses  from public.le_expense           where project_id = old.id;

  if (c_entries + c_invoices + c_recurring + c_expenses) > 0 then
    raise exception 'Projekt "%" kann nicht gelöscht werden: % Rapport(e), % Rechnung(en), % Wiederkehrende, % Spesen verknüpft. Bitte stattdessen archivieren (status=''archiviert'').',
      old.name, c_entries, c_invoices, c_recurring, c_expenses;
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."le_block_project_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_rate_group_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare c_proj int;
begin
  select count(*) into c_proj from public.le_project where rate_group_id = old.id;
  if c_proj > 0 then
    raise exception 'Gruppenansatz "%" kann nicht gelöscht werden: % Projekt(e) nutzen ihn. Bitte stattdessen deaktivieren (active=false).', old.name, c_proj;
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."le_block_rate_group_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_block_service_type_delete_if_referenced"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  c_entries int;
  c_lines int;
  c_rates int;
  c_history int;
begin
  select count(*) into c_entries from public.le_time_entry          where service_type_id = old.id;
  select count(*) into c_lines   from public.le_invoice_line        where service_type_id = old.id;
  select count(*) into c_rates   from public.le_rate_group_rate     where service_type_id = old.id;
  select count(*) into c_history from public.le_service_rate_history where service_type_id = old.id;

  if (c_entries + c_lines + c_rates + c_history) > 0 then
    raise exception 'Leistungsart "%" kann nicht gelöscht werden: % Rapport(e), % Rechnungsposition(en), % Gruppen-Sätze, % Satz-Historie verknüpft. Bitte stattdessen deaktivieren (active=false).',
      old.name, c_entries, c_lines, c_rates, c_history;
  end if;
  return old;
end $$;


ALTER FUNCTION "public"."le_block_service_type_delete_if_referenced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_customer_can_delete"("p_customer_id" "uuid") RETURNS TABLE("can_delete" boolean, "project_count" integer, "invoice_count" integer, "payment_count" integer, "dunning_count" integer, "recurring_count" integer, "expense_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare cp int; ci int; cy int; cd int; cr int; cx int;
begin
  select count(*) into cp from public.le_project           where customer_id = p_customer_id;
  select count(*) into ci from public.le_invoice           where customer_id = p_customer_id;
  select count(*) into cy from public.le_payment           where customer_id = p_customer_id;
  select count(*) into cd from public.le_dunning           where customer_id = p_customer_id;
  select count(*) into cr from public.le_recurring_invoice where customer_id = p_customer_id;
  select count(*) into cx from public.le_expense           where customer_id = p_customer_id;
  return query select (cp + ci + cy + cd + cr + cx) = 0, cp, ci, cy, cd, cr, cx;
end $$;


ALTER FUNCTION "public"."le_customer_can_delete"("p_customer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_employee_can_delete"("p_employee_id" "uuid") RETURNS TABLE("can_delete" boolean, "entry_count" integer, "expense_count" integer, "absence_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare
  c_e int;
  c_x int;
  c_a int;
begin
  select count(*) into c_e from public.le_time_entry where employee_id = p_employee_id;
  select count(*) into c_x from public.le_expense    where employee_id = p_employee_id;
  select count(*) into c_a from public.le_absence    where employee_id = p_employee_id;
  return query select (c_e + c_x + c_a) = 0, c_e, c_x, c_a;
end $$;


ALTER FUNCTION "public"."le_employee_can_delete"("p_employee_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."le_is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_next_dunning_no"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare y int := extract(year from current_date); last_no int; new_no int;
begin
  select coalesce(max((regexp_match(dunning_no, 'M-\d{4}-(\d+)'))[1]::int), 0) into last_no
  from public.le_dunning where dunning_no like 'M-' || y || '-%';
  new_no := last_no + 1;
  return 'M-' || y || '-' || lpad(new_no::text, 4, '0');
end $$;


ALTER FUNCTION "public"."le_next_dunning_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_next_invoice_no"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  y int := extract(year from current_date);
  last_no int;
  new_no  int;
begin
  select coalesce(max((regexp_match(invoice_no, 'R-\d{4}-(\d+)'))[1]::int), 0)
    into last_no
  from public.le_invoice
  where invoice_no like 'R-' || y || '-%';
  new_no := last_no + 1;
  return 'R-' || y || '-' || lpad(new_no::text, 4, '0');
end $$;


ALTER FUNCTION "public"."le_next_invoice_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_project_can_delete"("p_project_id" "uuid") RETURNS TABLE("can_delete" boolean, "entry_count" integer, "invoice_count" integer, "recurring_count" integer, "expense_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare ce int; ci int; cr int; cx int;
begin
  select count(*) into ce from public.le_time_entry        where project_id = p_project_id;
  select count(*) into ci from public.le_invoice           where project_id = p_project_id;
  select count(*) into cr from public.le_recurring_invoice where project_id = p_project_id;
  select count(*) into cx from public.le_expense           where project_id = p_project_id;
  return query select (ce + ci + cr + cx) = 0, ce, ci, cr, cx;
end $$;


ALTER FUNCTION "public"."le_project_can_delete"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_resolve_rate"("p_project_id" "uuid", "p_employee_id" "uuid", "p_service_type_id" "uuid", "p_date" "date" DEFAULT CURRENT_DATE) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  proj record;
  emp record;
  grp record;
  rate numeric;
begin
  select rate_mode, special_rate, rate_group_id into proj
    from public.le_project where id = p_project_id;

  if proj is null then return 0; end if;

  if proj.rate_mode = 'special' then
    return coalesce(proj.special_rate, 0);
  end if;

  if proj.rate_mode = 'employee' then
    select billable_rate into rate from public.le_employee where id = p_employee_id;
    return coalesce(rate, 0);
  end if;

  if proj.rate_mode = 'employee_group' then
    select g.billable_rate into rate
      from public.le_employee e
      join public.le_employee_group g on g.id = e.employee_group_id
      where e.id = p_employee_id;
    return coalesce(rate, 0);
  end if;

  -- Default: service_type via rate_group oder service_rate_history
  if proj.rate_group_id is not null then
    select rgr.rate into rate
      from public.le_rate_group_rate rgr
      where rgr.rate_group_id = proj.rate_group_id
        and rgr.service_type_id = p_service_type_id
        and rgr.valid_from <= p_date
      order by rgr.valid_from desc
      limit 1;
    if rate is not null then return rate; end if;
  end if;

  select srh.rate into rate
    from public.le_service_rate_history srh
    where srh.service_type_id = p_service_type_id
      and srh.valid_from <= p_date
    order by srh.valid_from desc
    limit 1;
  return coalesce(rate, 0);
end $$;


ALTER FUNCTION "public"."le_resolve_rate"("p_project_id" "uuid", "p_employee_id" "uuid", "p_service_type_id" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_resolve_vat_rate"("p_code" "text", "p_date" "date" DEFAULT CURRENT_DATE) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
declare r numeric;
begin
  select rate into r
    from public.le_vat_rate
    where code = p_code
      and valid_from <= p_date
      and (valid_to is null or valid_to >= p_date)
      and active = true
    order by valid_from desc
    limit 1;
  return coalesce(r, 0);
end $$;


ALTER FUNCTION "public"."le_resolve_vat_rate"("p_code" "text", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_service_type_can_delete"("p_id" "uuid") RETURNS TABLE("can_delete" boolean, "entry_count" integer, "line_count" integer, "rate_count" integer, "history_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare ce int; cl int; cr int; ch int;
begin
  select count(*) into ce from public.le_time_entry          where service_type_id = p_id;
  select count(*) into cl from public.le_invoice_line        where service_type_id = p_id;
  select count(*) into cr from public.le_rate_group_rate     where service_type_id = p_id;
  select count(*) into ch from public.le_service_rate_history where service_type_id = p_id;
  return query select (ce + cl + cr + ch) = 0, ce, cl, cr, ch;
end $$;


ALTER FUNCTION "public"."le_service_type_can_delete"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."le_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_short_code_from_name"("p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  parts text[];
  out text := '';
  i int;
begin
  if p_name is null or length(trim(p_name)) = 0 then return 'XX'; end if;
  parts := regexp_split_to_array(trim(p_name), '\s+');
  for i in 1..least(array_length(parts, 1), 3) loop
    if length(parts[i]) > 0 then
      out := out || upper(substring(parts[i] from 1 for 1));
    end if;
  end loop;
  if length(out) = 0 then out := 'XX'; end if;
  return out;
end $$;


ALTER FUNCTION "public"."le_short_code_from_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_sync_profile_to_employee"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  base_code text;
  unique_code text;
  nom text;
begin
  -- Nur einfügen wenn noch keiner existiert
  if exists (select 1 from public.le_employee where profile_id = new.id) then
    return new;
  end if;

  nom := coalesce(new.full_name, split_part(new.email, '@', 1));
  base_code := public.le_short_code_from_name(nom);
  unique_code := public.le_unique_short_code(base_code);

  insert into public.le_employee (profile_id, short_code, full_name, email, role, active)
  values (new.id, unique_code, nom, new.email, new.role, true);
  return new;
end $$;


ALTER FUNCTION "public"."le_sync_profile_to_employee"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_unique_short_code"("p_base" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  candidate text := p_base;
  i int := 2;
begin
  while exists (select 1 from public.le_employee where short_code = candidate) loop
    candidate := p_base || i::text;
    i := i + 1;
    if i > 99 then exit; end if;
  end loop;
  return candidate;
end $$;


ALTER FUNCTION "public"."le_unique_short_code"("p_base" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."le_update_employee_from_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if (new.full_name is distinct from old.full_name)
     or (new.email is distinct from old.email)
     or (new.role is distinct from old.role)
  then
    update public.le_employee
       set full_name = coalesce(new.full_name, full_name),
           email = coalesce(new.email, email),
           role = coalesce(new.role, role)
     where profile_id = new.id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."le_update_employee_from_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "name" "text", "filename" "text", "category" "text", "year" integer, "customer_id" "uuid", "storage_path" "text", "file_size" bigint, "file_type" "text", "notes" "text", "created_at" timestamp with time zone, "rank" real, "headline" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_query tsquery;
BEGIN
  BEGIN
    v_query := websearch_to_tsquery('german', p_query);
  EXCEPTION WHEN OTHERS THEN
    v_query := to_tsquery('simple', regexp_replace(trim(p_query), '\s+', ':* & ', 'g') || ':*');
  END;
  RETURN QUERY
    SELECT d.id, d.name, d.filename, d.category, d.year, d.customer_id,
      d.storage_path, d.file_size, d.file_type, d.notes, d.created_at,
      ts_rank_cd(d.search_vector, v_query) AS rank,
      ts_headline('german', coalesce(d.name,'') || ' ' || coalesce(d.notes,''),
        v_query, 'MaxWords=10, MinWords=3, ShortWord=2') AS headline
    FROM public.dokumente d
    WHERE d.search_vector @@ v_query
      AND (p_customer_id IS NULL OR d.customer_id = p_customer_id)
    ORDER BY rank DESC, d.created_at DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tax_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tax_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_anbu_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end $$;


ALTER FUNCTION "public"."tg_anbu_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_auto_index_document"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.storage_path IS NOT NULL AND (NEW.content_text IS NULL OR NEW.content_text = '') THEN
    PERFORM net.http_post(
      url     := 'https://api.artis.sm-artis.ch/functions/v1/index-document',
      body    := jsonb_build_object('doc_id', NEW.id)::text,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A'
      )
    );
  END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."trg_auto_index_document"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_brief_vorlagen_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_brief_vorlagen_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_dokumente_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_dokumente_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_fahrzeuge_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."update_fahrzeuge_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_fristen_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_fristen_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_kb_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."update_kb_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_steuerdaten_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_steuerdaten_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_support_tickets_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_support_tickets_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ablage_dateien" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "storage_path" "text" NOT NULL,
    "dateiname" "text" NOT NULL,
    "dateityp" "text",
    "groesse" bigint,
    "customer_id" "uuid",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "beschreibung" "text",
    "ordner" "text" DEFAULT '/'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ablage_dateien" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."abschluss" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "geschaeftsjahr" integer NOT NULL,
    "status" "public"."abschluss_status" DEFAULT 'in_arbeit'::"public"."abschluss_status" NOT NULL,
    "notizen" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "einstellungen" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."abschluss" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."abschluss_konten" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "abschluss_id" "uuid" NOT NULL,
    "kontonummer" "text" NOT NULL,
    "kontoname" "text" DEFAULT ''::"text" NOT NULL,
    "saldo_ist" numeric(15,2) DEFAULT 0 NOT NULL,
    "saldo_vorjahr" numeric(15,2),
    "position_id" "text",
    "position_override" boolean DEFAULT false NOT NULL,
    "notiz" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "arbeitspapier" "jsonb"
);


ALTER TABLE "public"."abschluss_konten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "order" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "uuid" NOT NULL,
    "item_id" "text" NOT NULL,
    "filename" "text" NOT NULL,
    "jwt" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    "used_at" timestamp with time zone,
    "download_url" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."agent_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aktienbuch" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "customer_id" "uuid" NOT NULL,
    "aktionaer_name" "text" DEFAULT ''::"text" NOT NULL,
    "aktionaer_adresse" "text" DEFAULT ''::"text" NOT NULL,
    "wirtschaftlich_berechtigter" "text" DEFAULT ''::"text" NOT NULL,
    "nutzniesser" "text" DEFAULT ''::"text" NOT NULL,
    "aktienart" "text" DEFAULT 'Namenaktie'::"text" NOT NULL,
    "anzahl" integer DEFAULT 0 NOT NULL,
    "nominalwert" numeric(10,2) DEFAULT 100 NOT NULL,
    "liberierungsgrad" integer DEFAULT 100 NOT NULL,
    "zertifikat_nr" "text" DEFAULT ''::"text" NOT NULL,
    "aktien_nr_von" integer,
    "aktien_nr_bis" integer,
    "transaktionstyp" "text" DEFAULT 'Emission'::"text" NOT NULL,
    "kaufdatum" "date",
    "verkaufsdatum" "date",
    "datum_vr_entscheid" "date",
    "vorgaenger_id" "uuid",
    "aktiv" boolean DEFAULT true NOT NULL,
    "vinkuliert" boolean DEFAULT false NOT NULL,
    "notizen" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."aktienbuch" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anbu_anlage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "abschluss_id" "uuid" NOT NULL,
    "inv_nr" "text",
    "beschreibung" "text" NOT NULL,
    "lieferant" "text",
    "typ" "text" DEFAULT 'Kauf'::"text" NOT NULL,
    "menge" numeric DEFAULT 1 NOT NULL,
    "aktiviert" boolean DEFAULT true NOT NULL,
    "beschaffung_monat" integer,
    "beschaffung_jahr" integer,
    "beschaffungskosten_netto" numeric DEFAULT 0 NOT NULL,
    "fibu_konto" "text",
    "kategorie_id" "uuid",
    "sub_kategorie" "text",
    "notiz" "text",
    "anbu_nutzungsdauer_j" integer,
    "anbu_buchwert_anfang" numeric DEFAULT 0 NOT NULL,
    "anbu_abschreibung_gj" numeric DEFAULT 0 NOT NULL,
    "anbu_korrektur" numeric DEFAULT 0 NOT NULL,
    "anbu_buchwert_ende" numeric DEFAULT 0 NOT NULL,
    "fibu_abschreibung_pct" numeric,
    "fibu_buchwert_anfang" numeric DEFAULT 0 NOT NULL,
    "fibu_abschreibung_gj" numeric DEFAULT 0 NOT NULL,
    "fibu_korrektur" numeric DEFAULT 0 NOT NULL,
    "fibu_buchwert_ende" numeric DEFAULT 0 NOT NULL,
    "sortierung" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."anbu_anlage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anbu_jahresabschluss" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "geschaeftsjahr" integer NOT NULL,
    "einstellungen" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."anbu_jahresabschluss" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anbu_kategorie" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "reihenfolge" integer DEFAULT 0 NOT NULL,
    "default_anbu_nutzungsdauer_j" integer,
    "default_fibu_abschreibung_pct" numeric,
    "notiz" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."anbu_kategorie" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brief_vorlagen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."brief_vorlagen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "outlook_id" "text" NOT NULL,
    "subject" "text",
    "body_preview" "text",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "is_all_day" boolean DEFAULT false,
    "location" "text",
    "online_meeting_url" "text",
    "organizer_name" "text",
    "organizer_email" "text",
    "response_status" "text" DEFAULT 'none'::"text",
    "is_cancelled" boolean DEFAULT false,
    "importance" "text" DEFAULT 'normal'::"text",
    "categories" "text"[] DEFAULT '{}'::"text"[],
    "customer_id" "uuid",
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."call_notes_pending" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "phone_number" "text" NOT NULL,
    "phone_suffix" "text",
    "created_by" "uuid",
    "artis_user_name" "text",
    "artis_user_email" "text",
    "note_title" "text",
    "note_text" "text",
    "clicked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linked_call_id" "uuid",
    "linked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."call_notes_pending" OWNER TO "postgres";


COMMENT ON TABLE "public"."call_notes_pending" IS 'Vorab-Notizen beim Click-to-Call in MailFlow. Wird vom sync-teams-calls Job an den realen call_records-Eintrag angehängt (gleicher Mitarbeiter + gleiche Nummer ±30 Min).';



CREATE TABLE IF NOT EXISTS "public"."call_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "graph_call_id" "text" NOT NULL,
    "customer_id" "uuid",
    "direction" "text",
    "call_type" "text",
    "caller_number" "text",
    "callee_number" "text",
    "caller_name" "text",
    "callee_name" "text",
    "artis_user_id" "text",
    "artis_user_name" "text",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "duration_seconds" integer,
    "notes" "text",
    "raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_id_manual" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."call_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."call_records" IS 'Telefon-Anrufprotokoll aus MS Teams / Teams Phone (Graph callRecords). Additiv, separat von Mail-Integration.';



COMMENT ON COLUMN "public"."call_records"."graph_call_id" IS 'ID aus Microsoft Graph callRecords — eindeutig, für Deduplikation';



COMMENT ON COLUMN "public"."call_records"."direction" IS 'incoming = Kunde→Artis, outgoing = Artis→Kunde';



COMMENT ON COLUMN "public"."call_records"."call_type" IS 'peerToPeer / group / pstnCall';



COMMENT ON COLUMN "public"."call_records"."artis_user_id" IS 'Graph user id (Object-ID) des Artis-Mitarbeiters am Anruf';



COMMENT ON COLUMN "public"."call_records"."raw" IS 'Kompletter Graph-Response als jsonb (Audit/Debug)';



COMMENT ON COLUMN "public"."call_records"."customer_id_manual" IS 'Wenn TRUE, wurde customer_id manuell gesetzt (UI). Sync überschreibt dann nicht mehr.';



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text",
    "email" "text",
    "phone" "text",
    "company" "text",
    "address" "text",
    "notes" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "status" "text" DEFAULT 'active'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "company_name" "text",
    "strasse" "text",
    "plz" "text",
    "ort" "text",
    "budget" numeric,
    "mandatsleiter_id" "uuid",
    "sachbearbeiter_id" "uuid",
    "activities" "jsonb" DEFAULT '[]'::"jsonb",
    "contact_persons" "jsonb" DEFAULT '[]'::"jsonb",
    "aktiv" boolean DEFAULT true,
    "kanton" "text",
    "person_type" "text" DEFAULT 'unternehmen'::"text",
    "vorname" "text",
    "nachname" "text",
    "ahv_nummer" "text",
    "geburtsdatum" "date",
    "steuer_zugaenge" "jsonb" DEFAULT '[]'::"jsonb",
    "partner_name" "text",
    "partner_vorname" "text",
    "ist_nebensteuerdomizil" boolean DEFAULT false,
    "hauptdomizil_id" "uuid",
    "ist_hauptsteuerdomizil" boolean DEFAULT false,
    "anrede" "text" DEFAULT ''::"text",
    "street" "text",
    "building_number" "text",
    "zip" "text",
    "city" "text",
    "country" character(2) DEFAULT 'CH'::"bpchar",
    "billing_email" "text"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dok_tag_learnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "keyword" "text" NOT NULL,
    "tag_id" "uuid",
    "customer_id" "uuid",
    "category" "text",
    "hits" integer DEFAULT 1 NOT NULL,
    "source" "text" DEFAULT 'user_correction'::"text" NOT NULL,
    "confidence" numeric(3,2) DEFAULT 1.00,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "dok_tag_learnings_has_target" CHECK ((("tag_id" IS NOT NULL) OR ("customer_id" IS NOT NULL) OR ("category" IS NOT NULL)))
);


ALTER TABLE "public"."dok_tag_learnings" OWNER TO "postgres";


COMMENT ON TABLE "public"."dok_tag_learnings" IS 'Lern-Tabelle: Keyword→Tag/Kunde für Massenablage-KI. Additiv, nicht in Einzelupload-Flow eingebunden.';



COMMENT ON COLUMN "public"."dok_tag_learnings"."keyword" IS 'Stichwort aus Dateiinhalt/Dateiname, immer lowercase';



COMMENT ON COLUMN "public"."dok_tag_learnings"."hits" IS 'Wie oft der Vorschlag vom Nutzer bestätigt wurde — höhere Werte = verlässlicher';



COMMENT ON COLUMN "public"."dok_tag_learnings"."source" IS 'user_correction | ai_confirmed | seed';



COMMENT ON COLUMN "public"."dok_tag_learnings"."confidence" IS 'Geschätzte Zuverlässigkeit 0–1';



CREATE TABLE IF NOT EXISTS "public"."dok_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6366f1'::"text" NOT NULL,
    "parent_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text",
    "created_by" "uuid"
);


ALTER TABLE "public"."dok_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dokumente" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "category" "text" DEFAULT 'korrespondenz'::"text" NOT NULL,
    "year" integer DEFAULT (EXTRACT(year FROM "now"()))::integer NOT NULL,
    "name" "text" NOT NULL,
    "filename" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size" bigint,
    "file_type" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tag_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "checked_out_by" "uuid",
    "checked_out_by_name" "text",
    "checked_out_at" timestamp with time zone,
    "sharepoint_item_id" "text",
    "sharepoint_web_url" "text",
    "search_vector" "tsvector",
    "content_text" "text" DEFAULT ''::"text"
);


ALTER TABLE "public"."dokumente" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domain_tag_rules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "domain" "text" NOT NULL,
    "tag" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."domain_tag_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fahrzeuge" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "customer_id" "uuid",
    "kennzeichen" "text" DEFAULT ''::"text" NOT NULL,
    "marke" "text" DEFAULT ''::"text" NOT NULL,
    "modell" "text" DEFAULT ''::"text" NOT NULL,
    "fahrzeugart" "text" DEFAULT ''::"text" NOT NULL,
    "chassis_nummer" "text" DEFAULT ''::"text" NOT NULL,
    "anschaffungsjahr" integer,
    "kaufpreis_exkl_mwst" numeric(12,2),
    "leasing" boolean DEFAULT false NOT NULL,
    "leasing_barkaufpreis" numeric(12,2),
    "leasing_laufzeit_bis" "date",
    "leasing_vertrag_url" "text",
    "monate_im_betrieb" integer DEFAULT 12 NOT NULL,
    "fahrer_name" "text" DEFAULT ''::"text" NOT NULL,
    "fahrer_selbstbezahlt_monat" numeric(8,2) DEFAULT 0 NOT NULL,
    "unentgeltliche_befoerderung" boolean DEFAULT false NOT NULL,
    "fahrtenbuch" boolean DEFAULT false NOT NULL,
    "effektive_privatkilometer" numeric(8,0),
    "ausschliesslich_geschaeftlich" boolean DEFAULT false NOT NULL,
    "notizen" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "leasing_startdatum" "date",
    "leasing_anzahl_raten" integer,
    "leasing_erste_rate" numeric(10,2),
    "leasing_monatliche_rate" numeric(10,2),
    "leasing_restwert" numeric(10,2),
    "leasing_dokument_id" "uuid"
);


ALTER TABLE "public"."fahrzeuge" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_bank_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "dateiname" "text",
    "konto_iban" "text",
    "konto_nr" "text",
    "import_datum" timestamp with time zone DEFAULT "now"(),
    "anzahl_transaktionen" integer DEFAULT 0,
    "erstellt_von" "uuid"
);


ALTER TABLE "public"."fibu_bank_imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_bank_transaktionen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "import_id" "uuid",
    "konto_iban" "text",
    "buchungsdatum" "date" NOT NULL,
    "valutadatum" "date",
    "betrag" numeric(15,2) NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar",
    "richtung" "text" NOT NULL,
    "gegenpartei_name" "text",
    "gegenpartei_iban" "text",
    "referenz_typ" "text",
    "referenz_nr" "text",
    "end_to_end_id" "text",
    "verwendungszweck" "text",
    "zusatzinfo" "text",
    "status" "text" DEFAULT 'offen'::"text" NOT NULL,
    "matched_beleg_id" "uuid",
    "matched_typ" "text",
    "match_confidence" numeric(4,2),
    "match_methode" "text",
    "buchungs_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "fibu_bank_transaktionen_matched_typ_check" CHECK (("matched_typ" = ANY (ARRAY['kreditor'::"text", 'debitor'::"text"]))),
    CONSTRAINT "fibu_bank_transaktionen_richtung_check" CHECK (("richtung" = ANY (ARRAY['eingang'::"text", 'ausgang'::"text"]))),
    CONSTRAINT "fibu_bank_transaktionen_status_check" CHECK (("status" = ANY (ARRAY['offen'::"text", 'vorschlag'::"text", 'gematcht'::"text", 'ignoriert'::"text", 'verbucht'::"text"])))
);


ALTER TABLE "public"."fibu_bank_transaktionen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_buchung_belege" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "beleg_nr" "text" NOT NULL,
    "buchungsdatum" "date" NOT NULL,
    "text" "text",
    "art" "text" DEFAULT 'normal'::"text" NOT NULL,
    "pdf_path" "text",
    "pdf_name" "text",
    "storniert" boolean DEFAULT false NOT NULL,
    "storno_beleg_id" "uuid",
    "original_beleg_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "fibu_buchung_belege_art_check" CHECK (("art" = ANY (ARRAY['normal'::"text", 'storno'::"text", 'saldovortrag'::"text"])))
);


ALTER TABLE "public"."fibu_buchung_belege" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_buchung_serien" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "bezeichnung" "text" NOT NULL,
    "konto_soll" "text" NOT NULL,
    "konto_haben" "text" NOT NULL,
    "betrag_total" numeric(14,2) NOT NULL,
    "anzahl_perioden" smallint DEFAULT 12 NOT NULL,
    "intervall" "text" DEFAULT 'monatlich'::"text" NOT NULL,
    "naechstes_datum" "date" NOT NULL,
    "erzeugt_anzahl" smallint DEFAULT 0 NOT NULL,
    "letzte_erzeugung" "date",
    "aktiv" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_buchung_serien_anzahl_perioden_check" CHECK ((("anzahl_perioden" >= 1) AND ("anzahl_perioden" <= 120))),
    CONSTRAINT "fibu_buchung_serien_intervall_check" CHECK (("intervall" = ANY (ARRAY['monatlich'::"text", 'quartal'::"text", 'jaehrlich'::"text"])))
);


ALTER TABLE "public"."fibu_buchung_serien" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_buchungen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "buchungs_nr" "text" NOT NULL,
    "buchungsdatum" "date" NOT NULL,
    "beleg_ref" "text",
    "konto_soll" "text" NOT NULL,
    "konto_haben" "text" NOT NULL,
    "betrag" numeric(14,2) NOT NULL,
    "mwst_code" "text",
    "mwst_betrag" numeric(14,2),
    "text" "text",
    "quelle" "text",
    "quelle_id" "uuid",
    "storniert" boolean DEFAULT false NOT NULL,
    "storno_von" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "periode_art" "text" DEFAULT 'normal'::"text" NOT NULL,
    "fw_waehrung" character(3),
    "fw_betrag" numeric(14,2),
    CONSTRAINT "fibu_buchungen_periode_art_check" CHECK (("periode_art" = ANY (ARRAY['normal'::"text", 'eroeffnung'::"text", 'abschluss'::"text"]))),
    CONSTRAINT "fibu_buchungen_quelle_check" CHECK (("quelle" = ANY (ARRAY['kreditoren'::"text", 'debitoren'::"text", 'manuell'::"text", 'zahlungslauf'::"text", 'abschluss'::"text"])))
);


ALTER TABLE "public"."fibu_buchungen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fibu_buchungen"."periode_art" IS 'normal = reguläre Buchung; eroeffnung = Eröffnungsbuchung 01.01.; abschluss = Abschlussbuchung 31.12.';



CREATE TABLE IF NOT EXISTS "public"."fibu_budget" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "jahr" smallint NOT NULL,
    "konto_nr" "text" NOT NULL,
    "betrag" numeric(14,2) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fibu_budget" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_jahresabschluss" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "jahr" integer NOT NULL,
    "status" "text" DEFAULT 'offen'::"text" NOT NULL,
    "gewinn_verlust" numeric(15,2),
    "konto_jahresergebnis" "text" DEFAULT '9999'::"text" NOT NULL,
    "konto_gewinnvortrag" "text" DEFAULT '2970'::"text" NOT NULL,
    "konto_verlustvortrag" "text" DEFAULT '2979'::"text" NOT NULL,
    "konto_eroeffnung" "text" DEFAULT '9900'::"text" NOT NULL,
    "abgeschlossen_am" timestamp with time zone,
    "abgeschlossen_von" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_jahresabschluss_status_check" CHECK (("status" = ANY (ARRAY['offen'::"text", 'abgeschlossen'::"text"])))
);


ALTER TABLE "public"."fibu_jahresabschluss" OWNER TO "postgres";


COMMENT ON TABLE "public"."fibu_jahresabschluss" IS 'Jahresabschluss-Datensatz pro Mandant und Jahr. Enthält Status, Abschluss-Konten und berechnetes Jahresergebnis.';



COMMENT ON COLUMN "public"."fibu_jahresabschluss"."gewinn_verlust" IS 'Nettoergebnis nach Abschluss: positiv = Gewinn, negativ = Verlust.';



COMMENT ON COLUMN "public"."fibu_jahresabschluss"."konto_jahresergebnis" IS 'Schlussbilanzkonto / Gewinn-Verlust-Konto. Standard CH-KMU: 9999.';



COMMENT ON COLUMN "public"."fibu_jahresabschluss"."konto_gewinnvortrag" IS 'Passivkonto für Gewinnvortrag. Standard CH-KMU: 2970.';



COMMENT ON COLUMN "public"."fibu_jahresabschluss"."konto_verlustvortrag" IS 'Aktivkonto für Verlustvortrag. Standard CH-KMU: 2979.';



COMMENT ON COLUMN "public"."fibu_jahresabschluss"."konto_eroeffnung" IS 'Eröffnungsbilanzkonto (technisches Gegenkonto für EB-Buchungen). Standard CH-KMU: 9900.';



CREATE TABLE IF NOT EXISTS "public"."fibu_konten" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "konto_nr" "text" NOT NULL,
    "bezeichnung" "text" NOT NULL,
    "konto_typ" "text" NOT NULL,
    "mwst_code" "text",
    "aktiv" boolean DEFAULT true NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    CONSTRAINT "fibu_konten_konto_typ_check" CHECK (("konto_typ" = ANY (ARRAY['aktiv'::"text", 'passiv'::"text", 'ertrag'::"text", 'aufwand'::"text", 'abschluss'::"text"])))
);


ALTER TABLE "public"."fibu_konten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_kontierungsregeln" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "stichwort" "text" NOT NULL,
    "konto_nr" "text" NOT NULL,
    "mwst_code" "text",
    "sortierung" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fibu_kontierungsregeln" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_kreditoren_belege" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "beleg_nr" "text" NOT NULL,
    "lieferant_id" "uuid" NOT NULL,
    "lieferant_beleg_nr" "text",
    "belegdatum" "date" NOT NULL,
    "valutadatum" "date",
    "faelligkeit" "date" NOT NULL,
    "zahlungsbedingung_tage" smallint,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "betrag_netto" numeric(14,2) DEFAULT 0 NOT NULL,
    "betrag_mwst" numeric(14,2) DEFAULT 0 NOT NULL,
    "betrag_brutto" numeric(14,2) DEFAULT 0 NOT NULL,
    "betrag_bezahlt" numeric(14,2) DEFAULT 0 NOT NULL,
    "bezahlt_am" "date",
    "zahlungsreferenz" "text",
    "status" "text" DEFAULT 'offen'::"text" NOT NULL,
    "notiz" "text",
    "scan_url" "text",
    "scan_ocr_text" "text",
    "gebucht_am" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gebucht_von" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verbucht" boolean DEFAULT false NOT NULL,
    "belegtyp" "text" DEFAULT 'rechnung'::"text" NOT NULL,
    "storno_beleg_id" "uuid",
    "kurs" numeric(16,8),
    "freigabe_status" "text" DEFAULT 'freigegeben'::"text" NOT NULL,
    "freigegeben_am" timestamp with time zone,
    "freigegeben_von" "uuid",
    "buchungsdatum" "date",
    "mwst_abgerechnet" boolean DEFAULT false NOT NULL,
    "mwst_abrechnung_ref" "text",
    "belegreferenz" "text",
    "gruppe" "text",
    "belegtext" "text",
    CONSTRAINT "fibu_kreditoren_belege_belegtyp_check" CHECK (("belegtyp" = ANY (ARRAY['rechnung'::"text", 'gutschrift'::"text"]))),
    CONSTRAINT "fibu_kreditoren_belege_freigabe_status_check" CHECK (("freigabe_status" = ANY (ARRAY['ausstehend'::"text", 'freigegeben'::"text"]))),
    CONSTRAINT "fibu_kreditoren_belege_status_check" CHECK (("status" = ANY (ARRAY['offen'::"text", 'ausstehend'::"text", 'teilbezahlt'::"text", 'bezahlt'::"text", 'ebanking'::"text", 'storniert'::"text"])))
);


ALTER TABLE "public"."fibu_kreditoren_belege" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_kreditoren_dauerbelege" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "lieferant_id" "uuid" NOT NULL,
    "bezeichnung" "text" NOT NULL,
    "konto_nr" "text" NOT NULL,
    "mwst_code" "text",
    "betrag_brutto" numeric(14,2) NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "intervall" "text" NOT NULL,
    "zahlungsbedingung_tage" smallint DEFAULT 30 NOT NULL,
    "naechstes_belegdatum" "date" NOT NULL,
    "letzte_erzeugung" "date",
    "aktiv" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_kreditoren_dauerbelege_intervall_check" CHECK (("intervall" = ANY (ARRAY['monatlich'::"text", 'quartal'::"text", 'halbjahr'::"text", 'jaehrlich'::"text"])))
);


ALTER TABLE "public"."fibu_kreditoren_dauerbelege" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_kreditoren_positionen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "beleg_id" "uuid" NOT NULL,
    "position" smallint DEFAULT 1 NOT NULL,
    "konto_nr" "text" NOT NULL,
    "bezeichnung" "text",
    "mwst_code" "text" DEFAULT 'VS81'::"text" NOT NULL,
    "mwst_satz" numeric(5,2) DEFAULT 8.1 NOT NULL,
    "betrag_netto" numeric(14,2) DEFAULT 0 NOT NULL,
    "betrag_mwst" numeric(14,2) DEFAULT 0 NOT NULL,
    "betrag_brutto" numeric(14,2) DEFAULT 0 NOT NULL,
    "kostenstelle" "text"
);


ALTER TABLE "public"."fibu_kreditoren_positionen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_kreditoren_verrechnungen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "gutschrift_beleg_id" "uuid" NOT NULL,
    "rechnung_beleg_id" "uuid" NOT NULL,
    "betrag" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."fibu_kreditoren_verrechnungen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_lieferanten" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "nr" "text" NOT NULL,
    "name" "text" NOT NULL,
    "uid" "text",
    "adresse" "text",
    "plz" "text",
    "ort" "text",
    "land" character(2) DEFAULT 'CH'::"bpchar" NOT NULL,
    "iban" "text",
    "bank_name" "text",
    "zahlungsbedingung_tage" smallint DEFAULT 30 NOT NULL,
    "skonto_prozent" numeric(5,2),
    "skonto_tage" smallint,
    "standard_konto_nr" "text",
    "mwst_code" "text" DEFAULT 'VS81'::"text" NOT NULL,
    "notiz" "text",
    "aktiv" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL
);


ALTER TABLE "public"."fibu_lieferanten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_mandanten" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "uid" "text",
    "mwst_nr" "text",
    "mwst_pflichtig" boolean DEFAULT true NOT NULL,
    "geschaeftsjahr_beginn" smallint DEFAULT 1 NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "kontenrahmen" "text" DEFAULT 'CH_KMU'::"text" NOT NULL,
    "adresse" "text",
    "plz" "text",
    "ort" "text",
    "land" character(2) DEFAULT 'CH'::"bpchar" NOT NULL,
    "aktiv" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inbox_code" "text",
    "imap_host" "text",
    "imap_port" integer DEFAULT 993,
    "imap_user" "text",
    "imap_password" "text",
    "imap_mailbox" "text" DEFAULT 'INBOX'::"text",
    "imap_aktiv" boolean DEFAULT false NOT NULL,
    "mwst_methode" "text" DEFAULT 'effektiv'::"text" NOT NULL,
    "saldosteuersatz_prozent" numeric(5,2),
    "abrechnungsperiode" "text" DEFAULT 'quartal'::"text" NOT NULL,
    "geschaeftsjahr" integer DEFAULT (EXTRACT(year FROM "now"()))::integer NOT NULL,
    "gesperrt_bis" "date",
    "belegfreigabe_aktiv" boolean DEFAULT false NOT NULL,
    "fw_buchungskurs" "text" DEFAULT 'monat'::"text" NOT NULL,
    "fw_bewertungskurs" "text" DEFAULT 'tag'::"text" NOT NULL,
    CONSTRAINT "fibu_mandanten_abrechnungsperiode_check" CHECK (("abrechnungsperiode" = ANY (ARRAY['quartal'::"text", 'semester'::"text"]))),
    CONSTRAINT "fibu_mandanten_fw_bewertungskurs_check" CHECK (("fw_bewertungskurs" = ANY (ARRAY['monat'::"text", 'tag'::"text"]))),
    CONSTRAINT "fibu_mandanten_fw_buchungskurs_check" CHECK (("fw_buchungskurs" = ANY (ARRAY['monat'::"text", 'tag'::"text"]))),
    CONSTRAINT "fibu_mandanten_geschaeftsjahr_beginn_check" CHECK ((("geschaeftsjahr_beginn" >= 1) AND ("geschaeftsjahr_beginn" <= 12))),
    CONSTRAINT "fibu_mandanten_mwst_methode_check" CHECK (("mwst_methode" = ANY (ARRAY['effektiv'::"text", 'saldosteuersatz'::"text", 'pauschalsteuersatz'::"text"])))
);


ALTER TABLE "public"."fibu_mandanten" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fibu_mandanten"."imap_host" IS 'IMAP-Server für automatischen Rechnungsimport, z.B. imap.gmail.com oder mail.artis-gmbh.ch';



COMMENT ON COLUMN "public"."fibu_mandanten"."imap_aktiv" IS 'Wenn true, wird die fibu-imap-sync Edge Function diesen Mandanten bei jedem Cron-Lauf verarbeiten';



COMMENT ON COLUMN "public"."fibu_mandanten"."geschaeftsjahr" IS 'Aktuell laufendes Geschäftsjahr. Wird nach Jahresabschluss automatisch auf Jahr+1 gesetzt.';



CREATE TABLE IF NOT EXISTS "public"."fibu_mwst_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "bezeichnung" "text" NOT NULL,
    "satz" numeric(5,2) DEFAULT 0 NOT NULL,
    "typ" "text" NOT NULL,
    "konto_vorsteuer" "text",
    "konto_umsatz" "text",
    "aktiv" boolean DEFAULT true NOT NULL,
    "sortierung" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "fibu_mwst_codes_typ_check" CHECK (("typ" = ANY (ARRAY['vorsteuer'::"text", 'umsatzsteuer'::"text", 'steuerbefreit'::"text"])))
);


ALTER TABLE "public"."fibu_mwst_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_rechnung_inbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid",
    "sender_email" "text",
    "sender_name" "text",
    "betreff" "text",
    "email_body" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pdf_path" "text",
    "pdf_name" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "beleg_id" "uuid",
    "inbox_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'webhook'::"text" NOT NULL,
    "imap_uid" bigint,
    "imap_mailbox" "text",
    "imap_message_id" "text",
    CONSTRAINT "fibu_rechnung_inbox_source_check" CHECK (("source" = ANY (ARRAY['webhook'::"text", 'imap'::"text", 'manual'::"text"]))),
    CONSTRAINT "fibu_rechnung_inbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verarbeitet'::"text", 'ignoriert'::"text"])))
);


ALTER TABLE "public"."fibu_rechnung_inbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_user_mandant_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_user_mandant_access_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'buchhalter'::"text", 'readonly'::"text"])))
);


ALTER TABLE "public"."fibu_user_mandant_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_wechselkurse" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "typ" "text" NOT NULL,
    "datum" "date" NOT NULL,
    "waehrung" character(3) NOT NULL,
    "einheit" integer DEFAULT 1 NOT NULL,
    "kurs" numeric(16,8) NOT NULL,
    "kurs_raw" numeric(16,8) NOT NULL,
    "land" "text",
    "quelle" "text" DEFAULT 'BAZG/ESTV'::"text" NOT NULL,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fibu_wechselkurse_typ_check" CHECK (("typ" = ANY (ARRAY['monat'::"text", 'tag'::"text"])))
);


ALTER TABLE "public"."fibu_wechselkurse" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_zahlstellen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "bezeichnung" "text" NOT NULL,
    "konto_nr" "text",
    "iban" "text" NOT NULL,
    "bic" "text",
    "bank_name" "text",
    "ist_standard" boolean DEFAULT false NOT NULL,
    "aktiv" boolean DEFAULT true NOT NULL,
    "sortierung" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "waehrung" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL
);


ALTER TABLE "public"."fibu_zahlstellen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_zahlungslaeufe" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "lauf_nr" "text" NOT NULL,
    "valutadatum" "date" NOT NULL,
    "zahlungskonto_nr" "text" NOT NULL,
    "zahlungskonto_iban" "text",
    "total_betrag" numeric(14,2) DEFAULT 0 NOT NULL,
    "anzahl_zahlungen" smallint DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'entwurf'::"text" NOT NULL,
    "pain001_xml" "text",
    "exportiert_am" timestamp with time zone,
    "verbucht_am" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "fibu_zahlungslaeufe_status_check" CHECK (("status" = ANY (ARRAY['entwurf'::"text", 'freigegeben'::"text", 'exportiert'::"text", 'verbucht'::"text"])))
);


ALTER TABLE "public"."fibu_zahlungslaeufe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fibu_zahlungslauf_positionen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mandant_id" "uuid" NOT NULL,
    "zahlungslauf_id" "uuid" NOT NULL,
    "beleg_id" "uuid" NOT NULL,
    "lieferant_id" "uuid" NOT NULL,
    "iban" "text" NOT NULL,
    "betrag" numeric(14,2) NOT NULL,
    "zahlungsreferenz" "text",
    "zahlungsmitteilung" "text",
    "rueckgemeldet" boolean DEFAULT false NOT NULL,
    "rueckgemeldet_am" timestamp with time zone,
    "bank_tx_id" "uuid"
);


ALTER TABLE "public"."fibu_zahlungslauf_positionen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fristen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "due_date" "date",
    "category" "text" DEFAULT 'Verschiedenes'::"text",
    "status" "text" DEFAULT 'offen'::"text",
    "customer_id" "uuid",
    "assignee" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_recurring" boolean DEFAULT false,
    "recurrence" "text",
    "jahr" integer,
    "kanton" "text",
    "portal_login" "text",
    "portal_password" "text",
    "ist_hauptsteuerdomizil" boolean DEFAULT true,
    "unterlagen_datum" "date",
    "abschluss_vorbereitet" boolean DEFAULT false,
    "portal_uid" "text",
    "einreichen_datum" "date",
    "einreichen_notiz" "text",
    "einreichen_screenshot" "text",
    "formular_erhalten" boolean DEFAULT false
);


ALTER TABLE "public"."fristen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jahresplanung" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "assigned_to" "uuid" NOT NULL,
    "month" integer NOT NULL,
    "activity_type" "text" NOT NULL,
    "hours" numeric(5,1),
    "notes" "text",
    "recurring_group_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "year" integer DEFAULT 2026 NOT NULL,
    "done" boolean DEFAULT false NOT NULL,
    "month_half" "text",
    CONSTRAINT "jahresplanung_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."jahresplanung" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jp_feiertage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "hours" numeric(4,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."jp_feiertage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_columns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "order" integer DEFAULT 0,
    "color" "text" DEFAULT '#0078d4'::"text",
    "mailbox" "text" DEFAULT 'personal'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kanban_columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "category" "text" DEFAULT 'Allgemein'::"text" NOT NULL,
    "source_file" "text",
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."knowledge_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_absence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "category" "public"."le_absence_category" NOT NULL,
    "date_from" "date" NOT NULL,
    "date_to" "date" NOT NULL,
    "half_day_from" boolean DEFAULT false NOT NULL,
    "half_day_to" boolean DEFAULT false NOT NULL,
    "hours_total" numeric(6,2),
    "status" "public"."le_absence_status" DEFAULT 'beantragt'::"public"."le_absence_status" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "receipt_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "le_absence_check" CHECK (("date_to" >= "date_from"))
);


ALTER TABLE "public"."le_absence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_camt_import" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "filename" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "imported_by" "uuid",
    "total_count" integer DEFAULT 0 NOT NULL,
    "matched_count" integer DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."le_camt_import" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_company_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" DEFAULT 'Artis Treuhand GmbH'::"text" NOT NULL,
    "street" "text",
    "building_number" "text",
    "zip" "text",
    "city" "text",
    "country" character(2) DEFAULT 'CH'::"bpchar" NOT NULL,
    "iban" "text",
    "qr_iban" "text",
    "vat_no" "text",
    "uid" "text",
    "email" "text",
    "phone" "text",
    "website" "text",
    "bank_name" "text",
    "logo_url" "text",
    "vat_default_pct" numeric(4,2) DEFAULT 8.1 NOT NULL,
    "payment_terms_days" integer DEFAULT 30 NOT NULL,
    "invoice_footer" "text",
    "letter_intro" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_company_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_customer_terms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "rate_group_id" "uuid",
    "discount_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "payment_terms_days" integer,
    "skonto_pct" numeric(5,2),
    "skonto_days" integer,
    "currency" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "vat_required" boolean DEFAULT true NOT NULL,
    "dunning_disabled" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vat_mode" "public"."le_vat_mode" DEFAULT 'inland'::"public"."le_vat_mode"
);


ALTER TABLE "public"."le_customer_terms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."le_customer_terms"."vat_mode" IS 'inland: Default-VAT-Codes pro Leistungsart, export: alle Lines auf EXP (0%), manuell: User wählt pro Position';



CREATE TABLE IF NOT EXISTS "public"."le_dunning" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "level" integer NOT NULL,
    "dunning_no" "text",
    "dunning_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "new_due_date" "date",
    "fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "interest_rate_pct" numeric(5,2) DEFAULT 5.0 NOT NULL,
    "interest_from" "date",
    "interest_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "outstanding_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "is_betreibungsandrohung" boolean DEFAULT false NOT NULL,
    "status" "public"."le_dunning_status" DEFAULT 'entwurf'::"public"."le_dunning_status" NOT NULL,
    "sent_at" timestamp with time zone,
    "pdf_url" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "le_dunning_level_check" CHECK ((("level" >= 1) AND ("level" <= 5)))
);


ALTER TABLE "public"."le_dunning" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_employee" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "short_code" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text",
    "role" "text",
    "pensum_pct" numeric(5,2) DEFAULT 100.00,
    "entry_date" "date",
    "exit_date" "date",
    "cost_rate" numeric(10,2),
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "billable_rate" numeric(10,2),
    "employee_group_id" "uuid",
    "archived_at" timestamp with time zone
);


ALTER TABLE "public"."le_employee" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_employee_group" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "billable_rate" numeric(10,2),
    "cost_rate" numeric(10,2),
    "sort_order" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_employee_group" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_expense" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "expense_date" "date" NOT NULL,
    "category" "public"."le_expense_category" NOT NULL,
    "description" "text" NOT NULL,
    "amount_gross" numeric(10,2) NOT NULL,
    "vat_pct" numeric(4,2) DEFAULT 0 NOT NULL,
    "vat_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "km_count" numeric(7,2),
    "km_rate" numeric(6,2),
    "project_id" "uuid",
    "customer_id" "uuid",
    "rebillable" boolean DEFAULT false NOT NULL,
    "receipt_url" "text",
    "receipt_hash" "text",
    "payment_method" "text",
    "status" "public"."le_expense_status" DEFAULT 'entwurf'::"public"."le_expense_status" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "invoiced_invoice_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_expense" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_holiday" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "canton" "text"
);


ALTER TABLE "public"."le_holiday" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_invoice" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_no" "text",
    "customer_id" "uuid",
    "project_id" "uuid",
    "status" "public"."le_invoice_status" DEFAULT 'entwurf'::"public"."le_invoice_status" NOT NULL,
    "issue_date" "date",
    "due_date" "date",
    "period_from" "date",
    "period_to" "date",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "vat_pct" numeric(5,2) DEFAULT 8.1 NOT NULL,
    "vat_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "sent_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "paid_amount" numeric(12,2),
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invoice_type" "public"."le_invoice_type" DEFAULT 'normal'::"public"."le_invoice_type" NOT NULL,
    "parent_invoice_id" "uuid",
    "qr_reference" "text",
    "pdf_url" "text"
);


ALTER TABLE "public"."le_invoice" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_invoice_akonto_link" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schluss_invoice_id" "uuid" NOT NULL,
    "akonto_invoice_id" "uuid" NOT NULL,
    "amount_net" numeric(12,2) NOT NULL,
    "amount_vat" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_invoice_akonto_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_invoice_line" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "service_type_id" "uuid",
    "description" "text" NOT NULL,
    "hours" numeric(10,2) DEFAULT 0 NOT NULL,
    "rate" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_kulant" boolean DEFAULT false NOT NULL,
    "vat_code" "text" DEFAULT 'STD'::"text",
    "vat_pct" numeric(5,2),
    "section" "public"."le_invoice_section" DEFAULT 'honorar'::"public"."le_invoice_section"
);


ALTER TABLE "public"."le_invoice_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_number_sequence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "format" "text" NOT NULL,
    "current_value" integer DEFAULT 0 NOT NULL,
    "reset_yearly" boolean DEFAULT true NOT NULL,
    "last_year" integer DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
    "padding_length" integer DEFAULT 4 NOT NULL
);


ALTER TABLE "public"."le_number_sequence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_payment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid",
    "customer_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "currency" character(3) DEFAULT 'CHF'::"bpchar" NOT NULL,
    "paid_at" "date" NOT NULL,
    "value_date" "date",
    "reference" "text",
    "debtor_name" "text",
    "debtor_iban" "text",
    "bank_ref" "text",
    "source" "public"."le_payment_source" DEFAULT 'manual'::"public"."le_payment_source" NOT NULL,
    "raw_xml_chunk" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_payment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_project" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_no" "text" NOT NULL,
    "name" "text" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "responsible_employee_id" "uuid",
    "rate_group_id" "uuid",
    "billing_mode" "public"."le_project_billing_mode" DEFAULT 'effektiv'::"public"."le_project_billing_mode" NOT NULL,
    "pauschal_amount" numeric(12,2),
    "pauschal_cycle" "text",
    "budget_hours" numeric(10,2),
    "budget_amount" numeric(12,2),
    "status" "public"."le_project_status" DEFAULT 'offen'::"public"."le_project_status" NOT NULL,
    "started_at" "date",
    "closed_at" "date",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rate_mode" "public"."le_rate_mode" DEFAULT 'service_type'::"public"."le_rate_mode" NOT NULL,
    "special_rate" numeric(10,2)
);


ALTER TABLE "public"."le_project" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_project_template" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "name_suffix" "text",
    "billing_mode" "public"."le_project_billing_mode" DEFAULT 'effektiv'::"public"."le_project_billing_mode" NOT NULL,
    "pauschal_amount" numeric(12,2),
    "pauschal_cycle" "text",
    "rate_group_id" "uuid",
    "budget_hours" numeric(10,2),
    "budget_amount" numeric(12,2),
    "default_notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_project_template" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_rate_group" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_rate_group" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_rate_group_rate" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rate_group_id" "uuid" NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "rate" numeric(10,2) NOT NULL,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_rate_group_rate" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_recurring_invoice" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "customer_id" "uuid",
    "title" "text" NOT NULL,
    "cycle" "public"."le_recurring_cycle" DEFAULT 'monthly'::"public"."le_recurring_cycle" NOT NULL,
    "interval_months" integer DEFAULT 1 NOT NULL,
    "next_date" "date" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "paused" boolean DEFAULT false NOT NULL,
    "template_lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payment_terms_days" integer DEFAULT 30 NOT NULL,
    "reference_prefix" "text",
    "last_run_at" "date",
    "last_invoice_id" "uuid",
    "notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_recurring_invoice" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_service_rate_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "valid_from" "date" NOT NULL,
    "rate" numeric(10,2) NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_service_rate_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_service_type" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "billable" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_vat_code" "text" DEFAULT 'STD'::"text",
    "default_section" "public"."le_invoice_section" DEFAULT 'honorar'::"public"."le_invoice_section"
);


ALTER TABLE "public"."le_service_type" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_sollzeit_profile" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "valid_from" "date" NOT NULL,
    "valid_to" "date",
    "pensum_pct" numeric(5,2) DEFAULT 100 NOT NULL,
    "hours_mo" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_di" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_mi" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_do" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_fr" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_sa" numeric(4,2) DEFAULT 0 NOT NULL,
    "hours_so" numeric(4,2) DEFAULT 0 NOT NULL,
    "vacation_days" numeric(4,1) DEFAULT 25 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_sollzeit_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_time_entry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "time_from" time without time zone,
    "time_to" time without time zone,
    "hours_internal" numeric(5,2) NOT NULL,
    "rate_snapshot" numeric(10,2) NOT NULL,
    "description" "text",
    "status" "public"."le_time_entry_status" DEFAULT 'erfasst'::"public"."le_time_entry_status" NOT NULL,
    "invoice_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "le_time_entry_hours_internal_check" CHECK (("hours_internal" >= (0)::numeric))
);


ALTER TABLE "public"."le_time_entry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_vat_rate" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "rate" numeric(5,2) NOT NULL,
    "valid_from" "date" NOT NULL,
    "valid_to" "date",
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_vat_rate" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mail_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "outlook_id" "text",
    "subject" "text" DEFAULT '(Kein Betreff)'::"text" NOT NULL,
    "sender_name" "text",
    "sender_email" "text",
    "recipient_email" "text",
    "received_date" timestamp with time zone,
    "is_read" boolean DEFAULT false,
    "has_attachments" boolean DEFAULT false,
    "body_preview" "text",
    "body" "text",
    "mailbox" "text" DEFAULT 'personal'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "column_id" "uuid",
    "project" "text",
    "reminder_date" timestamp with time zone,
    "is_completed" boolean DEFAULT false,
    "is_replied" boolean DEFAULT false,
    "notes" "text",
    "skip_outlook_delete" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false,
    "customer_id" "uuid",
    "internet_message_id" "text",
    CONSTRAINT "mail_items_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."mail_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mail_kanban_mappings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "outlook_id" "text" NOT NULL,
    "column_id" "uuid",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "project" "text",
    "reminder_date" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."mail_kanban_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mp_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "detail_text" "text",
    "datum" "date",
    "done" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "month_end" integer,
    "month_half" character varying(10),
    "person" "text",
    CONSTRAINT "mp_entries_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."mp_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mp_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mp_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."priorities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#ef4444'::"text",
    "level" integer DEFAULT 1,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."priorities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text",
    "is_admin" boolean DEFAULT false,
    "theme" "text" DEFAULT 'dark'::"text",
    "microsoft_access_token" "text",
    "microsoft_refresh_token" "text",
    "microsoft_token_expiry" bigint,
    "microsoft_delta_link" "text" DEFAULT ''::"text",
    "outlook_email" "text",
    "sync_days" integer DEFAULT 80,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "titel" "text" DEFAULT ''::"text",
    "inviteState" smallint DEFAULT '0'::smallint,
    "phone" "text",
    "calendar_access_token" "text",
    "calendar_token_expiry" bigint,
    "calendar_delta_link" "text",
    "calendar_sync_days" integer DEFAULT 30,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text", 'task_user'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6366f1'::"text",
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_vorlagen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "titel" "text" NOT NULL,
    "kategorie" "text",
    "inhalt" "text" NOT NULL
);


ALTER TABLE "public"."prompt_vorlagen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."share_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(18), 'hex'::"text") NOT NULL,
    "doc_id" "uuid",
    "customer_id" "uuid",
    "category" "text",
    "year" integer,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "download_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "password" "text"
);


ALTER TABLE "public"."share_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signaturen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "customer_id" "uuid",
    "document_name" "text" DEFAULT ''::"text" NOT NULL,
    "document_url" "text" DEFAULT ''::"text" NOT NULL,
    "dokument_id" "uuid",
    "skribble_request_id" "text",
    "skribble_document_id" "text",
    "signing_url" "text",
    "skribble_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "signers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "signature_type" "text" DEFAULT 'AES'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "signed_stored" boolean DEFAULT false NOT NULL,
    "signed_dokument_url" "text",
    "signed_dokument_id" "uuid",
    "signed_at" timestamp with time zone,
    "notizen" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "signaturen_signature_type_check" CHECK (("signature_type" = ANY (ARRAY['SES'::"text", 'AES'::"text", 'QES'::"text"]))),
    CONSTRAINT "signaturen_skribble_status_check" CHECK (("skribble_status" = ANY (ARRAY['draft'::"text", 'open'::"text", 'signed'::"text", 'declined'::"text", 'withdrawn'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."signaturen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."steuerdaten" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "kanton" "text" NOT NULL,
    "steuerjahr" integer NOT NULL,
    "felder" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notizen" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "steuerdaten_kanton_check" CHECK (("kanton" = ANY (ARRAY['SG'::"text", 'TG'::"text", 'ESTV'::"text"]))),
    CONSTRAINT "steuerdaten_steuerjahr_check" CHECK ((("steuerjahr" >= 2000) AND ("steuerjahr" <= 2099)))
);


ALTER TABLE "public"."steuerdaten" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "column_id" "uuid",
    "title" "text" NOT NULL,
    "from_email" "text" NOT NULL,
    "from_name" "text",
    "body" "text",
    "ticket_type" "text" DEFAULT 'regular'::"text" NOT NULL,
    "assigned_to" "uuid",
    "customer_id" "uuid",
    "is_read" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "outlook_message_id" "text",
    CONSTRAINT "support_tickets_ticket_type_check" CHECK (("ticket_type" = ANY (ARRAY['regular'::"text", 'documents_only'::"text"])))
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6366f1'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_columns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "order" integer DEFAULT 0,
    "color" "text" DEFAULT '#6366f1'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_email" "text" NOT NULL,
    "user_name" "text",
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_by" "text"[] DEFAULT ARRAY[]::"text"[]
);


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_read_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_read_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "completed" boolean DEFAULT false,
    "due_date" timestamp with time zone,
    "reminder_date" timestamp with time zone,
    "column_id" "uuid",
    "assigned_to" "uuid",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "project" "text",
    "customer_id" "uuid",
    "mail_id" "uuid",
    "order" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assignee" "text",
    "priority_id" "uuid",
    "linked_mail_id" "uuid",
    "linked_mail_microsoft_id" "text",
    "attachments" "jsonb" DEFAULT '[]'::"jsonb",
    "verantwortlich" "text"
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_allocation_invoice" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "rechnungstyp" "text" NOT NULL,
    "rechnungsdatum" "date",
    "faelligkeit" "date",
    "betrag_soll" numeric(14,2),
    "betrag_haben" numeric(14,2),
    "bezahlt_datum" "date",
    "pdf_url" "text",
    "notiz" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tax_allocation_invoice_rechnungstyp_check" CHECK (("rechnungstyp" = ANY (ARRAY['provisorisch'::"text", 'definitiv'::"text", 'schluss'::"text", 'zins'::"text", 'akonto'::"text"])))
);


ALTER TABLE "public"."tax_allocation_invoice" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_allocation_period" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "steuerjahr" integer NOT NULL,
    "person_type" "text" DEFAULT 'jp'::"text" NOT NULL,
    "dbst_kanton" "text",
    "gesamtgewinn" numeric(14,2),
    "gesamtkapital" numeric(14,2),
    "praezipuum_pct" numeric(5,2) DEFAULT 0,
    "status" "text" DEFAULT 'entwurf'::"text" NOT NULL,
    "notiz" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tax_allocation_period_person_type_check" CHECK (("person_type" = ANY (ARRAY['jp'::"text", 'np'::"text"]))),
    CONSTRAINT "tax_allocation_period_status_check" CHECK (("status" = ANY (ARRAY['entwurf'::"text", 'definitiv'::"text"])))
);


ALTER TABLE "public"."tax_allocation_period" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_allocation_unit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "period_id" "uuid" NOT NULL,
    "ebene" "text" NOT NULL,
    "kanton" "text" NOT NULL,
    "gemeinde" "text",
    "anknuepfung" "text",
    "schluessel_umsatz" numeric(14,2),
    "schluessel_lohnsumme" numeric(14,2),
    "schluessel_anlagewerte" numeric(14,2),
    "schluessel_mobiliar" numeric(14,2),
    "quote_berechnet_pct" numeric(7,4),
    "quote_manuell_pct" numeric(7,4),
    "steuerbarer_gewinn_eigen" numeric(14,2),
    "steuerbarer_gewinn_zum_satz" numeric(14,2),
    "steuerbares_kapital_eigen" numeric(14,2),
    "steuerbares_kapital_zum_satz" numeric(14,2),
    "veranlagung_datum" "date",
    "veranlagung_status" "text" DEFAULT 'offen'::"text",
    "veranlagung_pdf_url" "text",
    "veranlagung_faktoren" "jsonb",
    "sort_order" integer DEFAULT 0,
    "notiz" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tax_allocation_unit_anknuepfung_check" CHECK (("anknuepfung" = ANY (ARRAY['sitz'::"text", 'betriebsstaette'::"text", 'liegenschaft'::"text", 'wohnsitz'::"text"]))),
    CONSTRAINT "tax_allocation_unit_ebene_check" CHECK (("ebene" = ANY (ARRAY['kanton'::"text", 'gemeinde'::"text"]))),
    CONSTRAINT "tax_allocation_unit_veranlagung_status_check" CHECK (("veranlagung_status" = ANY (ARRAY['offen'::"text", 'provisorisch'::"text", 'definitiv'::"text"])))
);


ALTER TABLE "public"."tax_allocation_unit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tax_steuerfuss" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kanton" "text" NOT NULL,
    "gemeinde" "text",
    "jahr" integer NOT NULL,
    "steuerfuss_pct" numeric(7,3) NOT NULL,
    "tarif_referenz" "text",
    "override_user_id" "uuid",
    "override_note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tax_steuerfuss" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_columns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6366f1'::"text",
    "order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ticket_columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "sender_type" "text" DEFAULT 'staff'::"text" NOT NULL,
    "sender_id" "uuid",
    "is_ai_suggestion" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ticket_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['customer'::"text", 'staff'::"text", 'ai_suggestion'::"text"])))
);


ALTER TABLE "public"."ticket_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "col_widths" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whiteboards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "name" "text" DEFAULT 'Neues Whiteboard'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "thumbnail" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."whiteboards" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ablage_dateien"
    ADD CONSTRAINT "ablage_dateien_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."abschluss"
    ADD CONSTRAINT "abschluss_customer_jahr_unique" UNIQUE ("customer_id", "geschaeftsjahr");



ALTER TABLE ONLY "public"."abschluss_konten"
    ADD CONSTRAINT "abschluss_konten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."abschluss"
    ADD CONSTRAINT "abschluss_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_templates"
    ADD CONSTRAINT "activity_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aktienbuch"
    ADD CONSTRAINT "aktienbuch_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anbu_anlage"
    ADD CONSTRAINT "anbu_anlage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anbu_jahresabschluss"
    ADD CONSTRAINT "anbu_jahresabschluss_customer_id_geschaeftsjahr_key" UNIQUE ("customer_id", "geschaeftsjahr");



ALTER TABLE ONLY "public"."anbu_jahresabschluss"
    ADD CONSTRAINT "anbu_jahresabschluss_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anbu_kategorie"
    ADD CONSTRAINT "anbu_kategorie_customer_id_name_key" UNIQUE ("customer_id", "name");



ALTER TABLE ONLY "public"."anbu_kategorie"
    ADD CONSTRAINT "anbu_kategorie_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brief_vorlagen"
    ADD CONSTRAINT "brief_vorlagen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_notes_pending"
    ADD CONSTRAINT "call_notes_pending_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_records"
    ADD CONSTRAINT "call_records_graph_call_id_key" UNIQUE ("graph_call_id");



ALTER TABLE ONLY "public"."call_records"
    ADD CONSTRAINT "call_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dok_tag_learnings"
    ADD CONSTRAINT "dok_tag_learnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dok_tags"
    ADD CONSTRAINT "dok_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dokumente"
    ADD CONSTRAINT "dokumente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_tag_rules"
    ADD CONSTRAINT "domain_tag_rules_domain_created_by_key" UNIQUE ("domain", "created_by");



ALTER TABLE ONLY "public"."domain_tag_rules"
    ADD CONSTRAINT "domain_tag_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fahrzeuge"
    ADD CONSTRAINT "fahrzeuge_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_bank_imports"
    ADD CONSTRAINT "fibu_bank_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_bank_transaktionen"
    ADD CONSTRAINT "fibu_bank_transaktionen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_mandant_id_beleg_nr_key" UNIQUE ("mandant_id", "beleg_nr");



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_buchung_serien"
    ADD CONSTRAINT "fibu_buchung_serien_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_buchungen"
    ADD CONSTRAINT "fibu_buchungen_mandant_id_buchungs_nr_key" UNIQUE ("mandant_id", "buchungs_nr");



ALTER TABLE ONLY "public"."fibu_buchungen"
    ADD CONSTRAINT "fibu_buchungen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_budget"
    ADD CONSTRAINT "fibu_budget_mandant_id_jahr_konto_nr_key" UNIQUE ("mandant_id", "jahr", "konto_nr");



ALTER TABLE ONLY "public"."fibu_budget"
    ADD CONSTRAINT "fibu_budget_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_jahresabschluss"
    ADD CONSTRAINT "fibu_jahresabschluss_mandant_id_jahr_key" UNIQUE ("mandant_id", "jahr");



ALTER TABLE ONLY "public"."fibu_jahresabschluss"
    ADD CONSTRAINT "fibu_jahresabschluss_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_konten"
    ADD CONSTRAINT "fibu_konten_mandant_id_konto_nr_key" UNIQUE ("mandant_id", "konto_nr");



ALTER TABLE ONLY "public"."fibu_konten"
    ADD CONSTRAINT "fibu_konten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_kontierungsregeln"
    ADD CONSTRAINT "fibu_kontierungsregeln_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_mandant_id_beleg_nr_key" UNIQUE ("mandant_id", "beleg_nr");



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_dauerbelege"
    ADD CONSTRAINT "fibu_kreditoren_dauerbelege_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_positionen"
    ADD CONSTRAINT "fibu_kreditoren_positionen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_verrechnungen"
    ADD CONSTRAINT "fibu_kreditoren_verrechnungen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_lieferanten"
    ADD CONSTRAINT "fibu_lieferanten_mandant_id_nr_key" UNIQUE ("mandant_id", "nr");



ALTER TABLE ONLY "public"."fibu_lieferanten"
    ADD CONSTRAINT "fibu_lieferanten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_mandanten"
    ADD CONSTRAINT "fibu_mandanten_inbox_code_key" UNIQUE ("inbox_code");



ALTER TABLE ONLY "public"."fibu_mandanten"
    ADD CONSTRAINT "fibu_mandanten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_mwst_abrechnungsperioden"
    ADD CONSTRAINT "fibu_mwst_abrechnungsperioden_mandant_id_periode_von_period_key" UNIQUE ("mandant_id", "periode_von", "periode_bis");



ALTER TABLE ONLY "public"."fibu_mwst_abrechnungsperioden"
    ADD CONSTRAINT "fibu_mwst_abrechnungsperioden_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_mwst_codes"
    ADD CONSTRAINT "fibu_mwst_codes_mandant_id_code_key" UNIQUE ("mandant_id", "code");



ALTER TABLE ONLY "public"."fibu_mwst_codes"
    ADD CONSTRAINT "fibu_mwst_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_rechnung_inbox"
    ADD CONSTRAINT "fibu_rechnung_inbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_user_mandant_access"
    ADD CONSTRAINT "fibu_user_mandant_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_user_mandant_access"
    ADD CONSTRAINT "fibu_user_mandant_access_user_id_mandant_id_key" UNIQUE ("user_id", "mandant_id");



ALTER TABLE ONLY "public"."fibu_wechselkurse"
    ADD CONSTRAINT "fibu_wechselkurse_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_wechselkurse"
    ADD CONSTRAINT "fibu_wechselkurse_typ_datum_waehrung_key" UNIQUE ("typ", "datum", "waehrung");



ALTER TABLE ONLY "public"."fibu_zahlstellen"
    ADD CONSTRAINT "fibu_zahlstellen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_zahlungslaeufe"
    ADD CONSTRAINT "fibu_zahlungslaeufe_mandant_id_lauf_nr_key" UNIQUE ("mandant_id", "lauf_nr");



ALTER TABLE ONLY "public"."fibu_zahlungslaeufe"
    ADD CONSTRAINT "fibu_zahlungslaeufe_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fristen"
    ADD CONSTRAINT "fristen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jahresplanung"
    ADD CONSTRAINT "jahresplanung_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jp_feiertage"
    ADD CONSTRAINT "jp_feiertage_date_key" UNIQUE ("date");



ALTER TABLE ONLY "public"."jp_feiertage"
    ADD CONSTRAINT "jp_feiertage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_absence"
    ADD CONSTRAINT "le_absence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_camt_import"
    ADD CONSTRAINT "le_camt_import_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_company_settings"
    ADD CONSTRAINT "le_company_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_customer_terms"
    ADD CONSTRAINT "le_customer_terms_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."le_customer_terms"
    ADD CONSTRAINT "le_customer_terms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_dunning"
    ADD CONSTRAINT "le_dunning_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_employee_group"
    ADD CONSTRAINT "le_employee_group_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."le_employee_group"
    ADD CONSTRAINT "le_employee_group_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_holiday"
    ADD CONSTRAINT "le_holiday_date_canton_name_key" UNIQUE ("date", "canton", "name");



ALTER TABLE ONLY "public"."le_holiday"
    ADD CONSTRAINT "le_holiday_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_invoice_akonto_link"
    ADD CONSTRAINT "le_invoice_akonto_link_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_invoice_akonto_link"
    ADD CONSTRAINT "le_invoice_akonto_link_schluss_invoice_id_akonto_invoice_id_key" UNIQUE ("schluss_invoice_id", "akonto_invoice_id");



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_number_sequence"
    ADD CONSTRAINT "le_number_sequence_kind_key" UNIQUE ("kind");



ALTER TABLE ONLY "public"."le_number_sequence"
    ADD CONSTRAINT "le_number_sequence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_payment"
    ADD CONSTRAINT "le_payment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_project_no_key" UNIQUE ("project_no");



ALTER TABLE ONLY "public"."le_project_template"
    ADD CONSTRAINT "le_project_template_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."le_project_template"
    ADD CONSTRAINT "le_project_template_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_rate_group"
    ADD CONSTRAINT "le_rate_group_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."le_rate_group"
    ADD CONSTRAINT "le_rate_group_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_rate_group_id_service_type_id_valid_from_key" UNIQUE ("rate_group_id", "service_type_id", "valid_from");



ALTER TABLE ONLY "public"."le_recurring_invoice"
    ADD CONSTRAINT "le_recurring_invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_service_type_id_valid_from_key" UNIQUE ("service_type_id", "valid_from");



ALTER TABLE ONLY "public"."le_service_type"
    ADD CONSTRAINT "le_service_type_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."le_service_type"
    ADD CONSTRAINT "le_service_type_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_sollzeit_profile"
    ADD CONSTRAINT "le_sollzeit_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_vat_rate"
    ADD CONSTRAINT "le_vat_rate_code_valid_from_key" UNIQUE ("code", "valid_from");



ALTER TABLE ONLY "public"."le_vat_rate"
    ADD CONSTRAINT "le_vat_rate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_outlook_id_created_by_key" UNIQUE ("outlook_id", "created_by");



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_outlook_id_created_by_key" UNIQUE ("outlook_id", "created_by");



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_entries"
    ADD CONSTRAINT "mp_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_plans"
    ADD CONSTRAINT "mp_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."priorities"
    ADD CONSTRAINT "priorities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_vorlagen"
    ADD CONSTRAINT "prompt_vorlagen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_skribble_request_id_key" UNIQUE ("skribble_request_id");



ALTER TABLE ONLY "public"."steuerdaten"
    ADD CONSTRAINT "steuerdaten_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."steuerdaten"
    ADD CONSTRAINT "steuerdaten_unique" UNIQUE ("customer_id", "kanton", "steuerjahr");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_name_created_by_key" UNIQUE ("name", "created_by");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_columns"
    ADD CONSTRAINT "task_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_read_statuses"
    ADD CONSTRAINT "task_read_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_read_statuses"
    ADD CONSTRAINT "task_read_statuses_task_id_user_email_key" UNIQUE ("task_id", "user_email");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_allocation_invoice"
    ADD CONSTRAINT "tax_allocation_invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_allocation_period"
    ADD CONSTRAINT "tax_allocation_period_customer_id_steuerjahr_key" UNIQUE ("customer_id", "steuerjahr");



ALTER TABLE ONLY "public"."tax_allocation_period"
    ADD CONSTRAINT "tax_allocation_period_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_allocation_unit"
    ADD CONSTRAINT "tax_allocation_unit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tax_steuerfuss"
    ADD CONSTRAINT "tax_steuerfuss_kanton_gemeinde_jahr_key" UNIQUE ("kanton", "gemeinde", "jahr");



ALTER TABLE ONLY "public"."tax_steuerfuss"
    ADD CONSTRAINT "tax_steuerfuss_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_columns"
    ADD CONSTRAINT "ticket_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."whiteboards"
    ADD CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id");



CREATE INDEX "dok_tag_learnings_customer_idx" ON "public"."dok_tag_learnings" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);



CREATE INDEX "dok_tag_learnings_keyword_idx" ON "public"."dok_tag_learnings" USING "btree" ("lower"("keyword"));



CREATE INDEX "fibu_buchung_belege_mandant" ON "public"."fibu_buchung_belege" USING "btree" ("mandant_id", "buchungsdatum" DESC);



CREATE INDEX "fibu_buchung_serien_mandant" ON "public"."fibu_buchung_serien" USING "btree" ("mandant_id", "aktiv");



CREATE INDEX "fibu_buchungen_mandant_id_buchungsdatum_idx" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "buchungsdatum");



CREATE INDEX "fibu_buchungen_mandant_id_konto_haben_idx" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "konto_haben");



CREATE INDEX "fibu_buchungen_mandant_id_konto_soll_idx" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "konto_soll");



CREATE INDEX "fibu_budget_mandant_jahr" ON "public"."fibu_budget" USING "btree" ("mandant_id", "jahr");



CREATE INDEX "fibu_dauerbelege_mandant" ON "public"."fibu_kreditoren_dauerbelege" USING "btree" ("mandant_id", "aktiv");



CREATE INDEX "fibu_kontierungsregeln_mandant" ON "public"."fibu_kontierungsregeln" USING "btree" ("mandant_id", "sortierung");



CREATE INDEX "fibu_kreditoren_belege_mandant_id_faelligkeit_idx" ON "public"."fibu_kreditoren_belege" USING "btree" ("mandant_id", "faelligkeit");



CREATE INDEX "fibu_kreditoren_belege_mandant_id_lieferant_id_idx" ON "public"."fibu_kreditoren_belege" USING "btree" ("mandant_id", "lieferant_id");



CREATE INDEX "fibu_kreditoren_belege_mandant_id_status_idx" ON "public"."fibu_kreditoren_belege" USING "btree" ("mandant_id", "status");



CREATE INDEX "fibu_kreditoren_positionen_beleg_id_idx" ON "public"."fibu_kreditoren_positionen" USING "btree" ("beleg_id");



CREATE INDEX "fibu_user_mandant_access_user_id_idx" ON "public"."fibu_user_mandant_access" USING "btree" ("user_id");



CREATE INDEX "fibu_verrechnung_mandant" ON "public"."fibu_kreditoren_verrechnungen" USING "btree" ("mandant_id", "created_at" DESC);



CREATE INDEX "fibu_wechselkurse_lookup" ON "public"."fibu_wechselkurse" USING "btree" ("waehrung", "typ", "datum" DESC);



CREATE INDEX "fibu_zahlstellen_mandant" ON "public"."fibu_zahlstellen" USING "btree" ("mandant_id", "aktiv");



CREATE UNIQUE INDEX "fibu_zahlstellen_one_standard" ON "public"."fibu_zahlstellen" USING "btree" ("mandant_id") WHERE "ist_standard";



CREATE INDEX "idx_ablage_customer" ON "public"."ablage_dateien" USING "btree" ("customer_id");



CREATE INDEX "idx_ablage_ordner" ON "public"."ablage_dateien" USING "btree" ("ordner");



CREATE INDEX "idx_ablage_tags" ON "public"."ablage_dateien" USING "gin" ("tags");



CREATE INDEX "idx_abschluss_customer" ON "public"."abschluss" USING "btree" ("customer_id");



CREATE INDEX "idx_abschluss_customer_jahr" ON "public"."abschluss" USING "btree" ("customer_id", "geschaeftsjahr");



CREATE INDEX "idx_abschluss_konten_abschluss" ON "public"."abschluss_konten" USING "btree" ("abschluss_id");



CREATE INDEX "idx_abschluss_konten_kontonummer" ON "public"."abschluss_konten" USING "btree" ("abschluss_id", "kontonummer");



CREATE INDEX "idx_abschluss_status" ON "public"."abschluss" USING "btree" ("status");



CREATE INDEX "idx_aktienbuch_aktiv" ON "public"."aktienbuch" USING "btree" ("customer_id", "aktiv");



CREATE INDEX "idx_aktienbuch_customer" ON "public"."aktienbuch" USING "btree" ("customer_id");



CREATE INDEX "idx_aktienbuch_vorgaenger" ON "public"."aktienbuch" USING "btree" ("vorgaenger_id");



CREATE INDEX "idx_anbu_anlage_abschluss" ON "public"."anbu_anlage" USING "btree" ("abschluss_id");



CREATE INDEX "idx_anbu_anlage_fibu_konto" ON "public"."anbu_anlage" USING "btree" ("fibu_konto");



CREATE INDEX "idx_anbu_anlage_kategorie" ON "public"."anbu_anlage" USING "btree" ("kategorie_id");



CREATE INDEX "idx_anbu_jahresabschluss_cust" ON "public"."anbu_jahresabschluss" USING "btree" ("customer_id", "geschaeftsjahr");



CREATE INDEX "idx_anbu_kategorie_cust" ON "public"."anbu_kategorie" USING "btree" ("customer_id", "reihenfolge");



CREATE INDEX "idx_bank_tx_datum" ON "public"."fibu_bank_transaktionen" USING "btree" ("buchungsdatum");



CREATE UNIQUE INDEX "idx_bank_tx_dedup_base" ON "public"."fibu_bank_transaktionen" USING "btree" ("mandant_id", "konto_iban", "buchungsdatum", "betrag", "richtung") WHERE (("referenz_nr" IS NULL) AND ("end_to_end_id" IS NULL));



CREATE UNIQUE INDEX "idx_bank_tx_dedup_e2e" ON "public"."fibu_bank_transaktionen" USING "btree" ("mandant_id", "konto_iban", "buchungsdatum", "betrag", "richtung", "end_to_end_id") WHERE (("referenz_nr" IS NULL) AND ("end_to_end_id" IS NOT NULL));



CREATE UNIQUE INDEX "idx_bank_tx_dedup_qrr" ON "public"."fibu_bank_transaktionen" USING "btree" ("mandant_id", "konto_iban", "buchungsdatum", "betrag", "richtung", "referenz_nr") WHERE ("referenz_nr" IS NOT NULL);



CREATE INDEX "idx_bank_tx_mandant" ON "public"."fibu_bank_transaktionen" USING "btree" ("mandant_id");



CREATE INDEX "idx_bank_tx_referenz" ON "public"."fibu_bank_transaktionen" USING "btree" ("referenz_nr") WHERE ("referenz_nr" IS NOT NULL);



CREATE INDEX "idx_bank_tx_status" ON "public"."fibu_bank_transaktionen" USING "btree" ("mandant_id", "status");



CREATE INDEX "idx_calendar_events_customer" ON "public"."calendar_events" USING "btree" ("customer_id", "start_time");



CREATE UNIQUE INDEX "idx_calendar_events_outlook_user" ON "public"."calendar_events" USING "btree" ("outlook_id", "created_by");



CREATE INDEX "idx_calendar_events_start" ON "public"."calendar_events" USING "btree" ("created_by", "start_time");



CREATE INDEX "idx_call_notes_pending_customer" ON "public"."call_notes_pending" USING "btree" ("customer_id", "clicked_at" DESC);



CREATE INDEX "idx_call_notes_pending_match" ON "public"."call_notes_pending" USING "btree" ("artis_user_name", "phone_suffix", "clicked_at") WHERE ("linked_call_id" IS NULL);



CREATE INDEX "idx_call_notes_pending_unlinked" ON "public"."call_notes_pending" USING "btree" ("clicked_at" DESC) WHERE ("linked_call_id" IS NULL);



CREATE INDEX "idx_call_records_artis_user" ON "public"."call_records" USING "btree" ("artis_user_id", "start_time" DESC);



CREATE INDEX "idx_call_records_customer_start" ON "public"."call_records" USING "btree" ("customer_id", "start_time" DESC);



CREATE INDEX "idx_call_records_start" ON "public"."call_records" USING "btree" ("start_time" DESC);



CREATE INDEX "idx_customers_hauptdomizil" ON "public"."customers" USING "btree" ("hauptdomizil_id");



CREATE INDEX "idx_customers_kanton" ON "public"."customers" USING "btree" ("kanton");



CREATE INDEX "idx_dok_checked_out" ON "public"."dokumente" USING "btree" ("checked_out_by") WHERE ("checked_out_by" IS NOT NULL);



CREATE INDEX "idx_dok_created_at" ON "public"."dokumente" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_dok_cust_cat_year" ON "public"."dokumente" USING "btree" ("customer_id", "category", "year" DESC);



CREATE INDEX "idx_dok_name_fts" ON "public"."dokumente" USING "gin" ("to_tsvector"('"german"'::"regconfig", "name"));



CREATE INDEX "idx_dok_sp_item" ON "public"."dokumente" USING "btree" ("sharepoint_item_id") WHERE ("sharepoint_item_id" IS NOT NULL);



CREATE INDEX "idx_dok_tag_ids" ON "public"."dokumente" USING "gin" ("tag_ids");



CREATE INDEX "idx_dok_tags_parent" ON "public"."dok_tags" USING "btree" ("parent_id");



CREATE INDEX "idx_dok_tags_sort" ON "public"."dok_tags" USING "btree" ("parent_id" NULLS FIRST, "sort_order");



CREATE INDEX "idx_dokumente_category" ON "public"."dokumente" USING "btree" ("category");



CREATE INDEX "idx_dokumente_customer_id" ON "public"."dokumente" USING "btree" ("customer_id");



CREATE INDEX "idx_dokumente_search_gin" ON "public"."dokumente" USING "gin" ("search_vector");



CREATE INDEX "idx_dokumente_year" ON "public"."dokumente" USING "btree" ("year");



CREATE INDEX "idx_fahrzeuge_customer" ON "public"."fahrzeuge" USING "btree" ("customer_id");



CREATE INDEX "idx_fahrzeuge_customer_id" ON "public"."fahrzeuge" USING "btree" ("customer_id");



CREATE INDEX "idx_fibu_buchungen_konto" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "konto_soll", "buchungsdatum");



CREATE INDEX "idx_fibu_buchungen_mwst" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "mwst_code", "buchungsdatum") WHERE ("mwst_code" IS NOT NULL);



CREATE INDEX "idx_fibu_buchungen_periode_art" ON "public"."fibu_buchungen" USING "btree" ("mandant_id", "periode_art") WHERE ("periode_art" <> 'normal'::"text");



CREATE UNIQUE INDEX "idx_fibu_inbox_imap_uid" ON "public"."fibu_rechnung_inbox" USING "btree" ("mandant_id", "imap_mailbox", "imap_uid") WHERE ("imap_uid" IS NOT NULL);



CREATE INDEX "idx_fibu_inbox_source" ON "public"."fibu_rechnung_inbox" USING "btree" ("mandant_id", "source", "received_at" DESC);



CREATE INDEX "idx_fibu_jahresabschluss_mandant_jahr" ON "public"."fibu_jahresabschluss" USING "btree" ("mandant_id", "jahr");



CREATE INDEX "idx_fibu_kred_belege_buchungsdatum" ON "public"."fibu_kreditoren_belege" USING "btree" ("mandant_id", "buchungsdatum");



CREATE INDEX "idx_fibu_kred_belege_gruppe" ON "public"."fibu_kreditoren_belege" USING "btree" ("mandant_id", "gruppe") WHERE ("gruppe" IS NOT NULL);



CREATE INDEX "idx_fibu_rechnung_inbox_code" ON "public"."fibu_rechnung_inbox" USING "btree" ("inbox_code");



CREATE INDEX "idx_fibu_rechnung_inbox_mandant_status" ON "public"."fibu_rechnung_inbox" USING "btree" ("mandant_id", "status", "received_at" DESC);



CREATE INDEX "idx_kb_active" ON "public"."knowledge_base" USING "btree" ("is_active");



CREATE INDEX "idx_kb_category" ON "public"."knowledge_base" USING "btree" ("category");



CREATE INDEX "idx_le_absence_dates" ON "public"."le_absence" USING "btree" ("date_from", "date_to");



CREATE INDEX "idx_le_absence_employee" ON "public"."le_absence" USING "btree" ("employee_id");



CREATE INDEX "idx_le_dunning_invoice" ON "public"."le_dunning" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_dunning_status" ON "public"."le_dunning" USING "btree" ("status");



CREATE INDEX "idx_le_employee_active_archived" ON "public"."le_employee" USING "btree" ("active", "archived_at");



CREATE INDEX "idx_le_employee_group" ON "public"."le_employee" USING "btree" ("employee_group_id");



CREATE INDEX "idx_le_expense_employee" ON "public"."le_expense" USING "btree" ("employee_id");



CREATE INDEX "idx_le_expense_project" ON "public"."le_expense" USING "btree" ("project_id");



CREATE INDEX "idx_le_expense_status" ON "public"."le_expense" USING "btree" ("status");



CREATE INDEX "idx_le_invoice_customer" ON "public"."le_invoice" USING "btree" ("customer_id");



CREATE INDEX "idx_le_invoice_line_invoice" ON "public"."le_invoice_line" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_invoice_line_kulant" ON "public"."le_invoice_line" USING "btree" ("invoice_id") WHERE ("is_kulant" = true);



CREATE INDEX "idx_le_invoice_line_section" ON "public"."le_invoice_line" USING "btree" ("invoice_id", "section");



CREATE INDEX "idx_le_invoice_parent" ON "public"."le_invoice" USING "btree" ("parent_invoice_id");



CREATE INDEX "idx_le_invoice_project" ON "public"."le_invoice" USING "btree" ("project_id");



CREATE INDEX "idx_le_invoice_status" ON "public"."le_invoice" USING "btree" ("status");



CREATE INDEX "idx_le_payment_customer" ON "public"."le_payment" USING "btree" ("customer_id");



CREATE INDEX "idx_le_payment_invoice" ON "public"."le_payment" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_payment_ref" ON "public"."le_payment" USING "btree" ("reference");



CREATE INDEX "idx_le_project_customer" ON "public"."le_project" USING "btree" ("customer_id");



CREATE INDEX "idx_le_project_status" ON "public"."le_project" USING "btree" ("status");



CREATE INDEX "idx_le_recurring_next" ON "public"."le_recurring_invoice" USING "btree" ("next_date") WHERE (("paused" = false) AND ("active" = true));



CREATE INDEX "idx_le_sollzeit_employee" ON "public"."le_sollzeit_profile" USING "btree" ("employee_id");



CREATE INDEX "idx_le_time_entry_date" ON "public"."le_time_entry" USING "btree" ("entry_date");



CREATE INDEX "idx_le_time_entry_employee" ON "public"."le_time_entry" USING "btree" ("employee_id");



CREATE INDEX "idx_le_time_entry_invoice" ON "public"."le_time_entry" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_time_entry_project" ON "public"."le_time_entry" USING "btree" ("project_id");



CREATE INDEX "idx_le_time_entry_status" ON "public"."le_time_entry" USING "btree" ("status");



CREATE INDEX "idx_le_vat_rate_code" ON "public"."le_vat_rate" USING "btree" ("code");



CREATE INDEX "idx_le_vat_rate_valid" ON "public"."le_vat_rate" USING "btree" ("valid_from", "valid_to");



CREATE INDEX "idx_mail_items_column_id" ON "public"."mail_items" USING "btree" ("column_id");



CREATE INDEX "idx_mail_items_created_by" ON "public"."mail_items" USING "btree" ("created_by");



CREATE INDEX "idx_mail_items_internet_message_id" ON "public"."mail_items" USING "btree" ("internet_message_id");



CREATE INDEX "idx_mail_items_outlook_id" ON "public"."mail_items" USING "btree" ("outlook_id");



CREATE INDEX "idx_mail_items_received_date" ON "public"."mail_items" USING "btree" ("received_date" DESC);



CREATE INDEX "idx_mp_entries_plan_year" ON "public"."mp_entries" USING "btree" ("plan_id", "year");



CREATE INDEX "idx_mp_plans_customer" ON "public"."mp_plans" USING "btree" ("customer_id");



CREATE INDEX "idx_signaturen_created_by" ON "public"."signaturen" USING "btree" ("created_by");



CREATE INDEX "idx_signaturen_customer_id" ON "public"."signaturen" USING "btree" ("customer_id");



CREATE INDEX "idx_signaturen_status" ON "public"."signaturen" USING "btree" ("skribble_status");



CREATE INDEX "idx_steuerdaten_customer" ON "public"."steuerdaten" USING "btree" ("customer_id");



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_created_by" ON "public"."tasks" USING "btree" ("created_by");



CREATE INDEX "idx_tax_invoice_unit" ON "public"."tax_allocation_invoice" USING "btree" ("unit_id");



CREATE INDEX "idx_tax_period_customer" ON "public"."tax_allocation_period" USING "btree" ("customer_id");



CREATE INDEX "idx_tax_period_jahr" ON "public"."tax_allocation_period" USING "btree" ("steuerjahr");



CREATE INDEX "idx_tax_steuerfuss_kg_jahr" ON "public"."tax_steuerfuss" USING "btree" ("kanton", "gemeinde", "jahr");



CREATE INDEX "idx_tax_unit_kanton" ON "public"."tax_allocation_unit" USING "btree" ("kanton");



CREATE INDEX "idx_tax_unit_period" ON "public"."tax_allocation_unit" USING "btree" ("period_id");



CREATE INDEX "idx_whiteboards_customer" ON "public"."whiteboards" USING "btree" ("customer_id");



CREATE INDEX "share_links_token_idx" ON "public"."share_links" USING "btree" ("token");



CREATE INDEX "support_tickets_column_id_idx" ON "public"."support_tickets" USING "btree" ("column_id");



CREATE INDEX "support_tickets_created_at_idx" ON "public"."support_tickets" USING "btree" ("created_at");



CREATE INDEX "support_tickets_customer_id_idx" ON "public"."support_tickets" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "support_tickets_outlook_message_id_idx" ON "public"."support_tickets" USING "btree" ("outlook_message_id") WHERE ("outlook_message_id" IS NOT NULL);



CREATE INDEX "tasks_customer_id_idx" ON "public"."tasks" USING "btree" ("customer_id");



CREATE INDEX "tasks_verantwortlich_idx" ON "public"."tasks" USING "btree" ("verantwortlich");



CREATE INDEX "ticket_messages_created_at_idx" ON "public"."ticket_messages" USING "btree" ("created_at");



CREATE INDEX "ticket_messages_ticket_id_idx" ON "public"."ticket_messages" USING "btree" ("ticket_id");



CREATE OR REPLACE TRIGGER "ablage_updated_at" BEFORE UPDATE ON "public"."ablage_dateien" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "brief_vorlagen_updated_at" BEFORE UPDATE ON "public"."brief_vorlagen" FOR EACH ROW EXECUTE FUNCTION "public"."update_brief_vorlagen_updated_at"();



CREATE OR REPLACE TRIGGER "call_records_protect_manual_customer_trg" BEFORE UPDATE ON "public"."call_records" FOR EACH ROW EXECUTE FUNCTION "public"."call_records_protect_manual_customer"();



CREATE OR REPLACE TRIGGER "dok_tag_learnings_updated_at" BEFORE UPDATE ON "public"."dok_tag_learnings" FOR EACH ROW EXECUTE FUNCTION "public"."dok_tag_learnings_set_updated_at"();



CREATE OR REPLACE TRIGGER "dokumente_updated_at" BEFORE UPDATE ON "public"."dokumente" FOR EACH ROW EXECUTE FUNCTION "public"."update_dokumente_updated_at"();



CREATE OR REPLACE TRIGGER "fahrzeuge_updated_at" BEFORE UPDATE ON "public"."fahrzeuge" FOR EACH ROW EXECUTE FUNCTION "public"."update_fahrzeuge_updated_at"();



CREATE OR REPLACE TRIGGER "fibu_belege_updated_at" BEFORE UPDATE ON "public"."fibu_kreditoren_belege" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_updated_at"();



CREATE OR REPLACE TRIGGER "fibu_jahresabschluss_updated_at" BEFORE UPDATE ON "public"."fibu_jahresabschluss" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_updated_at"();



CREATE OR REPLACE TRIGGER "fibu_lieferanten_updated_at" BEFORE UPDATE ON "public"."fibu_lieferanten" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_updated_at"();



CREATE OR REPLACE TRIGGER "fibu_mandanten_updated_at" BEFORE UPDATE ON "public"."fibu_mandanten" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_updated_at"();



CREATE OR REPLACE TRIGGER "fibu_rechnung_inbox_updated_at" BEFORE UPDATE ON "public"."fibu_rechnung_inbox" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "fristen_updated_at" BEFORE UPDATE ON "public"."fristen" FOR EACH ROW EXECUTE FUNCTION "public"."update_fristen_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."kanban_columns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."mail_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "support_tickets_updated_at" BEFORE UPDATE ON "public"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."update_support_tickets_updated_at"();



CREATE OR REPLACE TRIGGER "trg_abschluss_updated_at" BEFORE UPDATE ON "public"."abschluss" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_anbu_anlage_touch" BEFORE UPDATE ON "public"."anbu_anlage" FOR EACH ROW EXECUTE FUNCTION "public"."tg_anbu_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_anbu_jahresabschluss_touch" BEFORE UPDATE ON "public"."anbu_jahresabschluss" FOR EACH ROW EXECUTE FUNCTION "public"."tg_anbu_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_beleg_freigabe" BEFORE INSERT ON "public"."fibu_kreditoren_belege" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_freigabe_status"();



CREATE OR REPLACE TRIGGER "trg_buchungen_mwst_periode" BEFORE INSERT OR UPDATE OF "buchungsdatum", "mwst_code", "mwst_betrag", "betrag", "konto_soll", "konto_haben", "storniert" ON "public"."fibu_buchungen" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_check_buchung_mwst_periode"();



CREATE OR REPLACE TRIGGER "trg_buchungen_sperre" BEFORE INSERT OR DELETE OR UPDATE ON "public"."fibu_buchungen" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_check_buchungssperre"();



CREATE OR REPLACE TRIGGER "trg_call_notes_pending_updated_at" BEFORE UPDATE ON "public"."call_notes_pending" FOR EACH ROW EXECUTE FUNCTION "public"."call_notes_pending_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_call_records_updated_at" BEFORE UPDATE ON "public"."call_records" FOR EACH ROW EXECUTE FUNCTION "public"."call_records_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_customers_protect_delete_le" BEFORE DELETE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_customer_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_dokumente_search" BEFORE INSERT OR UPDATE ON "public"."dokumente" FOR EACH ROW EXECUTE FUNCTION "public"."dokumente_update_search_vector"();



CREATE OR REPLACE TRIGGER "trg_fahrzeuge_updated_at" BEFORE UPDATE ON "public"."fahrzeuge" FOR EACH ROW EXECUTE FUNCTION "public"."update_fahrzeuge_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kb_updated_at" BEFORE UPDATE ON "public"."knowledge_base" FOR EACH ROW EXECUTE FUNCTION "public"."update_kb_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_absence_updated" BEFORE UPDATE ON "public"."le_absence" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_company_updated" BEFORE UPDATE ON "public"."le_company_settings" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_customer_terms_updated" BEFORE UPDATE ON "public"."le_customer_terms" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_dunning_updated" BEFORE UPDATE ON "public"."le_dunning" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_employee_group_protect_delete" BEFORE DELETE ON "public"."le_employee_group" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_employee_group_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_le_employee_group_updated" BEFORE UPDATE ON "public"."le_employee_group" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_employee_protect_delete" BEFORE DELETE ON "public"."le_employee" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_employee_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_le_employee_updated" BEFORE UPDATE ON "public"."le_employee" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_expense_updated" BEFORE UPDATE ON "public"."le_expense" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_invoice_updated" BEFORE UPDATE ON "public"."le_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_project_protect_delete" BEFORE DELETE ON "public"."le_project" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_project_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_le_project_template_updated" BEFORE UPDATE ON "public"."le_project_template" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_project_updated" BEFORE UPDATE ON "public"."le_project" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_rate_group_protect_delete" BEFORE DELETE ON "public"."le_rate_group" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_rate_group_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_le_rate_group_updated" BEFORE UPDATE ON "public"."le_rate_group" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_recurring_updated" BEFORE UPDATE ON "public"."le_recurring_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_service_type_protect_delete" BEFORE DELETE ON "public"."le_service_type" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_service_type_delete_if_referenced"();



CREATE OR REPLACE TRIGGER "trg_le_service_type_updated" BEFORE UPDATE ON "public"."le_service_type" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_time_entry_lock_billed" BEFORE DELETE OR UPDATE ON "public"."le_time_entry" FOR EACH ROW EXECUTE FUNCTION "public"."le_block_locked_time_entry"();



CREATE OR REPLACE TRIGGER "trg_le_time_entry_updated" BEFORE UPDATE ON "public"."le_time_entry" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_vat_rate_updated" BEFORE UPDATE ON "public"."le_vat_rate" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_mwst_perioden_updated" BEFORE UPDATE ON "public"."fibu_mwst_abrechnungsperioden" FOR EACH ROW EXECUTE FUNCTION "public"."_fibu_mwst_perioden_set_updated"();



CREATE OR REPLACE TRIGGER "trg_profile_to_employee" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."le_sync_profile_to_employee"();



CREATE OR REPLACE TRIGGER "trg_profile_update_employee" AFTER UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."le_update_employee_from_profile"();



CREATE OR REPLACE TRIGGER "trg_steuerdaten_updated_at" BEFORE UPDATE ON "public"."steuerdaten" FOR EACH ROW EXECUTE FUNCTION "public"."update_steuerdaten_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tax_fuss_updated" BEFORE UPDATE ON "public"."tax_steuerfuss" FOR EACH ROW EXECUTE FUNCTION "public"."tax_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tax_invoice_updated" BEFORE UPDATE ON "public"."tax_allocation_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."tax_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tax_period_updated" BEFORE UPDATE ON "public"."tax_allocation_period" FOR EACH ROW EXECUTE FUNCTION "public"."tax_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tax_unit_updated" BEFORE UPDATE ON "public"."tax_allocation_unit" FOR EACH ROW EXECUTE FUNCTION "public"."tax_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_zahlstellen_updated" BEFORE UPDATE ON "public"."fibu_zahlstellen" FOR EACH ROW EXECUTE FUNCTION "public"."fibu_set_updated_at"();



ALTER TABLE ONLY "public"."ablage_dateien"
    ADD CONSTRAINT "ablage_dateien_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ablage_dateien"
    ADD CONSTRAINT "ablage_dateien_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."abschluss"
    ADD CONSTRAINT "abschluss_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."abschluss"
    ADD CONSTRAINT "abschluss_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."abschluss_konten"
    ADD CONSTRAINT "abschluss_konten_abschluss_id_fkey" FOREIGN KEY ("abschluss_id") REFERENCES "public"."abschluss"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."dokumente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aktienbuch"
    ADD CONSTRAINT "aktienbuch_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."aktienbuch"
    ADD CONSTRAINT "aktienbuch_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aktienbuch"
    ADD CONSTRAINT "aktienbuch_vorgaenger_id_fkey" FOREIGN KEY ("vorgaenger_id") REFERENCES "public"."aktienbuch"("id");



ALTER TABLE ONLY "public"."anbu_anlage"
    ADD CONSTRAINT "anbu_anlage_abschluss_id_fkey" FOREIGN KEY ("abschluss_id") REFERENCES "public"."anbu_jahresabschluss"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anbu_anlage"
    ADD CONSTRAINT "anbu_anlage_kategorie_id_fkey" FOREIGN KEY ("kategorie_id") REFERENCES "public"."anbu_kategorie"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."anbu_jahresabschluss"
    ADD CONSTRAINT "anbu_jahresabschluss_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anbu_kategorie"
    ADD CONSTRAINT "anbu_kategorie_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brief_vorlagen"
    ADD CONSTRAINT "brief_vorlagen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."call_notes_pending"
    ADD CONSTRAINT "call_notes_pending_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."call_notes_pending"
    ADD CONSTRAINT "call_notes_pending_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."call_notes_pending"
    ADD CONSTRAINT "call_notes_pending_linked_call_id_fkey" FOREIGN KEY ("linked_call_id") REFERENCES "public"."call_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."call_records"
    ADD CONSTRAINT "call_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_hauptdomizil_id_fkey" FOREIGN KEY ("hauptdomizil_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dok_tag_learnings"
    ADD CONSTRAINT "dok_tag_learnings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dok_tag_learnings"
    ADD CONSTRAINT "dok_tag_learnings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dok_tag_learnings"
    ADD CONSTRAINT "dok_tag_learnings_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."dok_tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dok_tags"
    ADD CONSTRAINT "dok_tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dok_tags"
    ADD CONSTRAINT "dok_tags_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."dok_tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dokumente"
    ADD CONSTRAINT "dokumente_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."dokumente"
    ADD CONSTRAINT "dokumente_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."domain_tag_rules"
    ADD CONSTRAINT "domain_tag_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fahrzeuge"
    ADD CONSTRAINT "fahrzeuge_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fahrzeuge"
    ADD CONSTRAINT "fahrzeuge_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fahrzeuge"
    ADD CONSTRAINT "fahrzeuge_leasing_dokument_id_fkey" FOREIGN KEY ("leasing_dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fibu_bank_imports"
    ADD CONSTRAINT "fibu_bank_imports_erstellt_von_fkey" FOREIGN KEY ("erstellt_von") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_bank_imports"
    ADD CONSTRAINT "fibu_bank_imports_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_bank_transaktionen"
    ADD CONSTRAINT "fibu_bank_transaktionen_buchungs_id_fkey" FOREIGN KEY ("buchungs_id") REFERENCES "public"."fibu_buchungen"("id");



ALTER TABLE ONLY "public"."fibu_bank_transaktionen"
    ADD CONSTRAINT "fibu_bank_transaktionen_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."fibu_bank_imports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_bank_transaktionen"
    ADD CONSTRAINT "fibu_bank_transaktionen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_original_beleg_id_fkey" FOREIGN KEY ("original_beleg_id") REFERENCES "public"."fibu_buchung_belege"("id");



ALTER TABLE ONLY "public"."fibu_buchung_belege"
    ADD CONSTRAINT "fibu_buchung_belege_storno_beleg_id_fkey" FOREIGN KEY ("storno_beleg_id") REFERENCES "public"."fibu_buchung_belege"("id");



ALTER TABLE ONLY "public"."fibu_buchung_serien"
    ADD CONSTRAINT "fibu_buchung_serien_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_buchungen"
    ADD CONSTRAINT "fibu_buchungen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_buchungen"
    ADD CONSTRAINT "fibu_buchungen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_buchungen"
    ADD CONSTRAINT "fibu_buchungen_storno_von_fkey" FOREIGN KEY ("storno_von") REFERENCES "public"."fibu_buchungen"("id");



ALTER TABLE ONLY "public"."fibu_budget"
    ADD CONSTRAINT "fibu_budget_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_jahresabschluss"
    ADD CONSTRAINT "fibu_jahresabschluss_abgeschlossen_von_fkey" FOREIGN KEY ("abgeschlossen_von") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_jahresabschluss"
    ADD CONSTRAINT "fibu_jahresabschluss_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_konten"
    ADD CONSTRAINT "fibu_konten_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kontierungsregeln"
    ADD CONSTRAINT "fibu_kontierungsregeln_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_freigegeben_von_fkey" FOREIGN KEY ("freigegeben_von") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_gebucht_von_fkey" FOREIGN KEY ("gebucht_von") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_lieferant_id_fkey" FOREIGN KEY ("lieferant_id") REFERENCES "public"."fibu_lieferanten"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_belege"
    ADD CONSTRAINT "fibu_kreditoren_belege_storno_beleg_id_fkey" FOREIGN KEY ("storno_beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_dauerbelege"
    ADD CONSTRAINT "fibu_kreditoren_dauerbelege_lieferant_id_fkey" FOREIGN KEY ("lieferant_id") REFERENCES "public"."fibu_lieferanten"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_dauerbelege"
    ADD CONSTRAINT "fibu_kreditoren_dauerbelege_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_positionen"
    ADD CONSTRAINT "fibu_kreditoren_positionen_beleg_id_fkey" FOREIGN KEY ("beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_positionen"
    ADD CONSTRAINT "fibu_kreditoren_positionen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_verrechnungen"
    ADD CONSTRAINT "fibu_kreditoren_verrechnungen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_verrechnungen"
    ADD CONSTRAINT "fibu_kreditoren_verrechnungen_gutschrift_beleg_id_fkey" FOREIGN KEY ("gutschrift_beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id");



ALTER TABLE ONLY "public"."fibu_kreditoren_verrechnungen"
    ADD CONSTRAINT "fibu_kreditoren_verrechnungen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_kreditoren_verrechnungen"
    ADD CONSTRAINT "fibu_kreditoren_verrechnungen_rechnung_beleg_id_fkey" FOREIGN KEY ("rechnung_beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id");



ALTER TABLE ONLY "public"."fibu_lieferanten"
    ADD CONSTRAINT "fibu_lieferanten_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_mwst_abrechnungsperioden"
    ADD CONSTRAINT "fibu_mwst_abrechnungsperioden_benutzer_id_fkey" FOREIGN KEY ("benutzer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_mwst_abrechnungsperioden"
    ADD CONSTRAINT "fibu_mwst_abrechnungsperioden_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_mwst_codes"
    ADD CONSTRAINT "fibu_mwst_codes_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_rechnung_inbox"
    ADD CONSTRAINT "fibu_rechnung_inbox_beleg_id_fkey" FOREIGN KEY ("beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fibu_rechnung_inbox"
    ADD CONSTRAINT "fibu_rechnung_inbox_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_user_mandant_access"
    ADD CONSTRAINT "fibu_user_mandant_access_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_user_mandant_access"
    ADD CONSTRAINT "fibu_user_mandant_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_zahlstellen"
    ADD CONSTRAINT "fibu_zahlstellen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_zahlungslaeufe"
    ADD CONSTRAINT "fibu_zahlungslaeufe_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."fibu_zahlungslaeufe"
    ADD CONSTRAINT "fibu_zahlungslaeufe_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_bank_tx_id_fkey" FOREIGN KEY ("bank_tx_id") REFERENCES "public"."fibu_bank_transaktionen"("id");



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_beleg_id_fkey" FOREIGN KEY ("beleg_id") REFERENCES "public"."fibu_kreditoren_belege"("id");



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_lieferant_id_fkey" FOREIGN KEY ("lieferant_id") REFERENCES "public"."fibu_lieferanten"("id");



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_mandant_id_fkey" FOREIGN KEY ("mandant_id") REFERENCES "public"."fibu_mandanten"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fibu_zahlungslauf_positionen"
    ADD CONSTRAINT "fibu_zahlungslauf_positionen_zahlungslauf_id_fkey" FOREIGN KEY ("zahlungslauf_id") REFERENCES "public"."fibu_zahlungslaeufe"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fristen"
    ADD CONSTRAINT "fristen_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."jahresplanung"
    ADD CONSTRAINT "jahresplanung_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jahresplanung"
    ADD CONSTRAINT "jahresplanung_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."jahresplanung"
    ADD CONSTRAINT "jahresplanung_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jp_feiertage"
    ADD CONSTRAINT "jp_feiertage_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_absence"
    ADD CONSTRAINT "le_absence_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_absence"
    ADD CONSTRAINT "le_absence_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."le_employee"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_camt_import"
    ADD CONSTRAINT "le_camt_import_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_customer_terms"
    ADD CONSTRAINT "le_customer_terms_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_customer_terms"
    ADD CONSTRAINT "le_customer_terms_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_dunning"
    ADD CONSTRAINT "le_dunning_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_dunning"
    ADD CONSTRAINT "le_dunning_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_dunning"
    ADD CONSTRAINT "le_dunning_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_employee_group_id_fkey" FOREIGN KEY ("employee_group_id") REFERENCES "public"."le_employee_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."le_employee"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_invoiced_invoice_id_fkey" FOREIGN KEY ("invoiced_invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_expense"
    ADD CONSTRAINT "le_expense_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."le_project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice_akonto_link"
    ADD CONSTRAINT "le_invoice_akonto_link_akonto_invoice_id_fkey" FOREIGN KEY ("akonto_invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_invoice_akonto_link"
    ADD CONSTRAINT "le_invoice_akonto_link_schluss_invoice_id_fkey" FOREIGN KEY ("schluss_invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_parent_invoice_id_fkey" FOREIGN KEY ("parent_invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."le_project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_payment"
    ADD CONSTRAINT "le_payment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_payment"
    ADD CONSTRAINT "le_payment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_payment"
    ADD CONSTRAINT "le_payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_responsible_employee_id_fkey" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."le_employee"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project_template"
    ADD CONSTRAINT "le_project_template_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_recurring_invoice"
    ADD CONSTRAINT "le_recurring_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_recurring_invoice"
    ADD CONSTRAINT "le_recurring_invoice_last_invoice_id_fkey" FOREIGN KEY ("last_invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_recurring_invoice"
    ADD CONSTRAINT "le_recurring_invoice_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."le_project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_sollzeit_profile"
    ADD CONSTRAINT "le_sollzeit_profile_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."le_employee"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."le_employee"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."le_project"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "public"."kanban_columns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "public"."kanban_columns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_entries"
    ADD CONSTRAINT "mp_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mp_entries"
    ADD CONSTRAINT "mp_entries_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."mp_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_plans"
    ADD CONSTRAINT "mp_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mp_plans"
    ADD CONSTRAINT "mp_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."priorities"
    ADD CONSTRAINT "priorities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prompt_vorlagen"
    ADD CONSTRAINT "prompt_vorlagen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."dokumente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_dokument_id_fkey" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_signed_dokument_id_fkey" FOREIGN KEY ("signed_dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "public"."ticket_columns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_columns"
    ADD CONSTRAINT "task_columns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_read_statuses"
    ADD CONSTRAINT "task_read_statuses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "public"."task_columns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_mail_id_fkey" FOREIGN KEY ("mail_id") REFERENCES "public"."mail_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_allocation_invoice"
    ADD CONSTRAINT "tax_allocation_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_allocation_invoice"
    ADD CONSTRAINT "tax_allocation_invoice_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."tax_allocation_unit"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_allocation_period"
    ADD CONSTRAINT "tax_allocation_period_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_allocation_period"
    ADD CONSTRAINT "tax_allocation_period_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_allocation_unit"
    ADD CONSTRAINT "tax_allocation_unit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_allocation_unit"
    ADD CONSTRAINT "tax_allocation_unit_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."tax_allocation_period"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tax_steuerfuss"
    ADD CONSTRAINT "tax_steuerfuss_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tax_steuerfuss"
    ADD CONSTRAINT "tax_steuerfuss_override_user_id_fkey" FOREIGN KEY ("override_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ticket_columns"
    ADD CONSTRAINT "ticket_columns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whiteboards"
    ADD CONSTRAINT "whiteboards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."whiteboards"
    ADD CONSTRAINT "whiteboards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage dok_tags" ON "public"."dok_tags" TO "authenticated" USING (true);



CREATE POLICY "Admins can update any profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."id" = "auth"."uid"()) AND ("profiles_1"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."id" = "auth"."uid"()) AND ("profiles_1"."role" = 'admin'::"text")))));



CREATE POLICY "Authenticated users can manage fahrzeuge" ON "public"."fahrzeuge" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can manage signaturen" ON "public"."signaturen" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can read dok_tags" ON "public"."dok_tags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users full access" ON "public"."steuerdaten" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can manage their own preferences" ON "public"."user_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own calendar events" ON "public"."calendar_events" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "Users see own kanban_columns" ON "public"."kanban_columns" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own mail_items" ON "public"."mail_items" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own mail_kanban_mappings" ON "public"."mail_kanban_mappings" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own tags" ON "public"."tags" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "ablage_all" ON "public"."ablage_dateien" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."ablage_dateien" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."abschluss" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "abschluss_auth" ON "public"."abschluss" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."abschluss_konten" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "abschluss_konten_auth" ON "public"."abschluss_konten" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."activity_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aktienbuch" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aktienbuch_auth" ON "public"."aktienbuch" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow_all" ON "public"."task_comments" USING (true) WITH CHECK (true);



CREATE POLICY "allow_all_share_links" ON "public"."share_links" USING (true) WITH CHECK (true);



ALTER TABLE "public"."anbu_anlage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anbu_anlage_all" ON "public"."anbu_anlage" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."anbu_jahresabschluss" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anbu_jahresabschluss_all" ON "public"."anbu_jahresabschluss" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."anbu_kategorie" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anbu_kategorie_all" ON "public"."anbu_kategorie" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_insert_own" ON "public"."agent_tokens" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "auth_select_own" ON "public"."agent_tokens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "authenticated full access" ON "public"."prompt_vorlagen" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "authenticated_access" ON "public"."task_read_statuses" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_activity_templates" ON "public"."activity_templates" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_customers" ON "public"."customers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_priorities" ON "public"."priorities" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_task_columns" ON "public"."task_columns" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "bank_imports_access" ON "public"."fibu_bank_imports" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "bank_tx_access" ON "public"."fibu_bank_transaktionen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



ALTER TABLE "public"."brief_vorlagen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brief_vorlagen_authenticated" ON "public"."brief_vorlagen" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."call_notes_pending" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_notes_pending_delete" ON "public"."call_notes_pending" FOR DELETE USING ((("auth"."role"() = 'authenticated'::"text") AND (("created_by" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"))));



CREATE POLICY "call_notes_pending_insert" ON "public"."call_notes_pending" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "call_notes_pending_select" ON "public"."call_notes_pending" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "call_notes_pending_service" ON "public"."call_notes_pending" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "call_notes_pending_update" ON "public"."call_notes_pending" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (("created_by" = "auth"."uid"()) OR (("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")))) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."call_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_records_select" ON "public"."call_records" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "call_records_user_update" ON "public"."call_records" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "call_records_write" ON "public"."call_records" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dok_tag_learnings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dok_tag_learnings_delete_authenticated" ON "public"."dok_tag_learnings" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "dok_tag_learnings_insert_authenticated" ON "public"."dok_tag_learnings" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "dok_tag_learnings_select_authenticated" ON "public"."dok_tag_learnings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "dok_tag_learnings_update_authenticated" ON "public"."dok_tag_learnings" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."dok_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dok_tags_authenticated_all" ON "public"."dok_tags" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."dokumente" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dokumente_authenticated_all" ON "public"."dokumente" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."domain_tag_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domain_tag_rules_delete" ON "public"."domain_tag_rules" FOR DELETE USING (("auth"."uid"() = "created_by"));



CREATE POLICY "domain_tag_rules_insert" ON "public"."domain_tag_rules" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "domain_tag_rules_select" ON "public"."domain_tag_rules" FOR SELECT USING (("auth"."uid"() = "created_by"));



CREATE POLICY "domain_tag_rules_update" ON "public"."domain_tag_rules" FOR UPDATE USING (("auth"."uid"() = "created_by"));



ALTER TABLE "public"."fahrzeuge" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fahrzeuge_auth" ON "public"."fahrzeuge" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "fibu: admins manage access" ON "public"."fibu_user_mandant_access" USING ((("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())) AND "public"."fibu_user_is_admin_for"("mandant_id")));



CREATE POLICY "fibu: belege select" ON "public"."fibu_kreditoren_belege" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: belege write" ON "public"."fibu_kreditoren_belege" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: buchung_belege all" ON "public"."fibu_buchung_belege" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: buchung_serien all" ON "public"."fibu_buchung_serien" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: buchungen lesen" ON "public"."fibu_buchungen" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: buchungen select" ON "public"."fibu_buchungen" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: buchungen write" ON "public"."fibu_buchungen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: budget all" ON "public"."fibu_budget" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: creator inserts first access row" ON "public"."fibu_user_mandant_access" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."fibu_mandant_has_no_access"("mandant_id")));



CREATE POLICY "fibu: dauerbelege all" ON "public"."fibu_kreditoren_dauerbelege" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: inbox lesen" ON "public"."fibu_rechnung_inbox" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: inbox manuell hochladen" ON "public"."fibu_rechnung_inbox" FOR INSERT WITH CHECK (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: inbox schreiben" ON "public"."fibu_rechnung_inbox" FOR UPDATE USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: insert mandanten" ON "public"."fibu_mandanten" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "fibu: konten select" ON "public"."fibu_konten" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: konten write" ON "public"."fibu_konten" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: kontierungsregeln all" ON "public"."fibu_kontierungsregeln" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: lieferanten select" ON "public"."fibu_lieferanten" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: lieferanten write" ON "public"."fibu_lieferanten" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: mwst_codes select" ON "public"."fibu_mwst_codes" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: mwst_codes write" ON "public"."fibu_mwst_codes" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: mwst_perioden all" ON "public"."fibu_mwst_abrechnungsperioden" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: positionen select" ON "public"."fibu_kreditoren_positionen" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: positionen write" ON "public"."fibu_kreditoren_positionen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: select own mandanten" ON "public"."fibu_mandanten" FOR SELECT USING (("id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: update own mandanten (admin)" ON "public"."fibu_mandanten" FOR UPDATE USING ((("id" = ANY ("public"."fibu_mandant_ids_for_user"())) AND (EXISTS ( SELECT 1
   FROM "public"."fibu_user_mandant_access"
  WHERE (("fibu_user_mandant_access"."user_id" = "auth"."uid"()) AND ("fibu_user_mandant_access"."mandant_id" = "fibu_mandanten"."id") AND ("fibu_user_mandant_access"."role" = 'admin'::"text"))))));



CREATE POLICY "fibu: users see own access rows" ON "public"."fibu_user_mandant_access" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "fibu: verrechnungen all" ON "public"."fibu_kreditoren_verrechnungen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: wechselkurse lesen" ON "public"."fibu_wechselkurse" FOR SELECT USING (true);



CREATE POLICY "fibu: zahlstellen all" ON "public"."fibu_zahlstellen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: zlauf select" ON "public"."fibu_zahlungslaeufe" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: zlauf write" ON "public"."fibu_zahlungslaeufe" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: zlaufpos select" ON "public"."fibu_zahlungslauf_positionen" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu: zlaufpos write" ON "public"."fibu_zahlungslauf_positionen" USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



ALTER TABLE "public"."fibu_bank_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_bank_transaktionen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_buchung_belege" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_buchung_serien" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_buchungen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_budget" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_jahresabschluss" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fibu_jahresabschluss_delete" ON "public"."fibu_jahresabschluss" FOR DELETE USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu_jahresabschluss_insert" ON "public"."fibu_jahresabschluss" FOR INSERT WITH CHECK (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu_jahresabschluss_select" ON "public"."fibu_jahresabschluss" FOR SELECT USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



CREATE POLICY "fibu_jahresabschluss_update" ON "public"."fibu_jahresabschluss" FOR UPDATE USING (("mandant_id" = ANY ("public"."fibu_mandant_ids_for_user"())));



ALTER TABLE "public"."fibu_konten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_kontierungsregeln" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_kreditoren_belege" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_kreditoren_dauerbelege" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_kreditoren_positionen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_kreditoren_verrechnungen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_lieferanten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_mandanten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_mwst_abrechnungsperioden" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_mwst_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_rechnung_inbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_user_mandant_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_wechselkurse" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_zahlstellen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_zahlungslaeufe" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fibu_zahlungslauf_positionen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fristen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fristen_admin_all" ON "public"."fristen" USING ("public"."is_admin_user"());



CREATE POLICY "fristen_user_access" ON "public"."fristen" USING (((("auth"."uid"())::"text" = ("created_by")::"text") OR ("assignee" = "auth"."email"()) OR ("created_by" IS NULL))) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."jahresplanung" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jahresplanung_auth" ON "public"."jahresplanung" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."jp_feiertage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jp_feiertage_auth" ON "public"."jp_feiertage" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."kanban_columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kb_auth" ON "public"."knowledge_base" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_absence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_absence_read" ON "public"."le_absence" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_absence_write" ON "public"."le_absence" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_camt_import" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_camt_import_read" ON "public"."le_camt_import" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_camt_import_write" ON "public"."le_camt_import" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_company_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_company_settings_read" ON "public"."le_company_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_company_settings_write" ON "public"."le_company_settings" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_customer_terms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_customer_terms_read" ON "public"."le_customer_terms" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_customer_terms_write" ON "public"."le_customer_terms" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_dunning" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_dunning_read" ON "public"."le_dunning" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_dunning_write" ON "public"."le_dunning" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_employee" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_employee_group" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_employee_group_read" ON "public"."le_employee_group" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_employee_group_write" ON "public"."le_employee_group" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "le_employee_read" ON "public"."le_employee" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_employee_write" ON "public"."le_employee" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_expense" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_expense_read" ON "public"."le_expense" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_expense_write" ON "public"."le_expense" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_holiday" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_holiday_read" ON "public"."le_holiday" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_holiday_write" ON "public"."le_holiday" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_invoice" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_invoice_akonto_link" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_invoice_akonto_link_read" ON "public"."le_invoice_akonto_link" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_invoice_akonto_link_write" ON "public"."le_invoice_akonto_link" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_invoice_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_invoice_line_read" ON "public"."le_invoice_line" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_invoice_line_write" ON "public"."le_invoice_line" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "le_invoice_read" ON "public"."le_invoice" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_invoice_write" ON "public"."le_invoice" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_number_sequence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_number_sequence_read" ON "public"."le_number_sequence" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_number_sequence_write" ON "public"."le_number_sequence" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_payment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_payment_read" ON "public"."le_payment" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_payment_write" ON "public"."le_payment" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_project" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_project_read" ON "public"."le_project" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."le_project_template" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_project_template_read" ON "public"."le_project_template" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_project_template_write" ON "public"."le_project_template" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "le_project_write" ON "public"."le_project" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_rate_group" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_rate_group_rate" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_rate_group_rate_read" ON "public"."le_rate_group_rate" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_rate_group_rate_write" ON "public"."le_rate_group_rate" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



CREATE POLICY "le_rate_group_read" ON "public"."le_rate_group" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_rate_group_write" ON "public"."le_rate_group" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_recurring_invoice" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_recurring_invoice_read" ON "public"."le_recurring_invoice" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_recurring_invoice_write" ON "public"."le_recurring_invoice" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_service_rate_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_service_rate_history_read" ON "public"."le_service_rate_history" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_service_rate_history_write" ON "public"."le_service_rate_history" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_service_type" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_service_type_read" ON "public"."le_service_type" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_service_type_write" ON "public"."le_service_type" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_sollzeit_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_sollzeit_profile_read" ON "public"."le_sollzeit_profile" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_sollzeit_profile_write" ON "public"."le_sollzeit_profile" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_time_entry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_time_entry_delete_admin" ON "public"."le_time_entry" FOR DELETE TO "authenticated" USING ("public"."le_is_admin"());



CREATE POLICY "le_time_entry_insert_own" ON "public"."le_time_entry" FOR INSERT TO "authenticated" WITH CHECK (("public"."le_is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."le_employee" "e"
  WHERE (("e"."id" = "le_time_entry"."employee_id") AND ("e"."profile_id" = "auth"."uid"()))))));



CREATE POLICY "le_time_entry_read" ON "public"."le_time_entry" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_time_entry_update_own" ON "public"."le_time_entry" FOR UPDATE TO "authenticated" USING (("public"."le_is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."le_employee" "e"
  WHERE (("e"."id" = "le_time_entry"."employee_id") AND ("e"."profile_id" = "auth"."uid"()))))));



ALTER TABLE "public"."le_vat_rate" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_vat_rate_read" ON "public"."le_vat_rate" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_vat_rate_write" ON "public"."le_vat_rate" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."mail_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mail_kanban_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mp_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mp_entries_all" ON "public"."mp_entries" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."mp_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mp_plans_all" ON "public"."mp_plans" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "own_domain_tag_rules" ON "public"."domain_tag_rules" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "own_kanban_columns" ON "public"."kanban_columns" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "own_mail_items" ON "public"."mail_items" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "own_mail_kanban_mappings" ON "public"."mail_kanban_mappings" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "own_profile" ON "public"."profiles" USING (("auth"."uid"() = "id"));



CREATE POLICY "own_projects" ON "public"."projects" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "own_tags" ON "public"."tags" USING (("auth"."uid"() = "created_by"));



ALTER TABLE "public"."priorities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_admin_read_all" ON "public"."profiles" FOR SELECT USING ("public"."is_admin_user"());



CREATE POLICY "profiles_own" ON "public"."profiles" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prompt_vorlagen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."share_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signaturen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signaturen_auth" ON "public"."signaturen" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."steuerdaten" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "support_tickets_all_auth" ON "public"."support_tickets" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_admin_all" ON "public"."system_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_columns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_read_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_rls" ON "public"."tasks" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."tax_allocation_invoice" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_allocation_period" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_allocation_unit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tax_fuss_all" ON "public"."tax_steuerfuss" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tax_invoice_all" ON "public"."tax_allocation_invoice" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tax_period_all" ON "public"."tax_allocation_period" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."tax_steuerfuss" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tax_unit_all" ON "public"."tax_allocation_unit" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."ticket_columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ticket_columns_all_auth" ON "public"."ticket_columns" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."ticket_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ticket_messages_all_auth" ON "public"."ticket_messages" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wb_policy" ON "public"."whiteboards" USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."whiteboards" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."mail_items";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."_fibu_mwst_perioden_set_updated"() TO "anon";
GRANT ALL ON FUNCTION "public"."_fibu_mwst_perioden_set_updated"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_fibu_mwst_perioden_set_updated"() TO "service_role";



GRANT ALL ON FUNCTION "public"."call_notes_pending_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."call_notes_pending_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."call_notes_pending_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."call_records_protect_manual_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."call_records_protect_manual_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."call_records_protect_manual_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."call_records_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."call_records_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."call_records_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dok_tag_learnings_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."dok_tag_learnings_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dok_tag_learnings_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "anon";
GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_bank_match_kreditor"("p_tx_id" "uuid", "p_beleg_id" "uuid", "p_betrag" numeric, "p_datum" "date", "p_confidence" numeric, "p_methode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_bank_match_kreditor"("p_tx_id" "uuid", "p_beleg_id" "uuid", "p_betrag" numeric, "p_datum" "date", "p_confidence" numeric, "p_methode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_bank_match_kreditor"("p_tx_id" "uuid", "p_beleg_id" "uuid", "p_betrag" numeric, "p_datum" "date", "p_confidence" numeric, "p_methode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_beleg_freigeben"("p_beleg_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_beleg_freigeben"("p_beleg_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_beleg_freigeben"("p_beleg_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_bilanz"("p_mandant_id" "uuid", "p_stichtag" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_bilanz"("p_mandant_id" "uuid", "p_stichtag" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_bilanz"("p_mandant_id" "uuid", "p_stichtag" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_buchung_mwst_code_aendern"("p_mandant_id" "uuid", "p_buchungs_nr" "text", "p_mwst_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_buchung_mwst_code_aendern"("p_mandant_id" "uuid", "p_buchungs_nr" "text", "p_mwst_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_buchung_mwst_code_aendern"("p_mandant_id" "uuid", "p_buchungs_nr" "text", "p_mwst_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_buchung_serie_erzeugen"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_buchung_serie_erzeugen"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_buchung_serie_erzeugen"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_buchung_serien_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_buchung_serien_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_buchung_serien_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_buchungssperre_setzen"("p_mandant_id" "uuid", "p_datum" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_buchungssperre_setzen"("p_mandant_id" "uuid", "p_datum" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_buchungssperre_setzen"("p_mandant_id" "uuid", "p_datum" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_budget_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_zeilen" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_budget_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_zeilen" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_budget_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_zeilen" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_budget_uebersicht"("p_mandant_id" "uuid", "p_jahr" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_budget_uebersicht"("p_mandant_id" "uuid", "p_jahr" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_budget_uebersicht"("p_mandant_id" "uuid", "p_jahr" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_check_buchung_mwst_periode"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_check_buchung_mwst_periode"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_check_buchung_mwst_periode"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_check_buchungssperre"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_check_buchungssperre"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_check_buchungssperre"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_create_mandant"("p_name" "text", "p_uid" "text", "p_mwst_nr" "text", "p_ort" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_create_mandant"("p_name" "text", "p_uid" "text", "p_mwst_nr" "text", "p_ort" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_create_mandant"("p_name" "text", "p_uid" "text", "p_mwst_nr" "text", "p_ort" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_dauerbeleg_erzeugen"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_dauerbeleg_erzeugen"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_dauerbeleg_erzeugen"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_dauerbelege_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_dauerbelege_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_dauerbelege_faellige_erzeugen"("p_mandant_id" "uuid", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_delete_kreditoren_beleg"("p_beleg_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_delete_kreditoren_beleg"("p_beleg_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_delete_kreditoren_beleg"("p_beleg_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_delete_mandant"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_delete_mandant"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_delete_mandant"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_erfolgsrechnung"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_erfolgsrechnung"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_erfolgsrechnung"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_gutschrift_verrechnen"("p_mandant_id" "uuid", "p_gutschrift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_gutschrift_verrechnen"("p_mandant_id" "uuid", "p_gutschrift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_gutschrift_verrechnen"("p_mandant_id" "uuid", "p_gutschrift_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_inbox_insert"("p_inbox_code" "text", "p_sender" "text", "p_sender_name" "text", "p_betreff" "text", "p_body" "text", "p_pdf_path" "text", "p_pdf_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_inbox_insert"("p_inbox_code" "text", "p_sender" "text", "p_sender_name" "text", "p_betreff" "text", "p_body" "text", "p_pdf_path" "text", "p_pdf_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_inbox_insert"("p_inbox_code" "text", "p_sender" "text", "p_sender_name" "text", "p_betreff" "text", "p_body" "text", "p_pdf_path" "text", "p_pdf_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_durchfuehren"("p_mandant_id" "uuid", "p_jahr" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_jahresabschluss_salden"("p_mandant_id" "uuid", "p_jahr" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_konten_mit_bewegungen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_konten_mit_bewegungen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_konten_mit_bewegungen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_kontoblatt"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_kontoblatt"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_kontoblatt"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_kontoblatt_eroeffnung"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_stichtag" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_kontoblatt_eroeffnung"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_stichtag" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_kontoblatt_eroeffnung"("p_mandant_id" "uuid", "p_konto_nr" "text", "p_stichtag" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_kreditoren_storno"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_kreditoren_storno"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_kreditoren_storno"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_kreditoren_verbuchen"("p_beleg_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_kreditoren_verbuchen"("p_beleg_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_kreditoren_verbuchen"("p_beleg_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_kursbewertung_buchen"("p_mandant_id" "uuid", "p_stichtag" "date", "p_konto" "text", "p_betrag" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_kursbewertung_buchen"("p_mandant_id" "uuid", "p_stichtag" "date", "p_konto" "text", "p_betrag" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_kursbewertung_buchen"("p_mandant_id" "uuid", "p_stichtag" "date", "p_konto" "text", "p_betrag" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_lieferant_buchungshistorie"("p_mandant_id" "uuid", "p_lieferant_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_lieferant_buchungshistorie"("p_mandant_id" "uuid", "p_lieferant_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_lieferant_buchungshistorie"("p_mandant_id" "uuid", "p_lieferant_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_list_mandant_users"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_list_mandant_users"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_list_mandant_users"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mandant_belegfreigabe_setzen"("p_mandant_id" "uuid", "p_aktiv" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mandant_belegfreigabe_setzen"("p_mandant_id" "uuid", "p_aktiv" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mandant_belegfreigabe_setzen"("p_mandant_id" "uuid", "p_aktiv" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mandant_has_no_access"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mandant_has_no_access"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mandant_has_no_access"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mandant_ids_for_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mandant_ids_for_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mandant_ids_for_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mandant_mwst_methode_setzen"("p_mandant_id" "uuid", "p_methode" "text", "p_sss" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mandant_mwst_methode_setzen"("p_mandant_id" "uuid", "p_methode" "text", "p_sss" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mandant_mwst_methode_setzen"("p_mandant_id" "uuid", "p_methode" "text", "p_sss" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_erstellen"("p_mandant_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_art" "text", "p_zeilen" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_erstellen"("p_mandant_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_art" "text", "p_zeilen" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_erstellen"("p_mandant_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_art" "text", "p_zeilen" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_korrigieren"("p_beleg_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_zeilen" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_korrigieren"("p_beleg_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_zeilen" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_korrigieren"("p_beleg_id" "uuid", "p_datum" "date", "p_text" "text", "p_pdf_path" "text", "p_pdf_name" "text", "p_zeilen" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_stornieren"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_stornieren"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_manuelle_buchung_stornieren"("p_beleg_id" "uuid", "p_storno_datum" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mwst_by_konto"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mwst_by_konto"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mwst_by_konto"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mwst_detail"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mwst_detail"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mwst_detail"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON TABLE "public"."fibu_mwst_abrechnungsperioden" TO "anon";
GRANT ALL ON TABLE "public"."fibu_mwst_abrechnungsperioden" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_mwst_abrechnungsperioden" TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_abschliessen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date", "p_status" "text", "p_zahllast" numeric, "p_notizen" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_abschliessen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date", "p_status" "text", "p_zahllast" numeric, "p_notizen" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_abschliessen"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date", "p_status" "text", "p_zahllast" numeric, "p_notizen" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_get"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_get"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mwst_periode_get"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_mwst_summary"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_mwst_summary"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_mwst_summary"("p_mandant_id" "uuid", "p_von" "date", "p_bis" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_next_buchungs_nr"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_next_buchungs_nr"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_next_buchungs_nr"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_remove_mandant_user"("p_mandant_id" "uuid", "p_target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_remove_mandant_user"("p_mandant_id" "uuid", "p_target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_remove_mandant_user"("p_mandant_id" "uuid", "p_target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_lesen"("p_mandant_id" "uuid", "p_jahr" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_lesen"("p_mandant_id" "uuid", "p_jahr" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_lesen"("p_mandant_id" "uuid", "p_jahr" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_salden" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_salden" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_saldovortrag_speichern"("p_mandant_id" "uuid", "p_jahr" integer, "p_salden" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_seed_kontenplan_ch_kmu"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_seed_kontenplan_ch_kmu"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_seed_kontenplan_ch_kmu"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_seed_mwst_codes"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_seed_mwst_codes"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_seed_mwst_codes"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_set_freigabe_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_set_freigabe_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_set_freigabe_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_set_mandant_user_role"("p_mandant_id" "uuid", "p_target_user_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_set_mandant_user_role"("p_mandant_id" "uuid", "p_target_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_set_mandant_user_role"("p_mandant_id" "uuid", "p_target_user_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_skonto_buchen"("p_beleg_id" "uuid", "p_skonto_betrag" numeric, "p_datum" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_skonto_buchen"("p_beleg_id" "uuid", "p_skonto_betrag" numeric, "p_datum" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_skonto_buchen"("p_beleg_id" "uuid", "p_skonto_betrag" numeric, "p_datum" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_user_has_any_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_user_has_any_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_user_has_any_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_user_is_admin_for"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_user_is_admin_for"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_user_is_admin_for"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_user_is_any_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_user_is_any_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_user_is_any_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_zahlstelle_set_standard"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_zahlstelle_set_standard"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_zahlstelle_set_standard"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fibu_zahlungslauf_historie"("p_mandant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fibu_zahlungslauf_historie"("p_mandant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fibu_zahlungslauf_historie"("p_mandant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customers_for_addin"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_customers_for_addin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customers_for_addin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tags_for_addin"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_tags_for_addin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tags_for_addin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_customer_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_customer_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_customer_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_employee_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_employee_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_employee_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_employee_group_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_employee_group_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_employee_group_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_locked_time_entry"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_locked_time_entry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_locked_time_entry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_project_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_project_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_project_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_rate_group_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_rate_group_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_rate_group_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_block_service_type_delete_if_referenced"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_block_service_type_delete_if_referenced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_block_service_type_delete_if_referenced"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_customer_can_delete"("p_customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."le_customer_can_delete"("p_customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_customer_can_delete"("p_customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_employee_can_delete"("p_employee_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."le_employee_can_delete"("p_employee_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_employee_can_delete"("p_employee_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_next_dunning_no"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_next_dunning_no"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_next_dunning_no"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_project_can_delete"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."le_project_can_delete"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_project_can_delete"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_resolve_rate"("p_project_id" "uuid", "p_employee_id" "uuid", "p_service_type_id" "uuid", "p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."le_resolve_rate"("p_project_id" "uuid", "p_employee_id" "uuid", "p_service_type_id" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_resolve_rate"("p_project_id" "uuid", "p_employee_id" "uuid", "p_service_type_id" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_resolve_vat_rate"("p_code" "text", "p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."le_resolve_vat_rate"("p_code" "text", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_resolve_vat_rate"("p_code" "text", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_service_type_can_delete"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."le_service_type_can_delete"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_service_type_can_delete"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_short_code_from_name"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."le_short_code_from_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_short_code_from_name"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_sync_profile_to_employee"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_sync_profile_to_employee"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_sync_profile_to_employee"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_unique_short_code"("p_base" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."le_unique_short_code"("p_base" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_unique_short_code"("p_base" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."le_update_employee_from_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_update_employee_from_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_update_employee_from_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tax_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tax_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tax_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_anbu_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_anbu_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_anbu_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_auto_index_document"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_auto_index_document"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_auto_index_document"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_brief_vorlagen_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_brief_vorlagen_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_brief_vorlagen_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_dokumente_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_dokumente_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_dokumente_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_fahrzeuge_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_fahrzeuge_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_fahrzeuge_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_fristen_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_fristen_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_fristen_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_kb_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_kb_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_kb_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_steuerdaten_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_steuerdaten_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_steuerdaten_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."ablage_dateien" TO "anon";
GRANT ALL ON TABLE "public"."ablage_dateien" TO "authenticated";
GRANT ALL ON TABLE "public"."ablage_dateien" TO "service_role";



GRANT ALL ON TABLE "public"."abschluss" TO "anon";
GRANT ALL ON TABLE "public"."abschluss" TO "authenticated";
GRANT ALL ON TABLE "public"."abschluss" TO "service_role";



GRANT ALL ON TABLE "public"."abschluss_konten" TO "anon";
GRANT ALL ON TABLE "public"."abschluss_konten" TO "authenticated";
GRANT ALL ON TABLE "public"."abschluss_konten" TO "service_role";



GRANT ALL ON TABLE "public"."activity_templates" TO "anon";
GRANT ALL ON TABLE "public"."activity_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_templates" TO "service_role";



GRANT ALL ON TABLE "public"."agent_tokens" TO "anon";
GRANT ALL ON TABLE "public"."agent_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."aktienbuch" TO "anon";
GRANT ALL ON TABLE "public"."aktienbuch" TO "authenticated";
GRANT ALL ON TABLE "public"."aktienbuch" TO "service_role";



GRANT ALL ON TABLE "public"."anbu_anlage" TO "anon";
GRANT ALL ON TABLE "public"."anbu_anlage" TO "authenticated";
GRANT ALL ON TABLE "public"."anbu_anlage" TO "service_role";



GRANT ALL ON TABLE "public"."anbu_jahresabschluss" TO "anon";
GRANT ALL ON TABLE "public"."anbu_jahresabschluss" TO "authenticated";
GRANT ALL ON TABLE "public"."anbu_jahresabschluss" TO "service_role";



GRANT ALL ON TABLE "public"."anbu_kategorie" TO "anon";
GRANT ALL ON TABLE "public"."anbu_kategorie" TO "authenticated";
GRANT ALL ON TABLE "public"."anbu_kategorie" TO "service_role";



GRANT ALL ON TABLE "public"."brief_vorlagen" TO "anon";
GRANT ALL ON TABLE "public"."brief_vorlagen" TO "authenticated";
GRANT ALL ON TABLE "public"."brief_vorlagen" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_events" TO "anon";
GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."call_notes_pending" TO "anon";
GRANT ALL ON TABLE "public"."call_notes_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."call_notes_pending" TO "service_role";



GRANT ALL ON TABLE "public"."call_records" TO "anon";
GRANT ALL ON TABLE "public"."call_records" TO "authenticated";
GRANT ALL ON TABLE "public"."call_records" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."dok_tag_learnings" TO "anon";
GRANT ALL ON TABLE "public"."dok_tag_learnings" TO "authenticated";
GRANT ALL ON TABLE "public"."dok_tag_learnings" TO "service_role";



GRANT ALL ON TABLE "public"."dok_tags" TO "anon";
GRANT ALL ON TABLE "public"."dok_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."dok_tags" TO "service_role";



GRANT ALL ON TABLE "public"."dokumente" TO "anon";
GRANT ALL ON TABLE "public"."dokumente" TO "authenticated";
GRANT ALL ON TABLE "public"."dokumente" TO "service_role";



GRANT ALL ON TABLE "public"."domain_tag_rules" TO "anon";
GRANT ALL ON TABLE "public"."domain_tag_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."domain_tag_rules" TO "service_role";



GRANT ALL ON TABLE "public"."fahrzeuge" TO "anon";
GRANT ALL ON TABLE "public"."fahrzeuge" TO "authenticated";
GRANT ALL ON TABLE "public"."fahrzeuge" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_bank_imports" TO "anon";
GRANT ALL ON TABLE "public"."fibu_bank_imports" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_bank_imports" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_bank_transaktionen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_bank_transaktionen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_bank_transaktionen" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_buchung_belege" TO "anon";
GRANT ALL ON TABLE "public"."fibu_buchung_belege" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_buchung_belege" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_buchung_serien" TO "anon";
GRANT ALL ON TABLE "public"."fibu_buchung_serien" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_buchung_serien" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_buchungen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_buchungen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_buchungen" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_budget" TO "anon";
GRANT ALL ON TABLE "public"."fibu_budget" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_budget" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_jahresabschluss" TO "anon";
GRANT ALL ON TABLE "public"."fibu_jahresabschluss" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_jahresabschluss" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_konten" TO "anon";
GRANT ALL ON TABLE "public"."fibu_konten" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_konten" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_kontierungsregeln" TO "anon";
GRANT ALL ON TABLE "public"."fibu_kontierungsregeln" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_kontierungsregeln" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_kreditoren_belege" TO "anon";
GRANT ALL ON TABLE "public"."fibu_kreditoren_belege" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_kreditoren_belege" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_kreditoren_dauerbelege" TO "anon";
GRANT ALL ON TABLE "public"."fibu_kreditoren_dauerbelege" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_kreditoren_dauerbelege" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_kreditoren_positionen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_kreditoren_positionen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_kreditoren_positionen" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_kreditoren_verrechnungen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_kreditoren_verrechnungen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_kreditoren_verrechnungen" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_lieferanten" TO "anon";
GRANT ALL ON TABLE "public"."fibu_lieferanten" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_lieferanten" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_mandanten" TO "anon";
GRANT ALL ON TABLE "public"."fibu_mandanten" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_mandanten" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_mwst_codes" TO "anon";
GRANT ALL ON TABLE "public"."fibu_mwst_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_mwst_codes" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_rechnung_inbox" TO "anon";
GRANT ALL ON TABLE "public"."fibu_rechnung_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_rechnung_inbox" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_user_mandant_access" TO "anon";
GRANT ALL ON TABLE "public"."fibu_user_mandant_access" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_user_mandant_access" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_wechselkurse" TO "anon";
GRANT ALL ON TABLE "public"."fibu_wechselkurse" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_wechselkurse" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_zahlstellen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_zahlstellen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_zahlstellen" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_zahlungslaeufe" TO "anon";
GRANT ALL ON TABLE "public"."fibu_zahlungslaeufe" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_zahlungslaeufe" TO "service_role";



GRANT ALL ON TABLE "public"."fibu_zahlungslauf_positionen" TO "anon";
GRANT ALL ON TABLE "public"."fibu_zahlungslauf_positionen" TO "authenticated";
GRANT ALL ON TABLE "public"."fibu_zahlungslauf_positionen" TO "service_role";



GRANT ALL ON TABLE "public"."fristen" TO "anon";
GRANT ALL ON TABLE "public"."fristen" TO "authenticated";
GRANT ALL ON TABLE "public"."fristen" TO "service_role";



GRANT ALL ON TABLE "public"."jahresplanung" TO "anon";
GRANT ALL ON TABLE "public"."jahresplanung" TO "authenticated";
GRANT ALL ON TABLE "public"."jahresplanung" TO "service_role";



GRANT ALL ON TABLE "public"."jp_feiertage" TO "anon";
GRANT ALL ON TABLE "public"."jp_feiertage" TO "authenticated";
GRANT ALL ON TABLE "public"."jp_feiertage" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_columns" TO "anon";
GRANT ALL ON TABLE "public"."kanban_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_columns" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_base" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_base" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_base" TO "service_role";



GRANT ALL ON TABLE "public"."le_absence" TO "anon";
GRANT ALL ON TABLE "public"."le_absence" TO "authenticated";
GRANT ALL ON TABLE "public"."le_absence" TO "service_role";



GRANT ALL ON TABLE "public"."le_camt_import" TO "anon";
GRANT ALL ON TABLE "public"."le_camt_import" TO "authenticated";
GRANT ALL ON TABLE "public"."le_camt_import" TO "service_role";



GRANT ALL ON TABLE "public"."le_company_settings" TO "anon";
GRANT ALL ON TABLE "public"."le_company_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."le_company_settings" TO "service_role";



GRANT ALL ON TABLE "public"."le_customer_terms" TO "anon";
GRANT ALL ON TABLE "public"."le_customer_terms" TO "authenticated";
GRANT ALL ON TABLE "public"."le_customer_terms" TO "service_role";



GRANT ALL ON TABLE "public"."le_dunning" TO "anon";
GRANT ALL ON TABLE "public"."le_dunning" TO "authenticated";
GRANT ALL ON TABLE "public"."le_dunning" TO "service_role";



GRANT ALL ON TABLE "public"."le_employee" TO "anon";
GRANT ALL ON TABLE "public"."le_employee" TO "authenticated";
GRANT ALL ON TABLE "public"."le_employee" TO "service_role";



GRANT ALL ON TABLE "public"."le_employee_group" TO "anon";
GRANT ALL ON TABLE "public"."le_employee_group" TO "authenticated";
GRANT ALL ON TABLE "public"."le_employee_group" TO "service_role";



GRANT ALL ON TABLE "public"."le_expense" TO "anon";
GRANT ALL ON TABLE "public"."le_expense" TO "authenticated";
GRANT ALL ON TABLE "public"."le_expense" TO "service_role";



GRANT ALL ON TABLE "public"."le_holiday" TO "anon";
GRANT ALL ON TABLE "public"."le_holiday" TO "authenticated";
GRANT ALL ON TABLE "public"."le_holiday" TO "service_role";



GRANT ALL ON TABLE "public"."le_invoice" TO "anon";
GRANT ALL ON TABLE "public"."le_invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."le_invoice" TO "service_role";



GRANT ALL ON TABLE "public"."le_invoice_akonto_link" TO "anon";
GRANT ALL ON TABLE "public"."le_invoice_akonto_link" TO "authenticated";
GRANT ALL ON TABLE "public"."le_invoice_akonto_link" TO "service_role";



GRANT ALL ON TABLE "public"."le_invoice_line" TO "anon";
GRANT ALL ON TABLE "public"."le_invoice_line" TO "authenticated";
GRANT ALL ON TABLE "public"."le_invoice_line" TO "service_role";



GRANT ALL ON TABLE "public"."le_number_sequence" TO "anon";
GRANT ALL ON TABLE "public"."le_number_sequence" TO "authenticated";
GRANT ALL ON TABLE "public"."le_number_sequence" TO "service_role";



GRANT ALL ON TABLE "public"."le_payment" TO "anon";
GRANT ALL ON TABLE "public"."le_payment" TO "authenticated";
GRANT ALL ON TABLE "public"."le_payment" TO "service_role";



GRANT ALL ON TABLE "public"."le_project" TO "anon";
GRANT ALL ON TABLE "public"."le_project" TO "authenticated";
GRANT ALL ON TABLE "public"."le_project" TO "service_role";



GRANT ALL ON TABLE "public"."le_project_template" TO "anon";
GRANT ALL ON TABLE "public"."le_project_template" TO "authenticated";
GRANT ALL ON TABLE "public"."le_project_template" TO "service_role";



GRANT ALL ON TABLE "public"."le_rate_group" TO "anon";
GRANT ALL ON TABLE "public"."le_rate_group" TO "authenticated";
GRANT ALL ON TABLE "public"."le_rate_group" TO "service_role";



GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "anon";
GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "service_role";



GRANT ALL ON TABLE "public"."le_recurring_invoice" TO "anon";
GRANT ALL ON TABLE "public"."le_recurring_invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."le_recurring_invoice" TO "service_role";



GRANT ALL ON TABLE "public"."le_service_rate_history" TO "anon";
GRANT ALL ON TABLE "public"."le_service_rate_history" TO "authenticated";
GRANT ALL ON TABLE "public"."le_service_rate_history" TO "service_role";



GRANT ALL ON TABLE "public"."le_service_type" TO "anon";
GRANT ALL ON TABLE "public"."le_service_type" TO "authenticated";
GRANT ALL ON TABLE "public"."le_service_type" TO "service_role";



GRANT ALL ON TABLE "public"."le_sollzeit_profile" TO "anon";
GRANT ALL ON TABLE "public"."le_sollzeit_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."le_sollzeit_profile" TO "service_role";



GRANT ALL ON TABLE "public"."le_time_entry" TO "anon";
GRANT ALL ON TABLE "public"."le_time_entry" TO "authenticated";
GRANT ALL ON TABLE "public"."le_time_entry" TO "service_role";



GRANT ALL ON TABLE "public"."le_vat_rate" TO "anon";
GRANT ALL ON TABLE "public"."le_vat_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."le_vat_rate" TO "service_role";



GRANT ALL ON TABLE "public"."mail_items" TO "anon";
GRANT ALL ON TABLE "public"."mail_items" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_items" TO "service_role";



GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "anon";
GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."mp_entries" TO "anon";
GRANT ALL ON TABLE "public"."mp_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_entries" TO "service_role";



GRANT ALL ON TABLE "public"."mp_plans" TO "anon";
GRANT ALL ON TABLE "public"."mp_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_plans" TO "service_role";



GRANT ALL ON TABLE "public"."priorities" TO "anon";
GRANT ALL ON TABLE "public"."priorities" TO "authenticated";
GRANT ALL ON TABLE "public"."priorities" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."prompt_vorlagen" TO "anon";
GRANT ALL ON TABLE "public"."prompt_vorlagen" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_vorlagen" TO "service_role";



GRANT ALL ON TABLE "public"."share_links" TO "anon";
GRANT ALL ON TABLE "public"."share_links" TO "authenticated";
GRANT ALL ON TABLE "public"."share_links" TO "service_role";



GRANT ALL ON TABLE "public"."signaturen" TO "anon";
GRANT ALL ON TABLE "public"."signaturen" TO "authenticated";
GRANT ALL ON TABLE "public"."signaturen" TO "service_role";



GRANT ALL ON TABLE "public"."steuerdaten" TO "anon";
GRANT ALL ON TABLE "public"."steuerdaten" TO "authenticated";
GRANT ALL ON TABLE "public"."steuerdaten" TO "service_role";



GRANT ALL ON TABLE "public"."support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."task_columns" TO "anon";
GRANT ALL ON TABLE "public"."task_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."task_columns" TO "service_role";



GRANT ALL ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT ALL ON TABLE "public"."task_read_statuses" TO "anon";
GRANT ALL ON TABLE "public"."task_read_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."task_read_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."tax_allocation_invoice" TO "anon";
GRANT ALL ON TABLE "public"."tax_allocation_invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_allocation_invoice" TO "service_role";



GRANT ALL ON TABLE "public"."tax_allocation_period" TO "anon";
GRANT ALL ON TABLE "public"."tax_allocation_period" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_allocation_period" TO "service_role";



GRANT ALL ON TABLE "public"."tax_allocation_unit" TO "anon";
GRANT ALL ON TABLE "public"."tax_allocation_unit" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_allocation_unit" TO "service_role";



GRANT ALL ON TABLE "public"."tax_steuerfuss" TO "anon";
GRANT ALL ON TABLE "public"."tax_steuerfuss" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_steuerfuss" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_columns" TO "anon";
GRANT ALL ON TABLE "public"."ticket_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_columns" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_messages" TO "anon";
GRANT ALL ON TABLE "public"."ticket_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_messages" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."whiteboards" TO "anon";
GRANT ALL ON TABLE "public"."whiteboards" TO "authenticated";
GRANT ALL ON TABLE "public"."whiteboards" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



/* auth function*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
INSERT INTO public.profiles (id, email)
VALUES (new.id, new.email);
RETURN NEW;
END;
$$;

-- 2. Bind the function to the auth.users table via a trigger
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

/* cron jobs*/

DO $$ BEGIN PERFORM cron.schedule('auto-sync-all', '*/5 * * * *', 'select net.http_post(url:=''https://api.artis.sm-artis.ch/functions/v1/auto-sync-all'',headers:=jsonb_build_object(''Content-Type'',''application/json'',''X-Cron-Secret'',''IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU''),body:=''{}''::jsonb,timeout_milliseconds:=55000);'); PERFORM cron.schedule('outlook-auto-sync', '* * * * *', 'select
  net.http_post(
      url:=''https://api.artis.sm-artis.ch/functions/v1/sync-outlook-mails'',
      headers:=jsonb_build_object(''X-Cron-Secret'', ''IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU''),
      timeout_milliseconds:=1000
  );'); PERFORM cron.schedule('sync-teams-calls-daily', '0 6 * * *', '
  select net.http_post(
    url     := ''https://api.artis.sm-artis.ch/functions/v1/sync-teams-calls'',
    headers := jsonb_build_object(
      ''Content-Type'',    ''application/json'',
      ''X-Cron-Secret'',   (select decrypted_secret from vault.decrypted_secrets where name = ''CRON_SECRET'' limit 1)
    ),
    body := ''{}''::jsonb
  );
  '); PERFORM cron.schedule('sync-teams-calls-auto', '0 * * * *', 'SELECT net.http_post(
           url        := ''https://api.artis.sm-artis.ch/functions/v1/sync-teams-calls'',
           headers    := ''{"Authorization": "Bearer sb_publishable_s2gEt0LIpVZNLOuxTVByVg_qs6ZDxZi"}''::jsonb,
           body       := ''{}''::jsonb
         );'); PERFORM cron.schedule('fibu-wechselkurse-taeglich', '0 13 * * *', '
      SELECT net.http_post(
        url     := ''https://api.artis.sm-artis.ch/functions/v1/fibu-wechselkurse-import'',
        headers := jsonb_build_object(''Content-Type'', ''application/json''),
        body    := jsonb_build_object(''typ'', ''beide'')
      );
    '); END $$;


/*Create Buckets*/
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('note-attachments', 'note-attachments', NULL, false, NULL, NULL, '2026-03-10 07:34:11.037868+00', '2026-03-10 07:34:11.037868+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('dokumente', 'dokumente', NULL, false, NULL, NULL, '2026-03-12 21:07:05.182859+00', '2026-03-12 21:07:05.182859+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('team-ablage', 'team-ablage', NULL, false, '104857600', NULL, '2026-03-27 07:27:23.16366+00', '2026-03-27 07:27:23.16366+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('downloads', 'downloads', NULL, true, NULL, NULL, '2026-03-28 11:55:04.975078+00', '2026-03-28 11:55:04.975078+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('posteingang', 'posteingang', NULL, false, NULL, NULL, '2026-04-01 18:36:54.909065+00', '2026-04-01 18:36:54.909065+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('task-attachments', 'task-attachments', NULL, false, NULL, NULL, '2026-04-13 16:37:09.067016+00', '2026-04-13 16:37:09.067016+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('invoices', 'invoices', NULL, true, '5242880', ARRAY['application/pdf'], '2026-04-28 12:35:50.4566+00', '2026-04-28 12:35:50.4566+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('expenses', 'expenses', NULL, false, '10485760', ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'], '2026-04-28 12:35:50.4566+00', '2026-04-28 12:35:50.4566+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('fibu-inbox', 'fibu-inbox', NULL, false, '10485760', ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], '2026-05-03 14:32:40.387119+00', '2026-05-03 14:32:40.387119+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types, created_at, updated_at, owner_id) VALUES ('fibu-belege', 'fibu-belege', NULL, false, '10485760', ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], '2026-05-16 13:52:04.701833+00', '2026-05-16 13:52:04.701833+00', NULL) ON CONFLICT (id) DO NOTHING;




























