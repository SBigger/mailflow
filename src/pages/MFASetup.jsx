import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { QRCodeSVG } from "qrcode.react"; // Einfache QR-Code Komponente
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck, Loader2, ArrowRight, Smartphone } from "lucide-react";
import {useNavigate} from "react-router-dom";

export default function MFASetup() {
    const [factorId, setFactorId] = useState("");
    const [qrCodeUrl, setQrCodeUrl] = useState("");
    const [verifyCode, setVerifyCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const navigate = useNavigate();

    // Schritt 1: MFA Enrollment initialisieren
    useEffect(() => {
        async function startEnroll() {
            try {
                const { data, error } = await supabase.auth.mfa.enroll({
                    factorType: "totp",
                    issuer: "Artis MailFlow",
                    friendlyName: "Hauptgerät",
                });

                if (error) throw error;

                setFactorId(data.id);
                setQrCodeUrl(data.totp.uri); // Das ist der Standard-URI für Authenticator-Apps
            } catch (err) {
                toast.error("MFA konnte nicht gestartet werden: " + err.message);
            } finally {
                setLoading(false);
            }
        }
        startEnroll();
    }, []);

    // Schritt 2: Den Code verifizieren und MFA aktivieren
    const handleVerify = async (e) => {
        e.preventDefault();
        setVerifying(true);

        try {
            // 1. Challenge erstellen
            const { data: challenge, error: challengeError } =
                await supabase.auth.mfa.challenge({ factorId });

            if (challengeError) throw challengeError;

            // 2. Mit dem Code des Users verifizieren
            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId,
                challengeId: challenge.id,
                code: verifyCode,
            });

            if (verifyError) throw verifyError;

            toast.success("2-Faktor-Authentifizierung erfolgreich aktiviert!");
            navigate("/Dashboard");
        } catch (err) {
            toast.error("Code ungültig: " + err.message);
        } finally {
            setVerifying(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#f2f5f2]">
                <Loader2 className="animate-spin h-8 w-8 text-[#7c9881]" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#f2f5f2]">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-[#ccd8cc] p-8">

                <div className="text-center mb-6">
                    <div className="bg-[#f2f5f2] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ShieldCheck className="h-8 w-8 text-[#7c9881]" />
                    </div>
                    <h1 className="text-2xl font-bold text-[#2d3a2d]">Sicherheit erhöhen</h1>
                    <p className="text-sm text-[#6b826b] mt-2">
                        Scanne den QR-Code mit deiner Authenticator-App (z.B. Google, Microsoft oder 1Password).
                    </p>
                </div>

                {/* QR Code Bereich */}
                <div className="flex justify-center p-4 bg-white border-2 border-dashed border-[#bfcfbf] rounded-xl mb-8">
                    {qrCodeUrl && (
                        <QRCodeSVG
                            value={qrCodeUrl}
                            size={200}
                            level="H"
                            includeMargin={true}
                        />
                    )}
                </div>

                {/* Bestätigungs-Formular */}
                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-[#8aaa8f] mb-2">
                            6-stelliger Bestätigungscode
                        </label>
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8aaa8f]" />
                            <Input
                                type="text"
                                placeholder="000 000"
                                value={verifyCode}
                                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                                maxLength={6}
                                className="pl-10 h-12 text-lg tracking-[0.5em] font-mono"
                                style={{ backgroundColor: '#f2f5f2', border: '1px solid #bfcfbf' }}
                                required
                            />
                        </div>
                    </div>

                    <Button
                        type="submit"
                        disabled={verifying || verifyCode.length < 6}
                        className="w-full h-12 text-white font-semibold rounded-xl transition-all"
                        style={{ backgroundColor: '#7c9881' }}
                    >
                        {verifying ? (
                            <Loader2 className="animate-spin h-5 w-5" />
                        ) : (
                            <span className="flex items-center gap-2">
                MFA Aktivieren <ArrowRight className="h-4 w-4" />
              </span>
                        )}
                    </Button>
                </form>

                <p className="text-center text-[10px] text-[#94a3b8] mt-6 leading-relaxed">
                    Speichere deine Recovery-Codes sicher ab, falls du den Zugriff auf dein Gerät verlierst.
                </p>
            </div>
        </div>
    );
}