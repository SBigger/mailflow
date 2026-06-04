// Anmelde-Prüfung (Supabase Auth).
// Das Frontend meldet sich mit E-Mail + Passwort an und schickt bei jedem
// API-Aufruf den Zugriffs-Token (Bearer) mit. Hier wird er serverseitig geprüft.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export function authConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Diese Werte sind für den Browser bestimmt (der anon-/publishable-Key ist öffentlich).
export function getPublicConfig() {
  return { supabaseUrl: SUPABASE_URL || null, supabaseAnonKey: SUPABASE_ANON_KEY || null };
}

let _authClient = null;
function authClient() {
  if (_authClient) return _authClient;
  if (!authConfigured()) {
    throw new Error('Login ist nicht konfiguriert – bitte SUPABASE_URL und SUPABASE_ANON_KEY setzen.');
  }
  _authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return _authClient;
}

// Express-Middleware: lässt nur Anfragen mit gültigem Token durch.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
    const { data, error } = await authClient().auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Sitzung ungültig – bitte neu anmelden.' });
    req.user = data.user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
