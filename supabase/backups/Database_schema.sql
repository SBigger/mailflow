


SET statement_timeout = 0;
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



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






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


CREATE TYPE "public"."le_invoice_status" AS ENUM (
    'entwurf',
    'definitiv',
    'versendet',
    'bezahlt',
    'storniert'
);


ALTER TYPE "public"."le_invoice_status" OWNER TO "postgres";


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


CREATE TYPE "public"."le_time_entry_status" AS ENUM (
    'erfasst',
    'freigegeben',
    'verrechnet',
    'storniert'
);


ALTER TYPE "public"."le_time_entry_status" OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."le_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."le_is_admin"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."le_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."le_set_updated_at"() OWNER TO "postgres";


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
    AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_auto_index_document"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.storage_path IS NOT NULL AND (NEW.content_text IS NULL OR NEW.content_text = '') THEN
    PERFORM net.http_post(
      url     := 'https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/index-document',
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    "anrede" "text" DEFAULT ''::"text"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_employee" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_invoice" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_invoice_line" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "service_type_id" "uuid",
    "description" "text" NOT NULL,
    "hours" numeric(10,2) DEFAULT 0 NOT NULL,
    "rate" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_invoice_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."le_project" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_no" "text" NOT NULL,
    "name" "text" NOT NULL,
    "customer_id" "uuid",
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_project" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."le_service_type" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."brief_vorlagen"
    ADD CONSTRAINT "brief_vorlagen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."fristen"
    ADD CONSTRAINT "fristen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_project_no_key" UNIQUE ("project_no");



ALTER TABLE ONLY "public"."le_rate_group"
    ADD CONSTRAINT "le_rate_group_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."le_rate_group"
    ADD CONSTRAINT "le_rate_group_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_rate_group_id_service_type_id_valid_from_key" UNIQUE ("rate_group_id", "service_type_id", "valid_from");



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_service_type_id_valid_from_key" UNIQUE ("service_type_id", "valid_from");



ALTER TABLE ONLY "public"."le_service_type"
    ADD CONSTRAINT "le_service_type_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."le_service_type"
    ADD CONSTRAINT "le_service_type_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."le_time_entry"
    ADD CONSTRAINT "le_time_entry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_outlook_id_created_by_key" UNIQUE ("outlook_id", "created_by");



ALTER TABLE ONLY "public"."mail_items"
    ADD CONSTRAINT "mail_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_outlook_id_created_by_key" UNIQUE ("outlook_id", "created_by");



ALTER TABLE ONLY "public"."mail_kanban_mappings"
    ADD CONSTRAINT "mail_kanban_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."priorities"
    ADD CONSTRAINT "priorities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."ticket_columns"
    ADD CONSTRAINT "ticket_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."whiteboards"
    ADD CONSTRAINT "whiteboards_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "idx_kb_active" ON "public"."knowledge_base" USING "btree" ("is_active");



CREATE INDEX "idx_kb_category" ON "public"."knowledge_base" USING "btree" ("category");



CREATE INDEX "idx_le_invoice_customer" ON "public"."le_invoice" USING "btree" ("customer_id");



CREATE INDEX "idx_le_invoice_line_invoice" ON "public"."le_invoice_line" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_invoice_project" ON "public"."le_invoice" USING "btree" ("project_id");



CREATE INDEX "idx_le_invoice_status" ON "public"."le_invoice" USING "btree" ("status");



CREATE INDEX "idx_le_project_customer" ON "public"."le_project" USING "btree" ("customer_id");



CREATE INDEX "idx_le_project_status" ON "public"."le_project" USING "btree" ("status");



CREATE INDEX "idx_le_time_entry_date" ON "public"."le_time_entry" USING "btree" ("entry_date");



CREATE INDEX "idx_le_time_entry_employee" ON "public"."le_time_entry" USING "btree" ("employee_id");



CREATE INDEX "idx_le_time_entry_invoice" ON "public"."le_time_entry" USING "btree" ("invoice_id");



CREATE INDEX "idx_le_time_entry_project" ON "public"."le_time_entry" USING "btree" ("project_id");



CREATE INDEX "idx_le_time_entry_status" ON "public"."le_time_entry" USING "btree" ("status");



CREATE INDEX "idx_mail_items_column_id" ON "public"."mail_items" USING "btree" ("column_id");



CREATE INDEX "idx_mail_items_created_by" ON "public"."mail_items" USING "btree" ("created_by");



CREATE INDEX "idx_mail_items_internet_message_id" ON "public"."mail_items" USING "btree" ("internet_message_id");



CREATE INDEX "idx_mail_items_outlook_id" ON "public"."mail_items" USING "btree" ("outlook_id");



CREATE INDEX "idx_mail_items_received_date" ON "public"."mail_items" USING "btree" ("received_date" DESC);



CREATE INDEX "idx_signaturen_created_by" ON "public"."signaturen" USING "btree" ("created_by");



CREATE INDEX "idx_signaturen_customer_id" ON "public"."signaturen" USING "btree" ("customer_id");



CREATE INDEX "idx_signaturen_status" ON "public"."signaturen" USING "btree" ("skribble_status");



CREATE INDEX "idx_steuerdaten_customer" ON "public"."steuerdaten" USING "btree" ("customer_id");



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_created_by" ON "public"."tasks" USING "btree" ("created_by");



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



CREATE OR REPLACE TRIGGER "dokumente_updated_at" BEFORE UPDATE ON "public"."dokumente" FOR EACH ROW EXECUTE FUNCTION "public"."update_dokumente_updated_at"();



CREATE OR REPLACE TRIGGER "fahrzeuge_updated_at" BEFORE UPDATE ON "public"."fahrzeuge" FOR EACH ROW EXECUTE FUNCTION "public"."update_fahrzeuge_updated_at"();



CREATE OR REPLACE TRIGGER "fristen_updated_at" BEFORE UPDATE ON "public"."fristen" FOR EACH ROW EXECUTE FUNCTION "public"."update_fristen_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."kanban_columns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."mail_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "support_tickets_updated_at" BEFORE UPDATE ON "public"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."update_support_tickets_updated_at"();



CREATE OR REPLACE TRIGGER "trg_abschluss_updated_at" BEFORE UPDATE ON "public"."abschluss" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_dokumente_search" BEFORE INSERT OR UPDATE ON "public"."dokumente" FOR EACH ROW EXECUTE FUNCTION "public"."dokumente_update_search_vector"();



CREATE OR REPLACE TRIGGER "trg_fahrzeuge_updated_at" BEFORE UPDATE ON "public"."fahrzeuge" FOR EACH ROW EXECUTE FUNCTION "public"."update_fahrzeuge_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kb_updated_at" BEFORE UPDATE ON "public"."knowledge_base" FOR EACH ROW EXECUTE FUNCTION "public"."update_kb_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_employee_updated" BEFORE UPDATE ON "public"."le_employee" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_invoice_updated" BEFORE UPDATE ON "public"."le_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_project_updated" BEFORE UPDATE ON "public"."le_project" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_rate_group_updated" BEFORE UPDATE ON "public"."le_rate_group" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_service_type_updated" BEFORE UPDATE ON "public"."le_service_type" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_le_time_entry_updated" BEFORE UPDATE ON "public"."le_time_entry" FOR EACH ROW EXECUTE FUNCTION "public"."le_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_steuerdaten_updated_at" BEFORE UPDATE ON "public"."steuerdaten" FOR EACH ROW EXECUTE FUNCTION "public"."update_steuerdaten_updated_at"();



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



ALTER TABLE ONLY "public"."brief_vorlagen"
    ADD CONSTRAINT "brief_vorlagen_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_hauptdomizil_id_fkey" FOREIGN KEY ("hauptdomizil_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."fristen"
    ADD CONSTRAINT "fristen_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_employee"
    ADD CONSTRAINT "le_employee_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."le_invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_invoice_line"
    ADD CONSTRAINT "le_invoice_line_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_invoice"
    ADD CONSTRAINT "le_invoice_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."le_project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_project"
    ADD CONSTRAINT "le_project_responsible_employee_id_fkey" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."le_employee"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_rate_group_id_fkey" FOREIGN KEY ("rate_group_id") REFERENCES "public"."le_rate_group"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."le_rate_group_rate"
    ADD CONSTRAINT "le_rate_group_rate_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."le_service_rate_history"
    ADD CONSTRAINT "le_service_rate_history_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."le_service_type"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."priorities"
    ADD CONSTRAINT "priorities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



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



CREATE POLICY "auth_insert_own" ON "public"."agent_tokens" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "auth_select_own" ON "public"."agent_tokens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "authenticated_access" ON "public"."task_read_statuses" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_activity_templates" ON "public"."activity_templates" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_customers" ON "public"."customers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_priorities" ON "public"."priorities" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_task_columns" ON "public"."task_columns" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."brief_vorlagen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brief_vorlagen_authenticated" ON "public"."brief_vorlagen" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."fristen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fristen_admin_all" ON "public"."fristen" USING ("public"."is_admin_user"());



CREATE POLICY "fristen_user_access" ON "public"."fristen" USING (((("auth"."uid"())::"text" = ("created_by")::"text") OR ("assignee" = "auth"."email"()) OR ("created_by" IS NULL))) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."kanban_columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kb_auth" ON "public"."knowledge_base" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_employee" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_employee_read" ON "public"."le_employee" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_employee_write" ON "public"."le_employee" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_invoice" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_invoice_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_invoice_line_read" ON "public"."le_invoice_line" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_invoice_line_write" ON "public"."le_invoice_line" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "le_invoice_read" ON "public"."le_invoice" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_invoice_write" ON "public"."le_invoice" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."le_project" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_project_read" ON "public"."le_project" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_project_write" ON "public"."le_project" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_rate_group" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."le_rate_group_rate" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_rate_group_rate_read" ON "public"."le_rate_group_rate" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_rate_group_rate_write" ON "public"."le_rate_group_rate" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



CREATE POLICY "le_rate_group_read" ON "public"."le_rate_group" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_rate_group_write" ON "public"."le_rate_group" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_service_rate_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_service_rate_history_read" ON "public"."le_service_rate_history" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_service_rate_history_write" ON "public"."le_service_rate_history" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_service_type" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_service_type_read" ON "public"."le_service_type" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_service_type_write" ON "public"."le_service_type" TO "authenticated" USING ("public"."le_is_admin"()) WITH CHECK ("public"."le_is_admin"());



ALTER TABLE "public"."le_time_entry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "le_time_entry_delete_admin" ON "public"."le_time_entry" FOR DELETE TO "authenticated" USING ("public"."le_is_admin"());



CREATE POLICY "le_time_entry_insert_own" ON "public"."le_time_entry" FOR INSERT TO "authenticated" WITH CHECK (("public"."le_is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."le_employee" "e"
  WHERE (("e"."id" = "le_time_entry"."employee_id") AND ("e"."profile_id" = "auth"."uid"()))))));



