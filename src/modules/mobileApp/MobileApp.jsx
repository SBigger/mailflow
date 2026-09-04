import React, { useState, useRef } from 'react'
import { supabase } from '../../api/supabaseClient'
import { Camera, RefreshCw, Upload, CheckCircle2, Image as ImageIcon, Zap, ZapOff } from 'lucide-react'
import { useTheme } from '@/components/useTheme'
import { useIsMobile } from '@/components/mobile/useIsMobile'
import { useAuth } from "../../lib/AuthContext.jsx";

export default function MobileApp() {
    const isMobile = useIsMobile()
    const { user } = useAuth();
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')

    // Kamera & Foto States
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const [photo, setPhoto] = useState(null)
    const [isCameraActive, setIsCameraActive] = useState(false)
    const [isTorchOn, setIsTorchOn] = useState(false)
    const [torchSupported, setTorchSupported] = useState(false)

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

    // Kamera starten (nutzt 'environment' für Rückkamera auf Smartphones)
    const startCamera = async () => {
        setIsCameraActive(true)
        setMessage('')
        setIsTorchOn(false)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            })
            if (videoRef.current) {
                videoRef.current.srcObject = stream
            }

            // Prüfen, ob das Gerät eine Taschenlampe/Blitz unterstützt
            const track = stream.getVideoTracks()[0]
            const capabilities = track.getCapabilities ? track.getCapabilities() : {}
            if (capabilities.torch) {
                setTorchSupported(true)
            } else {
                setTorchSupported(false)
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
            stream.getTracks().forEach(track => {
                // Blitz vorher ausschalten, falls er noch an war
                if (isTorchOn) {
                    track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {})
                }
                track.stop()
            })
            videoRef.current.srcObject = null
        }
        setIsCameraActive(false)
        setIsTorchOn(false)
        setTorchSupported(false)
    }

    // Blitz umschalten (An/Aus)
    const toggleTorch = async () => {
        if (!videoRef.current || !videoRef.current.srcObject) return
        const track = videoRef.current.srcObject.getVideoTracks()[0]
        if (!track) return

        try {
            const newTorchState = !isTorchOn
            await track.applyConstraints({
                advanced: [{ torch: newTorchState }]
            })
            setIsTorchOn(newTorchState)
        } catch (err) {
            console.error("Fehler beim Umschalten des Blitzes:", err)
            alert("Blitz konnte nicht gesteuert werden.")
        }
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
            const fileName = `${user.id}/${Date.now()}.jpg`

            // 1. Bild in Supabase Storage hochladen
            const { error: uploadError } = await supabase.storage
                .from('fibu-foto-app')
                .upload(fileName, photo)

            if (uploadError) throw uploadError

            // 2. Öffentliche URL abrufen
            const { data: { publicUrl } } = supabase.storage
                .from('fibu-foto-app')
                .getPublicUrl(fileName)

            // 3. Metadaten in Tabelle speichern (Korrigiert: user.id statt session.user.id)
            const { error: dbError } = await supabase
                .from('fibu_photo_app_metadata')
                .insert([{ user_id: user.id, image_url: publicUrl }])

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

    return (
        <div className={`flex flex-col w-full align-center justify-center overflow-y-auto ${isMobile ? 'p-3' : 'p-6'} max-w-2xl mx-auto font-sans`}>
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

                                {/* Blitz-Button overlay (wird nur angezeigt, wenn Hardware es unterstützt) */}
                                {torchSupported && (
                                    <button
                                        onClick={toggleTorch}
                                        className="absolute top-3 right-3 p-2.5 rounded-full shadow-md backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
                                        style={{
                                            backgroundColor: isTorchOn ? 'rgba(234, 179, 8, 0.9)' : 'rgba(0, 0, 0, 0.6)',
                                            color: isTorchOn ? '#000' : '#fff'
                                        }}
                                        title={isTorchOn ? "Blitz ausschalten" : "Blitz einschalten"}
                                    >
                                        {isTorchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                                    </button>
                                )}
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