import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Clock, FileText, Database, Smartphone, Banknote, SlidersHorizontal, Check, RotateCcw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

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
import DebitorenOPPanel from '@/components/leistungserfassung/DebitorenOPPanel';
import MitarbeitergruppenPanel from '@/components/leistungserfassung/MitarbeitergruppenPanel';
import MwstSaetzePanel from '@/components/leistungserfassung/MwstSaetzePanel';
import KalenderTagPanel from '@/components/leistungserfassung/KalenderTagPanel';
import KalenderWochePanel from '@/components/leistungserfassung/KalenderWochePanel';

// ---------------------------------------------------------------------
// Navigations-Definition + welche Sec-IDs welches Panel rendern
// ---------------------------------------------------------------------
const NAV = [
  {
    id: 'erfassen', label: 'Erfassen', icon: Clock,
    sec: [
      { id: 'kal-tag',    label: 'Kalender Tag',    comp: KalenderTagPanel },
      { id: 'kal-woche',  label: 'Kalender Woche',  comp: KalenderWochePanel },
      { id: 'tag',        label: 'Tagesansicht',    comp: TagesansichtPanel },
      { id: 'woche',      label: 'Wochenrapport',   comp: WochenrapportPanel },
      { id: 'meine',      label: 'Meine Rapporte',  comp: MeineRapportePanel },
      { id: 'abwesend',   label: 'Abwesenheiten',   comp: AbwesenheitenPanel },
      { id: 'spesen-erf', label: 'Spesen erfassen', comp: SpesenErfassenPanel },
    ],
  },
  {
    id: 'abrechnen', label: 'Abrechnen', icon: FileText, access: 'billing',
    sec: [
      { id: 'aa',         label: 'Angef. Arbeiten (AA)', comp: AAPanel },
      { id: 'fakvor',     label: 'Faktura-Vorschlag',    comp: FakturaVorschlagPanel },
      { id: 'entw-durch', label: 'Entwurfs-Durchgang',   comp: EntwurfsDurchgangPanel },
      { id: 'rechn-list', label: 'Rechnungsübersicht',   comp: RechnungsuebersichtPanel },
      { id: 'akonto',     label: 'Akonto',               comp: AkontoPanel },
      { id: 'gutschrift', label: 'Gutschrift/Storno',    comp: GutschriftPanel },
      { id: 'spesen-abr', label: 'Spesen abrechnen',     comp: SpesenAbrechnenPanel },
      { id: 'wiederk',    label: 'Wiederkehrende',       comp: WiederkehrendePanel },
    ],
  },
  {
    id: 'debitoren', label: 'Debitoren', icon: Banknote, access: 'billing',
    sec: [
      { id: 'op-liste', label: 'Offene Posten',     comp: DebitorenOPPanel },
      { id: 'mahnung',  label: 'Mahnwesen',         comp: MahnungenPanel },
      { id: 'zahlung',  label: 'Zahlungseingänge',  comp: ZahlungseingaengePanel },
    ],
  },
  {
    id: 'stammdaten', label: 'Stammdaten', icon: Database, access: 'stammdaten',
    sec: [
      { id: 'sd-projekte', label: 'Projekte',            comp: ProjektePanel },
      { id: 'sd-vorlagen', label: 'Projekt-Vorlagen',    comp: ProjektVorlagenPanel },
      { id: 'sd-mitarb',   label: 'Mitarbeiter',         comp: MitarbeiterPanel },
      { id: 'sd-magrp',    label: 'Mitarbeitergruppen',  comp: MitarbeitergruppenPanel },
      { id: 'sd-sollzeit', label: 'Sollzeiten-Profile',  comp: SollzeitenPanel },
      { id: 'sd-leistung', label: 'Leistungsarten',      comp: LeistungsartenPanel },
      { id: 'sd-gruppen',  label: 'Gruppenansätze',      comp: GruppenansaetzePanel },
      { id: 'sd-mwst',     label: 'MWST-Sätze',          comp: MwstSaetzePanel },
      { id: 'sd-kondi',    label: 'Kunden-Konditionen',  comp: KundenKonditionenPanel },
      { id: 'sd-templ',    label: 'Rechnungs-Templates', comp: RechnungsTemplatesPanel },
      { id: 'sd-nummern',  label: 'Nummernkreise',       comp: NummernkreisePanel },
      { id: 'sd-firma',    label: 'Firma',               comp: FirmenSettingsPanel },
    ],
  },
  // «Auswertungen» ist in den eigenen Top-Level-Menüpunkt /Auswertungen umgezogen
  // (src/pages/Auswertungen.jsx – ersetzt das Power BI-Embed).
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

// Sprungziel aus anderen Seiten (z.B. Auswertungen → «Fakturieren»):
// sessionStorage 'le.jump' = { primary, secondary } – einmalig beim Öffnen gelesen.
function readJumpTarget() {
  try {
    const j = JSON.parse(sessionStorage.getItem('le.jump') || 'null');
    sessionStorage.removeItem('le.jump');
    const nav = NAV.find(n => n.id === j?.primary);
    if (!nav) return null;
    return { primary: nav.id, secondary: nav.sec.find(s => s.id === j?.secondary)?.id ?? nav.sec[0].id };
  } catch {
    return null;
  }
}

export default function Leistungserfassung() {
  const [role, setRole] = useState(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [jump] = useState(readJumpTarget);
  const [primary, setPrimary] = useState(jump?.primary ?? 'erfassen');
  const [secondaryMap, setSecondaryMap] = useState(() => {
    const map = Object.fromEntries(NAV.map(n => [n.id, n.sec[0].id]));
    if (jump) map[jump.primary] = jump.secondary;
    return map;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setRoleLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) {
        setRole(data?.role ?? 'readonly');
        setRoleLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allowedNav = useMemo(() => {
    const canManage = ['admin', 'mandatsleiter'].includes(role);
    return NAV.filter((item) => !item.access || canManage);
  }, [role]);

  useEffect(() => {
    if (roleLoaded && !allowedNav.some((item) => item.id === primary)) {
      setPrimary(allowedNav[0]?.id ?? 'erfassen');
    }
  }, [allowedNav, primary, roleLoaded]);

  // Laschen ein-/ausblenden (persistent, pro Browser). Set aus sec-IDs, die versteckt sind.
  const [hiddenTabs, setHiddenTabs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('le_hidden_tabs') || '[]')); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem('le_hidden_tabs', JSON.stringify([...hiddenTabs])); }
    catch { /* ignore */ }
  }, [hiddenTabs]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef(null);
  useEffect(() => {
    if (!customizeOpen) return;
    const onDown = (e) => { if (customizeRef.current && !customizeRef.current.contains(e.target)) setCustomizeOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [customizeOpen]);
  const toggleTab = (secId) => setHiddenTabs((prev) => {
    const next = new Set(prev);
    if (next.has(secId)) next.delete(secId); else next.add(secId);
    return next;
  });

  // Cross-Panel-Navigation: erlaubt z.B. einem Klick auf einen Projekt-Link
  // in der Tagesansicht direkt zum Faktura-Vorschlag zu springen.
  // Aufruf: window.dispatchEvent(new CustomEvent('le-navigate', {
  //   detail: { primary: 'abrechnen', secondary: 'fakvor' }
  // }));
  useEffect(() => {
    const handler = (e) => {
      const { primary: p, secondary: s } = e.detail || {};
      if (p) setPrimary(p);
      if (p && s) setSecondaryMap(m => ({ ...m, [p]: s }));
    };
    window.addEventListener('le-navigate', handler);
    return () => window.removeEventListener('le-navigate', handler);
  }, []);

  const primaryDef = useMemo(
    () => allowedNav.find(n => n.id === primary) ?? allowedNav[0],
    [allowedNav, primary],
  );
  const visibleSec = useMemo(
    () => (primaryDef?.sec ?? []).filter(s => !hiddenTabs.has(s.id)),
    [primaryDef, hiddenTabs],
  );
  let secondaryId = secondaryMap[primary];
  // Ist die aktive Lasche ausgeblendet? -> auf erste sichtbare wechseln
  useEffect(() => {
    if (hiddenTabs.has(secondaryId) && visibleSec.length) {
      setSecondaryMap(m => ({ ...m, [primary]: visibleSec[0].id }));
    }
  }, [hiddenTabs, secondaryId, visibleSec, primary]);
  if (hiddenTabs.has(secondaryId) && visibleSec.length) secondaryId = visibleSec[0].id;
  const secondaryDef = primaryDef?.sec.find(s => s.id === secondaryId);

  const PanelComp = secondaryDef?.comp;

  return (
    <div className="h-full w-full overflow-auto" style={{ background: '#f2f5f2' }}>
      <div className="px-6 pt-3 pb-2 border-b" style={{ borderColor: '#d9e0d9', background: '#fff' }}>
        {/* Zeile 1: Titel links, Primary-Tabs rechts (nutzt vorher leeren Whitespace) */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6ede6', color: '#4d6a50' }}>
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Leistungserfassung</h1>
              <p className="text-[10px] text-zinc-500 leading-tight">Projekte · Rapporte · Fakturierung</p>
            </div>
          </div>

          {/* Primary Tabs neben Titel */}
          <div className="flex items-center gap-1 overflow-x-auto ml-auto">
            {allowedNav.map(n => {
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

        {/* Zeile 2: Secondary Tabs (kompakter Abstand) + Anpassen */}
        <div className="mt-2 flex items-center gap-1">
          <div className="flex items-center gap-1 overflow-x-auto">
            {visibleSec.map(s => {
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
            {visibleSec.length === 0 && (
              <span className="text-xs text-zinc-400 px-1">Alle Laschen ausgeblendet – über „Anpassen" wieder einblenden.</span>
            )}
          </div>

          {/* Anpassen: Laschen ein-/ausblenden */}
          <div className="relative ml-auto flex-shrink-0" ref={customizeRef}>
            <button
              type="button"
              onClick={() => setCustomizeOpen(o => !o)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              style={{
                background: customizeOpen ? '#e6ede6' : 'transparent',
                color: '#6a766a',
                border: `1px solid ${customizeOpen ? '#bfd3bf' : 'transparent'}`,
              }}
              title="Laschen ein-/ausblenden"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Anpassen
              {hiddenTabs.size > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold" style={{ background: '#7a9b7f', color: '#fff' }}>
                  {hiddenTabs.size}
                </span>
              )}
            </button>

            {customizeOpen && (
              <div className="absolute right-0 mt-1 z-30 rounded-lg border shadow-lg bg-white" style={{ borderColor: '#d9e0d9', width: 260 }}>
                <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: '#eef1ee' }}>
                  <span className="text-xs font-semibold text-zinc-700">Laschen «{primaryDef?.label}»</span>
                  {hiddenTabs.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setHiddenTabs(new Set())}
                      className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-800"
                      title="Alle wieder einblenden"
                    >
                      <RotateCcw className="w-3 h-3" /> Alle
                    </button>
                  )}
                </div>
                <div className="max-h-[50vh] overflow-y-auto py-1">
                  {(primaryDef?.sec ?? []).map(s => {
                    const visible = !hiddenTabs.has(s.id);
                    const isLastVisible = visible && visibleSec.length === 1;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isLastVisible}
                        onClick={() => toggleTab(s.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isLastVisible ? 'Mindestens eine Lasche muss sichtbar bleiben' : undefined}
                      >
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded border flex-shrink-0"
                          style={{
                            background: visible ? '#7a9b7f' : '#fff',
                            borderColor: visible ? '#7a9b7f' : '#cdd6cd',
                            color: '#fff',
                          }}
                        >
                          {visible && <Check className="w-3 h-3" />}
                        </span>
                        <span style={{ color: visible ? '#3d4a3d' : '#9aa09a' }}>{s.label}</span>
                        {!s.comp && <span className="ml-auto text-[9px] text-zinc-400 italic">bald</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-3">
        {!roleLoaded
          ? <div className="p-6 text-sm text-zinc-500">Berechtigungen werden geladen…</div>
          : PanelComp
            ? <PanelComp />
            : <ComingSoon title={`${primaryDef?.label ?? ''} · ${secondaryDef?.label ?? ''}`} />}
      </div>
    </div>
  );
}
