import React, { useState, useMemo } from 'react';
import { Clock, FileText, Database, BarChart3, Smartphone } from 'lucide-react';

import TagesansichtPanel from '@/components/leistungserfassung/TagesansichtPanel';
import MitarbeiterPanel from '@/components/leistungserfassung/MitarbeiterPanel';
import LeistungsartenPanel from '@/components/leistungserfassung/LeistungsartenPanel';
import GruppenansaetzePanel from '@/components/leistungserfassung/GruppenansaetzePanel';
import ProjektePanel from '@/components/leistungserfassung/ProjektePanel';
import AAPanel from '@/components/leistungserfassung/AAPanel';
import FakturaVorschlagPanel from '@/components/leistungserfassung/FakturaVorschlagPanel';
import EntwurfsDurchgangPanel from '@/components/leistungserfassung/EntwurfsDurchgangPanel';
import RechnungsuebersichtPanel from '@/components/leistungserfassung/RechnungsuebersichtPanel';
import WochenrapportPanel from '@/components/leistungserfassung/WochenrapportPanel';
import MeineRapportePanel from '@/components/leistungserfassung/MeineRapportePanel';
import MahnungenPanel from '@/components/leistungserfassung/MahnungenPanel';
import ZahlungseingaengePanel from '@/components/leistungserfassung/ZahlungseingaengePanel';
import SpesenErfassenPanel from '@/components/leistungserfassung/SpesenErfassenPanel';
import AbwesenheitenPanel from '@/components/leistungserfassung/AbwesenheitenPanel';
import WiederkehrendePanel from '@/components/leistungserfassung/WiederkehrendePanel';
import AuswertungenPanel from '@/components/leistungserfassung/AuswertungenPanel';
import SollzeitenPanel from '@/components/leistungserfassung/SollzeitenPanel';
import KundenKonditionenPanel from '@/components/leistungserfassung/KundenKonditionenPanel';
import RechnungsTemplatesPanel from '@/components/leistungserfassung/RechnungsTemplatesPanel';
import NummernkreisePanel from '@/components/leistungserfassung/NummernkreisePanel';
import FirmenSettingsPanel from '@/components/leistungserfassung/FirmenSettingsPanel';
import AkontoPanel from '@/components/leistungserfassung/AkontoPanel';
import GutschriftPanel from '@/components/leistungserfassung/GutschriftPanel';
import SpesenAbrechnenPanel from '@/components/leistungserfassung/SpesenAbrechnenPanel';
import ProjektVorlagenPanel from '@/components/leistungserfassung/ProjektVorlagenPanel';
import MobileVorschauPanel from '@/components/leistungserfassung/MobileVorschauPanel';

