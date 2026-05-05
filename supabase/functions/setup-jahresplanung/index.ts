import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not set" }), { status: 500, headers: cors });

  const sql = postgres(dbUrl, { max: 1 });

  try {
    // 1. Add year column back to jahresplanung
    await sql`
      ALTER TABLE public.jahresplanung
        ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT 2026
    `;

    // 2. Add done column for completion tracking
    await sql`
      ALTER TABLE public.jahresplanung
        ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false
    `;

    // 3b. Add month_half column (null = whole month, 'first' = 1–15, 'second' = 16–31)
    await sql`
      ALTER TABLE public.jahresplanung
        ADD COLUMN IF NOT EXISTS month_half text
    `;

    // 3. Create jp_feiertage table (global holidays, per date)
    await sql`
      CREATE TABLE IF NOT EXISTS public.jp_feiertage (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        date       date        NOT NULL UNIQUE,
        hours      numeric(4,2) NOT NULL DEFAULT 0,
        notes      text,
        created_by uuid        REFERENCES public.profiles(id),
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`ALTER TABLE public.jp_feiertage ENABLE ROW LEVEL SECURITY`;

    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = 'jp_feiertage' AND policyname = 'jp_feiertage_auth'
        ) THEN
          CREATE POLICY "jp_feiertage_auth" ON public.jp_feiertage
            FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$
    `;

    // 4. Add direct phone number to profiles (for Teams call matching)
    await sql`
      ALTER TABLE public.profiles
        ADD COLUMN IF NOT EXISTS phone text
    `;

    // 5. Schedule sync-teams-calls via pg_cron (every 30 minutes)
    //    Removes existing schedule first (idempotent), then recreates it.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://uawgpxcihixqxqxxbjak.supabase.co";
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const syncUrl    = `${supabaseUrl}/functions/v1/sync-teams-calls`;
    const authHeader = `{"Authorization": "Bearer ${anonKey}"}`;

    // Unschedule (ignore error if not exists)
    await sql`
      DO $do$ BEGIN
        PERFORM cron.unschedule('sync-teams-calls-auto');
      EXCEPTION WHEN OTHERS THEN NULL;
      END $do$
    `;

    // Create new schedule — cron command uses single-quoted SQL string with '' escaping
    await sql.unsafe(`
      SELECT cron.schedule(
        'sync-teams-calls-auto',
        '0 * * * *',
        'SELECT net.http_post(
           url        := ''${syncUrl}'',
           headers    := ''${authHeader.replace(/'/g, "''")}''::jsonb,
           body       := ''{}''::jsonb
         );'
      )
    `);

    // Reload PostgREST schema cache so new columns are immediately visible.
    await sql`NOTIFY pgrst, 'reload schema'`;

    await sql.end();
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (err) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ error: String(err.message) }), { status: 500, headers: cors });
  }
});
