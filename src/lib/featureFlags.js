// Feature Flags
// Standard: alles AUS. Aktivierung nur über .env / Vercel-Env-Vars.
// Nutzung: import { FEATURE_LEISTUNGSERFASSUNG } from '@/lib/featureFlags';

const read = (key) => String(import.meta.env?.[key] ?? '').toLowerCase() === 'true';

export const FEATURE_LEISTUNGSERFASSUNG = read('VITE_FEATURE_LEISTUNGSERFASSUNG');
