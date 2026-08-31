import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { mandantenApi } from '../api';

const MandantContext = createContext(null);

export function MandantProvider({ children }) {
  const { mandantId } = useParams();
  const navigate = useNavigate();
  // Externer Kundenbenutzer? Dann gibt es ausserhalb der FiBu nichts zu sehen —
  // Wege nach draussen werden in der Oberflaeche ausgeblendet.
  const { profile } = useAuth();
  const isExtern = profile?.role === 'extern';
  const [mandant, setMandant] = useState(null);
  const [mandanten, setMandanten] = useState([]);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Alle zugänglichen Mandanten laden
  useEffect(() => {
    mandantenApi.list()
      .then(setMandanten)
      .catch(err => setError(err.message));
  }, []);

  // Aktiven Mandanten laden sobald mandantId in URL steht
  useEffect(() => {
    if (!mandantId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      mandantenApi.get(mandantId),
      mandantenApi.getUserRole(mandantId),
    ])
      .then(([m, r]) => {
        setMandant(m);
        setRole(r);
        // Zuletzt benutzten Mandanten merken — die Haupt-Sidebar
        // verlinkt damit direkt in Kreditoren/Debitoren etc.
        localStorage.setItem('fibu_last_mandant', mandantId);
      })
      .catch(err => {
        // Kein Zugriff (RLS liefert keine Zeile) → PostgREST meldet das als
        // "Cannot coerce the result to a single JSON object". Das ist fuer den
        // Benutzer nichtssagend; typischer Fall ist ein alter oder geteilter Link.
        const keinZugriff = /coerce the result|multiple \(or no\) rows|PGRST116/i.test(err.message ?? '');
        setError(keinZugriff
          ? 'Kein Zugriff auf diesen Mandanten. Bitte einen Mandanten aus der Liste wählen.'
          : err.message);
        if (localStorage.getItem('fibu_last_mandant') === mandantId) {
          localStorage.removeItem('fibu_last_mandant');
        }
      })
      .finally(() => setLoading(false));
  }, [mandantId]);

  const switchMandant = useCallback((id) => {
    navigate(`/fibu/${id}/kreditoren`);
  }, [navigate]);

  const canWrite = role === 'admin' || role === 'buchhalter';
  const isAdmin = role === 'admin';

  return (
    <MandantContext.Provider value={{
      mandant, mandanten, role, loading, error,
      canWrite, isAdmin, isExtern, switchMandant, profile
    }}>
      {children}
    </MandantContext.Provider>
  );
}

export function useMandant() {
  const ctx = useContext(MandantContext);
  if (!ctx) throw new Error('useMandant must be used inside MandantProvider');
  return ctx;
}
