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
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";

export const NAV_GROUPS = [
  {
    id: 'start', label: null, color: '#7a9b7f', items: [
      { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, rail: true, aliases: ['start', 'home', 'übersicht'] },
    ],
  },
  {
    id: 'arbeit', label: 'Arbeit', color: '#4e79a7', items: [
      { name: 'MailKanban', label: 'Mails', icon: Mail, rail: true, aliases: ['email', 'e-mail', 'posteingang outlook', 'kanban'] },
      { name: 'TaskBoard', label: 'Tasks', icon: CheckSquare, rail: true, aliases: ['aufgaben', 'todo', 'pendenzen'] },
      { name: 'Chartis', label: 'Chartis', icon: MessageSquare, rail: true, aliases: ['chat', 'nachrichten', 'kommunikation'] },
      { name: 'TicketBoard', label: 'Tickets', icon: LifeBuoy, rail: true, aliases: ['support', 'anfragen'] },
      { name: 'Fristen', label: 'Fristen', icon: CalendarClock, rail: true, aliases: ['deadline', 'termine', 'fristverlängerung', 'steuerfristen'] },
      { name: 'Kalender', label: 'Kalender', icon: CalendarDays, aliases: ['termine', 'agenda'] },
      ...(FEATURE_LEISTUNGSERFASSUNG ? [{ name: 'Leistungserfassung', label: 'Leistungserfassung', icon: Clock, rail: true, aliases: ['stunden', 'zeiterfassung', 'rapport', 'le'] }] : []),
    ],
  },
  {
    id: 'kunden', label: 'Kunden', color: '#d98836', items: [
      { name: 'Kunden', label: 'Kunden', icon: Building2, rail: true, aliases: ['crm', 'mandanten', 'firmen', 'unternehmen'] },
      { name: 'Personen', label: 'Personen', icon: Users, aliases: ['privatpersonen', 'kontakte'] },
      { name: 'Dokumente', label: 'Dokumente', icon: FolderOpen, rail: true, aliases: ['ablage', 'dateiablage', 'dateien', 'abschlussunterlagen', 'archiv'] },
      { name: 'DokumenteV2', label: 'Dokumente V2', icon: FolderOpen, aliases: ['ablage neu', 'beta'] },
      { name: 'Posteingang', label: 'Posteingang', icon: CloudUpload, rail: true, aliases: ['scans', 'upload', 'eingang'] },
      { name: 'TelefonDashboard', label: 'Telefon', icon: PhoneCall, aliases: ['anrufe', 'telefonliste', 'calls'] },
    ],
  },
  {
    id: 'fibu', label: 'Buchhaltung', color: '#8a6bbf', items: [
      { fibu: null, label: 'Mandanten', icon: BookMarked, rail: true, aliases: ['fibu', 'buchhaltung', 'finanzbuchhaltung', 'mandant wechseln'] },
      { fibu: 'kreditoren/uebersicht', label: 'Kreditoren', icon: Receipt, aliases: ['kredi', 'lieferantenrechnungen', 'eingangsrechnungen', 'zahlungen'] },
      { fibu: 'debitoren/uebersicht', label: 'Debitoren', icon: FileText, aliases: ['debi', 'faktura', 'rechnungen stellen', 'kundenrechnungen'] },
      { fibu: 'bankabstimmung', label: 'E-Banking', icon: Landmark, aliases: ['bank', 'bankabstimmung', 'camt', 'abgleich'] },
      { fibu: 'kreditoren/journal', label: 'Auswertungen FiBu', icon: BookText, aliases: ['belegjournal', 'bilanz', 'erfolgsrechnung', 'kontoblätter', 'op-liste', 'mwst'] },
      { fibu: 'jahresabschluss', label: 'Jahresabschluss', icon: FolderArchive, aliases: ['abschluss', 'abschlussunterlagen', 'abschluss-kontenplan', 'jr'] },
      { fibu: 'manuelle-buchungen', label: 'Hauptbuch', icon: BookOpen, aliases: ['buchungen', 'kassenbuch', 'saldovorträge', 'budget'] },
      { fibu: 'kontenplan', label: 'Stammdaten', icon: Database, aliases: ['kontenplan', 'mwst-codes', 'wechselkurse', 'zahlstellen'] },
      { name: 'Anlagebuchhaltung', label: 'Anlagebuchhaltung', icon: Archive, aliases: ['anlagen', 'abschreibungen', 'afa'] },
    ],
  },
  {
    id: 'steuern', label: 'Steuern', color: '#c25b5b', items: [
      { name: 'Steuern', label: 'Steuererklärungen', icon: Percent, aliases: ['ste', 'steuern', 'taxes'] },
      { name: 'Veranlagungen', label: 'Veranlagungen', icon: FileCheck, aliases: ['veranlagung', 'einschätzung'] },
      { name: 'Steuerausscheidung', label: 'Steuerausscheidung', icon: Scale, aliases: ['ausscheidung', 'interkantonal'] },
    ],
  },
  {
    id: 'planung', label: 'Planung & Auswertung', color: '#3d9b8f', items: [
      { name: 'Auswertungen', label: 'Auswertungen', icon: BarChart3, rail: true, aliases: ['reports', 'statistik', 'kennzahlen'] },
      { name: 'Jahresplanung', label: 'Jahresplanung', icon: CalendarRange, aliases: ['planung jahr'] },
      { name: 'Monatsplanung', label: 'Einsatzplanung', icon: CalendarCheck, aliases: ['monatsplanung', 'einsätze', 'ressourcen'] },
      { name: 'Abschlussdokumentation', label: 'Abschlussdokumentation', icon: FolderArchive, aliases: ['abschlussdoku', 'dokumentation'] },
    ],
  },
  {
    id: 'tools', label: 'Tools', color: '#7b8794', items: [
      { name: 'BriefSchreiben', label: 'Briefe schreiben', icon: PenLine, aliases: ['brief', 'korrespondenz', 'vorlagen'] },
      { name: 'Whiteboard', label: 'Whiteboard', icon: Presentation, aliases: ['zeichnen', 'skizze', 'board'] },
      { name: 'GVProtokollApp', label: 'GV-Protokoll', icon: ScrollText, aliases: ['generalversammlung', 'protokoll', 'transkript'] },
      { name: 'Aktienbuch', label: 'Aktienbuch', icon: BookUser, aliases: ['aktien', 'aktionäre'] },
      { name: 'Fahrzeugliste', label: 'Fahrzeugliste', icon: Car, aliases: ['autos', 'fahrzeuge'] },
      { name: 'Unterschriften', label: 'Unterschriften', icon: FileSignature, aliases: ['signatur', 'skribble', 'signieren'] },
      { name: 'Promptvorlagen', label: 'Promptvorlagen', icon: Sparkles, aliases: ['ki-vorlagen', 'prompts'] },
      { name: 'ArtisTools', label: 'Alle Tools', icon: Wrench, rail: true, aliases: ['werkzeuge', 'tools übersicht'] },
    ],
  },
  {
    id: 'system', label: null, color: '#7b8794', items: [
      { name: 'KnowledgeBase', label: 'Wissen', icon: BookOpen, rail: true, aliases: ['knowledge', 'wiki', 'anleitungen'] },
      { name: 'AiAssistant', label: 'AI-Assistant', icon: Bot, rail: true, requiresAi: true, aliases: ['ki', 'assistent', 'ai'] },
      { name: 'Settings', label: 'Einstellungen', icon: SettingsIcon, rail: true, aliases: ['settings', 'konfiguration', 'optionen'] },
    ],
  },
];

// Gruppen, die beim ersten Start in der Sidebar aufgeklappt sind
export const DEFAULT_OPEN = { start: true, arbeit: true, kunden: true, fibu: true, steuern: false, planung: false, tools: false, system: true };

// FiBu-Links öffnen den zuletzt benutzten Mandanten direkt;
// ohne bekannten Mandanten landet man auf der Mandanten-Auswahl.
export function fibuHref(sub) {
  const id = localStorage.getItem('fibu_last_mandant');
  if (!id || !sub) return '/fibu';
  return `/fibu/${id}/${sub}`;
}

export function itemHref(item) {
  if (item.name) return item.href ?? createPageUrl(item.name);
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
  // Dock und Launcher live synchron halten
  window.dispatchEvent(new CustomEvent('smartis:favorites-changed'));
}

export function isFavorite(item) {
  return getFavoriteKeys().includes(appKey(item));
}

export function toggleFavorite(item) {
  const k = appKey(item);
  const cur = getFavoriteKeys();
  writeFavorites(cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);
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
