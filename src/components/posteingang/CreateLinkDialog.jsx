import React, { useState, useRef } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { X, Upload, FileText, Calendar, Tag, MessageSquare, Building2 } from "lucide-react";
import {toast} from "sonner";

const CATEGORIES = [
    { key: "rechnungswesen", label: "01 - Rechnungswesen", icon: "\uD83D\uDCCA" },
    { key: "steuern",        label: "02 - Steuern",        icon: "\uD83D\uDCB0" },
    { key: "mwst",           label: "03 - Mehrwertsteuer", icon: "\uD83E\uDDFE" },
    { key: "revision",       label: "04 - Revision",       icon: "\uD83D\uDD0D" },
    { key: "rechtsberatung", label: "05 - Rechtsberatung", icon: "\u2696\uFE0F" },
    { key: "personal",       label: "06 - Personal",       icon: "\uD83D\uDC65" },
    { key: "korrespondenz",  label: "09 - Korrespondenz",  icon: "\u2709\uFE0F" },
];

export default function CreateLinkDialog({open, customers, preCustomer, allTags, onClose, s, border, accent, isArtis, BUCKET = "posteingang"}) {
    const [file, setFile] = useState(null);
    const [custId, setCustId] = useState(preCustomer?.id || "");
    const [name, setName] = useState("");
    const [tagIds, setTagIds] = useState([]);
    const [notes, setNotes] = useState("");
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef();
    const [dialogData, setDialogData] = useState({
        customerId: preCustomer || "",
        expiry: (() => {
            const d = new Date();
            d.setDate(d.getDate() + 14);
            return d.toISOString().split('T')[0];
        })(),
        tags: [],
        category: "steuern",
        year: new Date().getFullYear(),
        bucket: 'posteingang'
    });

    // Styles analog zu AddFristDialog.jsx
    const headerBg = isArtis ? "#e6ede6" : "#f8fafc";
    const labelCls = "text-xs font-semibold uppercase tracking-wide mb-1 block";
    const inStyle = {
        backgroundColor: s.inputBg,
        borderColor: border,
        color: s.textMain,
        borderRadius: "6px"
    };

    async function createUploadLink(){
        if (!custId) return toast.error("Bitte einen Kunden wählen");

        // Base64 Hash generieren
        const hash = btoa(JSON.stringify(dialogData));
        const url = `${window.location.origin}/upload/${hash}`;

        // In neuem Tab öffnen & Zwischenablage
        window.open(url, '_blank', 'noopener,noreferrer');
        navigator.clipboard.writeText(url);
        toast.success("Link wurde kopiert & geöffnet", { position: "top-center" });
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-xl p-0 overflow-hidden gap-0" style={{ backgroundColor: s.cardBg, borderColor: border, color: s.textMain }}>
                {/* ── Header ── */}
                <DialogHeader className="px-5 pt-4 pb-3 border-b" style={{ backgroundColor: headerBg, borderColor: border }}>
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        Kunden Link für Dateiupload erstellen
                    </DialogTitle>
                </DialogHeader>

                {/* ── Body ── */}
                <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
                    {/* Kunde */}
                    <div>
                        <label className={labelCls} style={{ color: s.textMuted }}>
                            <Building2 size={12} className="inline mr-1 mb-0.5" /> Kunde *
                        </label>
                        <select
                            value={custId}
                            onChange={(e) => {setDialogData({
                                ...dialogData,
                                customerId: e.target.value
                            }), setCustId(e.target.value)}}
                            className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none cursor-pointer"
                            style={inStyle}
                        >
                            <option value="">-- Kunde wählen --</option>
                            {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                        </select>
                    </div>

                    {/* Kategorie | Jahr */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls} style={{ color: s.textMuted }}>Kategorie</label>
                            <select
                                value={dialogData.category}
                                onChange={(e) => setDialogData({
                                    ...dialogData,          // Kopiert expiry und tags
                                    category: e.target.value
                                })}
                                className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none cursor-pointer"
                                style={inStyle}
                            >
                                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls} style={{ color: s.textMuted }}>
                                <Calendar size={12} className="inline mr-1 mb-0.5" /> Steuerjahr *
                            </label>
                            <input
                                type="number"
                                value={dialogData.year}
                                onChange={(e) => setDialogData({
                                    ...dialogData,
                                    year: e.target.value
                                })}
                                className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                                style={{ ...inStyle, borderColor: !dialogData.year ? "#ef4444" : border }}
                            />
                        </div>
                    </div>

                    {/* Tags Section */}
                    {/*<div className="rounded-lg p-3" style={{ backgroundColor: "rgba(122,155,127,0.06)", border: `1px solid ${border}` }}>
                        <label className={labelCls} style={{ color: s.textMuted }}>
                            <Tag size={12} className="inline mr-1 mb-0.5" /> Tags
                        </label>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {allTags.map(tag => {
                                const isSel = tagIds.includes(tag.id);
                                return (
                                    <button
                                        key={tag.id}
                                        onClick={() => setTagIds(prev => isSel ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                                        className="px-2.5 py-1 rounded text-[11px] font-medium transition-all"
                                        style={{
                                            backgroundColor: isSel ? accent : s.inputBg,
                                            color: isSel ? "#fff" : s.textMuted,
                                            border: `1px solid ${isSel ? accent : border}`
                                        }}
                                    >
                                        {tag.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>*/}
                    {/* Ablaufdatum */}
                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide mb-1 block" style={{ color: s.textMuted }}>
                            Link gültig bis *
                        </label>
                        <div className="relative">
                            <input
                                type="date"
                                value={dialogData.expiry}
                                onChange={e => setDialogData({...dialogData, expiry: e.target.value})}
                                className="rounded-md border px-3 py-1.5 text-sm focus:outline-none w-full"
                                style={{ backgroundColor: s.inputBg, borderColor: border, color: s.textMain }}
                            />
                        </div>
                        <p className="text-[10px] mt-1.5" style={{ color: "#b91c1c" }}>
                            * Nach diesem Datum kann der Kunde keine Dateien mehr über diesen Link hochladen.
                        </p>
                    </div>
                </div>

                {/* ── Footer ── */}
                <DialogFooter className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ backgroundColor: headerBg, borderColor: border }}>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80"
                        style={{ color: s.textMuted }}
                    >
                        Abbrechen
                    </button>
                    <button
                        onClick={createUploadLink}
                        disabled={!custId}
                        className="px-4 py-1.5 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-40"
                        style={{ backgroundColor: accent }}
                    >
                        {uploading ? "Verarbeite..." : "Hochladen & Speichern"}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}