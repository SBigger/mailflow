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
 *
 * Fehlt die Konfiguration, wirft dieses Modul NICHT beim Import. Sonst
 * liesse sich der Demo-Modus unter /demo nicht öffnen, der bewusst ohne
 * Backend auskommt. Stattdessen ist `supabase` dann null und
 * `istKonfiguriert` false — die App sagt das, statt weiss zu bleiben.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const istKonfiguriert = Boolean(url && key);

export const supabase = istKonfiguriert ? createClient(url, key) : null;

if (!istKonfiguriert) {
  console.warn(
    '[Steuern nP] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen — ' +
    'nur der Demo-Modus unter /demo ist nutzbar. Siehe .env.example.'
  );
}
