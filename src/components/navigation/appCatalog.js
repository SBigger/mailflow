// ── Zentraler App-Katalog ──────────────────────────────────────────
// Eine Quelle für Sidebar UND App-Launcher.
// `name`       → MailFlow-Seite (Route /<Name>)
// `fibu`       → Unterseite im FiBu-Modul (öffnet zuletzt benutzten Mandanten)
// `rail`       → erscheint auch in der schmalen Icon-Leiste
// `requiresAi` → nur sichtbar wenn profile.modules.ai aktiv ist
// `aliases`    → zusätzliche Suchbegriffe für den Launcher
import {
  LayoutDashboard,
  Mail,
  CheckSquare,
  Settings as SettingsIcon,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  LifeBuoy,
  BookOpen,
  FolderOpen,
  FolderArchive,
  Wrench,
  CloudUpload,
  BarChart3,
  Clock,
  BookMarked,
  BookText,
  Bot,
  MessageSquare,
  Receipt,
  FileText,
  FileCheck,
  FileSignature,
  Landmark,
  Database,
  Archive,
  Percent,
  Scale,
  PenLine,
  Presentation,
  BookUser,
  Car,
  Sparkles,
  ScrollText,
  PhoneCall,
  Users,
  ShieldCheck,
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";
import { scheduleNavPrefsSave } from "./navPrefsSync";

export const NAV_GROUPS = [
  {
    id: 'start', label: null, color: '#7a9b7f', items: [
      { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, rail: true, color: '#7a9b7f', aliases: ['start', 'home', 'übersicht'] },
    ],
  },
  {
    id: 'arbeit', label: 'Arbeit', color: '#4e79a7', items: [
      { name: 'MailKanban', label: 'Mails', icon: Mail, rail: true, color: '#4e79a7', aliases: ['email', 'e-mail', 'posteingang outlook', 'kanban'] },
      { name: 'TaskBoard', label: 'Tasks', icon: CheckSquare, rail: true, color: '#2f9e77', aliases: ['aufgaben', 'todo', 'pendenzen'] },
      { name: 'Chartis', label: 'Chartis', icon: MessageSquare, rail: true, color: '#c65b8a', aliases: ['chat', 'nachrichten', 'kommunikation'] },
      { name: 'TicketBoard', label: 'Tickets', icon: LifeBuoy, rail: true, color: '#e07b39', aliases: ['support', 'anfragen'] },
      { name: 'Fristen', label: 'Fristen', icon: CalendarClock, rail: true, color: '#c94f4f', aliases: ['deadline', 'termine', 'fristverlängerung', 'steuerfristen'] },
      { name: 'Kalender', label: 'Kalender', icon: CalendarDays, color: '#5b6fc9', aliases: ['termine', 'agenda'] },
      ...(FEATURE_LEISTUNGSERFASSUNG ? [{ name: 'Leistungserfassung', label: 'Leistungserfassung', icon: Clock, rail: true, color: '#2e9aa8', aliases: ['stunden', 'zeiterfassung', 'rapport', 'le'] }] : []),
    ],
  },
  {
    id: 'kunden', label: 'Kunden', color: '#d98836', items: [
      { name: 'Kunden', label: 'Kunden', icon: Building2, rail: true, color: '#d98836', aliases: ['crm', 'mandanten', 'firmen', 'unternehmen'] },
      { name: 'Personen', label: 'Personen', icon: Users, color: '#8a63c9', aliases: ['privatpersonen', 'kontakte'] },
      { name: 'Dokumente', label: 'E-Binder', icon: FolderOpen, rail: true, color: '#caa53d', aliases: ['dokumente', 'ablage', 'dateiablage', 'dateien', 'abschlussunterlagen', 'archiv', 'e-binder', 'ebinder'] },
      /*{ name: 'DokumenteV2', label: 'Dokumente V2', icon: FolderOpen, color: '#a8862f', aliases: ['ablage neu', 'beta'] },*/
      { name: 'Posteingang', label: 'Paperboy', icon: CloudUpload, rail: true, color: '#4ba3c7', aliases: ['posteingang', 'scans', 'upload', 'eingang', 'paperboy'] },
      { name: 'Kundenportal', label: 'Kundenportal', icon: ShieldCheck, color: '#0e756a', aliases: ['portal', 'kundenzugang', 'freigabe', 'read-only', 'kundenlogin'] },
      { name: 'TelefonDashboard', label: 'Telefon', icon: PhoneCall, color: '#4fae6b', aliases: ['anrufe', 'telefonliste', 'calls'] },
    ],
  },
  {
    id: 'fibu', label: 'Buchhaltung', color: '#8a6bbf', items: [
      { fibu: null, label: 'Mandanten', icon: BookMarked, rail: true, color: '#8a6bbf', aliases: ['fibu', 'buchhaltung', 'finanzbuchhaltung', 'mandant wechseln'] },
      { fibu: 'kreditoren/uebersicht', label: 'Kreditoren', icon: Receipt, color: '#c9564f', aliases: ['kredi', 'lieferantenrechnungen', 'eingangsrechnungen', 'zahlungen'] },
      { fibu: 'debitoren/uebersicht', label: 'Debitoren', icon: FileText, color: '#3e9b6e', aliases: ['debi', 'faktura', 'rechnungen stellen', 'kundenrechnungen'] },
      { fibu: 'bankabstimmung', label: 'E-Banking', icon: Landmark, color: '#3f7fc2', aliases: ['bank', 'bankabstimmung', 'camt', 'abgleich'] },
      { fibu: 'kreditoren/journal', label: 'Auswertungen FiBu', icon: BookText, color: '#a35bb0', aliases: ['belegjournal', 'bilanz', 'erfolgsrechnung', 'kontoblätter', 'op-liste', 'mwst'] },
      { fibu: 'jahresabschluss', label: 'Jahresabschluss', icon: FolderArchive, color: '#d98836', aliases: ['abschluss', 'abschlussunterlagen', 'abschluss-kontenplan', 'jr'] },
      { fibu: 'manuelle-buchungen', label: 'Hauptbuch', icon: BookOpen, color: '#6b7fc9', aliases: ['buchungen', 'kassenbuch', 'saldovorträge', 'budget'] },
      { fibu: 'kontenplan', label: 'Stammdaten', icon: Database, color: '#6f8a99', aliases: ['kontenplan', 'mwst-codes', 'wechselkurse', 'zahlstellen'] },
      { name: 'Anlagebuchhaltung', label: 'Anlagebuchhaltung', icon: Archive, color: '#a08a4f', aliases: ['anlagen', 'abschreibungen', 'afa'] },
    ],
  },
  {
    id: 'steuern', label: 'Steuern', color: '#c25b5b', items: [
      { name: 'Steuern', label: 'Steuererklärungen', icon: Percent, color: '#c25b5b', aliases: ['ste', 'steuern', 'taxes'] },
      { name: 'Veranlagungen', label: 'Veranlagungen', icon: FileCheck, color: '#d67f3c', aliases: ['veranlagung', 'einschätzung'] },
      { name: 'Steuerausscheidung', label: 'Steuerausscheidung', icon: Scale, color: '#9c5bc2', aliases: ['ausscheidung', 'interkantonal'] },
    ],
  },
  {
    id: 'planung', label: 'Planung & Auswertung', color: '#3d9b8f', items: [
      { name: 'Auswertungen', label: 'Auswertungen', icon: BarChart3, rail: true, color: '#3d9b8f', aliases: ['reports', 'statistik', 'kennzahlen'] },
      { name: 'Jahresplanung', label: 'Jahresplanung', icon: CalendarRange, color: '#4a8ec2', aliases: ['planung jahr'] },
      { name: 'Monatsplanung', label: 'Einsatzplanung', icon: CalendarCheck, color: '#5bb06a', aliases: ['monatsplanung', 'einsätze', 'ressourcen'] },
      { name: 'Abschlussdokumentation', label: 'Abschlussdokumentation', icon: FolderArchive, color: '#b08a3d', aliases: ['abschlussdoku', 'dokumentation'] },
    ],
  },
  {
    id: 'tools', label: 'Tools', color: '#7b8794', items: [
      { name: 'BriefSchreiben', label: 'Briefe schreiben', icon: PenLine, color: '#5b8ac9', aliases: ['brief', 'korrespondenz', 'vorlagen'] },
      { name: 'Whiteboard', label: 'Whiteboard', icon: Presentation, color: '#e0913d', aliases: ['zeichnen', 'skizze', 'board'] },
      { name: 'GVProtokollApp', label: 'GV-Protokoll', icon: ScrollText, color: '#b05b7e', aliases: ['generalversammlung', 'protokoll', 'transkript'] },
      { name: 'Firmensuche', label: 'Firmensuche', icon: Building2, color: '#3d7fa6', aliases: ['zefix', 'handelsregister', 'shab', 'uid', 'revisionsstelle', 'revisionsmandate', 'branche', 'firmenrecherche'] },
      { name: 'Aktienbuch', label: 'Aktienbuch', icon: BookUser, color: '#7d9b45', aliases: ['aktien', 'aktionäre'] },
      { name: 'Fahrzeugliste', label: 'Fahrzeugliste', icon: Car, color: '#4fa3b8', aliases: ['autos', 'fahrzeuge'] },
      { name: 'Unterschriften', label: 'Unterschriften', icon: FileSignature, color: '#8a63c9', aliases: ['signatur', 'skribble', 'signieren'] },
      { name: 'Promptvorlagen', label: 'Promptvorlagen', icon: Sparkles, color: '#d4a03d', aliases: ['ki-vorlagen', 'prompts'] },
      { name: 'ArtisTools', label: 'Alle Tools', icon: Wrench, rail: true, color: '#7b8794', aliases: ['werkzeuge', 'tools übersicht'] },
    ],
  },
  {
    id: 'system', label: null, color: '#7b8794', items: [
      { name: 'KnowledgeBase', label: 'Wissen', icon: BookOpen, rail: false, color: '#4a9e9a', aliases: ['knowledge', 'wiki', 'anleitungen'] },
      { name: 'AiAssistant', label: 'AI-Assistant', icon: Bot, rail: true, requiresAi: true, color: '#7a5bd4', aliases: ['ki', 'assistent', 'ai'] },
      { name: 'Settings', label: 'Einstellungen', icon: SettingsIcon, rail: true, color: '#7b8794', aliases: ['settings', 'konfiguration', 'optionen'] },
    ],
  },
];

// Gruppen, die beim ersten Start in der Sidebar aufgeklappt sind:
// alle — damit jede App sofort sichtbar ist. Zuklappen bleibt Sache des Nutzers.
export const DEFAULT_OPEN = { start: true, arbeit: true, kunden: true, fibu: true, steuern: true, planung: true, tools: true, system: true };

// FiBu-Links öffnen den zuletzt benutzten Mandanten direkt;
// ohne bekannten Mandanten landet man auf der Mandanten-Auswahl.
export function fibuHref(sub) {
  const id = localStorage.getItem('fibu_last_mandant');
  if (!id || !sub) return '/fibu';
  return `/fibu/${id}/${sub}`;
}

export function itemHref(item) {
  if (item.href) return item.href;
  if (item.name) return createPageUrl(item.name);
  return fibuHref(item.fibu);
}

export function appKey(item) {
  return item.name ?? `fibu:${item.fibu ?? 'select'}`;
}

// AI-Modul nur anzeigen, wenn freigeschaltet
export function visibleItems(items, profile) {
  return items.filter(it => !it.requiresAi || profile?.modules?.ai);
}

// Flache Liste aller sichtbaren Apps, angereichert mit Gruppen-Infos (für den Launcher)
export function allApps(profile) {
  return NAV_GROUPS.flatMap(g =>
    visibleItems(g.items, profile).map(item => ({
      ...item,
      groupId: g.id,
      groupLabel: g.label ?? 'Smartis',
      groupColor: g.color,
      color: item.color ?? g.color,
    }))
  );
}

// ── Frecency: lernt, welche Apps du wirklich nutzt ─────────────────
// Score = Anzahl Aufrufe × exponentieller Zeitzerfall (Halbwertszeit ~14 Tage).
const FRECENCY_KEY = 'app_frecency';

function readFrecency() {
  try {
    return JSON.parse(localStorage.getItem(FRECENCY_KEY)) || {};
  } catch {
    return {};
  }
}

export function recordAppOpen(item) {
  try {
    const data = readFrecency();
    const key = appKey(item);
    const prev = data[key] || { n: 0, t: 0 };
    data[key] = { n: Math.min(prev.n + 1, 500), t: Date.now() };
    localStorage.setItem(FRECENCY_KEY, JSON.stringify(data));
  } catch {
    // localStorage voll/gesperrt → Tracking einfach auslassen
  }
}

// ── Favoriten: explizit angepinnte Apps (rechte Dock-Leiste) ───────
const FAVORITES_KEY = 'app_favorites';

export function getFavoriteKeys() {
  try {
    const a = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeFavorites(keys) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(keys));
  } catch {
    return;
  }
  // Dock und Launcher live synchron halten + ins Profil sichern
  window.dispatchEvent(new CustomEvent('smartis:favorites-changed'));
  scheduleNavPrefsSave();
}

export function isFavorite(item) {
  return getFavoriteKeys().includes(appKey(item));
}

export function toggleFavorite(item) {
  const k = appKey(item);
  const cur = getFavoriteKeys();
  writeFavorites(cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);
}

// Neue Reihenfolge der Favoriten übernehmen (Drag & Drop im Hub/Dock)
export function reorderFavorites(orderedKeys) {
  const known = new Set(getFavoriteKeys());
  const clean = orderedKeys.filter(k => known.has(k));
  // fehlende (falls parallel etwas dazu kam) hinten anhängen
  const rest = [...known].filter(k => !clean.includes(k));
  writeFavorites([...clean, ...rest]);
}

export function favoriteApps(profile) {
  const map = new Map(allApps(profile).map(a => [appKey(a), a]));
  return getFavoriteKeys().map(k => map.get(k)).filter(Boolean);
}

export function frecencyTop(apps, count = 6) {
  const data = readFrecency();
  const now = Date.now();
  const scored = apps
    .map(app => {
      const e = data[appKey(app)];
      if (!e) return null;
      const ageDays = (now - e.t) / 86400000;
      return { app, score: e.n * Math.exp(-ageDays / 14) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.app);
}
