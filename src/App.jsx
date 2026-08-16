import React, {lazy, Suspense, useEffect} from 'react';
import {Toaster} from "@/components/ui/toaster";
import {Toaster as SonnerToaster} from "sonner";
import {QueryClientProvider, QueryClient} from '@tanstack/react-query';
import {BrowserRouter as Router, Route, Routes, Navigate, useNavigate} from 'react-router-dom';
import {AuthProvider, useAuth} from '@/lib/AuthContext';
import {Loader2} from 'lucide-react';
import {FEATURE_LEISTUNGSERFASSUNG} from "@/lib/featureFlags";
import Layout from './Layout';
import { TelephonyProvider } from "./modules/telefonie/context/TelephonyContext.jsx";

// --- Lade-Komponente für Suspense ---
const PageLoader = () => (
    <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin"/>
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
const Chartis = lazy(() => import('./pages/Chartis'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const Kundenportal = lazy(() => import('./pages/Kundenportal'));
const ArtisTools = lazy(() => import('./pages/ArtisTools'));
const BriefSchreiben = lazy(() => import('./modules/tools/BriefSchreiben.jsx'));
const Fahrzeugliste = lazy(() => import('./modules/tools/Fahrzeugliste.jsx'));
const Aktienbuch = lazy(() => import('./modules/tools/Aktienbuch.jsx'));
const Unterschriften = lazy(() => import('./modules/tools/Unterschriften.jsx'));
const Abschlussdokumentation = lazy(() => import('./modules/tools/Abschlussdokumentation.jsx'));
const Anlagebuchhaltung = lazy(() => import('./modules/tools/Anlagebuchhaltung.jsx'));
const Whiteboard = lazy(() => import('./modules/tools/Whiteboard.jsx'));
const Firmensuche = lazy(() => import('./pages/Firmensuche'));
const Auswertungen = lazy(() => import('./pages/Auswertungen'));
const Steuern = lazy(() => import('./modules/tools/Steuern.jsx'));
const Belegsortierung = lazy(() => import('./modules/tools/Belegsortierung.jsx'));
const Veranlagungen = lazy(() => import('./modules/tools/Veranlagungen.jsx'));
const Login = lazy(() => import('./pages/Login'));
const ResetPassword = lazy(() => import('./modules/login/ResetPassword.jsx'));
const MFASetup = lazy(() => import("./modules/login/MFASetup.jsx"));
const MFALogin = lazy(() => import("./modules/login/MFALogin.jsx"));
const SetPassword = lazy(() => import("./modules/login/SetPassword.jsx"));
const DokumentUploadKunden = lazy(() => import("./pages/DokumentUploadKunden.jsx"));
const Posteingang = lazy(() => import("./pages/Posteingang.jsx"));
const SharePage = lazy(() => import("./pages/SharePage.jsx"));
const Portal = lazy(() => import("./modules/kundenportal/Portal.jsx"));
const Leistungserfassung = lazy(() => import("./pages/Leistungserfassung.jsx"));
const Promptvorlagen = lazy(() => import("./modules/tools/Promptvorlagen.jsx"));
const TelefonDashboard = lazy(() => import("./modules/tools/TelefonDashboard.jsx"));
const Telefonliste = lazy(() => import("./pages/Telefonliste.jsx"));
const Jahresplanung = lazy(() => import("./modules/tools/Jahresplanung.jsx"));
const Monatsplanung = lazy(() => import("./modules/tools/Monatsplanung.jsx"));
const Kalender = lazy(() => import("./modules/tools/Kalender.jsx"));
const Steuerausscheidung = lazy(() => import("./modules/tools/Steuerausscheidung.jsx"));
const FiBuRouter = lazy(() => import("./modules/fibu/router.jsx"));
const TelefonieRouter = lazy(() => import("./modules/telefonie/router.jsx"));
const VideoRouter = lazy(() => import("./modules/video/router.jsx"));
const MeetGuest = lazy(() => import("./modules/video/pages/MeetGuest.jsx"));
const GlobalSoftphone = lazy(() => import("./modules/telefonie/components/Softphone.jsx"));
const Hub = lazy(() => import('./pages/Hub.jsx'));
const AiAssistant = lazy(() => import('./pages/AiAssistant.jsx'));
const GVProtokollApp = lazy(() => import('./modules/gv-protokoll/GVProtokollApp.jsx'));

const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: 1, staleTime: 30000}}
});

