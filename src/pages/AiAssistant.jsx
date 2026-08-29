import React, { useState, useContext, useRef, useEffect } from "react";
import { ThemeContext } from "@/Layout";
import {
    Bot,
    Send,
    Sparkles,
    Trash2,
    User,
    ArrowDownCircle,
    BrainCircuit,
    FileSearch,
    Calculator,
    ChevronDown,
    Search,
    X,
    Loader2
} from "lucide-react";
import {entities, supabase} from "@/api/supabaseClient.js";
import {useQuery} from "@tanstack/react-query";
import {sanitizeAiHtml} from "@/lib/sanitizeHtml.js";

const STORAGE_KEY = "ai-assistant-verlauf";

/**
 * Ruft das KI-Gateway auf.
 *
 * supabase.functions.invoke wird hier direkt verwendet (statt des Wrappers in
 * supabaseClient), weil dessen Error nur "non-2xx status code" sagt - die
 * eigentliche Fehlermeldung der Edge Function steckt in error.context.
 */
async function askGateway(body) {
    const { data, error } = await supabase.functions.invoke("mcp-server", { body });

    if (error) {
        let detail = "";
        try {
            const payload = await error.context?.json?.();
            detail = payload?.error || payload?.details || "";
        } catch {
            detail = "";
        }
        if (error.context?.status === 404) {
            throw new Error("Der KI-Dienst ist auf diesem Server nicht installiert (Edge Function 'mcp-server' fehlt).");
        }
        if (error.context?.status === 401) {
            throw new Error(detail || "Sitzung abgelaufen - bitte neu anmelden.");
        }
        throw new Error(detail || error.message || "Verbindung zum KI-Gateway fehlgeschlagen.");
    }

    if (data?.error) throw new Error(data.details ? `${data.error}: ${data.details}` : data.error);
    if (!data?.response) throw new Error("Keine Antwort erhalten.");

    return data;
}

const SUGGESTED_PROMPTS = [
    {
        id: "aktien",
        title: "Aktienbuch prüfen",
        description: "Hilf mir bei der Analyse einer komplexen Kapitalstruktur oder eines Aktiensplits nach OR 686.",
        icon: BrainCircuit,
        color: "#5b8a5b",
        bg: "#e8f2e8",
        prompt: "Ich brauche Unterstützung bei der Abbildung eines Aktiensplits im Aktienbuch nach Schweizer OR. Wie gehe ich vor?",
    },
    {
        id: "steuern",
        title: "Steuerausscheidung",
        description: "Fragen zu interkantonalen Steuerfaktoren, Quoten oder Satzbestimmungen für juristische Personen.",
        icon: Calculator,
        color: "#5b3b8a",
        bg: "#ece0f5",
        prompt: "Erkläre mir die gängige Praxis bei der interkantonalen Steuerausscheidung für eine Holding mit Liegenschaften in zwei Kantonen.",
    },
    {
        id: "analyse",
        title: "Belege analysieren",
        description: "Wie verbuche ich stille Reserven oder degressive Abschreibungen in der Anlagebuchhaltung?",
        icon: FileSearch,
        color: "#8a6a3b",
        bg: "#f5ede0",
        prompt: "Welche gesetzlichen Grenzen gelten im Schweizer Steuerrecht für die Bildung stiller Reserven auf dem Anlagevermögen?",
    },
];

