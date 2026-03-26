import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function MFALogin() {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleVerify = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // 1. Aktive Faktoren abrufen
            const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
            if (factorError) throw factorError;

            // Wir nehmen den ersten aktiven TOTP-Faktor
            const totpFactor = factors.totp[0];
            if (!totpFactor) throw new Error("Kein MFA-Faktor gefunden.");

            const factorId = totpFactor.id;

            // 2. Challenge & Verify
            const { data: challenge, error: challengeError } =
                await supabase.auth.mfa.challenge({ factorId });
            if (challengeError) throw challengeError;

            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.id,
                code,
            });

            if (verifyError) throw verifyError;

            toast.success("Erfolgreich angemeldet!");
            navigate("/Dashboard");
        } catch (err) {
            toast.error("Code falsch oder abgelaufen.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#f2f5f2]">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#ccd8cc] p-8 text-center">
                <ShieldCheck className="h-12 w-12 text-[#7c9881] mx-auto mb-4" />
                <h1 className="text-xl font-bold text-[#2d3a2d]">Zwei-Faktor-Check</h1>
                <p className="text-sm text-[#6b826b] mb-6">Bitte gib den Code aus deiner App ein.</p>

                <form onSubmit={handleVerify} className="space-y-4 text-left">
                    <Input
                        type="text"
                        placeholder="000000"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="text-center text-2xl tracking-[0.3em] h-14"
                        style={{ backgroundColor: '#f2f5f2', border: '1px solid #bfcfbf' }}
                        required
                        autoFocus
                    />
                    <Button
                        type="submit"
                        disabled={loading || code.length < 6}
                        className="w-full h-12 text-white font-semibold"
                        style={{ backgroundColor: '#7c9881' }}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : "Verifizieren"}
                    </Button>
                </form>
            </div>
        </div>
    );
}