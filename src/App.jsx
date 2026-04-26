import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

// Pages
import Dashboard from './pages/Dashboard';
import MailKanban from './pages/MailKanban';
import TaskBoard from './pages/TaskBoard';
import Settings from './pages/Settings';
import Kunden from './pages/Kunden';
import Personen from './pages/Personen';
import Fristen from './pages/Fristen';
import ReminderBoard from './pages/ReminderBoard';
import TicketBoard from './pages/TicketBoard';
import KnowledgeBase from './pages/KnowledgeBase';
import Dokumente from './pages/Dokumente';
import UserManagement from './pages/UserManagement';
import ArtisTools from './pages/ArtisTools';
import BriefSchreiben from './pages/BriefSchreiben';
import Fahrzeugliste from './pages/Fahrzeugliste';
import Aktienbuch from './pages/Aktienbuch';
import Unterschriften from './pages/Unterschriften';
import Abschlussdokumentation from './pages/Abschlussdokumentation';
import Whiteboard from './pages/Whiteboard';
import Auswertungen from './pages/Auswertungen';
import Steuern from './pages/Steuern';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Layout from './Layout';
import MFASetup from "./pages/MFASetup.jsx";
import MFALogin from "./pages/MFALogin.jsx";
import SetPassword from "./pages/SetPassword.jsx";
import DokumentUploadKunden from "./pages/DokumentUploadKunden.jsx";
import Posteingang from "./pages/Posteingang.jsx";
import SharePage from "./pages/SharePage.jsx";
import Leistungserfassung from "./pages/Leistungserfassung.jsx";
import Promptvorlagen from "./pages/Promptvorlagen.jsx";
import TelefonDashboard from "./pages/TelefonDashboard.jsx";
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } }
});

function AuthenticatedApp() {
  const { user, loading, requiresMfa} = useAuth();
  const navigate = useNavigate();

  // Globales Polling: Excel Add-in → Tauri injiziert window.__SMARTIS_EXCEL_UPLOAD__
  // Navigiert zur Dokumente-Seite, damit der dortige Upload-Dialog die Datei aufgreift.
  useEffect(() => {
    const check = setInterval(() => {
      if (window.__SMARTIS_EXCEL_UPLOAD__ && user) {
        navigate('/Dokumente');
      }
    }, 300);
    return () => clearInterval(check);
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (requiresMfa) {
    return <MFALogin />;
  }

  return (
    <Layout>
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
        <Route path="/TicketBoard"   element={<TicketBoard />} />
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
    </Layout>
  );
}

// ... (your imports remain the same)

function App() {
  return (
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          {/* Added future flag here to resolve the v7 warning */}
          <Router
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true
              }}
          >
            <Routes>
              {/* Password-Reset: accessible without login */}
              <Route path="/set-password" element={<SetPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/mfa-setup" element={<MFASetup />} />
              <Route path="/mfa-login" element={<MFALogin />} />
              <Route path="/upload/:hash" element={<DokumentUploadKunden />} />
              <Route path="/share/:token" element={<SharePage />} />
              <Route path="/share" element={<SharePage />} />

              {/* All other routes: handled via AuthenticatedApp */}
              <Route path="*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
          <SonnerToaster richColors position="top-center" />
        </QueryClientProvider>
      </AuthProvider>
  );
}

export default App;