function AuthenticatedApp() {
    const {user, loading, requiresMfa, profile} = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const check = setInterval(() => {
            if (window.__SMARTIS_EXCEL_UPLOAD__ && user) {
                navigate('/Dokumente');
            }
        }, 300);
        return () => clearInterval(check);
    }, [user, navigate]);

    if (loading) return <PageLoader/>;
    if (!user) return <Login/>;
    if (requiresMfa) return <MFALogin/>;

    return (
        // Ein einziger Suspense-Wrapper fängt alle darunter liegenden Lazy-Komponenten ab
        <Suspense fallback={<PageLoader />}>
            <TelephonyProvider>
            <Routes>
                {/* FiBu: eigene Shell, kein MailFlow-Layout */}
                <Route path="/fibu/*" element={<FiBuRouter />} />

                {/* Telefonie: eigene Shell + Softphone, kein MailFlow-Layout */}
                <Route path="/telefonie/*" element={<TelefonieRouter />} />

                {/* Besprechungen (Video): eigene Shell, kein MailFlow-Layout */}
                <Route path="/besprechungen/*" element={<VideoRouter />} />

                {/* MailFlow: Layout als Wrapper-Route (Layout muss im Inneren ein <Outlet /> nutzen!) */}
                <Route element={<Layout />}>
                    <Route path="/" element={<Navigate to="/Dashboard" replace />} />
                    <Route path="/Hub" element={<Hub />} />
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
                    <Route path="/Chartis" element={<Chartis/>}/>
                    <Route path="/Posteingang" element={<Posteingang />} />
                    <Route path="/UserManagement" element={<UserManagement />} />
                    <Route path="/Kundenportal" element={<Kundenportal />} />
                    <Route path="/ArtisTools" element={<ArtisTools />} />
                    <Route path="/BriefSchreiben" element={<BriefSchreiben />} />
                    <Route path="/Fahrzeugliste" element={<Fahrzeugliste />} />
                    <Route path="/Aktienbuch" element={<Aktienbuch />} />
                    <Route path="/Unterschriften" element={<Unterschriften />} />
                    <Route path="/Abschlussdokumentation" element={<Abschlussdokumentation />} />
                    <Route path="/Anlagebuchhaltung" element={<Anlagebuchhaltung />} />
                    <Route path="/Whiteboard" element={<Whiteboard />} />
                    <Route path="/Firmensuche" element={<Firmensuche />} />
                    <Route path="/Auswertungen" element={<Auswertungen />} />
                    <Route path="/Steuern" element={<Steuern />} />
                    <Route path="/Belegsortierung" element={<Belegsortierung />} />
                    <Route path="/Veranlagungen" element={<Veranlagungen />} />
                    <Route path="/Promptvorlagen" element={<Promptvorlagen />} />
                    <Route path="/TelefonDashboard" element={<TelefonDashboard />} />
                    <Route path="/Telefonliste" element={<Telefonliste />} />
                    <Route path="/Jahresplanung" element={<Jahresplanung />} />
                    <Route path="/Monatsplanung" element={<Monatsplanung />} />
                    <Route path="/Kalender" element={<Kalender />} />
                    <Route path="/Steuerausscheidung" element={<Steuerausscheidung />} />
                    <Route path="/GVProtokollApp" element={<GVProtokollApp/>} />
                    {profile?.modules?.ai && (
                        <Route path="/AiAssistant" element={<AiAssistant />} />
                    )}

                    {FEATURE_LEISTUNGSERFASSUNG && (
                        <Route path="/Leistungserfassung" element={<Leistungserfassung />} />
                    )}

                    {/* Fängt falsche URLs innerhalb des Layouts ab */}
                    <Route path="*" element={<Navigate to="/Dashboard" replace />} />
                </Route>

                {/* Fängt völlig unbekannte URLs außerhalb des Layouts ab */}
                <Route path="*" element={<Navigate to="/Dashboard" replace />} />
            </Routes>
            {/* Globales Softphone: schwebt über der ganzen App (innerhalb wie ausserhalb des Layouts) */}
            <Suspense fallback={null}><GlobalSoftphone /></Suspense>
            </TelephonyProvider>
        </Suspense>
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
                    <Routes>
                        <Route path="/set-password"
                               element={<Suspense fallback={<PageLoader/>}><SetPassword/></Suspense>}/>
                        <Route path="/reset-password"
                               element={<Suspense fallback={<PageLoader/>}><ResetPassword/></Suspense>}/>
                        <Route path="/mfa-setup" element={<Suspense fallback={<PageLoader/>}><MFASetup/></Suspense>}/>
                        <Route path="/mfa-login" element={<Suspense fallback={<PageLoader/>}><MFALogin/></Suspense>}/>
                        <Route path="/upload/:hash"
                               element={<Suspense fallback={<PageLoader/>}><DokumentUploadKunden/></Suspense>}/>
                        <Route path="/share/:token"
                               element={<Suspense fallback={<PageLoader/>}><SharePage/></Suspense>}/>
                        <Route path="/share" element={<Suspense fallback={<PageLoader/>}><SharePage/></Suspense>}/>

                        {/* Besprechung als Gast — bewusst AUSSERHALB der Anmeldung:
                            Kunden haben kein smartis-Konto, sie kommen nur mit dem
                            Link aus der Termineinladung. Der Warteraum entscheidet,
                            wer wirklich hereinkommt. */}
                        <Route path="/meet/:room"
                               element={<Suspense fallback={<PageLoader/>}><MeetGuest/></Suspense>}/>
                        <Route path="/portal" element={<Suspense fallback={<PageLoader/>}><Portal/></Suspense>}/>
                        <Route path="*" element={<AuthenticatedApp/>}/>
                    </Routes>
                </Router>
                <Toaster/>
                <SonnerToaster richColors position="top-center"/>
            </QueryClientProvider>
        </AuthProvider>
    );
}

export default App;
