import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requiresMfa, setRequiresMfa] = useState(null);

  // Neuer State für gecachte Berechtigungen (z.B. erlaubte Pfade oder Module)
  const [allowedRoutes, setAllowedRoutes] = useState([]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      handleAuthLogic(session);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Auth event: ", JSON.stringify(_event))
      handleAuthLogic(session);
    });

    const handleAuthLogic = async (session) => {
      const user = session?.user ?? null;
      if (user) {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (error) {
          console.error(error);
          setLoading(false);
          setUser(null);
          return;
        }

        if (data.currentLevel === 'aal1' && data.nextLevel === 'aal2') {
          setLoading(false);
          setRequiresMfa(true);
        } else {
          setRequiresMfa(false);
          loadProfile(user.id, user);
        }
      } else {
        setProfile(null);
        setAllowedRoutes([]);
        setLoading(false);
        setUser(null);
      }
    };

    checkUser();

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId, user) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) {
      setProfile(data);
      setUser(user);
      await fetchPermissions(data);
    }
    setLoading(false);
  }

  async function fetchPermissions(userProfile) {
    try {
      const { data, error } = await supabase.rpc('get_user_permissions', {
        user_id: userProfile.id
      });

      if (error) throw error;

      setAllowedRoutes(data || []);
    } catch (err) {
      // Fail-open: die DB-Funktion get_user_permissions ist auf Produktion (noch)
      // nicht vorhanden. Ohne Fallback bleibt allowedRoutes leer und blockiert
      // die komplette App (weisser Screen nach dem Login). Bis die Migration
      // sauber nachgezogen ist, gilt daher wieder die alte Rollenlogik.
      console.error("Fehler beim Laden der Berechtigungen:", err);
      setAllowedRoutes(userProfile.role === 'extern' ? ['/fibu'] : ['*']);
    }
  }

  // Die Prüffunktion für die ProtectedRoute
  function hasPermission(pathname) {
    if (!profile) return false;
    if (allowedRoutes.includes('*')) return true;

    return allowedRoutes.some(route => pathname.startsWith(route));
  }

  // Zusätzliche Methode, um ohne Umleitung zu prüfen ob Zugriff besteht
  function canAccessRoute(pathname) {
    if (!profile) return false;
    if (allowedRoutes.includes('*')) return true;
    return allowedRoutes.some(route => pathname.startsWith(route));
  }

  function getFirstAllowedRoute() {
    return allowedRoutes[0] || '/Login';
  }

  async function login(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async function checkMFA() {
    return await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  async function signOut() {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      console.error("Logout fehlgeschlagen:", error);
      return;
    }
    setUser(null);
    setAllowedRoutes([]);
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
        .from('profiles').update(updates).eq('id', user.id).select().single();
    if (error) throw error;
    setProfile(data);
    return data;
  }

  return (
      <AuthContext.Provider value={{ user, profile, loading, login, requiresMfa, signOut, updateProfile, hasPermission, canAccessRoute, getFirstAllowedRoute }}>
        {children}
      </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}