// Data-Access-Layer für die Steuererklärungs-Maske (ehemals steuerapp/src/lib/supabase.js).
// Benutzt den globalen mailflow-Supabase-Client.

import { supabase } from '@/api/supabaseClient';

export const steuerdaten = {
  async get(customerId, kanton, steuerjahr) {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('*')
      .eq('customer_id', customerId)
      .eq('kanton', kanton)
      .eq('steuerjahr', steuerjahr)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async upsert(customerId, kanton, steuerjahr, felder, notizen) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('steuerdaten')
      .upsert(
        { customer_id: customerId, kanton, steuerjahr, felder, notizen, updated_at: new Date().toISOString(), created_by: user?.id },
        { onConflict: 'customer_id,kanton,steuerjahr' }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async listForCustomer(customerId) {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('id, kanton, steuerjahr, updated_at, felder')
      .eq('customer_id', customerId)
      .order('steuerjahr', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async delete(customerId, kanton, steuerjahr) {
    const { error } = await supabase
      .from('steuerdaten')
      .delete()
      .eq('customer_id', customerId)
      .eq('kanton', kanton)
      .eq('steuerjahr', steuerjahr);
    if (error) throw new Error(error.message);
  },

  async listCustomerIds() {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('customer_id');
    if (error) throw new Error(error.message);
    return [...new Set((data || []).map(r => r.customer_id))];
  },
};
