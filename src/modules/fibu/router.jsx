import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const MandantSelect = React.lazy(() => import('./pages/MandantSelect'));
const FiBuShell     = React.lazy(() => import('./components/layout/FiBuShell'));

const Spinner = () => (
  <div style={{ position: 'fixed', inset: 0, background: '#f2f5f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Loader2 style={{ width: 28, height: 28, color: '#7a9b7f', animation: 'spin 1s linear infinite' }} />
    <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
);

// Entry point for the FiBu module.
// Mounted at /fibu/* in App.jsx — has NO knowledge of MailFlow layout.
export default function FiBuRouter() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route index element={<MandantSelect />} />
        <Route path=":mandantId/*" element={<FiBuShell />} />
      </Routes>
    </Suspense>
  );
}
