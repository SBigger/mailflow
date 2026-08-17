import { supabase } from '@/api/supabaseClient';

// ── Mandanten ────────────────────────────────────────────────────
export const mandantenApi = {
  list: async () => {
    // RLS fibu_mandant_ids_for_user() filtert automatisch auf zugängliche Mandanten
    const { data, error } = await supabase
      .from('fibu_mandanten')
      .select('*')
      .eq('aktiv', true)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },

  get: async (id) => {
    const { data, error } = await supabase
      .from('fibu_mandanten')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (payload) => {
    // Alles in einer atomaren SECURITY DEFINER Funktion:
    // INSERT mandant + access row + Kontenplan + MWST-Codes
    const { data: mandantId, error } = await supabase.rpc('fibu_create_mandant', {
      p_name:    payload.name,
      p_uid:     payload.uid     || null,
      p_mwst_nr: payload.mwst_nr || null,
      p_ort:     payload.ort     || null,
    });
    if (error) throw error;
    // Frisch angelegten Mandanten laden und zurückgeben
    const { data, error: getErr } = await supabase
      .from('fibu_mandanten').select('*').eq('id', mandantId).single();
    if (getErr) throw getErr;
    return data;
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_mandanten')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  addUser: async (mandantId, userId, role = 'buchhalter') => {
    const { data, error } = await supabase
      .from('fibu_user_mandant_access')
      .upsert({ mandant_id: mandantId, user_id: userId, role }, { onConflict: 'user_id,mandant_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  getUserRole: async (mandantId) => {
    // Nur die EIGENE Zugriffszeile lesen. Sonst liefert RLS bei Mandanten mit
    // mehreren Benutzern >1 Zeile → .maybeSingle() schlägt fehl → role bliebe null
    // → canWrite=false (Buchen / Zahlungslauf-Export wären fälschlich gesperrt).
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from('fibu_user_mandant_access')
      .select('role')
      .eq('mandant_id', mandantId)
      .eq('user_id', uid)
      .maybeSingle();
    return data?.role ?? null;
  },
};

// ── Lieferanten ──────────────────────────────────────────────────
export const lieferantenApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_lieferanten')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('name');
    if (error) throw error;
    return data ?? [];
  },

  get: async (id) => {
    const { data, error } = await supabase
      .from('fibu_lieferanten')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_lieferanten')
      .insert({ ...payload, mandant_id: mandantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_lieferanten')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  nextNr: async (mandantId) => {
    const { data } = await supabase
      .from('fibu_lieferanten')
      .select('nr')
      .eq('mandant_id', mandantId)
      .order('nr', { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = parseInt(data?.nr ?? '1000', 10);
    return String(isNaN(last) ? 1001 : last + 1);
  },
};

// ── Kreditoren-Belege ────────────────────────────────────────────
export const kreditorenApi = {
  listOffen: async (mandantId) => {
    // Gutschriften ausgeschlossen – sie können nicht "gezahlt" werden
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr,iban,bank_name,adresse,plz,ort,land,skonto_prozent,skonto_tage)')
      .eq('mandant_id', mandantId)
      .in('status', ['offen', 'teilbezahlt'])
      .neq('belegtyp', 'gutschrift')
      .eq('freigabe_status', 'freigegeben')
      .order('faelligkeit');
    if (error) throw error;
    return data ?? [];
  },

  listPerStichtag: async (mandantId, stichtag) => {
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr)')
      .eq('mandant_id', mandantId)
      .lte('belegdatum', stichtag)
      .or(`status.in.(offen,ausstehend,ebanking,teilbezahlt),and(status.eq.bezahlt,bezahlt_am.gt.${stichtag})`)
      .order('faelligkeit');
    if (error) throw error;
    return data ?? [];
  },

  listAll: async (mandantId, von, bis) => {
    // Filtert auf buchungsdatum (Verbuchungsjahr), fallback auf belegdatum
    let q = supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr)')
      .eq('mandant_id', mandantId)
      .order('buchungsdatum', { ascending: false, nullsFirst: false })
      .order('belegdatum',    { ascending: false });
    if (von) q = q.or(`buchungsdatum.gte.${von},and(buchungsdatum.is.null,belegdatum.gte.${von})`);
    if (bis) q = q.or(`buchungsdatum.lte.${bis},and(buchungsdatum.is.null,belegdatum.lte.${bis})`);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  get: async (id) => {
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(*), positionen:fibu_kreditoren_positionen(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  create: async (mandantId, beleg, positionen) => {
    const { data, error } = await supabase.rpc('fibu_kreditoren_erstellen', {
      p_mandant_id: mandantId,
      p_beleg: beleg,
      p_positionen: positionen ?? [],
    });
    if (error) throw error;
    return data;
  },

  // Beleg bearbeiten: Kopf + Positionen ersetzen und SAUBER neu verbuchen
  // (entfernt alte GL-Buchungen, kein Doppel-Beleg). Belegtyp/Mandant bleiben fix;
  // bezahlte/MWST-abgerechnete/stornierte Belege werden serverseitig gesperrt.
  bearbeiten: async (belegId, beleg, positionen) => {
    const { error } = await supabase.rpc('fibu_kreditoren_bearbeiten', {
      p_beleg_id:   belegId,
      p_beleg:      beleg,
      p_positionen: positionen ?? [],
    });
    if (error) throw error;
  },

  // Offene Posten PER STICHTAG (echte Rekonstruktion aus datierten Zahlungen)
  opListeStichtag: async (mandantId, stichtag) => {
    const { data, error } = await supabase.rpc('fibu_op_liste_kreditoren', {
      p_mandant_id: mandantId, p_stichtag: stichtag,
    });
    if (error) throw error;
    // Form an die Tabellen-Komponente angleichen (geschachteltes lieferant-Objekt)
    return (data ?? []).map(r => ({
      ...r,
      lieferant: { id: r.lieferant_id, name: r.lieferant_name, nr: r.lieferant_nr },
    }));
  },

  // Gutschrift gegen offene Rechnungen desselben Lieferanten verrechnen (FIFO)
  gutschriftVerrechnen: async (mandantId, gutschriftId) => {
    const { data, error } = await supabase.rpc('fibu_gutschrift_verrechnen', {
      p_mandant_id: mandantId, p_gutschrift_id: gutschriftId,
    });
    if (error) throw error;
    return data;   // verrechneter Gesamtbetrag
  },

  // Rechnung stornieren – erzeugt eine Storno-Gutschrift per Storno-Datum
  storno: async (belegId, stornoDatum) => {
    const { data, error } = await supabase.rpc('fibu_kreditoren_storno', {
      p_beleg_id: belegId, p_storno_datum: stornoDatum,
    });
    if (error) throw error;
    return data;   // id der Storno-Gutschrift
  },

  // Beleg löschen (nur Status offen/ausstehend, kein Bezahlt, keine MWST-Abrechnung)
  deleteBeleg: async (belegId) => {
    const { error } = await supabase.rpc('fibu_delete_kreditoren_beleg', {
      p_beleg_id: belegId,
    });
    if (error) throw error;
  },

  // Skonto-Abzug einer Kreditoren-Zahlung verbuchen
  skontoBuchen: async (belegId, skontoBetrag, datum) => {
    const { error } = await supabase.rpc('fibu_skonto_buchen', {
      p_beleg_id: belegId, p_skonto_betrag: skontoBetrag, p_datum: datum,
    });
    if (error) throw error;
  },

  // Beleg freigeben (Belegfreigabe-Workflow)
  freigeben: async (belegId) => {
    const { error } = await supabase.rpc('fibu_beleg_freigeben', { p_beleg_id: belegId });
    if (error) throw error;
  },

  markBezahlt: async (id, betrag, bezahltAm) => {
    const { data, error } = await supabase.rpc('fibu_kreditoren_zahlung_erfassen', {
      p_beleg_id: id,
      p_betrag: betrag,
      p_datum: bezahltAm ?? new Date().toISOString().slice(0, 10),
      p_zahlungsreferenz: null,
    });
    if (error) throw error;
    return data;
  },

  // Vorsteuer für ein Quartal — Stichtag ist das Buchungsdatum (nicht Belegdatum)
  vorsteuerQuartal: async (mandantId, quartal, jahr) => {
    const monat = (quartal - 1) * 3 + 1;
    const von = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    const bis = `${jahr}-${String(monat + 2).padStart(2, '0')}-31`;
    // buchungsdatum steuert MWST-Perioden; fallback auf belegdatum für ältere Belege
    const { data, error } = await supabase
      .from('fibu_kreditoren_positionen')
      .select('betrag_mwst, beleg:fibu_kreditoren_belege!inner(mandant_id, buchungsdatum, belegdatum)')
      .eq('fibu_kreditoren_belege.mandant_id', mandantId);
    if (error) throw error;
    return (data ?? []).filter(r => {
      const d = r.beleg?.buchungsdatum || r.beleg?.belegdatum || '';
      return d >= von && d <= bis;
    }).reduce((s, r) => s + (r.betrag_mwst ?? 0), 0);
  },
};

// ── Konten ───────────────────────────────────────────────────────
export const kontenApi = {
  list: async (mandantId, nurAktiv = true) => {
    let q = supabase.from('fibu_konten').select('*').eq('mandant_id', mandantId).order('konto_nr');
    if (nurAktiv) q = q.eq('aktiv', true);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  toggleAktiv: async (id, aktiv) => {
    const { error } = await supabase.from('fibu_konten').update({ aktiv }).eq('id', id);
    if (error) throw error;
  },
};

// ── MWST-Codes ───────────────────────────────────────────────────
export const mwstCodesApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_mwst_codes')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('sortierung');
    if (error) throw error;
    return data ?? [];
  },

  listAktiv: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_mwst_codes')
      .select('*')
      .eq('mandant_id', mandantId)
      .eq('aktiv', true)
      .order('sortierung');
    if (error) throw error;
    return data ?? [];
  },

  toggleAktiv: async (id, aktiv) => {
    const { error } = await supabase.from('fibu_mwst_codes').update({ aktiv }).eq('id', id);
    if (error) throw error;
  },
};

// ── KI-Buchungsvorschlag ─────────────────────────────────────────
export const kiVorschlagApi = {
  suggest: async ({ mandantId, lieferantId, lieferantName, kontextText, konten, mwstCodes, waehrung, betragBrutto }) => {
    const session = await supabase.auth.getSession();
    const token = session.data?.session?.access_token;
    const resp = await fetch(`${window.env.API_URL}/functions/v1/fibu-suggest-buchung`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        mandant_id:     mandantId,
        lieferant_id:   lieferantId,
        lieferant_name: lieferantName,
        kontext_text:   kontextText,
        konten,
        mwst_codes:     mwstCodes,
        waehrung,
        betrag_brutto:  betragBrutto,
      }),
    });
    if (!resp.ok) throw new Error(`KI-Suggest HTTP ${resp.status}`);
    return await resp.json();
  },
};

