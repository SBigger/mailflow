/**
 * LieferantLink — klickbarer Lieferantenname → öffnet den Lieferanten-Kontoauszug.
 * Überall einsetzbar, wo ein Lieferantenname angezeigt wird (Tabellen, Listen).
 *
 * Wichtig: stoppt die Klick-Propagation, damit ein Klick auf den Namen NICHT
 * die umgebende Zeile (z.B. Auswahl/Toggle) auslöst, sondern zum Auszug navigiert.
 *
 * Props:
 *   id       – lieferant_id (ohne id → reiner Text, kein Link)
 *   name     – anzuzeigender Name
 *   fallback – Text wenn kein Name (Default „—")
 *   style    – optionale zusätzliche Styles
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';

export default function LieferantLink({ id, name, fallback = '—', style }) {
  const navigate = useNavigate();
  const { mandant } = useMandant();

  if (!id || !name) {
    return <span style={style}>{name || fallback}</span>;
  }

  const go = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (mandant?.id) navigate(`/fibu/${mandant.id}/kreditoren/lieferanten-konto?l=${id}`);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      title={`Lieferantenauszug öffnen: ${name}`}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(e); }}
      style={{
        color: '#3d6641', cursor: 'pointer',
        borderBottom: '1px dotted #a9c6ae',
        ...style,
      }}
      onMouseOver={(e) => { e.currentTarget.style.borderBottomStyle = 'solid'; }}
      onMouseOut={(e) => { e.currentTarget.style.borderBottomStyle = 'dotted'; }}
    >
      {name}
    </span>
  );
}
