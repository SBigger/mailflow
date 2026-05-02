import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mandantenApi } from '../api';

const MandantContext = createContext(null);

export function MandantProvider({ children }) {
  const { mandantId } = useParams();
  const navigate = useNavigate();
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
      .then(([m, r]) => { setMandant(m); setRole(r); })
      .catch(err => setError(err.message))
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
      canWrite, isAdmin, switchMandant,
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
