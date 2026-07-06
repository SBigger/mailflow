import { requireUser, jsonResponse, corsHeaders } from "../_shared/auth.ts";

// Liefert die Mitarbeiterliste (id, Name, E-Mail) fuer Zuweisungs-Picker.
// Nur fuer eingeloggte Mitarbeiter (verhindert anonymes Auslesen aller Nutzer).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { data } = await auth.admin!
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name");

  return jsonResponse(data ?? []);
});