CREATE POLICY "le_time_entry_read" ON "public"."le_time_entry" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "le_time_entry_update_own" ON "public"."le_time_entry" FOR UPDATE TO "authenticated" USING (("public"."le_is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."le_employee" "e"
  WHERE (("e"."id" = "le_time_entry"."employee_id") AND ("e"."profile_id" = "auth"."uid"()))))));



ALTER TABLE "public"."mail_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mail_kanban_mappings" ENABLE ROW LEVEL SECURITY;


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














































































































































































GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dokumente_build_search_vector"("p_name" "text", "p_filename" "text", "p_notes" "text", "p_category" "text", "p_year" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "anon";
GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dokumente_update_search_vector"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_next_invoice_no"() TO "service_role";



GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."le_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_dokumente"("p_query" "text", "p_customer_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



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



GRANT ALL ON TABLE "public"."brief_vorlagen" TO "anon";
GRANT ALL ON TABLE "public"."brief_vorlagen" TO "authenticated";
GRANT ALL ON TABLE "public"."brief_vorlagen" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



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



GRANT ALL ON TABLE "public"."fristen" TO "anon";
GRANT ALL ON TABLE "public"."fristen" TO "authenticated";
GRANT ALL ON TABLE "public"."fristen" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_columns" TO "anon";
GRANT ALL ON TABLE "public"."kanban_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_columns" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_base" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_base" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_base" TO "service_role";



GRANT ALL ON TABLE "public"."le_employee" TO "anon";
GRANT ALL ON TABLE "public"."le_employee" TO "authenticated";
GRANT ALL ON TABLE "public"."le_employee" TO "service_role";



GRANT ALL ON TABLE "public"."le_invoice" TO "anon";
GRANT ALL ON TABLE "public"."le_invoice" TO "authenticated";
GRANT ALL ON TABLE "public"."le_invoice" TO "service_role";



GRANT ALL ON TABLE "public"."le_invoice_line" TO "anon";
GRANT ALL ON TABLE "public"."le_invoice_line" TO "authenticated";
GRANT ALL ON TABLE "public"."le_invoice_line" TO "service_role";



GRANT ALL ON TABLE "public"."le_project" TO "anon";
GRANT ALL ON TABLE "public"."le_project" TO "authenticated";
GRANT ALL ON TABLE "public"."le_project" TO "service_role";



GRANT ALL ON TABLE "public"."le_rate_group" TO "anon";
GRANT ALL ON TABLE "public"."le_rate_group" TO "authenticated";
GRANT ALL ON TABLE "public"."le_rate_group" TO "service_role";



GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "anon";
GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."le_rate_group_rate" TO "service_role";



GRANT ALL ON TABLE "public"."le_service_rate_history" TO "anon";
GRANT ALL ON TABLE "public"."le_service_rate_history" TO "authenticated";
GRANT ALL ON TABLE "public"."le_service_rate_history" TO "service_role";



GRANT ALL ON TABLE "public"."le_service_type" TO "anon";
GRANT ALL ON TABLE "public"."le_service_type" TO "authenticated";
GRANT ALL ON TABLE "public"."le_service_type" TO "service_role";



GRANT ALL ON TABLE "public"."le_time_entry" TO "anon";
GRANT ALL ON TABLE "public"."le_time_entry" TO "authenticated";
GRANT ALL ON TABLE "public"."le_time_entry" TO "service_role";



GRANT ALL ON TABLE "public"."mail_items" TO "anon";
GRANT ALL ON TABLE "public"."mail_items" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_items" TO "service_role";



GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "anon";
GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_kanban_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."priorities" TO "anon";
GRANT ALL ON TABLE "public"."priorities" TO "authenticated";
GRANT ALL ON TABLE "public"."priorities" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



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



































