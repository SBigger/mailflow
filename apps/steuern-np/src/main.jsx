import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Triage from './pages/Triage.jsx';
import Stammdaten from './pages/Stammdaten.jsx';
import Demo from './pages/Demo.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function Shell() {
  const { user, laedt, istKonfiguriert, mandant, mandanten, mandantId, setMandantId, abmelden } = useAuth();
  const imDemo = window.location.pathname.startsWith('/demo');

  // Der Demo-Modus braucht kein Backend und ist deshalb auch ohne
  // Konfiguration und ohne Anmeldung erreichbar. Angemeldet läuft /demo
  // dagegen in der normalen Shell mit Navigation (Route weiter unten).
  const demoShell = (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <nav className="max-w-6xl mx-auto flex items-center gap-2 px-4 h-12">
          <span className="font-semibold text-sm mr-3">Steuern nP</span>
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            Demo — ohne Backend, nichts wird gespeichert
          </span>
        </nav>
      </header>
      <main className="max-w-6xl mx-auto">
        <Routes><Route path="*" element={<Demo />} /></Routes>
      </main>
    </div>
  );

  if (!istKonfiguriert) return demoShell;

  if (laedt) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!user) return imDemo ? demoShell : <Login />;

  const link = ({ isActive }) =>
    `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <nav className="max-w-6xl mx-auto flex items-center gap-2 px-4 h-12">
          <span className="font-semibold text-sm mr-3">Steuern nP</span>
          <NavLink to="/triage" className={link}>Belegtriage</NavLink>
          <NavLink to="/stammdaten" className={link}>Stammdaten</NavLink>
          <NavLink to="/demo" className={link}>Demo</NavLink>

          <div className="ml-auto flex items-center gap-2">
            {mandanten.length > 1 && (
              <select className="text-sm border border-slate-300 rounded-md px-2 h-8"
                      value={mandantId || ''} onChange={e => setMandantId(e.target.value)}>
                {mandanten.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            {mandanten.length === 1 && (
              <span className="text-[12px] text-slate-500">{mandant?.name}</span>
            )}
            <button onClick={abmelden}
                    className="text-slate-500 hover:text-slate-900 p-1.5 rounded-md hover:bg-slate-100"
                    title="Abmelden">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/triage" replace />} />
          <Route path="/triage" element={<Triage />} />
          <Route path="/stammdaten" element={<Stammdaten />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="*" element={<Navigate to="/triage" replace />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
