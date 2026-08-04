import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Toaster } from 'sonner';
import Triage from './pages/Triage.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function Shell() {
  const link = ({ isActive }) =>
    `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <nav className="max-w-6xl mx-auto flex items-center gap-2 px-4 h-12">
          <span className="font-semibold text-sm mr-3">Steuern nP</span>
          <NavLink to="/triage" className={link}>Belegtriage</NavLink>
        </nav>
      </header>
      <main className="max-w-6xl mx-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/triage" replace />} />
          <Route path="/triage" element={<Triage />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
