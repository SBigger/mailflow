import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Supabase-Client mit Service-Role-Key.
 *
 * ACHTUNG: Der Service-Role-Key UMGEHT alle RLS-Policies. Die Mandanten-
 * Trennung wird darum in diesem Server im App-Layer erzwungen (siehe scope.ts):
 * Jede Query wird explizit auf den konfigurierten CUSTOMER_ID bzw. MANDANT_ID
 * eingeschraenkt. Es gibt keine Session-/User-Auth, daher keine Token-Refreshs.
 */

export const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

