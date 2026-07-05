// Gemeinsamer Auth-Helfer fuer Edge Functions.
// Verifiziert den Aufrufer-JWT SERVERSEITIG (Signaturpruefung via auth.getUser)
// statt ihn nur zu dekodieren, und laedt das Mitarbeiterprofil inkl. Rolle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type Requirer = {
  user?: { id: string; email?: string };
  profile?: { id: string; role: string };
  admin?: ReturnType<typeof serviceClient>;
  response?: Response;
};

/**
 * Verlangt einen gueltigen, eingeloggten Mitarbeiter.
 * - Prueft den JWT per getUser (Signatur), nicht per Dekodierung.
 * - Lehnt anon-Key-Aufrufe ab (getUser liefert dann keinen User).
 * - Optional: roles = Liste erlaubter profiles.role-Werte.
 * Rueckgabe: { user, profile, admin } bei Erfolg, sonst { response } (401/403).
 */
export async function requireUser(
  req: Request,
  opts: { roles?: string[] } = {},
): Promise<Requirer> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { response: jsonResponse({ error: "Unauthorized" }, 401) };

  const admin = serviceClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { response: jsonResponse({ error: "Unauthorized" }, 401) };

  const { data: profile } = await admin
    .from("profiles").select("id, role").eq("id", user.id).single();
  if (!profile) {
    return { response: jsonResponse({ error: "Forbidden: kein Mitarbeiterprofil" }, 403) };
  }
  if (opts.roles && !opts.roles.includes(profile.role)) {
    return { response: jsonResponse({ error: "Forbidden: unzureichende Rolle" }, 403) };
  }
  return { user, profile, admin };
}
