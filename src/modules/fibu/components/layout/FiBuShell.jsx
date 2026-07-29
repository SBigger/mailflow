import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { MandantProvider } from '../../contexts/MandantContext';
import FiBuSidebar from './FiBuSidebar';
import PaperboyInbox from '@/components/inbox/PaperboyInbox';
import { useMandant } from '../../contexts/MandantContext';

// Lazy-loaded pages
const KreditorenDashboard = React.lazy(() => import('../../pages/KreditorenDashboard'));
const Lieferanten         = React.lazy(() => import('../../pages/Lieferanten'));
const RechnungErfassen    = React.lazy(() => import('../../pages/RechnungErfassen'));
const OpListe             = React.lazy(() => import('../../pages/OpListe'));
const Zahlungslauf        = React.lazy(() => import('../../pages/Zahlungslauf'));
const Belegjournal        = React.lazy(() => import('../../pages/Belegjournal'));
const Kontenplan          = React.lazy(() => import('../../pages/Kontenplan'));
const MwstCodes           = React.lazy(() => import('../../pages/MwstCodes'));
const RechnungInbox       = React.lazy(() => import('../../pages/RechnungInbox'));
const MwstAbrechnung      = React.lazy(() => import('../../pages/MwstAbrechnung'));
const Jahresabschluss     = React.lazy(() => import('../../pages/Jahresabschluss'));
const MassenImport        = React.lazy(() => import('../../pages/MassenImport'));
const BankAbstimmungIntern = React.lazy(() => import('../../pages/BankAbstimmung'));
const Kontoblaetter        = React.lazy(() => import('../../pages/Kontoblaetter'));
const Bilanz               = React.lazy(() => import('../../pages/Bilanz'));
const Zahlstellen          = React.lazy(() => import('../../pages/Zahlstellen'));
const ManuelleBuchungen    = React.lazy(() => import('../../pages/ManuelleBuchungen'));
const Saldovortraege       = React.lazy(() => import('../../pages/Saldovortraege'));
const Budget               = React.lazy(() => import('../../pages/Budget'));
const Wechselkurse         = React.lazy(() => import('../../pages/Wechselkurse'));
const Einstellungen        = React.lazy(() => import('../../pages/Einstellungen'));
const LieferantenKonto     = React.lazy(() => import('../../pages/LieferantenKonto'));
const Dauerbelege          = React.lazy(() => import('../../pages/Dauerbelege'));
const Kontierungsregeln    = React.lazy(() => import('../../pages/Kontierungsregeln'));
const WiederkehrendeBuchungen = React.lazy(() => import('../../pages/WiederkehrendeBuchungen'));
const Kassenbuch           = React.lazy(() => import('../../pages/Kassenbuch'));
const Kursbewertung        = React.lazy(() => import('../../pages/Kursbewertung'));
const SetupAssistent       = React.lazy(() => import('../../pages/SetupAssistent'));
const RechnungsUebersicht  = React.lazy(() => import('../../pages/RechnungsUebersicht'));
const Benutzerverwaltung   = React.lazy(() => import('../../pages/Benutzerverwaltung'));
const Kunden               = React.lazy(() => import('../../pages/Kunden'));
const Artikel              = React.lazy(() => import('../../pages/Artikel'));
const DebitorenRechnung    = React.lazy(() => import('../../pages/DebitorenRechnung'));
const DebitorenUebersicht  = React.lazy(() => import('../../pages/DebitorenUebersicht'));
const DebitorenEinstellungen = React.lazy(() => import('../../pages/DebitorenEinstellungen'));
const Mahnwesen            = React.lazy(() => import('../../pages/Mahnwesen'));

const Spinner = () => (
  <div className="flex-1 flex items-center justify-center">
    <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#7a9b7f' }} />
  </div>
);

