// Anmeldung & Datenzugriff über Supabase Auth – ohne Admin-Schlüssel.
// Das Frontend meldet sich mit E-Mail + Passwort an und schickt bei jedem
// API-Aufruf den Zugriffs-Token (Bearer) mit. Daraus bauen wir je Request einen
// Supabase-Client, der NUR als dieser Nutzer arbeitet (RLS greift).
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

// Supabase-Client im Kontext des angemeldeten Nutzers (RLS aktiv).
export function userClient(token) {
  if (!authConfigured()) {
    throw new Error('Supabase ist nicht konfiguriert – bitte SUPABASE_URL und SUPABASE_ANON_KEY setzen.');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Express-Middleware: prüft den Token und hängt req.user + req.sb (user-Client) an.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
    const sb = userClient(token);
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) return res.status(401).json({ error: 'Sitzung ungültig – bitte neu anmelden.' });
    req.user = data.user;
    req.sb = sb;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
