// src/modules/fibu/hooks/useSetupProgress.js
// Prüft für einen Mandanten welche Setup-Schritte bereits erledigt sind.
// Wird von SetupAssistent, FiBuSidebar und KreditorenDashboard genutzt.

import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { kontenApi, zahlstellenApi, saldovortragApi } from '../api';

export const SETUP_STEP_IDS = ['firmendaten', 'kontenplan', 'mwst', 'zahlstellen', 'saldovortraege'];
export const SETUP_TOTAL    = SETUP_STEP_IDS.length;

/**
 * Gibt zurück welche Setup-Schritte für den Mandanten bereits erledigt sind.
 * @param {string|null} mandantId
 * @param {object|null} mandant  – das mandant-Objekt aus MandantContext (für firmendaten-Check)
 * @returns {{ done: Set<string>, loading: boolean, doneCount: number, refresh: function }}
 */
export function useSetupProgress(mandantId, mandant) {
  const [done,    setDone]    = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [tick,    setTick]    = useState(0);

  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    if (!mandantId) { setLoading(false); return; }
    let cancelled = false;
    const check = async () => {
      setLoading(true);
      try {
        const jahr = new Date().getFullYear();
        const [konten, mwstRes, zahlstellen, vortrag] = await Promise.all([
          kontenApi.list(mandantId).catch(() => []),
          supabase
            .from('fibu_mwst_codes')
            .select('*', { count: 'exact', head: true })
            .eq('mandant_id', mandantId),
          zahlstellenApi.list(mandantId).catch(() => []),
          saldovortragApi.lesen(mandantId, jahr).catch(() => []),
        ]);
        if (cancelled) return;

        const result = new Set();
        // Firmendaten: Name + mindestens Adresse oder UID ausgefüllt
        if (mandant?.adresse || mandant?.uid) result.add('firmendaten');
        // Kontenplan: mindestens 1 Konto vorhanden
        if (konten.length > 0)               result.add('kontenplan');
        // MWST: mindestens 1 Code vorhanden
        if ((mwstRes.count ?? 0) > 0)        result.add('mwst');
        // Zahlstellen: mindestens 1 vorhanden
        if (zahlstellen.length > 0)          result.add('zahlstellen');
        // Saldovorträge: mindestens 1 non-zero Saldo
        if (vortrag.some(v => Number(v.saldo) !== 0)) result.add('saldovortraege');

        setDone(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [mandantId, mandant?.adresse, mandant?.uid, tick]);

  return { done, loading, doneCount: done.size, refresh };
}
