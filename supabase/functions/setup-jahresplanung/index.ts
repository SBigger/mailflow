import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not set" }), { status: 500, headers: cors });

  const sql = postgres(dbUrl, { max: 1 });

  try {
    // Drop year column if it exists (entries are now perpetual / year-independent)
    await sql`
      ALTER TABLE public.jahresplanung
        DROP COLUMN IF EXISTS year
    `;

    await sql.end();
    return new Response(JSON.stringify({ ok: true, message: "year column removed – entries are now perpetual" }), { headers: cors });
  } catch (err) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ error: String(err.message) }), { status: 500, headers: cors });
  }
});
