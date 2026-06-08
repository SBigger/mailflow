-- ============================================================
-- Diagnostik fuer dokumente_versioning - RPC, kann von Frontend
-- via supabase.rpc('versioning_diagnose') aufgerufen werden
-- ============================================================

CREATE OR REPLACE FUNCTION public.versioning_diagnose()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  triggers_info jsonb;
  versions_count int;
  archive_fn_exists boolean;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'trigger_name', tgname,
    'table', tgrelid::regclass::text,
    'enabled', tgenabled,
    'when', CASE WHEN tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END,
    'event_update', (tgtype & 16) = 16
  )) INTO triggers_info
  FROM pg_trigger
  WHERE tgname = 'dokumente_archive_trigger'
    AND NOT tgisinternal;

  SELECT count(*) INTO versions_count FROM public.dokumente_versions;

  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname = 'dokumente_archive_old_version'
  ) INTO archive_fn_exists;

  RETURN jsonb_build_object(
    'trigger', triggers_info,
    'versions_count', versions_count,
    'archive_function_exists', archive_fn_exists,
    'dokumente_versions_columns', (
      SELECT jsonb_agg(column_name) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dokumente_versions'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.versioning_diagnose() TO authenticated;