// ── Zahlungsläufe ────────────────────────────────────────────────
export const zahlungslaufApi = {
  create: async (mandantId, lauf, positionen) => {
    const { data, error } = await supabase.rpc('fibu_zahlungslauf_erstellen', {
      p_mandant_id: mandantId,
      p_lauf: lauf,
      p_positionen: positionen ?? [],
    });
    if (error) {
      if (/aktiven Zahlungslauf|unique|duplicate/i.test(error.message || '')) {
        throw new Error('Mindestens ein Beleg ist bereits in einem aktiven Zahlungslauf – Doppelzahlung verhindert.');
      }
      throw error;
    }
    return data;
  },

  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_zahlungslaeufe')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  // Historie inkl. Rückmelde-Fortschritt (wie viele Belege schon bezahlt)
  historie: async (mandantId) => {
    const { data, error } = await supabase
      .rpc('fibu_zahlungslauf_historie', { p_mandant_id: mandantId });
    if (error) throw error;
    return data ?? [];
  },

  // pain.001-XML eines Laufs nachladen (für erneuten Download)
  getXml: async (laufId) => {
    const { data, error } = await supabase
      .from('fibu_zahlungslaeufe')
      .select('lauf_nr, valutadatum, pain001_xml')
      .eq('id', laufId)
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_zahlungslaeufe')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Positionen eines Laufs inkl. Status (für die Rückmelde-Ansicht)
  positionen: async (laufId) => {
    const { data, error } = await supabase
      .rpc('fibu_zahlungslauf_positionen_get', { p_lauf_id: laufId });
    if (error) throw error;
    return data ?? [];
  },

  // Rückmeldung: pro Position ausgeführt | storniert
  // positionen = [{ position_id, status: 'ausgefuehrt' | 'storniert' }]
  rueckmelden: async (laufId, positionen) => {
    const { error } = await supabase
      .rpc('fibu_zahlungslauf_rueckmelden', { p_lauf_id: laufId, p_positionen: positionen });
    if (error) throw error;
  },

  // Ganzen Lauf zurücknehmen: Belege wieder offen, ggf. Buchungen gegenbuchen
  stornieren: async (laufId, datum) => {
    const { error } = await supabase
      .rpc('fibu_zahlungslauf_stornieren', { p_lauf_id: laufId, p_datum: datum });
    if (error) throw error;
  },
};

// ── Firmenzahlstellen (eigene Bankkonten des Mandanten) ──────────
export const zahlstellenApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_zahlstellen')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('ist_standard', { ascending: false })
      .order('sortierung')
      .order('bezeichnung');
    if (error) throw error;
    return data ?? [];
  },

  listAktiv: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_zahlstellen')
      .select('*')
      .eq('mandant_id', mandantId)
      .eq('aktiv', true)
      .order('ist_standard', { ascending: false })
      .order('sortierung')
      .order('bezeichnung');
    if (error) throw error;
    return data ?? [];
  },

  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_zahlstellen')
      .insert({ ...payload, mandant_id: mandantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_zahlstellen')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('fibu_zahlstellen')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  setStandard: async (id) => {
    const { error } = await supabase
      .rpc('fibu_zahlstelle_set_standard', { p_id: id });
    if (error) throw error;
  },
};

