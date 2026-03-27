import React, { useState, useEffect } from "react";
import {entities, supabase} from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2, Lock, Loader2 } from "lucide-react";
import artisLogo from '/artis-logo.png';

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState(false);
  const [user, setUser] = useState({});
  const [sessionReady, setSessionReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Prüfen, ob wir eine Session haben (kommt via URL-Hash vom Invite-Link)
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const { data, err } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (data?.nextLevel === 'aal2' && data?.nextLevel !== data?.currentLevel) {
          navigate('/mfa-login', { state: { redirect: '/reset-password' } });
        }
        
        setSessionReady(true);
      } else {
        // Falls nach 2 Sek. keine Session da ist, war der Link evtl. abgelaufen
        setTimeout(() => {
          if (!sessionReady) toast.error("Sitzung abgelaufen oder ungültiger Link.");
        }, 2000);
      }
    };
    checkSession();
  }, [sessionReady]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwörter stimmen nicht überein");
      return;
    }
    if (password.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen haben");
      return;
    }

    setLoading(true);
    try {
      const { data, error} = await supabase.auth.updateUser({ password });
      if (error) throw error;

      let route = "";
      let inviteState = 0;
      const response = await entities.User.get(data?.user.id);
      switch (response.inviteState) {
        case 0:
          route = "/mfa-setup";
          inviteState = 1;
          break;
        case 1:
          route = "/Dashboard";
          inviteState = 2;
          break;
      }
      const { err } = await entities.User.update(data?.user.id, { inviteState: inviteState });
      if (err) throw err;

      setDone(true);
      toast.success("Passwort erfolgreich gesetzt!");
      setTimeout(() => navigate(route), 2000);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f2f5f2' }}>
        <div className="w-full max-w-sm">
          {/* Logo & Header */}
          <div className="text-center mb-8">
            <img src={artisLogo} alt="Artis" className="w-20 h-20 mb-4 mx-auto object-contain" />
            <h1 className="text-2xl font-bold" style={{ color: '#2d3a2d' }}>Artis MailFlow</h1>
            <p className="text-sm mt-1" style={{ color: '#6b826b' }}>Sicherheit & Account-Setup</p>
          </div>

          {/* Card Container */}
          <div className="rounded-2xl p-7 shadow-sm border" style={{ backgroundColor: '#ffffff', borderColor: '#ccd8cc' }}>
            {done ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CheckCircle2 className="h-12 w-12" style={{ color: '#7c9881' }} />
                  <h2 className="text-lg font-semibold" style={{ color: '#2d3a2d' }}>Passwort gespeichert!</h2>
                  <p className="text-sm" style={{ color: '#6b826b' }}>Du wirst zum Dashboard weitergeleitet…</p>
                </div>
            ) : !sessionReady ? (
                <div className="text-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" style={{ color: '#7c9881' }} />
                  <p style={{ color: '#6b826b' }} className="text-sm">Verifizierung läuft...</p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <p className="text-sm mb-2" style={{ color: '#4a5e4a' }}>
                    Bitte lege dein persönliches Passwort fest.
                  </p>

                  {/* Passwort Feld */}
                  <div>
                    <label className="block text-xs mb-1.5 font-bold uppercase tracking-wider" style={{ color: '#8aaa8f' }}>
                      Neues Passwort
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#8aaa8f' }} />
                      <Input
                          type={showPw ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          required
                          className="pl-10 h-11"
                          style={{ backgroundColor: '#f2f5f2', border: '1px solid #bfcfbf', color: '#2d3a2d' }}
                      />
                      <button
                          type="button"
                          onClick={() => setShowPw(!showPw)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                          style={{ color: '#8aaa8f' }}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Bestätigung Feld */}
                  <div>
                    <label className="block text-xs mb-1.5 font-bold uppercase tracking-wider" style={{ color: '#8aaa8f' }}>
                      Passwort bestätigen
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#8aaa8f' }} />
                      <Input
                          type="password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="••••••••"
                          required
                          className="pl-10 h-11"
                          style={{ backgroundColor: '#f2f5f2', border: '1px solid #bfcfbf', color: '#2d3a2d' }}
                      />
                    </div>
                  </div>

                  <Button
                      type="submit"
                      disabled={loading}
                      className="w-full h-11 text-white font-semibold transition-all"
                      style={{ backgroundColor: '#7c9881', borderRadius: '10px' }}
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : user?.inviteState === 1 ? "Konto aktivieren" : "Passwort zurücksetzen"}
                  </Button>
                </form>
            )}
          </div>

          <p className="text-center text-xs mt-8" style={{ color: '#8aaa8f' }}>
            © 2026 Artis Treuhand GmbH · MailFlow
          </p>
        </div>
      </div>
  );
}