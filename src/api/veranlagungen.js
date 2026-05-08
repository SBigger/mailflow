// DAL für das Veranlagungs-Tool.
// Speichert in der bestehenden Tabelle `steuerdaten` (gleicher Tabellen-Pool wie
// die Steuererklaerungs-Maske), aber unter dem reservierten kanton-Schluessel
// `_VERANLAGUNG`. So sind Veranlagungs-Eintraege strikt von Form-Eintraegen
// (SG/TG/ESTV) getrennt, ohne dass eine eigene DB-Tabelle noetig waere.
//
// Eintragsstruktur (felder JSONB):
// {
//   "SG":   { stand, datum, prov_steuer, def_gewinn, bemerkung, belege: [...] },
//   "TG":   { ... },
//   "Bund": { ... },
//   <weitere Kantonkürzel>: { ... }
// }
import { supabase } from '@/api/supabaseClient';

const KANTON_KEY = '_VERANLAGUNG';
// Reservierter Steuerjahr-Wert fuer Meta-Daten (Kantonsliste, Spalten-
// reihenfolge etc.). Echte Jahres-Eintraege haben steuerjahr >= 1900.
const META_YEAR = 1;

export const veranlagungen = {
  // Alle Jahres-Eintraege fuer einen Kunden (ohne Meta-Row)
  async listForCustomer(customerId) {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('id, steuerjahr, felder, updated_at')
      .eq('customer_id', customerId)
      .eq('kanton', KANTON_KEY)
      .gte('steuerjahr', 1900)
      .order('steuerjahr', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Kantonsliste pro Kunde (persistente Spalten-Konfiguration)
  async getKantone(customerId) {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('felder')
      .eq('customer_id', customerId)
      .eq('kanton', KANTON_KEY)
      .eq('steuerjahr', META_YEAR)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.felder?.kantone || null;
  },

  async setKantone(customerId, kantone) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('steuerdaten')
      .upsert({
        customer_id: customerId,
        kanton:      KANTON_KEY,
        steuerjahr:  META_YEAR,
        felder:      { kantone },
        updated_at:  new Date().toISOString(),
        created_by:  user?.id,
      }, { onConflict: 'customer_id,kanton,steuerjahr' });
    if (error) throw new Error(error.message);
  },

  // Eintrag fuer (Kunde, Jahr) — gibt felder-Map zurueck, ggf. {}
  async get(customerId, steuerjahr) {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('felder')
      .eq('customer_id', customerId)
      .eq('kanton', KANTON_KEY)
      .eq('steuerjahr', steuerjahr)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.felder || {};
  },

  // Speichert das gesamte Jahres-Objekt (alle Kantone in einem Schritt)
  async upsert(customerId, steuerjahr, felder, notizen = null) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('steuerdaten')
      .upsert(
        {
          customer_id: customerId,
          kanton: KANTON_KEY,
          steuerjahr,
          felder,
          notizen,
          updated_at: new Date().toISOString(),
          created_by: user?.id,
        },
        { onConflict: 'customer_id,kanton,steuerjahr' }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  // Loeschen aller Veranlagungs-Eintraege fuer (Kunde, Jahr)
  async delete(customerId, steuerjahr) {
    const { error } = await supabase
      .from('steuerdaten')
      .delete()
      .eq('customer_id', customerId)
      .eq('kanton', KANTON_KEY)
      .eq('steuerjahr', steuerjahr);
    if (error) throw new Error(error.message);
  },

  // Gibt alle Kunden-IDs zurueck, die mindestens einen Veranlagungs-Eintrag haben
  async listCustomerIds() {
    const { data, error } = await supabase
      .from('steuerdaten')
      .select('customer_id')
      .eq('kanton', KANTON_KEY);
    if (error) throw new Error(error.message);
    return [...new Set((data || []).map(r => r.customer_id))];
  },
};

// Konstanten für die UI
export const VERANLAGUNGSSTAND_OPTIONEN = [
  { value: 'offen',                label: 'offen',                 farbe: '#9ca3af', bg: '#f3f4f6' },
  { value: 'provisorisch',         label: 'provisorisch',          farbe: '#92400e', bg: '#fef3c7' },
  { value: 'definitiv veranlagt',  label: 'definitiv veranlagt',   farbe: '#15803d', bg: '#dcfce7' },
  { value: 'einsprache',           label: 'Einsprache',            farbe: '#b91c1c', bg: '#fee2e2' },
  { value: 'rekurs',               label: 'Rekurs',                farbe: '#7c3aed', bg: '#ede9fe' },
];

export const STANDARD_KANTONE = ['SG', 'TG', 'Bund'];

// Vollstaendige Liste fuer Custom-Kanton-Hinzufuegen
export const ALLE_KANTONE_PLUS_BUND = [
  'AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW',
  'SG','SH','SO','SZ','TG','TI','UR','VD','VS','ZG','ZH','Bund',
];
