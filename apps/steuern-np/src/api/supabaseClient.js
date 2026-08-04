/**
 * Supabase-Client für die Steuern-nP-App.
 *
 * Eigenes Supabase-Projekt, bewusst getrennt von MailFlow: Steuerdaten
 * unterliegen dem Steuergeheimnis und liegen deshalb in einer eigenen
 * Datenbank mit eigener Auth (siehe docs/recherche-und-architektur.md §10).
 *
 * Anders als MailFlow (window.env zur Laufzeit) nutzt diese App die
 * Vite-Umgebungsvariablen — es gibt keinen Electron-/Tauri-Wrapper, der
 * die Konfiguration nachträglich injizieren müsste.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Laut scheitern statt still auf die falsche Datenbank zeigen.
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen. ' +
    'Siehe .env.example — es muss das eigene Steuer-Projekt sein, nicht MailFlow.'
  );
}

export const supabase = createClient(url, key);
