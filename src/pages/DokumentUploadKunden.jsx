import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {Upload, FileText, Loader2, AlertCircle, Trash2} from 'lucide-react';
import artisLogo from '/artis-logo.png';
import { toast } from "sonner";
import {supabase} from "../api/supabaseClient.js";

export default function DokumentUploadKunden() {
    const { hash } = useParams(); // URL format: /upload/:hash
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [isValid, setIsValid] = useState(true);
    const [files, setFiles] = useState([]);

    // 1. Decode and Validate Hash on mount
    useEffect(() => {
        try {
            // Assuming hash is base64 encoded JSON
            const decodedData = JSON.parse(atob(hash));
            const { expiry, customerId, tags, bucket, category, year } = decodedData;

            // Check Expiry (Date string or timestamp)
            if (new Date() > new Date(expiry)) {
                setIsValid(false);
                toast.error("Dieser Link ist leider abgelaufen.");
            } else {
                setConfig({ customerId, tags, bucket, expiry, category, year });
            }
        } catch (err) {
            setIsValid(false);
            toast.error("Ungültiger Link.");
        }
    }, [hash]);

    const handleFileChange = (e) => {
        setFiles(files => [...files, ...Array.from(e.target.files)]);
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!files.length || !config) return;

        setUploading(true);
        try {
            for (const file of files) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}@${file.name}`;
                const filePath = `${config.customerId}/${config.category}_${config.year}_${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from(config.bucket)
                    .upload(filePath, file, {
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                //await supabase.from('incoming_docs').insert({ customer_id: config.customerId, path: filePath, tags: config.tags });
            }

            toast.success("Dateien erfolgreich hochgeladen!");
            setFiles([]);
        } catch (err) {
            toast.error("Upload fehlgeschlagen: " + err.message);
        } finally {
            setUploading(false);
        }
    };

    if (!isValid) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-[#f2f5f2]">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-[#2d3a2d]">Link ungültig oder abgelaufen</h1>
                    <p className="text-[#6b826b]">Bitte fordern Sie einen neuen Upload-Link an.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f2f5f2' }}>
            <div className="w-full max-w-md">
                {/* Logo Section */}
                <div className="text-center mb-8">
                    <img src={artisLogo} alt="Artis Treuhand" className="w-24 h-24 mb-4 mx-auto object-contain" />
                    <h1 className="text-2xl font-bold" style={{ color: '#2d3a2d' }}>Dokumenten-Upload</h1>
                    <p className="text-sm mt-1" style={{ color: '#6b826b' }}>Sicherer Datei-Transfer für Kunden</p>
                    <h4 className="text-sm mt-1 text-red-600">Dieser Link ist noch bis <strong>{config?.expiry.split('-').reverse().join('-')}</strong> gültig</h4>
                </div>

                {/* Content Box */}
                <div className="rounded-2xl p-6 shadow-sm border" style={{ backgroundColor: '#ffffff', borderColor: '#ccd8cc' }}>
                    <div className="mb-6">
                        <div className="flex justify-center flex-wrap gap-2 mb-4">
                            {config?.tags?.map((tag, i) => (
                                <span key={i} className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold rounded" style={{ backgroundColor: '#e2eae2', color: '#4a5e4a' }}>
                                  {tag}
                                </span>
                            ))}
                            <span key={config?.category} className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold rounded" style={{ backgroundColor: '#e2eae2', color: '#4a5e4a' }}>
                                  {config?.category}
                                </span>
                            <span key={config?.year} className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold rounded" style={{ backgroundColor: '#e2eae2', color: '#4a5e4a' }}>
                                  {config?.year}
                                </span>
                        </div>
                        <p className="text-sm text-[#4a5e4a]">
                            Bitte laden Sie hier Ihre Dokumente für den Posteingang hoch.
                        </p>
                    </div>

                    <form onSubmit={handleUpload} className="space-y-4">
                        <div
                            className="border-2 border-dashed rounded-xl p-8 text-center transition-colors relative"
                            style={{ borderColor: '#bfcfbf', backgroundColor: '#f9faf9' }}
                        >
                            <input
                                type="file"
                                multiple
                                onChange={handleFileChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <Upload className="w-10 h-10 mx-auto mb-2" style={{ color: '#8aaa8f' }} />
                            <p className="text-sm font-medium" style={{ color: '#2d3a2d' }}>
                                {files.length > 0 ? `${files.length} Datei(en) ausgewählt` : "Klicken oder Dateien hierher ziehen"}
                            </p>
                            <p className="text-xs mt-1" style={{ color: '#8aaa8f' }}>PDF, JPG, PNG bis zu 10MB</p>
                        </div>

                        {files.length > 0 && (
                            <ul className="text-xs space-y-1 max-h-32 overflow-y-auto p-2 rounded bg-[#f2f5f2]">
                                {files.map((f, i) => (
                                    <li key={i} className="flex items-center gap-2 text-[#4a5e4a]">
                                        <FileText className="w-3 h-3" /> {f.name}
                                        <Trash2 size={16} className="ml-auto" onClick={() => {
                                            setFiles(files.filter(file => file.name !== f.name));
                                        }} style={{ cursor: "pointer", color: "#ef4444" }} />
                                    </li>
                                ))}
                            </ul>
                        )}

                        <button
                            type="submit"
                            disabled={uploading || files.length === 0}
                            className="w-full font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 text-white disabled:opacity-50"
                            style={{ backgroundColor: '#7a9b7f' }}
                            onMouseOver={e => e.currentTarget.style.backgroundColor = '#5f7d64'}
                            onMouseOut={e => e.currentTarget.style.backgroundColor = '#7a9b7f'}
                        >
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {uploading ? 'Wird hochgeladen...' : 'Dokumente senden'}
                        </button>
                    </form>
                </div>

                <p className="text-center text-xs mt-6" style={{ color: '#8aaa8f' }}>
                    ID: {config?.customerId} · Verschlüsselter Upload
                </p>
            </div>
        </div>
    );
}