function FiBuContent() {
  const { loading, error } = useMandant();

  if (loading) return <Spinner />;
  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-sm" style={{ color: '#8a2d2d' }}>Fehler: {error}</div>
    </div>
  );

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route index element={<Navigate to="kreditoren" replace />} />
        <Route path="kreditoren"                   element={<KreditorenDashboard />} />
        <Route path="kreditoren/lieferanten"        element={<Lieferanten />} />
        <Route path="kreditoren/lieferanten/:lieferantId" element={<Lieferanten />} />
        <Route path="kreditoren/lieferanten-konto" element={<LieferantenKonto />} />
        <Route path="kreditoren/erfassen"           element={<RechnungErfassen />} />
        <Route path="kreditoren/erfassen/:belegId"  element={<RechnungErfassen />} />
        <Route path="kreditoren/opliste"            element={<OpListe />} />
        <Route path="kreditoren/zahlungslauf"       element={<Zahlungslauf />} />
        <Route path="kreditoren/journal"            element={<Belegjournal />} />
        <Route path="kontenplan"                    element={<Kontenplan />} />
        <Route path="mwstcodes"                     element={<MwstCodes />} />
        <Route path="kreditoren/uebersicht"         element={<RechnungsUebersicht />} />
        <Route path="kreditoren/inbox"              element={<RechnungInbox />} />
        <Route path="mwst/abrechnung"               element={<MwstAbrechnung />} />
        <Route path="jahresabschluss"               element={<Jahresabschluss />} />
        <Route path="kreditoren/massen-import"      element={<MassenImport />} />
        {/* ── Debitoren / Fakturierung ── */}
        <Route path="debitoren"                     element={<Navigate to="uebersicht" replace />} />
        <Route path="debitoren/uebersicht"          element={<DebitorenUebersicht />} />
        <Route path="debitoren/erfassen"            element={<DebitorenRechnung />} />
        <Route path="debitoren/erfassen/:belegId"   element={<DebitorenRechnung />} />
        <Route path="debitoren/mahnwesen"           element={<Mahnwesen />} />
        <Route path="debitoren/kunden"              element={<Kunden />} />
        <Route path="debitoren/artikel"             element={<Artikel />} />
        <Route path="debitoren/einstellungen"       element={<DebitorenEinstellungen />} />
        <Route path="kreditoren/dauerbelege"        element={<Dauerbelege />} />
        <Route path="bankabstimmung"               element={<BankAbstimmungIntern />} />
        <Route path="kontoblaetter"                element={<Kontoblaetter />} />
        <Route path="bilanz"                       element={<Bilanz />} />
        <Route path="zahlstellen"                  element={<Zahlstellen />} />
        <Route path="manuelle-buchungen"           element={<ManuelleBuchungen />} />
        <Route path="wiederkehrende-buchungen"     element={<WiederkehrendeBuchungen />} />
        <Route path="kassenbuch"                   element={<Kassenbuch />} />
        <Route path="kursbewertung"                element={<Kursbewertung />} />
        <Route path="saldovortraege"               element={<Saldovortraege />} />
        <Route path="budget"                       element={<Budget />} />
        <Route path="wechselkurse"                 element={<Wechselkurse />} />
        <Route path="einstellungen"                element={<Einstellungen />} />
        <Route path="kontierungsregeln"            element={<Kontierungsregeln />} />
        <Route path="setup"                        element={<SetupAssistent />} />
        <Route path="benutzerverwaltung"           element={<Benutzerverwaltung />} />
        <Route path="*" element={<Navigate to="kreditoren" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function FiBuShell() {
  return (
    <MandantProvider>
      <div
        className="flex h-screen overflow-hidden"
        style={{ background: '#f2f5f2', color: '#1a1a2e', fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <FiBuSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <FiBuContent />
        </main>
      </div>
      {/* Gebündelte Eingänge – FiBu läuft ohne MailFlow-Layout, wo der
          Paperboy sonst hängt. Das Thema wird hier fest mitgegeben: FiBu ist
          durchgehend hell gestaltet (#f2f5f2 oben) und stellt keinen
          ThemeContext bereit; ohne die Vorgabe käme dessen Standardwert
          "dark" zum Zug und das Panel stünde dunkel auf heller Seite. */}
      <PaperboyInbox theme="artis" />
    </MandantProvider>
  );
}
