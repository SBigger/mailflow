import React from 'react';
import FirmenSettingsPanel from './FirmenSettingsPanel';

// Re-Use des FirmenSettingsPanel im "templates"-Modus:
// zeigt nur Briefkopf/Fusszeile/Logo plus Mini-Vorschau.
export default function RechnungsTemplatesPanel() {
  return <FirmenSettingsPanel mode="templates" />;
}
