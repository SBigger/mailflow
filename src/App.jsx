import { Toaster } from "@/components/ui/toaster";
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
import ReminderBoard from './pages/ReminderBoard';
import UserManagement from './pages/UserManagement';
import Login from './pages/Login';
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
        <Route path="/ReminderBoard" element={<ReminderBoard />} />
        <Route path="/UserManagement" element={<UserManagement />} />
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
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
