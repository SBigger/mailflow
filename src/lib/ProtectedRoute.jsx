import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute() {
    const { user, loading, hasPermission, getFirstAllowedRoute} = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin"/>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/Login" replace />;
    }

    // Sofortiger Check gegen den gecachten State im Context
    if (!hasPermission(location.pathname)) {
        // Externe User automatisch zur FiBu umleiten, andere zum Dashboard
        const fallbackRoute = getFirstAllowedRoute();
        return <Navigate to={fallbackRoute} replace />;
    }

    return <Outlet />;
}