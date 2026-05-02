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
    const { data } = await supabase
      .from('fibu_user_mandant_access')
      .select('role')
      .eq('mandant_id', mandantId)
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
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr)')
      .eq('mandant_id', mandantId)
      .in('status', ['offen', 'teilbezahlt'])
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
      .or(`status.in.(offen,teilbezahlt),and(status.eq.bezahlt,bezahlt_am.gt.${stichtag})`)
      .order('faelligkeit');
    if (error) throw error;
    return data ?? [];
  },

  listAll: async (mandantId, von, bis) => {
    let q = supabase
      .from('fibu_kreditoren_belege')
      .select('*, lieferant:fibu_lieferanten(id,name,nr)')
      .eq('mandant_id', mandantId)
      .order('belegdatum', { ascending: false });
    if (von) q = q.gte('belegdatum', von);
    if (bis) q = q.lte('belegdatum', bis);
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
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .insert({ ...beleg, mandant_id: mandantId })
      .select()
      .single();
    if (error) throw error;
    if (positionen?.length) {
      const pos = positionen.map((p, i) => ({
        ...p, mandant_id: mandantId, beleg_id: data.id, position: i + 1,
      }));
      const { error: posErr } = await supabase.from('fibu_kreditoren_positionen').insert(pos);
      if (posErr) throw posErr;
    }
    return data;
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('fibu_kreditoren_belege')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  markBezahlt: async (id, betrag, bezahltAm) => {
    const { data: beleg } = await supabase
      .from('fibu_kreditoren_belege')
      .select('betrag_brutto, betrag_bezahlt')
      .eq('id', id)
      .single();
    const neuBezahlt = (beleg?.betrag_bezahlt ?? 0) + betrag;
    const status = neuBezahlt >= beleg?.betrag_brutto ? 'bezahlt' : 'teilbezahlt';
    return kreditorenApi.update(id, {
      betrag_bezahlt: neuBezahlt,
      bezahlt_am: bezahltAm ?? new Date().toISOString().slice(0, 10),
      status,
    });
  },

  nextBelegNr: async (mandantId) => {
    const year = new Date().getFullYear();
    const { data } = await supabase
      .from('fibu_kreditoren_belege')
      .select('beleg_nr')
      .eq('mandant_id', mandantId)
      .like('beleg_nr', `KR-${year}-%`)
      .order('beleg_nr', { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = parseInt(data?.beleg_nr?.split('-')[2] ?? '0', 10);
    return `KR-${year}-${String(last + 1).padStart(4, '0')}`;
  },

  // Vorsteuer für ein Quartal
  vorsteuerQuartal: async (mandantId, quartal, jahr) => {
    const monat = (quartal - 1) * 3 + 1;
    const von = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    const bis = `${jahr}-${String(monat + 2).padStart(2, '0')}-31`;
    const { data, error } = await supabase
      .from('fibu_kreditoren_positionen')
      .select('betrag_mwst, beleg:fibu_kreditoren_belege!inner(mandant_id, belegdatum)')
      .eq('fibu_kreditoren_belege.mandant_id', mandantId)
      .gte('fibu_kreditoren_belege.belegdatum', von)
      .lte('fibu_kreditoren_belege.belegdatum', bis);
    if (error) throw error;
    return (data ?? []).reduce((s, r) => s + (r.betrag_mwst ?? 0), 0);
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

// ── Zahlungsläufe ────────────────────────────────────────────────
export const zahlungslaufApi = {
  create: async (mandantId, lauf, positionen) => {
    const { data, error } = await supabase
      .from('fibu_zahlungslaeufe')
      .insert({ ...lauf, mandant_id: mandantId })
      .select()
      .single();
    if (error) throw error;
    if (positionen?.length) {
      await supabase.from('fibu_zahlungslauf_positionen').insert(
        positionen.map(p => ({ ...p, mandant_id: mandantId, zahlungslauf_id: data.id }))
      );
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
};
