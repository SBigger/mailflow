import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/api/supabaseClient'
import { Camera, LogOut, RefreshCw, Upload, CheckCircle2, Image as ImageIcon } from 'lucide-react'
import { useTheme } from '@/components/useTheme'
import { useIsMobile } from '@/components/mobile/useIsMobile'

export default function MobileApp() {
    const isMobile = useIsMobile()
    const [session, setSession] = useState(null)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')

    // Kamera & Foto States
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const [photo, setPhoto] = useState(null)
    const [isCameraActive, setIsCameraActive] = useState(false)

    // Theme-Erkennung (analog zum Dashboard)
    const { theme } = useTheme()
    const isDark = theme === 'dark'
    const isArtis = theme === 'artis'

    // Dashboard-konforme Farb-Token
    const cardBg = isDark ? 'rgba(39,39,42,0.5)' : isArtis ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.85)'
    const cardBorder = isDark ? '#3f3f46' : isArtis ? '#bfcfbf' : '#d0d0dc'
    const headingColor = isDark ? '#e4e4e7' : isArtis ? '#1a3a1a' : '#1e293b'
    const textBody = isDark ? '#d4d4d8' : isArtis ? '#2d4a2d' : '#374151'
    const textMuted = isDark ? '#71717a' : isArtis ? '#5a7a5a' : '#6b7280'
    const accentColor = isDark ? '#818cf8' : isArtis ? '#7a9b7f' : '#7c3aed'
    const itemBg = isDark ? 'rgba(24,24,27,0.6)' : isArtis ? 'rgba(255,255,255,0.55)' : 'rgba(248,250,252,0.9)'
    const itemBorder = isDark ? 'rgba(63,63,70,0.5)' : isArtis ? 'rgba(191,207,191,0.6)' : 'rgba(203,213,225,0.6)'

    // Auth Status überwachen
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })

        return () => subscription.unsubscribe()
    }, [])

    // Login Funktion
    const handleLogin = async (e) => {
        e.preventDefault()
        setLoading(true)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) alert(error.message)
        setLoading(false)
    }

    // Logout Funktion
    const handleLogout = async () => {
        await supabase.auth.signOut()
        stopCamera()
    }

    // Kamera starten (nutzt 'environment' für Rückkamera auf Smartphones)
    const startCamera = async () => {
        setIsCameraActive(true)
        setMessage('')
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            if (videoRef.current) {
                videoRef.current.srcObject = stream
            }
        } catch (err) {
            console.error("Kamerafehler:", err)
            alert("Kamera konnte nicht gestartet werden.")
            setIsCameraActive(false)
        }
    }

    // Kamera stoppen
    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject
            stream.getTracks().forEach(track => track.stop())
            videoRef.current.srcObject = null
        }
        setIsCameraActive(false)
    }

    // Foto aufnehmen
    const capturePhoto = () => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) return

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob((blob) => {
            setPhoto(blob)
            stopCamera()
        }, 'image/jpeg')
    }

    // Foto in Supabase speichern (Storage + Datenbank)
    const uploadPhoto = async () => {
        if (!photo) return
        setLoading(true)
        setMessage('')

        try {
            const fileName = `${session.user.id}/${Date.now()}.jpg`

            // 1. Bild in Supabase Storage hochladen
            const { error: uploadError } = await supabase.storage
                .from('fibu-foto-app')
                .upload(fileName, photo)

            if (uploadError) throw uploadError

            // 2. Öffentliche URL abrufen
            const { data: { publicUrl } } = supabase.storage
                .from('fibu-foto-app')
                .getPublicUrl(fileName)

            // 3. Metadaten in Tabelle speichern
            const { error: dbError } = await supabase
                .from('fibu_photo_app_metadata')
                .insert([{ user_id: session.user.id, image_url: publicUrl }])

            if (dbError) throw dbError

            setMessage('Foto erfolgreich gespeichert!')
            setPhoto(null)
        } catch (error) {
            console.error(error)
            alert('Fehler beim Speichern: ' + error.message)
        } finally {
            setLoading(false)
        }
    }

    // Wenn nicht eingeloggt: Login-Ansicht im Dashboard-Card-Style
    if (!session) {
        return (
            <div className="flex flex-col h-full w-full items-center justify-center p-6 font-sans">
                <div className="w-full max-w-md rounded-xl border p-6 shadow-sm" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                    <div className="flex items-center gap-3 mb-6">
                        <Camera className="h-6 w-6" style={{ color: accentColor }} />
                        <h1 className="text-xl font-bold" style={{ color: headingColor }}>Login / Registrierung</h1>
                    </div>
                    <form onSubmit={handleLogin} className="flex flex-col gap-4">
                        <input
                            type="email"
                            placeholder="E-Mail"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="p-2.5 rounded-lg border text-sm focus:outline-none"
                            style={{ backgroundColor: itemBg, borderColor: cardBorder, color: headingColor }}
                        />
                        <input
                            type="password"
                            placeholder="Passwort"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="p-2.5 rounded-lg border text-sm focus:outline-none"
                            style={{ backgroundColor: itemBg, borderColor: cardBorder, color: headingColor }}
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="p-2.5 rounded-lg text-white font-medium text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                            style={{ backgroundColor: accentColor }}
                        >
                            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Einloggen'}
                        </button>
                    </form>
                </div>
            </div>
        )
    }

    // Wenn eingeloggt: Kamera-App-Ansicht im Dashboard-Layout
    return (
        <div className={`flex flex-col h-full w-full overflow-y-auto ${isMobile ? 'p-3' : 'p-6'} max-w-2xl mx-auto font-sans`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b" style={{ borderColor: cardBorder }}>
                <div className="flex items-center gap-3">
                    <Camera className="h-7 w-7" style={{ color: accentColor }} />
                    <div>
                        <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold`} style={{ color: headingColor }}>Smartis Fibu App</h1>
                        <p className="text-xs" style={{ color: textMuted }}>Eingeloggt als: {session.user.email}</p>
                    </div>
                </div>
            </div>

            {/* Haupt-Card Container */}
            <div className="rounded-xl border p-6 shadow-sm" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                <div className="text-center">
                    {!isCameraActive && !photo && (
                        <div className="py-12 flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                                <Camera className="h-8 w-8" />
                            </div>
                            <h2 className="text-lg font-semibold mb-2" style={{ color: headingColor }}>Bereit für ein Belegfoto?</h2>
                            <p className="text-xs mb-6 max-w-xs" style={{ color: textMuted }}>Starte die Kamera, um ein Foto aufzunehmen und direkt in der Fibu zu speichern.</p>
                            <button
                                onClick={startCamera}
                                className="px-6 py-2.5 rounded-lg text-white font-medium text-sm transition-colors cursor-pointer shadow-sm flex items-center gap-2"
                                style={{ backgroundColor: accentColor }}
                            >
                                <Camera className="h-4 w-4" />
                                Kamera starten
                            </button>
                        </div>
                    )}

                    {isCameraActive && (
                        <div className="flex flex-col items-center">
                            <div className="relative w-full max-w-md overflow-hidden rounded-lg border mb-4 bg-black" style={{ borderColor: itemBorder }}>
                                <video ref={videoRef} autoPlay playsInline className="w-full h-auto block"></video>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={stopCamera}
                                    className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer"
                                    style={{ borderColor: cardBorder, color: headingColor, backgroundColor: itemBg }}
                                >
                                    Abbrechen
                                </button>
                                <button
                                    onClick={capturePhoto}
                                    className="px-6 py-2 rounded-lg text-white font-medium text-sm shadow-sm flex items-center gap-2 cursor-pointer"
                                    style={{ backgroundColor: accentColor }}
                                >
                                    <Camera className="h-4 w-4" />
                                    Foto aufnehmen 📸
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Unsichtbares Canvas für die Bildverarbeitung */}
                    <canvas ref={canvasRef} className="hidden"></canvas>

                    {photo && (
                        <div className="flex flex-col items-center">
                            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: headingColor }}>
                                <ImageIcon className="h-4 w-4" style={{ color: accentColor }} />
                                Vorschau
                            </h3>
                            <div className="w-full max-w-md overflow-hidden rounded-lg border mb-4" style={{ borderColor: itemBorder, backgroundColor: itemBg }}>
                                <img src={URL.createObjectURL(photo)} alt="Vorschau" className="w-full h-auto block" />
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setPhoto(null); startCamera(); }}
                                    className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer"
                                    style={{ borderColor: cardBorder, color: headingColor, backgroundColor: itemBg }}
                                >
                                    Neu machen
                                </button>
                                <button
                                    onClick={uploadPhoto}
                                    disabled={loading}
                                    className="px-5 py-2 rounded-lg text-white font-medium text-sm shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
                                    style={{ backgroundColor: '#10b981' }}
                                >
                                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                    {loading ? 'Speichere...' : 'In Supabase speichern'}
                                </button>
                            </div>
                        </div>
                    )}

                    {message && (
                        <div className="mt-4 p-3 rounded-lg border flex items-center justify-center gap-2 text-xs font-medium" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#059669' }}>
                            <CheckCircle2 className="h-4 w-4" />
                            {message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}