// ---------------------------------------------------------------------
// Navigations-Definition + welche Sec-IDs welches Panel rendern
// ---------------------------------------------------------------------
const NAV = [
  {
    id: 'erfassen', label: 'Erfassen', icon: Clock,
    sec: [
      { id: 'tag',        label: 'Tagesansicht',    comp: TagesansichtPanel },
      { id: 'woche',      label: 'Wochenrapport',   comp: WochenrapportPanel },
      { id: 'meine',      label: 'Meine Rapporte',  comp: MeineRapportePanel },
      { id: 'abwesend',   label: 'Abwesenheiten',   comp: AbwesenheitenPanel },
      { id: 'spesen-erf', label: 'Spesen erfassen', comp: SpesenErfassenPanel },
    ],
  },
  {
    id: 'abrechnen', label: 'Abrechnen', icon: FileText,
    sec: [
      { id: 'aa',         label: 'Angef. Arbeiten (AA)', comp: AAPanel },
      { id: 'fakvor',     label: 'Faktura-Vorschlag',    comp: FakturaVorschlagPanel },
      { id: 'entw-durch', label: 'Entwurfs-Durchgang',   comp: EntwurfsDurchgangPanel },
      { id: 'rechn-list', label: 'Rechnungsübersicht',   comp: RechnungsuebersichtPanel },
      { id: 'akonto',     label: 'Akonto',               comp: AkontoPanel },
      { id: 'mahnung',    label: 'Mahnwesen',            comp: MahnungenPanel },
      { id: 'zahlung',    label: 'Zahlungseingänge',     comp: ZahlungseingaengePanel },
      { id: 'gutschrift', label: 'Gutschrift/Storno',    comp: GutschriftPanel },
      { id: 'spesen-abr', label: 'Spesen abrechnen',     comp: SpesenAbrechnenPanel },
      { id: 'wiederk',    label: 'Wiederkehrende',       comp: WiederkehrendePanel },
    ],
  },
  {
    id: 'stammdaten', label: 'Stammdaten', icon: Database,
    sec: [
      { id: 'sd-projekte', label: 'Projekte',            comp: ProjektePanel },
      { id: 'sd-vorlagen', label: 'Projekt-Vorlagen',    comp: ProjektVorlagenPanel },
      { id: 'sd-mitarb',   label: 'Mitarbeiter',         comp: MitarbeiterPanel },
      { id: 'sd-sollzeit', label: 'Sollzeiten-Profile',  comp: SollzeitenPanel },
      { id: 'sd-leistung', label: 'Leistungsarten',      comp: LeistungsartenPanel },
      { id: 'sd-gruppen',  label: 'Gruppenansätze',      comp: GruppenansaetzePanel },
      { id: 'sd-kondi',    label: 'Kunden-Konditionen',  comp: KundenKonditionenPanel },
      { id: 'sd-templ',    label: 'Rechnungs-Templates', comp: RechnungsTemplatesPanel },
      { id: 'sd-nummern',  label: 'Nummernkreise',       comp: NummernkreisePanel },
      { id: 'sd-firma',    label: 'Firma',               comp: FirmenSettingsPanel },
    ],
  },
  {
    id: 'auswert', label: 'Auswertungen', icon: BarChart3,
    sec: [
      { id: 'aw-all',    label: 'Übersicht',           comp: AuswertungenPanel },
    ],
  },
  {
    id: 'mobile', label: 'Mobile', icon: Smartphone,
    sec: [{ id: 'mob-overview', label: 'Mobile-Vorschau', comp: MobileVorschauPanel }],
  },
];

// Placeholder für noch-nicht-implementierte Panels
const ComingSoon = ({ title }) => (
  <div className="rounded-lg border p-6" style={{ borderColor: '#cfe0d2', backgroundColor: '#f7faf7' }}>
    <div className="text-sm font-semibold mb-1" style={{ color: '#2d3f2e' }}>{title}</div>
    <div className="text-xs text-zinc-600">Dieses Panel folgt in einer späteren Etappe (Mockup vorhanden).</div>
  </div>
);

export default function Leistungserfassung() {
  const [primary, setPrimary] = useState('erfassen');
  const [secondaryMap, setSecondaryMap] = useState(() =>
    Object.fromEntries(NAV.map(n => [n.id, n.sec[0].id]))
  );

  const primaryDef = useMemo(() => NAV.find(n => n.id === primary), [primary]);
  const secondaryId = secondaryMap[primary];
  const secondaryDef = primaryDef.sec.find(s => s.id === secondaryId);

  const PanelComp = secondaryDef?.comp;

  return (
    <div className="h-full w-full overflow-auto" style={{ background: '#f2f5f2' }}>
      <div className="px-6 pt-5 pb-3 border-b" style={{ borderColor: '#d9e0d9', background: '#fff' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6ede6', color: '#4d6a50' }}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Leistungserfassung</h1>
            <p className="text-xs text-zinc-500">Projekte · Rapporte · Fakturierung</p>
          </div>
        </div>

        {/* Primary Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
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

        {/* Secondary Tabs */}
        <div className="mt-2.5 flex items-center gap-1 overflow-x-auto">
          {primaryDef.sec.map(s => {
            const active = s.id === secondaryId;
            const coming = !s.comp;
            return (
              <button
                key={s.id}
                onClick={() => setSecondaryMap(m => ({ ...m, [primary]: s.id }))}
                className="px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors"
                style={{
                  background: active ? '#e6ede6' : 'transparent',
                  color: active ? '#2d5a2d' : (coming ? '#a0aca0' : '#6a766a'),
                  border: `1px solid ${active ? '#bfd3bf' : 'transparent'}`,
                  fontWeight: active ? 600 : 500,
                  fontStyle: coming ? 'italic' : 'normal',
                }}
                title={coming ? 'Noch nicht implementiert' : undefined}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-6">
        {PanelComp ? <PanelComp /> : <ComingSoon title={`${primaryDef.label} · ${secondaryDef?.label ?? ''}`} />}
      </div>
    </div>
  );
}
