import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requiresMfa, setRequiresMfa] = useState(null);
  const [inviteIncomplete, setInviteIncomplete] = useState(null);

  // Neuer State für gecachte Berechtigungen (z.B. erlaubte Pfade oder Module)
  const [allowedRoutes, setAllowedRoutes] = useState([]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      handleAuthLogic(session);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthLogic(session);
    });

    const handleAuthLogic = async (session) => {
      const user = session?.user ?? null;
      if (user) {
        setInviteIncomplete(null);
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (error) {
          console.error(error);
          setLoading(false);
          setUser(null);
          return;
        }

        if (data.currentLevel === 'aal1' && data.nextLevel === 'aal2') {
          setRequiresMfa(true);
          setLoading(false);
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
    if(data && data.inviteState === 1) {
      setInviteIncomplete(data.email ?? user?.email ?? '');
      setProfile(null);
      setUser(null);
      supabase.auth.signOut();
    } else if (data) {
      setProfile(data);
      setUser(user);
      // Berechtigungen einmalig beim Login/Profil-Laden vom Backend abrufen
      await fetchPermissions(data);
    } else {
      setProfile(null);
      setUser(null);
      supabase.auth.signOut();
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
      console.error("Fehler beim Laden der Berechtigungen:", err);
      setAllowedRoutes([]);
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

    return allowedRoutes.some(route => {
      // Exakter Treffer
      if (route === pathname) return true;

      // Wildcard-Prüfung (z. B. wenn in allowedRoutes '/fibu/*' steht)
      if (route.endsWith('/*')) {
        const basePath = route.slice(0, -2); // schneidet '/*' ab
        return pathname === basePath || pathname.startsWith(basePath + '/');
      }

      return false;
    });
  }

  function getFirstAllowedRoute() {
    return allowedRoutes[0] || '/Login';
  }

  async function login(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
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
      <AuthContext.Provider value={{ user, profile, loading, login, checkMFA, signOut, updateProfile, requiresMfa, inviteIncomplete, setInviteIncomplete, hasPermission, canAccessRoute, getFirstAllowedRoute }}>
        {children}
      </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}