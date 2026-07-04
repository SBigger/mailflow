// Auswertungen · natives Reporting-Modul (Power BI-Ersatz)
// Produktivität (Stunden/Umsatz pro MA nach Projekttyp), Monatsrapport,
// Angefangene Arbeiten, Debitoren und Projekt-Auswertungen – direkt aus den
// Smartis-Daten (le_*-Tabellen). Der alte Power BI-Report bleibt während der
// Übergangszeit als letzter Tab erreichbar.
import React, { useState, useMemo } from 'react';
import {
  BarChart3, Users, FileText, ArrowDownCircle,
  FolderKanban, ExternalLink,
} from 'lucide-react';
import ProduktivitaetPanel from '@/components/auswertungen/ProduktivitaetPanel';
import MehrjahrePanel from '@/components/auswertungen/MehrjahrePanel';
import MonatsrapportPanel from '@/components/auswertungen/MonatsrapportPanel';
import FakturierungPanel from '@/components/auswertungen/FakturierungPanel';
import DebitorenAuswertungPanel from '@/components/auswertungen/DebitorenAuswertungPanel';
import ProjekteAuswertungPanel from '@/components/leistungserfassung/AuswertungenPanel';

// ── Power BI (Legacy) ────────────────────────────────────────────────────────
// Mit eingeschaltetem Nav-Pane, damit alle alten Report-Seiten erreichbar sind.
const PBI_EMBED =
  'https://app.powerbi.com/reportEmbed' +
  '?reportId=13a220be-5f7c-490e-9d33-c8fe2b57b438' +
  '&autoAuth=true' +
  '&ctid=cc857d96-3c6e-45ba-afbf-c20d0946d2be' +
  '&navContentPaneEnabled=true';
const PBI_DIRECT =
  'https://app.powerbi.com/groups/a39e904f-2669-4744-bac2-66286edd4221' +
  '/reports/13a220be-5f7c-490e-9d33-c8fe2b57b438';

function PowerBiLegacyPanel() {
  const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;
  const openInBrowser = () => {
    if (isTauri) {
      window.__TAURI__.core.invoke('open_external_url', { url: PBI_DIRECT }).catch(() => window.open(PBI_DIRECT, '_blank'));
    } else {
      window.open(PBI_DIRECT, '_blank');
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>
          Alter Power BI-Report («Artis Auswertungen neu») – wird durch die nativen Auswertungen abgelöst.
          Zugriff erfordert ein angemeldetes Microsoft-365-Konto mit Viewer-Rechten.
        </span>
        <button
          type="button"
          onClick={openInBrowser}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border text-xs text-zinc-600 hover:bg-zinc-50 flex-shrink-0"
          style={{ borderColor: '#d9dfd9', background: '#fff' }}
        >
          <ExternalLink className="w-3 h-3" /> In Power BI öffnen
        </button>
      </div>
      <iframe
        src={PBI_EMBED}
        title="Power BI – Artis Auswertungen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="w-full rounded-lg"
        style={{ border: '1px solid #d9e0d9', background: '#fff', height: 'calc(100vh - 210px)', minHeight: 480 }}
      />
    </div>
  );
}

// ── Navigation ───────────────────────────────────────────────────────────────
const NAV = [
  {
    id: 'produktivitaet', label: 'Produktivität', icon: Users,
    sec: [
      { id: 'uebersicht', label: 'Übersicht', comp: ProduktivitaetPanel },
      { id: 'mehrjahre', label: 'Mehrjahre', comp: MehrjahrePanel },
      { id: 'monatsrapport', label: 'Monatsrapport', comp: MonatsrapportPanel },
    ],
  },
  {
    id: 'fakturierung', label: 'Fakturierung', icon: FileText,
    sec: [{ id: 'aa', label: 'Angefangene Arbeiten', comp: FakturierungPanel }],
  },
  {
    id: 'debitoren', label: 'Debitoren', icon: ArrowDownCircle,
    sec: [{ id: 'uebersicht', label: 'Übersicht', comp: DebitorenAuswertungPanel }],
  },
  {
    id: 'projekte', label: 'Projekte', icon: FolderKanban,
    sec: [{ id: 'rentabilitaet', label: 'Rentabilität & Budget', comp: ProjekteAuswertungPanel }],
  },
  {
    id: 'powerbi', label: 'Power BI (alt)', icon: ExternalLink,
    sec: [{ id: 'embed', label: 'Report', comp: PowerBiLegacyPanel }],
  },
];

const STATE_KEY = 'smartis_auswertungen_state_v2';

export default function Auswertungen() {
  const initial = useMemo(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      const nav = NAV.find(n => n.id === s.primary) ? s.primary : 'produktivitaet';
      const navDef = NAV.find(n => n.id === nav);
      const sec = navDef.sec.find(x => x.id === s.secondary) ? s.secondary : navDef.sec[0].id;
      return { primary: nav, secondary: sec };
    } catch {
      return { primary: 'produktivitaet', secondary: 'uebersicht' };
    }
  }, []);

  const [primary, setPrimary] = useState(initial.primary);
  const [secondaryMap, setSecondaryMap] = useState(() => {
    const map = Object.fromEntries(NAV.map(n => [n.id, n.sec[0].id]));
    map[initial.primary] = initial.secondary;
    return map;
  });

  const primaryDef = NAV.find(n => n.id === primary);
  const secondaryId = secondaryMap[primary];
  const secondaryDef = primaryDef.sec.find(s => s.id === secondaryId) || primaryDef.sec[0];
  const PanelComp = secondaryDef.comp;

  React.useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ primary, secondary: secondaryId }));
    } catch { /* ignore */ }
  }, [primary, secondaryId]);

  return (
    <div className="h-full w-full overflow-auto" style={{ background: '#f2f5f2' }}>
      <div className="px-6 pt-3 pb-2 border-b" style={{ borderColor: '#d9e0d9', background: '#fff' }}>
        {/* Zeile 1: Titel links, Primary-Tabs rechts */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6ede6', color: '#4d6a50' }}>
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Auswertungen</h1>
              <p className="text-[10px] text-zinc-500 leading-tight">Produktivität · Fakturierung · Debitoren</p>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto ml-auto">
            {NAV.map(n => {
              const Icon = n.icon;
              const active = n.id === primary;
              return (
                <button
                  key={n.id}
                  onClick={() => setPrimary(n.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors"
                  style={{
                    background: active ? '#7a9b7f' : 'transparent',
                    color: active ? '#fff' : '#3d4a3d',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {n.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Zeile 2: Secondary Tabs (nur wenn mehrere) */}
        {primaryDef.sec.length > 1 && (
          <div className="mt-2 flex items-center gap-1 overflow-x-auto">
            {primaryDef.sec.map(s => {
              const active = s.id === secondaryDef.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSecondaryMap(m => ({ ...m, [primary]: s.id }))}
                  className="px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors"
                  style={{
                    background: active ? '#e6ede6' : 'transparent',
                    color: active ? '#2d5a2d' : '#6a766a',
                    border: `1px solid ${active ? '#bfd3bf' : 'transparent'}`,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-6 py-3">
        <PanelComp />
      </div>
    </div>
  );
}
