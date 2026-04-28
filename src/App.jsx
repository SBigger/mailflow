import React, { lazy, Suspense, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";
import Layout from './Layout';

// --- Lade-Komponente für Suspense ---
const PageLoader = () => (
    <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
);

// --- Lazy Imports der Seiten ---
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MailKanban = lazy(() => import('./pages/MailKanban'));
const TaskBoard = lazy(() => import('./pages/TaskBoard'));
const Settings = lazy(() => import('./pages/Settings'));
const Kunden = lazy(() => import('./pages/Kunden'));
const Personen = lazy(() => import('./pages/Personen'));
const Fristen = lazy(() => import('./pages/Fristen'));
const ReminderBoard = lazy(() => import('./pages/ReminderBoard'));
const TicketBoard = lazy(() => import('./pages/TicketBoard'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const Dokumente = lazy(() => import('./pages/Dokumente'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const ArtisTools = lazy(() => import('./pages/ArtisTools'));
const BriefSchreiben = lazy(() => import('./pages/BriefSchreiben'));
const Fahrzeugliste = lazy(() => import('./pages/Fahrzeugliste'));
const Aktienbuch = lazy(() => import('./pages/Aktienbuch'));
const Unterschriften = lazy(() => import('./pages/Unterschriften'));
const Abschlussdokumentation = lazy(() => import('./pages/Abschlussdokumentation'));
const Whiteboard = lazy(() => import('./pages/Whiteboard'));
const Auswertungen = lazy(() => import('./pages/Auswertungen'));
const Steuern = lazy(() => import('./pages/Steuern'));
const Login = lazy(() => import('./pages/Login'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const MFASetup = lazy(() => import("./pages/MFASetup.jsx"));
const MFALogin = lazy(() => import("./pages/MFALogin.jsx"));
const SetPassword = lazy(() => import("./pages/SetPassword.jsx"));
const DokumentUploadKunden = lazy(() => import("./pages/DokumentUploadKunden.jsx"));
const Posteingang = lazy(() => import("./pages/Posteingang.jsx"));
const SharePage = lazy(() => import("./pages/SharePage.jsx"));
const Leistungserfassung = lazy(() => import("./pages/Leistungserfassung.jsx"));
const Promptvorlagen = lazy(() => import("./pages/Promptvorlagen.jsx"));
const TelefonDashboard = lazy(() => import("./pages/TelefonDashboard.jsx"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } }
});

function AuthenticatedApp() {
  const { user, loading, requiresMfa } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const check = setInterval(() => {
      if (window.__SMARTIS_EXCEL_UPLOAD__ && user) {
        navigate('/Dokumente');
      }
    }, 300);
    return () => clearInterval(check);
  }, [user, navigate]);

  if (loading) return <PageLoader />;
  if (!user) return <Login />;
  if (requiresMfa) return <MFALogin />;

  return (
      <Layout>
        {/* Suspense fängt das Laden der lazy-Komponenten ab */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/Dashboard" replace />} />
            <Route path="/Dashboard" element={<Dashboard />} />
            <Route path="/MailKanban" element={<MailKanban />} />
            <Route path="/TaskBoard" element={<TaskBoard />} />
            <Route path="/Settings" element={<Settings />} />
            <Route path="/Kunden" element={<Kunden />} />
            <Route path="/Personen" element={<Personen />} />
            <Route path="/Fristen" element={<Fristen />} />
            <Route path="/ReminderBoard" element={<ReminderBoard />} />
            <Route path="/TicketBoard" element={<TicketBoard />} />
            <Route path="/KnowledgeBase" element={<KnowledgeBase />} />
            <Route path="/Dokumente" element={<Dokumente />} />
            <Route path="/Posteingang" element={<Posteingang />} />
            <Route path="/UserManagement" element={<UserManagement />} />
            <Route path="/ArtisTools" element={<ArtisTools />} />
            <Route path="/BriefSchreiben" element={<BriefSchreiben />} />
            <Route path="/Fahrzeugliste" element={<Fahrzeugliste />} />
            <Route path="/Aktienbuch" element={<Aktienbuch />} />
            <Route path="/Unterschriften" element={<Unterschriften />} />
            <Route path="/Abschlussdokumentation" element={<Abschlussdokumentation />} />
            <Route path="/Whiteboard" element={<Whiteboard />} />
            <Route path="/Auswertungen" element={<Auswertungen />} />
            <Route path="/Steuern" element={<Steuern />} />
            <Route path="/Promptvorlagen" element={<Promptvorlagen />} />
            <Route path="/TelefonDashboard" element={<TelefonDashboard />} />
            {FEATURE_LEISTUNGSERFASSUNG && (
                <Route path="/Leistungserfassung" element={<Leistungserfassung />} />
            )}
            <Route path="*" element={<Navigate to="/Dashboard" replace />} />
          </Routes>
        </Suspense>
      </Layout>
  );
}

function App() {
  return (
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <Router
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true
              }}
          >
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/set-password" element={<SetPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/mfa-setup" element={<MFASetup />} />
                <Route path="/mfa-login" element={<MFALogin />} />
                <Route path="/upload/:hash" element={<DokumentUploadKunden />} />
                <Route path="/share/:token" element={<SharePage />} />
                <Route path="/share" element={<SharePage />} />
                <Route path="*" element={<AuthenticatedApp />} />
              </Routes>
            </Suspense>
          </Router>
          <Toaster />
          <SonnerToaster richColors position="top-center" />
        </QueryClientProvider>
      </AuthProvider>
  );
}

export default App;