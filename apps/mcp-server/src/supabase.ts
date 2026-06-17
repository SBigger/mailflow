import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Supabase-Client mit Service-Role-Key.
 *
 * ACHTUNG: Der Service-Role-Key UMGEHT alle RLS-Policies. Die Mandanten-
 * Trennung wird darum in diesem Server im App-Layer erzwungen (siehe scope.ts):
 * Jede Query wird explizit auf den konfigurierten CUSTOMER_ID bzw. MANDANT_ID
 * eingeschraenkt. Es gibt keine Session-/User-Auth, daher keine Token-Refreshs.
 */
export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
