


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
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


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



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signaturen"
    ADD CONSTRAINT "signaturen_skribble_request_id_key" UNIQUE ("skribble_request_id");



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



CREATE INDEX "idx_mail_items_column_id" ON "public"."mail_items" USING "btree" ("column_id");



CREATE INDEX "idx_mail_items_created_by" ON "public"."mail_items" USING "btree" ("created_by");



CREATE INDEX "idx_mail_items_outlook_id" ON "public"."mail_items" USING "btree" ("outlook_id");



CREATE INDEX "idx_mail_items_received_date" ON "public"."mail_items" USING "btree" ("received_date" DESC);



CREATE INDEX "idx_signaturen_created_by" ON "public"."signaturen" USING "btree" ("created_by");



CREATE INDEX "idx_signaturen_customer_id" ON "public"."signaturen" USING "btree" ("customer_id");



CREATE INDEX "idx_signaturen_status" ON "public"."signaturen" USING "btree" ("skribble_status");



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_created_by" ON "public"."tasks" USING "btree" ("created_by");



CREATE INDEX "support_tickets_column_id_idx" ON "public"."support_tickets" USING "btree" ("column_id");



CREATE INDEX "support_tickets_created_at_idx" ON "public"."support_tickets" USING "btree" ("created_at");



CREATE INDEX "support_tickets_customer_id_idx" ON "public"."support_tickets" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "support_tickets_outlook_message_id_idx" ON "public"."support_tickets" USING "btree" ("outlook_message_id") WHERE ("outlook_message_id" IS NOT NULL);



CREATE INDEX "tasks_customer_id_idx" ON "public"."tasks" USING "btree" ("customer_id");



CREATE INDEX "tasks_verantwortlich_idx" ON "public"."tasks" USING "btree" ("verantwortlich");



CREATE INDEX "ticket_messages_created_at_idx" ON "public"."ticket_messages" USING "btree" ("created_at");



CREATE INDEX "ticket_messages_ticket_id_idx" ON "public"."ticket_messages" USING "btree" ("ticket_id");



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



CREATE POLICY "Admins can manage dok_tags" ON "public"."dok_tags" TO "authenticated" USING (true);



CREATE POLICY "Admins can update any profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."id" = "auth"."uid"()) AND ("profiles_1"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."id" = "auth"."uid"()) AND ("profiles_1"."role" = 'admin'::"text")))));



CREATE POLICY "Authenticated users can manage fahrzeuge" ON "public"."fahrzeuge" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can manage signaturen" ON "public"."signaturen" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can read dok_tags" ON "public"."dok_tags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can manage their own preferences" ON "public"."user_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own kanban_columns" ON "public"."kanban_columns" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own mail_items" ON "public"."mail_items" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own mail_kanban_mappings" ON "public"."mail_kanban_mappings" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users see own tags" ON "public"."tags" USING (("auth"."uid"() = "created_by"));



ALTER TABLE "public"."abschluss" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "abschluss_auth" ON "public"."abschluss" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."abschluss_konten" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "abschluss_konten_auth" ON "public"."abschluss_konten" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."activity_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aktienbuch" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aktienbuch_auth" ON "public"."aktienbuch" TO "authenticated" USING (true) WITH CHECK (true);



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


ALTER TABLE "public"."signaturen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signaturen_auth" ON "public"."signaturen" TO "authenticated" USING (true) WITH CHECK (true);



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


ALTER TABLE "public"."task_read_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_rls" ON "public"."tasks" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."ticket_columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ticket_columns_all_auth" ON "public"."ticket_columns" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."ticket_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ticket_messages_all_auth" ON "public"."ticket_messages" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";












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



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_support_tickets_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";
























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



GRANT ALL ON TABLE "public"."signaturen" TO "anon";
GRANT ALL ON TABLE "public"."signaturen" TO "authenticated";
GRANT ALL ON TABLE "public"."signaturen" TO "service_role";



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



































drop trigger if exists "trg_abschluss_updated_at" on "public"."abschluss";

drop trigger if exists "brief_vorlagen_updated_at" on "public"."brief_vorlagen";

drop trigger if exists "set_updated_at" on "public"."customers";

drop trigger if exists "dokumente_updated_at" on "public"."dokumente";

drop trigger if exists "trg_dokumente_search" on "public"."dokumente";

