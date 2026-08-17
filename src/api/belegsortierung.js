// Speichern und Laden der Belegsortierung je Mandant und Steuerjahr.
//
// Gespeichert wird die Entscheidung, nicht die Datei. Der Inhalts-Hash ist der
// Schlüssel: zieht man denselben Stapel erneut hinein, wird jeder Beleg am
// Inhalt wiedererkannt – ohne OCR, ohne KI.

import { supabase } from '@/api/supabaseClient';

/** Nur das, was gespeichert werden soll – Datei und Objekt-URL bleiben lokal. */
function fuerDieDatenbank(b) {
  return {
    hash:        b.hash,
    name:        b.name,
    groesse:     b.groesse ?? null,
    position:    b.position ?? null,
    belegart:    b.belegart ?? null,
    confidence:  b.confidence ?? null,
    quelle:      b.quelle ?? null,
    begruendung: b.begruendung ?? null,
    vonHand:     !!b.vonHand,
    // Beträge und Jahr sind Erfassung, nicht Erkennung – sie muessen mit.
    // Jeder Beleg fuehrt BEIDE Seiten der Erklaerung; leere bleiben null.
    // (Aeltere Staende mit betrag/betrag2 hebt migriereBetraege beim Laden.)
    einkommen:   b.einkommen ?? null,
    vermoegen:   b.vermoegen ?? null,
    betragQuelle: b.betragQuelle ?? null,
    // Seitenbereich: ein PDF kann mehrere Belege enthalten
    vonSeite:    b.vonSeite ?? null,
    doppelVon:   b.doppelVon ?? null,
    dateiPfad:   b.dateiPfad ?? null,
    bisSeite:    b.bisSeite ?? null,
    jahr:        b.jahr ?? null,
    // Der Text ist das Teure an einem Scan – gut zehn Sekunden OCR je Seite.
    // Deshalb aufheben, aber gedeckelt: er dient nur der Wiedererkennung.
    text:        (b.text || '').slice(0, 20000),
  };
}

// Originaldateien liegen im Storage-Bucket "belegsortierung", adressiert ueber
// den Inhalts-Hash: derselbe Beleg wird nie doppelt gespeichert, und beim
// Wiederoeffnen einer Sortierung laesst sich jede Datei wieder anzeigen --
// vorher war nach dem Neuladen nur noch die Entscheidung da, das PDF weg.
const BUCKET = 'belegsortierung';

function dateiPfadFuer(customerId, hash, name) {
  const endung = (String(name || '').match(/[.](pdf|png|jpeg|jpg)$/i) || ['.pdf'])[0].toLowerCase();
  return customerId + '/' + hash + endung;
}

export const belegsortierung = {
  /** Originaldatei einmal je Inhalt ablegen. Gibt den Pfad zurueck. */
  async dateiHochladen(customerId, hash, datei) {
    const pfad = dateiPfadFuer(customerId, hash, datei.name);
    const { error } = await supabase.storage.from(BUCKET)
      .upload(pfad, datei, { upsert: true, contentType: datei.type || 'application/pdf' });
    if (error) throw new Error(error.message);
    return pfad;
  },

  /** Kurzlebige Anzeige-URL (1 Stunde) fuer die Vorschau. */
  async dateiUrl(pfad) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /** Datei zurueckholen -- fuers Beilagenbuendel nach einem Neuladen. */
  async dateiLaden(pfad) {
    const { data, error } = await supabase.storage.from(BUCKET).download(pfad);
    if (error) throw new Error(error.message);
    return data;
  },

  async get(customerId, steuerjahr) {
    const { data, error } = await supabase
      .from('belegsortierung')
      .select('*')
      .eq('customer_id', customerId)
      .eq('steuerjahr', steuerjahr)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async upsert(customerId, steuerjahr, belege, notizen = null) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('belegsortierung')
      .upsert({
        customer_id: customerId,
        steuerjahr,
        belege: (belege || []).filter(b => b.hash).map(fuerDieDatenbank),
        notizen,
        updated_at: new Date().toISOString(),
        created_by: user?.id,
      }, { onConflict: 'customer_id,steuerjahr' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  /** Übersicht für einen Mandanten – welche Jahre sind schon bearbeitet? */
  async jahreFuer(customerId) {
    const { data, error } = await supabase
      .from('belegsortierung')
      .select('steuerjahr, updated_at, belege')
      .eq('customer_id', customerId)
      .order('steuerjahr', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(r => ({
      steuerjahr: r.steuerjahr,
      updated_at: r.updated_at,
      anzahl: Array.isArray(r.belege) ? r.belege.length : 0,
    }));
  },

  async delete(customerId, steuerjahr) {
    const { error } = await supabase
      .from('belegsortierung')
      .delete()
      .eq('customer_id', customerId)
      .eq('steuerjahr', steuerjahr);
    if (error) throw new Error(error.message);
  },
};