// Wiederverwendbare Dropdown-Komponente mit Suchfunktion
function SearchableDropdown({ label, options, selectedValue, onSelect, themeStyles, disabled, isLoading }) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const dropdownRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.value === selectedValue);
    const filteredOptions = options.filter(o =>
        o.label?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Das Dropdown soll auch blockiert sein, wenn die Daten noch laden
    const isDropdownDisabled = disabled || isLoading;

    return (
        <div className="relative" ref={dropdownRef}>
            <div
                className="flex items-center rounded-xl border transition-all min-w-[140px] px-3 py-2"
                style={{
                    backgroundColor: themeStyles.cardBg,
                    borderColor: themeStyles.cardBorder,
                    opacity: isDropdownDisabled ? 0.4 : 1,
                    cursor: isDropdownDisabled ? "not-allowed" : "default"
                }}
            >
                {/* Klickbarer Bereich */}
                <button
                    type="button"
                    disabled={isDropdownDisabled}
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex-1 flex items-center justify-between gap-2 text-xs font-semibold text-left truncate disabled:cursor-not-allowed"
                    style={{ color: themeStyles.headingColor }}
                >
                    <span className="truncate">
                        {isLoading ? "Lädt..." : (selectedOption ? selectedOption.label : label)}
                    </span>

                    {/* Zeigt den Spinner, falls isLoading aktiv ist, andernfalls den Pfeil */}
                    {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: themeStyles.accent }} />
                    ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: themeStyles.subColor }} />
                    )}
                </button>

                {/* Löschen-Icon (X) */}
                {selectedValue && !isDropdownDisabled && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect("");
                        }}
                        className="ml-1.5 p-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                    >
                        <X className="w-3.5 h-3.5" style={{ color: themeStyles.subColor }} />
                    </button>
                )}
            </div>

            {/* Dropdown Menü-Inhalt */}
            {isOpen && !isDropdownDisabled && (
                <div
                    className="absolute z-50 mt-1 w-56 rounded-xl border p-2 shadow-xl flex flex-col gap-1.5"
                    style={{
                        backgroundColor: themeStyles.cardBg === "rgba(255,255,255,0.9)" || themeStyles.cardBg === "rgba(255,255,255,0.85)" ? "#ffffff" : "#222226",
                        borderColor: themeStyles.cardBorder
                    }}
                >
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border" style={{ borderColor: themeStyles.cardBorder }}>
                        <Search className="w-3.5 h-3.5" style={{ color: themeStyles.subColor }} />
                        <input
                            type="text"
                            placeholder="Suchen..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs w-full"
                            style={{ color: themeStyles.headingColor }}
                        />
                    </div>
                    <div className="max-h-40 overflow-y-auto flex flex-col custom-scrollbar">
                        {filteredOptions.length === 0 ? (
                            <div className="text-xs p-2 text-center" style={{ color: themeStyles.subColor }}>Keine Resultate</div>
                        ) : (
                            filteredOptions.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                        onSelect(opt.value);
                                        setIsOpen(false);
                                        setSearchTerm("");
                                    }}
                                    className="text-left text-xs px-2 py-1.5 rounded-lg transition-colors hover:opacity-80"
                                    style={{
                                        backgroundColor: selectedValue === opt.value ? themeStyles.accent : "transparent",
                                        color: selectedValue === opt.value ? "#ffffff" : themeStyles.headingColor
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AiAssistant() {
    const { theme } = useContext(ThemeContext);
    // Verlauf ueberlebt einen Reload/Seitenwechsel, aber nicht das Schliessen
    // des Tabs - es stehen Mandantendaten drin.
    const [messages, setMessages] = useState(() => {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    // States für ausgewählte Kunden und Mandanten
    const [selectedCustomer, setSelectedCustomer] = useState("");
    const [selectedMandant, setSelectedMandant] = useState("");

    useEffect(() => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
        } catch {
            /* Speicher voll oder gesperrt - der Verlauf im State bleibt trotzdem nutzbar */
        }
    }, [messages]);

    const { data: customers = [], isLoading: isLoadingCustomers } = useQuery({
        queryKey: ["customers"],
        queryFn: () => entities.Customer.list("company_name"),
        select: (data) => data.map(c => ({ value: c.id, label: c.company_name }))
    });

// 2. Mandanten-Query: Mappt 'id' zu 'value' und 'name' zu 'label'
    const { data: mandanten = [], isLoading: isLoadingMandanten } = useQuery({
        queryKey: ["fibu_mandanten"],
        queryFn: () => entities.FibuMandanten.list("name"),
        select: (data) => data.map(m => ({
            value: m.id,
            label: m.name,
        }))
    });

    const isLight = theme === "light";
    const isArtis = theme === "artis";
    const isDark = !isLight && !isArtis;

    // Farb-Mapping exakt passend zu deiner ArtisTools-Komponente
    const pageBg       = isLight ? "#f4f4f8"              : isArtis ? "#f2f5f2"              : "#2a2a2f";
    const cardBg       = isLight ? "rgba(255,255,255,0.9)" : isArtis ? "rgba(255,255,255,0.85)" : "rgba(39,39,42,0.8)";
    const cardBorder   = isLight ? "#e2e2ec"             : isArtis ? "#ccd8cc"              : "#3f3f46";
    const headingColor = isLight ? "#1e293b"           : isArtis ? "#1a3a1a"              : "#e4e4e7";
    const subColor     = isLight ? "#64748b"               : isArtis ? "#4a6a4a"              : "#a1a1aa";
    const accent       = isArtis ? "#7a9b7f"               : isLight  ? "#4f6aab"             : "#7c3aed";
    const headerIconBg = isLight ? "#f0f0fa"           : isArtis ? "#e8f2e8"              : "#3f3f46";
    const bubbleUser   = isArtis ? "#7a9b7f"               : isLight  ? "#4f6aab"             : "#6d28d9";

    const themeStyles = { cardBg, cardBorder, headingColor, subColor, accent };

    // Auto-Scroll zu neuesten Nachrichten
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async (textToSend) => {
        const text = (textToSend ?? input).trim();
        if (!text || isLoading) return;

        // Nur Rolle und Inhalt an die API - die Fehler-Bubbles und UI-Felder
        // gehoeren nicht in die Historie, die Claude sieht.
        const history = messages
            .filter((m) => !m.isError)
            .map((m) => ({ role: m.role, content: m.content }));

        setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: text }]);
        setInput("");
        setIsLoading(true);

        try {
            const data = await askGateway({
                messages: [...history, { role: "user", content: text }],
                customerId: selectedCustomer || null,
                customerName: customers.find((c) => c.value === selectedCustomer)?.label || null,
                mandantId: selectedMandant || null,
                mandantName: mandanten.find((m) => m.value === selectedMandant)?.label || null,
            });

            setMessages((prev) => [...prev, {
                id: Date.now() + 1,
                role: "assistant",
                content: data.response,
                toolCalls: data.tool_calls || [],
            }]);
        } catch (err) {
            setMessages((prev) => [...prev, {
                id: Date.now() + 1,
                role: "assistant",
                content: err.message || "Verbindung zum KI-Gateway fehlgeschlagen.",
                isError: true,
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = () => {
        setMessages([]);
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch { /* egal */ }
    };

    return (
        <div className="flex flex-col h-screen w-screen p-6 overflow-hidden" style={{ backgroundColor: pageBg }}>

            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: headerIconBg }}>
                        <Bot className="w-6 h-6" style={{ color: accent }} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: headingColor }}>{window.env?.CUSTOMER} AI</h1>
                        <p className="text-sm" style={{ color: subColor }}>Intelligenter Treuhand-Assistent</p>
                    </div>
                </div>

                {/* Dropdowns und "Verlauf leeren" nebeneinander */}
                <div className="flex items-center gap-3">
                    <SearchableDropdown
                        label="Kunde wählen"
                        options={customers}
                        selectedValue={selectedCustomer}
                        onSelect={setSelectedCustomer}
                        themeStyles={themeStyles}
                        isLoading={isLoadingCustomers}
                    />
                    <SearchableDropdown
                        label="FiBu Mandant wählen"
                        options={mandanten}
                        selectedValue={selectedMandant}
                        onSelect={setSelectedMandant}
                        themeStyles={themeStyles}
                        isLoading={isLoadingMandanten}
                    />

                    <button
                        onClick={handleClear}
                        className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl border transition-all hover:opacity-80 h-[34px]"
                        style={{ backgroundColor: cardBg, borderColor: cardBorder, color: subColor }} disabled={messages.length === 0}>
                        <Trash2 className="w-3.5 h-3.5" /> Verlauf leeren
                    </button>
                </div>
            </div>

            {/* ── Chat-Bereich / Dashboard ────────────────────────────── */}
            <div className="flex-1 overflow-auto mb-4 min-h-0 rounded-2xl p-4 transition-all" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
                {messages.length === 0 ? (
                    // Leerer Zustand: Zeigt Prompt-Kacheln im echten Kachel-Design
                    <div className="h-full flex flex-col justify-center items-center max-w-4xl mx-auto px-4">
                        <div className="text-center mb-8">
                            <Sparkles className="w-10 h-10 mx-auto mb-3" style={{ color: accent }} />
                            <h2 className="text-xl font-bold mb-2" style={{ color: headingColor }}>Wie kann ich dich heute entlasten?</h2>
                            <p className="text-sm max-w-md mx-auto" style={{ color: subColor }}>
                                Ich habe direkten Zugriff auf deine Mandantendaten, das Aktienbuch sowie Berechnungs-Tools. Wähle ein Thema oder starte direkt.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                            {SUGGESTED_PROMPTS.map(({ id, title, description, icon: Icon, color, bg, prompt }) => (
                                <div
                                    key={id}
                                    onClick={() => handleSend(prompt)}
                                    className="rounded-2xl p-4 flex flex-col gap-3 transition-all hover:shadow-lg hover:-translate-y-0.5 cursor-pointer text-left"
                                    style={{
                                        backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#ffffff",
                                        border: `1px solid ${cardBorder}`,
                                    }}
                                >
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.06)" : bg }}>
                                        <Icon className="w-5 h-5" style={{ color: isDark ? "#a1a1aa" : color }} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm mb-1" style={{ color: headingColor }}>{title}</h3>
                                        <p className="text-xs leading-relaxed" style={{ color: subColor }}>{description}</p>
                                    </div>
                                    <div className="flex items-center gap-1 mt-auto text-xs font-semibold" style={{ color: accent }}>
                                        <span>Senden</span>
                                        <ArrowDownCircle className="w-3 h-3 -rotate-90" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    // Nachrichten-Verlauf
                    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
                        {messages.map((msg) => {
                            const isUser = msg.role === "user";
                            return (
                                <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isUser ? "self-end flex-row-reverse" : "self-start"}`}>
                                    <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold"
                                         style={{ backgroundColor: isUser ? bubbleUser : headerIconBg, color: isUser ? "#fff" : accent }}
                                    >
                                        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                    </div>
                                    {isUser ? (
                                        /* 1. Variante für den User: Normaler Text ohne HTML-Gefahr */
                                        <div className="rounded-2xl px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap leading-relaxed"
                                             style={{
                                                 backgroundColor: bubbleUser,
                                                 color: "#ffffff",
                                                 border: "none",
                                             }}
                                        >
                                            {msg.content}
                                        </div>
                                    ) : msg.isError ? (
                                        /* 2. Fehler: als Klartext, nie als HTML */
                                        <div className="rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed"
                                             style={{
                                                 backgroundColor: isDark ? "rgba(220,38,38,0.12)" : "#fef2f2",
                                                 color: isDark ? "#fca5a5" : "#b91c1c",
                                                 border: `1px solid ${isDark ? "rgba(220,38,38,0.35)" : "#fecaca"}`,
                                             }}
                                        >
                                            {msg.content}
                                        </div>
                                    ) : (
                                        /* 3. Variante für die KI: gefiltertes HTML rendern */
                                        <div className="rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed min-w-0 overflow-x-auto ai-antwort"
                                             style={{
                                                 backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                                                 color: headingColor,
                                                 border: `1px solid ${cardBorder}`,
                                             }}
                                        >
                                            <div dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(msg.content) }} />
                                            {msg.toolCalls?.length > 0 && (
                                                <div className="mt-2 pt-2 text-[11px] flex flex-wrap gap-1 items-center"
                                                     style={{ borderTop: `1px solid ${cardBorder}`, color: subColor }}>
                                                    <span>Verwendete Daten:</span>
                                                    {[...new Set(msg.toolCalls)].map((t) => (
                                                        <span key={t} className="px-1.5 py-0.5 rounded"
                                                              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#e2e8f0" }}>
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {isLoading && (
                            <div className="flex gap-3 self-start max-w-[85%]">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: headerIconBg }}>
                                    <Bot className="w-4 h-4 animate-bounce" style={{ color: accent }} />
                                </div>
                                <div className="rounded-2xl px-4 py-2.5 text-sm italic" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: subColor, border: `1px solid ${cardBorder}` }}>
                                    {window.env?.CUSTOMER} sucht Daten und generiert Antwort...
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* ── Input-Leiste ────────────────────────────────────────── */}
            <div className="max-w-4xl w-full mx-auto shrink-0">
                <form
                    onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                    className="flex items-end gap-2 rounded-xl p-2 transition-all"
                    style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
                >
                    <textarea
                        rows={1}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            // Enter sendet, Shift+Enter macht eine neue Zeile.
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Frage zu Aktien, Steuern oder Mandanten stellen... (Shift+Enter = neue Zeile)"
                        className="flex-1 bg-transparent border-none outline-none px-3 text-sm resize-none max-h-40 custom-scrollbar"
                        style={{ color: headingColor }}
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                        style={{ backgroundColor: bubbleUser, color: "#ffffff" }}
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>

        </div>
    );
}