/**
 * Anmeldung.
 *
 * Bewusst schlicht: E-Mail und Passwort über Supabase Auth. Die Registrierung
 * läuft nicht selbstbedient — wer Zugriff auf Steuerdossiers bekommt, wird
 * eingeladen, nicht angemeldet.
 */
import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Landmark, Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);

  async function anmelden(e) {
    e.preventDefault();
    setFehler(null);
    setLaeuft(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: passwort });
    setLaeuft(false);
    if (error) setFehler(error.message);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={anmelden}
            className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-slate-400" />
          <h1 className="text-lg font-semibold">Steuern nP</h1>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600" htmlFor="email">E-Mail</label>
          <input id="email" type="email" required autoComplete="username"
                 value={email} onChange={e => setEmail(e.target.value)}
                 className="w-full border border-slate-300 rounded-md px-2 h-9 text-sm" />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600" htmlFor="pw">Passwort</label>
          <input id="pw" type="password" required autoComplete="current-password"
                 value={passwort} onChange={e => setPasswort(e.target.value)}
                 className="w-full border border-slate-300 rounded-md px-2 h-9 text-sm" />
        </div>

        {fehler && (
          <p className="text-sm text-rose-600" role="alert">{fehler}</p>
        )}

        <Button type="submit" className="w-full" disabled={laeuft}>
          {laeuft && <Loader2 className="w-4 h-4 animate-spin" />}
          Anmelden
        </Button>

        <p className="text-[11px] text-slate-500">
          Zugänge werden vergeben, nicht selbst angelegt. Steuerdossiers unterliegen dem
          Steuergeheimnis.
        </p>
      </form>
    </div>
  );
}
