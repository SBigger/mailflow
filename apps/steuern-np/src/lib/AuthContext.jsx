/**
 * Auth und aktiver Mandant.
 *
 * Zwei Dinge, die zusammengehören: Ohne Anmeldung liefert RLS nichts, und
 * ohne gewählten Mandanten weiss die App nicht, in welchem Dossier sie
 * arbeitet. Beides steckt deshalb in einem Context.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, istKonfiguriert } from "@/api/supabaseClient";

const AuthContext = createContext(null);

const MANDANT_KEY = "steuern-np.mandant";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [mandanten, setMandanten] = useState([]);
  const [mandantId, setMandantIdState] = useState(
    () => localStorage.getItem(MANDANT_KEY) || null
  );

  useEffect(() => {
    // Ohne Konfiguration gibt es keine Session — die App bleibt beim
    // Demo-Modus, statt in einem Ladezustand hängen zu bleiben.
    if (!istKonfiguriert) { setLaedt(false); return; }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLaedt(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const ladeMandanten = useCallback(async () => {
    if (!session || !supabase) { setMandanten([]); return; }
    const { data, error } = await supabase
      .from("mandanten")
      .select("id, name, uid, th_id_zh")
      .eq("aktiv", true)
      .order("name");
    if (error) { console.warn("[Auth] Mandanten laden fehlgeschlagen:", error.message); return; }
    setMandanten(data || []);

    // Gespeicherte Auswahl nur behalten, wenn sie noch existiert —
    // sonst landet man auf einem Mandanten ohne Zugriff und sieht nichts.
    const gueltig = (data || []).some(m => m.id === mandantId);
    if (!gueltig) {
      const ersterId = data?.[0]?.id ?? null;
      setMandantIdState(ersterId);
      if (ersterId) localStorage.setItem(MANDANT_KEY, ersterId);
      else localStorage.removeItem(MANDANT_KEY);
    }
  }, [session, mandantId]);

  useEffect(() => { ladeMandanten(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMandantId = useCallback((id) => {
    setMandantIdState(id);
    if (id) localStorage.setItem(MANDANT_KEY, id);
    else localStorage.removeItem(MANDANT_KEY);
  }, []);

  const abmelden = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem(MANDANT_KEY);
    setMandantIdState(null);
  }, []);

  const mandant = mandanten.find(m => m.id === mandantId) || null;

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, laedt, istKonfiguriert,
      mandanten, mandant, mandantId, setMandantId,
      ladeMandanten, abmelden,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth muss innerhalb von <AuthProvider> stehen");
  return ctx;
}
