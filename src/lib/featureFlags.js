// Feature Flags
// Default für jedes Flag wählbar:
//   readWithDefault(key, true)  → Standard AN, nur "false" deaktiviert
//   readWithDefault(key, false) → Standard AUS, nur "true" aktiviert
// Nutzung: import { FEATURE_LEISTUNGSERFASSUNG } from '@/lib/featureFlags';

const readWithDefault = (key, defaultValue) => {
  const raw = String(import.meta.env?.[key] ?? '').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return defaultValue;
};

// Leistungserfassung ist produktiv → Standard AN. Setze
// VITE_FEATURE_LEISTUNGSERFASSUNG=false in Vercel um sie zu verstecken.
export const FEATURE_LEISTUNGSERFASSUNG = readWithDefault('VITE_FEATURE_LEISTUNGSERFASSUNG', true);

// FIBU noch in Entwicklung → Standard AUS, nur lokal aktivierbar.
export const FEATURE_FIBU = readWithDefault('VITE_FEATURE_FIBU', false);