// ── Manuelle Buchungen / Hauptbuch ───────────────────────────────
export const manuelleBuchungApi = {
  // Beleg-Liste (Kopf) mit optionalem Zeitraum
  listeBelege: async (mandantId, von, bis) => {
    let q = supabase
      .from('fibu_buchung_belege')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('buchungsdatum', { ascending: false })
      .order('beleg_nr', { ascending: false });
    if (von) q = q.gte('buchungsdatum', von);
    if (bis) q = q.lte('buchungsdatum', bis);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  // Buchungssätze eines Belegs
  zeilen: async (belegId) => {
    const { data, error } = await supabase
      .from('fibu_buchungen')
      .select('*')
      .eq('quelle_id', belegId)
      .order('buchungs_nr');
    if (error) throw error;
    return data ?? [];
  },

  erstellen: async ({ mandantId, datum, text, pdfPath, pdfName, zeilen }) => {
    const { data, error } = await supabase.rpc('fibu_manuelle_buchung_erstellen', {
      p_mandant_id: mandantId, p_datum: datum, p_text: text,
      p_pdf_path: pdfPath ?? null, p_pdf_name: pdfName ?? null,
      p_art: 'normal', p_zeilen: zeilen,
    });
    if (error) throw error;
    return data;
  },

  korrigieren: async ({ belegId, datum, text, pdfPath, pdfName, zeilen }) => {
    const { data, error } = await supabase.rpc('fibu_manuelle_buchung_korrigieren', {
      p_beleg_id: belegId, p_datum: datum, p_text: text,
      p_pdf_path: pdfPath ?? null, p_pdf_name: pdfName ?? null, p_zeilen: zeilen,
    });
    if (error) throw error;
    return data;
  },

  stornieren: async (belegId, stornoDatum) => {
    const { data, error } = await supabase.rpc('fibu_manuelle_buchung_stornieren', {
      p_beleg_id: belegId, p_storno_datum: stornoDatum,
    });
    if (error) throw error;
    return data;
  },

  // PDF in den Bucket fibu-belege hochladen → gibt den Pfad zurück
  uploadPdf: async (mandantId, file) => {
    const ext  = (file.name.split('.').pop() || 'pdf').toLowerCase();
    const path = `${mandantId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('fibu-belege')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { path, name: file.name };
  },

  signedPdfUrl: async (path) => {
    const { data, error } = await supabase.storage
      .from('fibu-belege')
      .createSignedUrl(path, 300);
    if (error) throw error;
    return data?.signedUrl ?? null;
  },
};

// ── Buchungssperre ───────────────────────────────────────────────
export const buchungssperreApi = {
  setzen: async (mandantId, datum) => {
    const { error } = await supabase.rpc('fibu_buchungssperre_setzen', {
      p_mandant_id: mandantId, p_datum: datum,
    });
    if (error) throw error;
  },
};

// ── Saldovorträge ────────────────────────────────────────────────
export const saldovortragApi = {
  lesen: async (mandantId, jahr) => {
    const { data, error } = await supabase.rpc('fibu_saldovortrag_lesen', {
      p_mandant_id: mandantId, p_jahr: jahr,
    });
    if (error) throw error;
    return data ?? [];
  },
  speichern: async (mandantId, jahr, salden) => {
    const { data, error } = await supabase.rpc('fibu_saldovortrag_speichern', {
      p_mandant_id: mandantId, p_jahr: jahr, p_salden: salden,
    });
    if (error) throw error;
    return data;
  },
};

// ── Wiederkehrende manuelle Buchungen (Buchungsserien) ───────────
export const buchungSerieApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_buchung_serien')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('aktiv', { ascending: false })
      .order('naechstes_datum');
    if (error) throw error;
    return data ?? [];
  },
  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_buchung_serien')
      .insert({ ...payload, mandant_id: mandantId })
      .select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { error } = await supabase
      .from('fibu_buchung_serien')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
  remove: async (id) => {
    const { error } = await supabase.from('fibu_buchung_serien').delete().eq('id', id);
    if (error) throw error;
  },
  erzeugen: async (id) => {
    const { data, error } = await supabase.rpc('fibu_buchung_serie_erzeugen', { p_id: id });
    if (error) throw error;
    return data;
  },
  faelligeErzeugen: async (mandantId, bis) => {
    const { data, error } = await supabase.rpc('fibu_buchung_serien_faellige_erzeugen', {
      p_mandant_id: mandantId, p_bis: bis,
    });
    if (error) throw error;
    return data;
  },
};

// ── Fremdwährungs-Kursbewertung ──────────────────────────────────
export const kursbewertungApi = {
  buchen: async (mandantId, stichtag, konto, betrag) => {
    const { data, error } = await supabase.rpc('fibu_kursbewertung_buchen', {
      p_mandant_id: mandantId, p_stichtag: stichtag, p_konto: konto, p_betrag: betrag,
    });
    if (error) throw error;
    return data;
  },
};

// ── Kassenbuch (OCR / Handschrift-Erkennung) ─────────────────────
export const kassenbuchApi = {
  // Kassenbeleg-Foto per Vision-KI auslesen (auch handschriftlich)
  ocr: async (imageBase64, mimeType) => {
    const { data, error } = await supabase.functions.invoke('fibu-kassenbeleg-ocr', {
      body: { image: imageBase64, mimeType },
    });
    if (error) throw error;
    return data;
  },
};

// ── Kontierungsregeln (Kontovorschlag) ───────────────────────────
export const kontierungsregelnApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_kontierungsregeln')
      .select('*')
      .eq('mandant_id', mandantId)
      .order('sortierung')
      .order('stichwort');
    if (error) throw error;
    return data ?? [];
  },
  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_kontierungsregeln')
      .insert({ ...payload, mandant_id: mandantId })
      .select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { error } = await supabase.from('fibu_kontierungsregeln').update(payload).eq('id', id);
    if (error) throw error;
  },
  remove: async (id) => {
    const { error } = await supabase.from('fibu_kontierungsregeln').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Wiederkehrende Kreditoren-Rechnungen (Dauerbelege) ───────────
export const dauerbelegApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_kreditoren_dauerbelege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr)')
      .eq('mandant_id', mandantId)
      .order('aktiv', { ascending: false })
      .order('naechstes_belegdatum');
    if (error) throw error;
    return data ?? [];
  },
  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_kreditoren_dauerbelege')
      .insert({ ...payload, mandant_id: mandantId })
      .select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { error } = await supabase
      .from('fibu_kreditoren_dauerbelege')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
  remove: async (id) => {
    const { error } = await supabase.from('fibu_kreditoren_dauerbelege').delete().eq('id', id);
    if (error) throw error;
  },
  erzeugen: async (id) => {
    const { data, error } = await supabase.rpc('fibu_dauerbeleg_erzeugen', { p_id: id });
    if (error) throw error;
    return data;
  },
  faelligeErzeugen: async (mandantId, bis) => {
    const { data, error } = await supabase.rpc('fibu_dauerbelege_faellige_erzeugen', {
      p_mandant_id: mandantId, p_bis: bis,
    });
    if (error) throw error;
    return data;   // Anzahl erzeugter Belege
  },
};

// ── Wechselkurse (ESTV/BAZG) ─────────────────────────────────────
export const wechselkurseApi = {
  // neueste Kurse eines Typs ('monat' | 'tag')
  list: async (typ) => {
    const { data: d } = await supabase
      .from('fibu_wechselkurse')
      .select('datum')
      .eq('typ', typ)
      .order('datum', { ascending: false })
      .limit(1);
    if (!d || d.length === 0) return { datum: null, kurse: [] };
    const datum = d[0].datum;
    const { data, error } = await supabase
      .from('fibu_wechselkurse')
      .select('*')
      .eq('typ', typ)
      .eq('datum', datum)
      .order('waehrung');
    if (error) throw error;
    return { datum, kurse: data ?? [] };
  },

  // Import von der ESTV/BAZG anstossen (Edge Function)
  importNow: async (typ = 'beide') => {
    const { data, error } = await supabase.functions.invoke('fibu-wechselkurse-import', {
      body: { typ },
    });
    if (error) throw error;
    return data;
  },
};

// ── Budget ───────────────────────────────────────────────────────
export const budgetApi = {
  uebersicht: async (mandantId, jahr) => {
    const { data, error } = await supabase.rpc('fibu_budget_uebersicht', {
      p_mandant_id: mandantId, p_jahr: jahr,
    });
    if (error) throw error;
    return data ?? [];
  },
  speichern: async (mandantId, jahr, zeilen) => {
    const { error } = await supabase.rpc('fibu_budget_speichern', {
      p_mandant_id: mandantId, p_jahr: jahr, p_zeilen: zeilen,
    });
    if (error) throw error;
  },
};

// ── Kundenstamm (Debitoren) ──────────────────────────────────────
export const kundenApi = {
  /**
   * Erstellt mehrere Kunden auf einmal und vergibt fortlaufende Kundennummern
   * @param {string} mandantId
   * @param {Array<Object>} kundenArray - Array von Kundenobjekten (ohne mandant_id und nr)
   */
  bulkCreate: async (mandantId, kundenArray) => {
    if (!kundenArray || kundenArray.length === 0) return [];

    const nextDStr = await kundenApi.nextNr(mandantId);
    let nextNummer = parseInt(nextDStr.replace(/\D/g, ''), 10) - 1 || 1;

    // Array mit Mandant-ID und generierter Kundennummer aufbereiten
    const payload = kundenArray.map((kunde) => {
      nextNummer++;
      return {
        ...kunde,
        mandant_id: mandantId,
        nr: `K-${nextNummer}`, // Verwendet bestehende Nr. aus Import oder generiert neue
        zahlungsbedingung_tage: kunde.zahlungsbedingung_tage ?? 30,
        mwst_code: kunde.mwst_code ?? 'U81',
        aktiv: kunde.aktiv ?? true,
      };
    });

    // Bulk-Insert in Supabase ausführen
    const { data, error } = await supabase
        .from('fibu_kunden')
        .insert(payload)
        .select();

    if (error) throw error;
    return data;
  },
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_kunden').select('*').eq('mandant_id', mandantId).order('name');
    if (error) throw error;
    return data ?? [];
  },
  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_kunden').insert({ ...payload, mandant_id: mandantId }).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_kunden').update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('fibu_kunden').delete().eq('id', id);
    if (error) throw error;
  },
  nextNr: async (mandantId) => {
    const { data } = await supabase
      .from('fibu_kunden').select('nr').eq('mandant_id', mandantId)
      .order('nr', { ascending: false }).limit(1).maybeSingle();
    const last = parseInt(String(data?.nr ?? '1000').replace(/\D/g, ''), 10);
    return 'K-' + String(isNaN(last) ? 1001 : last + 1);
  },
};

// ── Produktstamm (Artikel: Dienstleistung + Material) ────────────
export const artikelApi = {
  bulkCreate: async (mandantId, artikelArray) => {
    if (!artikelArray || artikelArray.length === 0) return [];

    // Höchste bestehende Artikel-Nr ermitteln für Fallback-Nummerierung
    const nextDStr = await artikelApi.nextNr(mandantId, 'dienstleistung');
    let nextNummer = parseInt(nextDStr.replace(/\D/g, ''), 10) - 1 || 1;

    const payload = artikelArray.map((artikel) => {
      nextNummer++;
      return {
        ...artikel,
        mandant_id: mandantId,
        nr: `D-${String(nextNummer).padStart(3, '0')}`,
        typ: artikel.typ || 'dienstleistung',
        einheit: artikel.einheit || 'Std',
        verkaufspreis: parseFloat(artikel.verkaufspreis) || 0,
        waehrung: artikel.waehrung || 'CHF',
        mwst_code: artikel.mwst_code || 'U81',
        ertragskonto: artikel.ertragskonto || '3400',
        aktiv: artikel.aktiv ?? true,
      };
    });

    const { data, error } = await supabase
        .from('fibu_artikel')
        .insert(payload)
        .select();

    if (error) throw error;
    return data;
  },
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_artikel').select('*').eq('mandant_id', mandantId).order('nr');
    if (error) throw error;
    return data ?? [];
  },
  create: async (mandantId, payload) => {
    const { data, error } = await supabase
      .from('fibu_artikel').insert({ ...payload, mandant_id: mandantId }).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_artikel').update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('fibu_artikel').delete().eq('id', id);
    if (error) throw error;
  },
  nextNr: async (mandantId, typ) => {
    const prefix = typ === 'material' ? 'M-' : 'D-';
    const { data } = await supabase
      .from('fibu_artikel').select('nr').eq('mandant_id', mandantId)
      .like('nr', prefix + '%').order('nr', { ascending: false }).limit(1).maybeSingle();
    const last = parseInt(String(data?.nr ?? '').replace(/\D/g, ''), 10);
    return prefix + String((isNaN(last) ? 0 : last) + 1).padStart(3, '0');
  },
};

// ── Debitoren-Belege (Ausgangsrechnungen) ────────────────────────
export const debitorenApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_debitoren_belege')
      .select('*, kunde:fibu_kunden(id,name,nr,ort)')
      .eq('mandant_id', mandantId)
      .order('belegdatum', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  get: async (id) => {
    const { data, error } = await supabase
      .from('fibu_debitoren_belege')
      .select('*, kunde:fibu_kunden(*), positionen:fibu_debitoren_positionen(*)')
      .eq('id', id).single();
    if (error) throw error;
    return data;
  },
  // beleg: Kopf (ohne beleg_nr -> wird generiert), positionen: Zeilen.
  // Wenn status !== 'entwurf' wird direkt ins Hauptbuch gebucht.
  create: async (mandantId, beleg, positionen) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_erstellen', {
      p_mandant_id: mandantId,
      p_beleg: beleg,
      p_positionen: positionen ?? [],
    });
    if (error) throw error;
    return data;
  },
  // Entwurf -> gestellt (offen) + ins Hauptbuch buchen
  stellen: async (id) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_stellen', {
      p_beleg_id: id,
    });
    if (error) throw error;
    return data;
  },
  markGesendet: async (id, email) => {
    const { error } = await supabase.from('fibu_debitoren_belege').update({
      gesendet_am: new Date().toISOString(),
      gesendet_an: email,
    }).eq('id', id);
    if (error) throw error;
  },
  // Vollständiges Update eines Entwurfs: Kopf + Positionen (alte ersetzen).
  // Nur erlaubt solange nicht verbucht (status === 'entwurf').
  updateFull: async (_mandantId, id, beleg, positionen) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_entwurf_speichern', {
      p_beleg_id: id,
      p_beleg: beleg,
      p_positionen: positionen ?? [],
      p_stellen: beleg.status !== 'entwurf',
    });
    if (error) throw error;
    return data;
  },
  // Zahlungseingang erfassen (wie Kreditoren markBezahlt – GL bucht die Bankabstimmung).
  markBezahlt: async (id, betrag, bezahltAm) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_zahlung_erfassen', {
      p_beleg_id: id,
      p_betrag: betrag,
      p_datum: bezahltAm ?? new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
    return data;
  },
  // Rechnung stornieren → erzeugt eine Storno-Gutschrift per Storno-Datum.
  storno: async (belegId, stornoDatum) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_storno', {
      p_beleg_id: belegId, p_storno_datum: stornoDatum,
    });
    if (error) throw error;
    return data;   // id der Storno-Gutschrift
  },
  remove: async (id) => {
    const { error } = await supabase.rpc('fibu_debitoren_entwurf_loeschen', {
      p_beleg_id: id,
    });
    if (error) throw error;
  },
};

// ── Debitoren-Mahnwesen ──────────────────────────────────────────
export const mahnungApi = {
  // Offene/überfällige Rechnungen (für Mahnlauf) – Gutschriften ausgeschlossen.
  offenePosten: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_debitoren_belege')
      .select('*, kunde:fibu_kunden(id,name,nr,ort,email)')
      .eq('mandant_id', mandantId)
      .in('status', ['offen', 'teilbezahlt'])
      .neq('belegtyp', 'gutschrift')
      .order('faelligkeit', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
  // Mahnhistorie eines Belegs.
  listForBeleg: async (belegId) => {
    const { data, error } = await supabase
      .from('fibu_debitoren_mahnungen')
      .select('*').eq('beleg_id', belegId).order('mahndatum', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  // Mahnung protokollieren + Beleg-Mahnstufe hochsetzen.
  erstellen: async (_mandantId, beleg, { stufe, gebuehr = 0, faelligAm, pdfUrl = null, gesendetAn = null }) => {
    const { data, error } = await supabase.rpc('fibu_debitoren_mahnung_erstellen', {
      p_beleg_id: beleg.id,
      p_stufe: stufe,
      p_gebuehr: gebuehr,
      p_faellig_am: faelligAm ?? null,
      p_pdf_url: pdfUrl,
      p_gesendet_an: gesendetAn,
    });
    if (error) throw error;
    return data;
  },
};

// ── Beleg-Versand per E-Mail (MS365 / Microsoft Graph) ───────────
// Wiederverwendung der generischen Edge Function `le-send-via-ms365`.
export const belegMailApi = {
  send: async ({ to, subject, html, attachmentUrl, attachmentFilename }) => {
    const { data, error } = await supabase.functions.invoke('le-send-via-ms365', {
      body: { to, subject, html, attachmentUrl, attachmentFilename },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  },
};
