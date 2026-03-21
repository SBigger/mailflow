import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

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
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Layout from './Layout';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } }
});

function AuthenticatedApp() {
  const { user, loading } = useAuth();

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
        <Route path="/UserManagement" element={<UserManagement />} />
        <Route path="/ArtisTools" element={<ArtisTools />} />
        <Route path="*" element={<Navigate to="/Dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Router>
          <Routes>
            {/* Passwort-Reset: zugänglich ohne Login */}
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Alle anderen Routen: benötigen Auth */}
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