drop trigger if exists "fahrzeuge_updated_at" on "public"."fahrzeuge";

drop trigger if exists "trg_fahrzeuge_updated_at" on "public"."fahrzeuge";

drop trigger if exists "fristen_updated_at" on "public"."fristen";

drop trigger if exists "set_updated_at" on "public"."kanban_columns";

drop trigger if exists "trg_kb_updated_at" on "public"."knowledge_base";

drop trigger if exists "set_updated_at" on "public"."mail_items";

drop trigger if exists "set_updated_at" on "public"."profiles";

drop trigger if exists "support_tickets_updated_at" on "public"."support_tickets";

drop trigger if exists "set_updated_at" on "public"."tasks";

drop policy "fristen_admin_all" on "public"."fristen";

drop policy "Admins can update any profile" on "public"."profiles";

drop policy "profiles_admin_read_all" on "public"."profiles";

drop policy "system_settings_admin_all" on "public"."system_settings";

alter table "public"."abschluss" drop constraint "abschluss_customer_id_fkey";

alter table "public"."abschluss_konten" drop constraint "abschluss_konten_abschluss_id_fkey";

alter table "public"."agent_tokens" drop constraint "agent_tokens_doc_id_fkey";

alter table "public"."aktienbuch" drop constraint "aktienbuch_customer_id_fkey";

alter table "public"."aktienbuch" drop constraint "aktienbuch_vorgaenger_id_fkey";

alter table "public"."customers" drop constraint "customers_created_by_fkey";

alter table "public"."customers" drop constraint "customers_hauptdomizil_id_fkey";

alter table "public"."dok_tags" drop constraint "dok_tags_parent_id_fkey";

alter table "public"."dokumente" drop constraint "dokumente_customer_id_fkey";

alter table "public"."domain_tag_rules" drop constraint "domain_tag_rules_created_by_fkey";

alter table "public"."fahrzeuge" drop constraint "fahrzeuge_customer_id_fkey";

alter table "public"."fahrzeuge" drop constraint "fahrzeuge_leasing_dokument_id_fkey";

alter table "public"."fristen" drop constraint "fristen_customer_id_fkey";

alter table "public"."kanban_columns" drop constraint "kanban_columns_created_by_fkey";

alter table "public"."mail_items" drop constraint "mail_items_column_id_fkey";

alter table "public"."mail_items" drop constraint "mail_items_created_by_fkey";

alter table "public"."mail_items" drop constraint "mail_items_customer_id_fkey";

alter table "public"."mail_kanban_mappings" drop constraint "mail_kanban_mappings_column_id_fkey";

alter table "public"."mail_kanban_mappings" drop constraint "mail_kanban_mappings_created_by_fkey";

alter table "public"."priorities" drop constraint "priorities_created_by_fkey";

alter table "public"."projects" drop constraint "projects_created_by_fkey";

alter table "public"."signaturen" drop constraint "signaturen_customer_id_fkey";

alter table "public"."signaturen" drop constraint "signaturen_dokument_id_fkey";

alter table "public"."signaturen" drop constraint "signaturen_signed_dokument_id_fkey";

alter table "public"."support_tickets" drop constraint "support_tickets_column_id_fkey";

alter table "public"."support_tickets" drop constraint "support_tickets_customer_id_fkey";

alter table "public"."tags" drop constraint "tags_created_by_fkey";

alter table "public"."task_columns" drop constraint "task_columns_created_by_fkey";

alter table "public"."task_read_statuses" drop constraint "task_read_statuses_task_id_fkey";

alter table "public"."tasks" drop constraint "tasks_assigned_to_fkey";

alter table "public"."tasks" drop constraint "tasks_column_id_fkey";

alter table "public"."tasks" drop constraint "tasks_created_by_fkey";

alter table "public"."tasks" drop constraint "tasks_mail_id_fkey";

alter table "public"."ticket_messages" drop constraint "ticket_messages_ticket_id_fkey";

alter table "public"."abschluss" alter column "status" set default 'in_arbeit'::public.abschluss_status;

alter table "public"."abschluss" alter column "status" set data type public.abschluss_status using "status"::text::public.abschluss_status;

alter table "public"."customers" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."domain_tag_rules" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."kanban_columns" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."mail_items" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."mail_kanban_mappings" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."priorities" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."projects" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."tags" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."task_columns" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."tasks" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."abschluss" add constraint "abschluss_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE not valid;

