// Auswertungen · natives Reporting-Modul (hat das Power BI-Embed abgelöst)
// Produktivität (Stunden/Umsatz pro MA nach Projekttyp), Monatsrapport,
// Angefangene Arbeiten, Debitoren und Projekt-Auswertungen – direkt aus den
// Smartis-Daten (le_*-Tabellen).
import React, { useState, useMemo } from 'react';
import {
  BarChart3, Users, FileText, ArrowDownCircle, FolderKanban,
} from 'lucide-react';
import ProduktivitaetPanel from '@/components/auswertungen/ProduktivitaetPanel';
import MehrjahrePanel from '@/components/auswertungen/MehrjahrePanel';
import MonatsrapportPanel from '@/components/auswertungen/MonatsrapportPanel';
import FakturierungPanel from '@/components/auswertungen/FakturierungPanel';
import DebitorenAuswertungPanel from '@/components/auswertungen/DebitorenAuswertungPanel';
import ProjekteAuswertungPanel from '@/components/leistungserfassung/AuswertungenPanel';

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
