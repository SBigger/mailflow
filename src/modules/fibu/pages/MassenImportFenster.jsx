/**
 * MassenImportFenster — Standalone-Vollbild-Fenster für den Massen-Import.
 * Route: /fibu/massen-import/:mandantId
 * Öffnen via: window.open(...) aus dem Massen-Import-Header.
 *
 * Unabhängig von FiBuShell (keine Sidebar) → volle Fensterbreite.
 * MassenImport nutzt useMandant(), daher hier in MandantProvider gewickelt.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { MandantProvider, useMandant } from '../contexts/MandantContext';
import MassenImport from './MassenImport';

function Inner() {
  const { loading, error } = useMandant();
  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 style={{ width: 28, height: 28, color: '#7a9b7f', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#8a2d2d' }}>
        Fehler: {error}
      </div>
    );
  }
  return <MassenImport standalone />;
}

export default function MassenImportFenster() {
  return (
    <MandantProvider>
      <div style={{ height: '100vh', overflow: 'hidden', background: '#f2f5f2', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <Inner />
      </div>
    </MandantProvider>
  );
}