alter table "public"."abschluss" validate constraint "abschluss_customer_id_fkey";

alter table "public"."abschluss_konten" add constraint "abschluss_konten_abschluss_id_fkey" FOREIGN KEY (abschluss_id) REFERENCES public.abschluss(id) ON DELETE CASCADE not valid;

alter table "public"."abschluss_konten" validate constraint "abschluss_konten_abschluss_id_fkey";

alter table "public"."agent_tokens" add constraint "agent_tokens_doc_id_fkey" FOREIGN KEY (doc_id) REFERENCES public.dokumente(id) ON DELETE CASCADE not valid;

alter table "public"."agent_tokens" validate constraint "agent_tokens_doc_id_fkey";

alter table "public"."aktienbuch" add constraint "aktienbuch_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE not valid;

alter table "public"."aktienbuch" validate constraint "aktienbuch_customer_id_fkey";

alter table "public"."aktienbuch" add constraint "aktienbuch_vorgaenger_id_fkey" FOREIGN KEY (vorgaenger_id) REFERENCES public.aktienbuch(id) not valid;

alter table "public"."aktienbuch" validate constraint "aktienbuch_vorgaenger_id_fkey";

alter table "public"."customers" add constraint "customers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."customers" validate constraint "customers_created_by_fkey";

alter table "public"."customers" add constraint "customers_hauptdomizil_id_fkey" FOREIGN KEY (hauptdomizil_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."customers" validate constraint "customers_hauptdomizil_id_fkey";

alter table "public"."dok_tags" add constraint "dok_tags_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.dok_tags(id) ON DELETE CASCADE not valid;

alter table "public"."dok_tags" validate constraint "dok_tags_parent_id_fkey";

alter table "public"."dokumente" add constraint "dokumente_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE not valid;

alter table "public"."dokumente" validate constraint "dokumente_customer_id_fkey";

alter table "public"."domain_tag_rules" add constraint "domain_tag_rules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."domain_tag_rules" validate constraint "domain_tag_rules_created_by_fkey";

alter table "public"."fahrzeuge" add constraint "fahrzeuge_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE not valid;

alter table "public"."fahrzeuge" validate constraint "fahrzeuge_customer_id_fkey";

alter table "public"."fahrzeuge" add constraint "fahrzeuge_leasing_dokument_id_fkey" FOREIGN KEY (leasing_dokument_id) REFERENCES public.dokumente(id) ON DELETE SET NULL not valid;

alter table "public"."fahrzeuge" validate constraint "fahrzeuge_leasing_dokument_id_fkey";

alter table "public"."fristen" add constraint "fristen_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."fristen" validate constraint "fristen_customer_id_fkey";

alter table "public"."kanban_columns" add constraint "kanban_columns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."kanban_columns" validate constraint "kanban_columns_created_by_fkey";

alter table "public"."mail_items" add constraint "mail_items_column_id_fkey" FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE SET NULL not valid;

alter table "public"."mail_items" validate constraint "mail_items_column_id_fkey";

alter table "public"."mail_items" add constraint "mail_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."mail_items" validate constraint "mail_items_created_by_fkey";

alter table "public"."mail_items" add constraint "mail_items_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."mail_items" validate constraint "mail_items_customer_id_fkey";

alter table "public"."mail_kanban_mappings" add constraint "mail_kanban_mappings_column_id_fkey" FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE SET NULL not valid;

alter table "public"."mail_kanban_mappings" validate constraint "mail_kanban_mappings_column_id_fkey";

alter table "public"."mail_kanban_mappings" add constraint "mail_kanban_mappings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."mail_kanban_mappings" validate constraint "mail_kanban_mappings_created_by_fkey";

alter table "public"."priorities" add constraint "priorities_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."priorities" validate constraint "priorities_created_by_fkey";

alter table "public"."projects" add constraint "projects_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."projects" validate constraint "projects_created_by_fkey";

alter table "public"."signaturen" add constraint "signaturen_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."signaturen" validate constraint "signaturen_customer_id_fkey";

alter table "public"."signaturen" add constraint "signaturen_dokument_id_fkey" FOREIGN KEY (dokument_id) REFERENCES public.dokumente(id) ON DELETE SET NULL not valid;

alter table "public"."signaturen" validate constraint "signaturen_dokument_id_fkey";

alter table "public"."signaturen" add constraint "signaturen_signed_dokument_id_fkey" FOREIGN KEY (signed_dokument_id) REFERENCES public.dokumente(id) ON DELETE SET NULL not valid;

alter table "public"."signaturen" validate constraint "signaturen_signed_dokument_id_fkey";

alter table "public"."support_tickets" add constraint "support_tickets_column_id_fkey" FOREIGN KEY (column_id) REFERENCES public.ticket_columns(id) ON DELETE SET NULL not valid;

alter table "public"."support_tickets" validate constraint "support_tickets_column_id_fkey";

alter table "public"."support_tickets" add constraint "support_tickets_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."support_tickets" validate constraint "support_tickets_customer_id_fkey";

alter table "public"."tags" add constraint "tags_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."tags" validate constraint "tags_created_by_fkey";

alter table "public"."task_columns" add constraint "task_columns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."task_columns" validate constraint "task_columns_created_by_fkey";

alter table "public"."task_read_statuses" add constraint "task_read_statuses_task_id_fkey" FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE not valid;

alter table "public"."task_read_statuses" validate constraint "task_read_statuses_task_id_fkey";

alter table "public"."tasks" add constraint "tasks_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."tasks" validate constraint "tasks_assigned_to_fkey";

alter table "public"."tasks" add constraint "tasks_column_id_fkey" FOREIGN KEY (column_id) REFERENCES public.task_columns(id) ON DELETE SET NULL not valid;

alter table "public"."tasks" validate constraint "tasks_column_id_fkey";

alter table "public"."tasks" add constraint "tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."tasks" validate constraint "tasks_created_by_fkey";

alter table "public"."tasks" add constraint "tasks_mail_id_fkey" FOREIGN KEY (mail_id) REFERENCES public.mail_items(id) ON DELETE SET NULL not valid;

alter table "public"."tasks" validate constraint "tasks_mail_id_fkey";

alter table "public"."ticket_messages" add constraint "ticket_messages_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE not valid;

alter table "public"."ticket_messages" validate constraint "ticket_messages_ticket_id_fkey";


  create policy "fristen_admin_all"
  on "public"."fristen"
  as permissive
  for all
  to public
using (public.is_admin_user());



  create policy "Admins can update any profile"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'admin'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'admin'::text)))));



  create policy "profiles_admin_read_all"
  on "public"."profiles"
  as permissive
  for select
  to public
