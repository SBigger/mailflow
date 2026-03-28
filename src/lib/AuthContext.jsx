import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requiresMfa, setRequiresMfa] = useState(null);

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
        // Check if MFA is required but not yet completed
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (error) {
          console.error(error);
          setLoading(false);
          return;
        }

        // If they are at AAL1 but 'next_level' is AAL2, they need to verify MFA
        if (data.currentLevel === 'aal1' && data.nextLevel === 'aal2') {
          // Option A: Set a specific state to show the MFA OTP input
          setRequiresMfa(true);
          setLoading(false);
        } else {
          // They are fully verified (AAL2) or don't have MFA enabled
          setRequiresMfa(false);
          setUser(user);
          loadProfile(user.id);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    };

    checkUser();

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data);
    setLoading(false);
  }

  async function login(email, password) {
    return  await supabase.auth.signInWithPassword({ email, password });
  }

  async function checkMFA() {
    return await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  async function signOut() {
    const { error} = await supabase.auth.signOut();
    if (error) {
      console.error("Logout fehlgeschlagen:", error);
      return;
    }
    setUser(null);
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles').update(updates).eq('id', user.id).select().single();
    if (error) throw error;
    setProfile(data);
    return data;
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, checkMFA, signOut, updateProfile, requiresMfa }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
