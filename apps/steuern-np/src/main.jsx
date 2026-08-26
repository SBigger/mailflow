/**
 * Steuern nP — lokale Anwendung.
 *
 * Kein Router und keine Anmeldung: Die App hat zwei Zustände — Verwaltung
 * und ein geöffnetes Dossier. Das passt zum Arbeitsablauf und macht sie
 * auch als Datei-Aufruf lauffähig, wo Pfad-Routing nicht funktioniert.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Verwaltung from './pages/Verwaltung.jsx';
import Dossier from './pages/Dossier.jsx';
import * as db from './lib/db.js';
import './index.css';

function App() {
  const [benutzer, setBenutzer] = useState(null);
  const [mandant, setMandant] = useState(null);
  const [offen, setOffen] = useState(null);   // { deklaration, person }
  const [bereit, setBereit] = useState(false);
  const [ladefehler, setLadefehler] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        await db.laden();
        setBenutzer(await db.aktiverBenutzer());
        const m = await db.mandantenListe();
        if (m.length === 1) setMandant(m[0]);
      } catch (e) {
        // Ohne diesen Zweig bliebe die App stumm im Ladezustand stehen —
        // gerade dann, wenn der Datenbestand beschaedigt ist und man es
        // am dringendsten wissen muss.
        setLadefehler(e?.message || String(e));
      } finally {
        setBereit(true);
      }
    })();
  }, []);

  if (!bereit) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh',
                    color: 'var(--ink-faint)' }}>
        Datenbestand wird geladen…
      </div>
    );
  }

  if (ladefehler) {
    return (
      <div style={{ padding: '48px 28px', maxWidth: 620 }}>
        <p className="eyebrow" style={{ color: 'var(--stop)' }}>Start nicht möglich</p>
        <h1 className="serif" style={{ fontSize: 26, fontWeight: 600, margin: '6px 0 12px' }}>
          Der Datenbestand liess sich nicht öffnen
        </h1>
        <p style={{ color: 'var(--ink-weak)' }}>{ladefehler}</p>
        <p style={{ color: 'var(--ink-weak)', marginTop: 12 }}>
          Im Ordner <code>daten/sicherung</code> liegt für jeden Tag eine Kopie. Eine davon
          nach <code>daten/steuerdaten.json</code> zurückkopieren und die Anwendung neu starten.
        </p>
        {window.steuerAPI && (
          <button className="knopf knopf-rand" style={{ marginTop: 16 }}
                  onClick={() => window.steuerAPI.ordnerZeigen()}>
            Datenordner öffnen
          </button>
        )}
      </div>
    );
  }

  if (offen) {
    return (
      <Dossier
        deklaration={offen.deklaration} person={offen.person}
        mandant={mandant} benutzer={benutzer}
        onZurueck={() => setOffen(null)}
      />
    );
  }

  return (
    <Verwaltung
      benutzer={benutzer} mandant={mandant}
      onBenutzer={setBenutzer} onMandant={setMandant}
      onOeffnen={(deklaration, person) => setOffen({ deklaration, person })}
    />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