using (public.is_admin_user());



  create policy "system_settings_admin_all"
  on "public"."system_settings"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


CREATE TRIGGER trg_abschluss_updated_at BEFORE UPDATE ON public.abschluss FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER brief_vorlagen_updated_at BEFORE UPDATE ON public.brief_vorlagen FOR EACH ROW EXECUTE FUNCTION public.update_brief_vorlagen_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER dokumente_updated_at BEFORE UPDATE ON public.dokumente FOR EACH ROW EXECUTE FUNCTION public.update_dokumente_updated_at();

CREATE TRIGGER trg_dokumente_search BEFORE INSERT OR UPDATE ON public.dokumente FOR EACH ROW EXECUTE FUNCTION public.dokumente_update_search_vector();

CREATE TRIGGER fahrzeuge_updated_at BEFORE UPDATE ON public.fahrzeuge FOR EACH ROW EXECUTE FUNCTION public.update_fahrzeuge_updated_at();

CREATE TRIGGER trg_fahrzeuge_updated_at BEFORE UPDATE ON public.fahrzeuge FOR EACH ROW EXECUTE FUNCTION public.update_fahrzeuge_updated_at();

CREATE TRIGGER fristen_updated_at BEFORE UPDATE ON public.fristen FOR EACH ROW EXECUTE FUNCTION public.update_fristen_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.kanban_columns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_kb_updated_at BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_kb_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.mail_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_support_tickets_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Auth users can delete dokumente"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'dokumente'::text));



  create policy "Auth users can read dokumente"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'dokumente'::text));



  create policy "Auth users can update dokumente"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'dokumente'::text));



  create policy "Auth users can upload dokumente"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'dokumente'::text));



  create policy "auth_delete_note_attachments"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'note-attachments'::text));



  create policy "auth_read_note_attachments"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'note-attachments'::text));



  create policy "auth_upload_note_attachments"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'note-attachments'::text));



