/**
 * VoiceAssistant – Smartis KI-Sprachassistent für Mailflow
 * Fragt Mails, Aufgaben, Fristen und Dokumente per Sprache oder Text ab.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic, MicOff, X, Send, Volume2, VolumeX, Mail, CheckSquare,
  CalendarClock, FolderOpen, ExternalLink, Loader2, Sparkles,
  ChevronRight, MessageSquare, RotateCcw,
} from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { createPageUrl } from "@/utils";

// ── Source type config ────────────────────────────────────────
const SOURCE_CFG = {
  frist:    { icon: CalendarClock, color: '#3b82f6', label: 'Frist',    page: 'Fristen'   },
  task:     { icon: CheckSquare,   color: '#8b5cf6', label: 'Aufgabe',  page: 'TaskBoard'  },
  mail:     { icon: Mail,          color: '#10b981', label: 'Mail',     page: 'MailKanban' },
  dokument: { icon: FolderOpen,    color: '#f59e0b', label: 'Dokument', page: 'Dokumente'  },
};

// ── Quick suggestion chips ────────────────────────────────────
const QUICK_QUESTIONS = [
  "Offene Fristen diese Woche?",
  "Meine offenen Aufgaben?",
  "Neue Mails heute?",
  "Dokumente für Müller AG?",
];

// ── Simple Markdown renderer ──────────────────────────────────
function SimpleMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div style={{ lineHeight: 1.6 }}>
      {lines.map((line, i) => {
        // Bold: **text**
        const parts = line.split(/\*\*(.+?)\*\*/g);
        const rendered = parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p);
        // List item
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
              <span style={{ opacity: 0.5, flexShrink: 0 }}>·</span>
              <span>{rendered.slice(1)}</span>
            </div>
          );
        }
        // Heading
        if (line.startsWith('## ')) {
          return <div key={i} style={{ fontWeight: 700, marginTop: 10, marginBottom: 4, opacity: 0.9 }}>{line.slice(3)}</div>;
        }
        if (line.startsWith('# ')) {
          return <div key={i} style={{ fontWeight: 700, fontSize: '1.05em', marginTop: 8, marginBottom: 4 }}>{line.slice(2)}</div>;
        }
        if (line === '') return <div key={i} style={{ height: 6 }} />;
        return <div key={i} style={{ marginBottom: 2 }}>{rendered}</div>;
      })}
    </div>
  );
}

// ── TTS helper ────────────────────────────────────────────────
function speak(text, onEnd) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'de-DE';
  utt.rate = 1.05;
  utt.pitch = 1;
  // Prefer a German voice if available
  const voices = window.speechSynthesis.getVoices();
  const deVoice = voices.find(v => v.lang.startsWith('de') && v.localService);
  if (deVoice) utt.voice = deVoice;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

// ── Main Component ────────────────────────────────────────────
export default function VoiceAssistant({ open, onClose }) {
  const navigate = useNavigate();

  // Theme from DOM (avoids circular import with Layout.jsx)
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isDark = theme === 'dark';
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  // Colors
  const panelBg      = isDark ? '#1c1c21' : isArtis ? '#f0f4f0' : '#ffffff';
  const panelBorder  = isDark ? 'rgba(113,113,122,0.3)' : isArtis ? '#bfcfbf' : '#d1d5db';
  const textPrimary  = isDark ? '#f4f4f5' : '#111827';
  const textSecond   = isDark ? '#a1a1aa' : '#6b7280';
  const inputBg      = isDark ? '#27272c' : isArtis ? '#e8f0e8' : '#f3f4f6';
  const itemBg       = isDark ? '#27272c' : isArtis ? '#e8f0e8' : '#f9fafb';
  const itemBorder   = isDark ? 'rgba(113,113,122,0.2)' : isArtis ? '#c8d8c8' : '#e5e7eb';
  const accentColor  = isArtis ? '#7a9b7f' : '#7c3aed';

  // State
  const [query,       setQuery]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null); // { answer, speak_text, sources }
  const [error,       setError]       = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking,  setIsSpeaking]  = useState(false);
  const [autoSpeak,   setAutoSpeak]   = useState(true);
  const [history,     setHistory]     = useState([]); // [{ q, answer, sources }]
  const [liveText,    setLiveText]    = useState(''); // interim speech text

  const inputRef   = useRef(null);
  const recogRef   = useRef(null);
  const panelRef   = useRef(null);

  // ── Keyboard shortcut: Ctrl+Shift+Space ──────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (open) onClose(); else open; // toggled from Layout
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      stopListening();
      stopSpeaking();
    }
  }, [open]);

  // Stop TTS when panel closes
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };

  // ── Speech Recognition ────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError('Spracherkennung nicht verfügbar. Bitte Chrome verwenden.');
      return;
    }
    stopSpeaking();
    const rec = new SR();
    rec.lang = 'de-CH';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart  = () => { setIsListening(true); setLiveText(''); setError(''); };
    rec.onend    = () => { setIsListening(false); setLiveText(''); };
    rec.onerror  = (e) => {
      setIsListening(false);
      setLiveText('');
      if (e.error !== 'aborted') setError(`Mikrofon-Fehler: ${e.error}`);
    };
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join(' ');
      setLiveText(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        setQuery(transcript);
        setLiveText('');
        rec.stop();
        // Auto-submit after voice input
        setTimeout(() => handleSubmit(transcript), 300);
      }
    };

    recogRef.current = rec;
    rec.start();
  }, []);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    recogRef.current = null;
    setIsListening(false);
    setLiveText('');
  }, []);

  const toggleListening = () => {
    if (isListening) stopListening();
    else startListening();
  };

  // ── Submit question ────────────────────────────────────────
  const handleSubmit = useCallback(async (overrideQuery) => {
    const q = (overrideQuery ?? query).trim();
    if (!q || loading) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Nicht angemeldet');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/voice-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Fehler ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
      setHistory(prev => [{ q, answer: data.answer, sources: data.sources }, ...prev.slice(0, 4)]);
      setQuery('');

      // Auto-speak
      if (autoSpeak && data.speak_text) {
        setIsSpeaking(true);
        speak(data.speak_text, () => setIsSpeaking(false));
      }
    } catch (e) {
      setError(e.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [query, loading, autoSpeak]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSource = (source) => {
    const cfg = SOURCE_CFG[source.type];
    if (!cfg) return;
    navigate(createPageUrl(cfg.page));
    onClose();
  };

  const toggleSpeak = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else if (result?.speak_text) {
      setIsSpeaking(true);
      speak(result.speak_text, () => setIsSpeaking(false));
    }
    setAutoSpeak(v => !v);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 39,
          animation: 'fadeIn 0.15s ease',
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0, bottom: 0,
          left: 56, // right after sidebar (w-14 = 56px)
          width: 420,
          background: panelBg,
          borderRight: `1px solid ${panelBorder}`,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '4px 0 24px rgba(0,0,0,0.25)',
          animation: 'slideInLeft 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 16px 12px',
          borderBottom: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${accentColor}22`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={16} color={accentColor} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: textPrimary }}>Smartis</div>
              <div style={{ fontSize: '0.7rem', color: textSecond }}>KI-Assistent · Deine Daten</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Auto-speak toggle */}
            <button
              onClick={toggleSpeak}
              title={autoSpeak ? 'Vorlesen aktiv' : 'Vorlesen aus'}
              style={{
                width: 30, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: autoSpeak ? `${accentColor}22` : inputBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: autoSpeak ? accentColor : textSecond,
                transition: 'all 0.15s',
              }}
            >
              {isSpeaking ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: inputBg, color: textSecond,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Quick suggestions (only when no result) */}
          {!result && !loading && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: textSecond, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Schnellzugriff
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {QUICK_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => { setQuery(q); handleSubmit(q); }}
                    style={{
                      padding: '5px 10px', borderRadius: 20, border: `1px solid ${itemBorder}`,
                      background: itemBg, color: textSecond, fontSize: '0.78rem',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.target.style.borderColor = accentColor}
                    onMouseLeave={e => e.target.style.borderColor = itemBorder}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '32px 0', gap: 12,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: `${accentColor}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse 1.5s infinite',
              }}>
                <Loader2 size={22} color={accentColor} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
              <div style={{ fontSize: '0.85rem', color: textSecond }}>Smartis sucht …</div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: '#fee2e2', border: '1px solid #fca5a5',
              borderRadius: 8, padding: '10px 14px',
              color: '#dc2626', fontSize: '0.83rem',
            }}>
              {error}
            </div>
          )}

          {/* Result */}
          {result && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Answer text */}
              <div style={{
                background: `${accentColor}11`,
                border: `1px solid ${accentColor}33`,
                borderRadius: 10, padding: '12px 14px',
                color: textPrimary, fontSize: '0.85rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} color={accentColor} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Antwort
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isSpeaking && (
                      <button onClick={stopSpeaking} style={{ border: 'none', background: 'none', cursor: 'pointer', color: accentColor, padding: 2 }}>
                        <VolumeX size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => { setResult(null); setQuery(''); }}
                      title="Neue Frage"
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: textSecond, padding: 2 }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>
                <SimpleMarkdown text={result.answer} />
              </div>

              {/* Sources */}
              {result.sources?.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: textSecond, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Gefundene Einträge ({result.sources.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.sources.map((src, i) => {
                      const cfg = SOURCE_CFG[src.type] || SOURCE_CFG.task;
                      const Icon = cfg.icon;
                      return (
                        <div
                          key={i}
                          style={{
                            background: itemBg,
                            border: `1px solid ${itemBorder}`,
                            borderRadius: 8,
                            padding: '8px 10px',
                            display: 'flex', alignItems: 'center', gap: 10,
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}
                          onClick={() => handleSource(src)}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = cfg.color;
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = itemBorder;
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                        >
                          {/* Type icon */}
                          <div style={{
                            width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                            background: `${cfg.color}18`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Icon size={14} color={cfg.color} />
                          </div>

                          {/* Text */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '0.82rem', fontWeight: 500, color: textPrimary,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {src.title}
                            </div>
                            {(src.subtitle || src.customer_name) && (
                              <div style={{
                                fontSize: '0.72rem', color: textSecond,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {[src.subtitle, src.customer_name].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>

                          {/* Badge + arrow */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 600, padding: '2px 6px',
                              borderRadius: 10, background: `${cfg.color}18`, color: cfg.color,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                              {cfg.label}
                            </span>
                            <ChevronRight size={12} color={textSecond} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* History (last questions) */}
          {history.length > 1 && !result && !loading && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: textSecond, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Letzte Fragen
              </div>
              {history.slice(1, 4).map((h, i) => (
                <button
                  key={i}
                  onClick={() => { setResult({ answer: h.answer, speak_text: '', sources: h.sources }); }}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none',
                    border: `1px solid ${itemBorder}`, borderRadius: 6,
                    padding: '6px 10px', marginBottom: 4, cursor: 'pointer', color: textSecond,
                    fontSize: '0.78rem', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = accentColor}
                  onMouseLeave={e => e.currentTarget.style.borderColor = itemBorder}
                >
                  <MessageSquare size={11} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
                  {h.q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${panelBorder}`,
          flexShrink: 0,
        }}>
          {/* Live speech text */}
          {(isListening || liveText) && (
            <div style={{
              fontSize: '0.8rem', color: accentColor, marginBottom: 8,
              padding: '6px 10px', background: `${accentColor}11`,
              borderRadius: 6, fontStyle: liveText ? 'normal' : 'italic',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#ef4444', animation: 'pulse 1s infinite', flexShrink: 0,
              }} />
              {liveText || 'Höre zu …'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {/* Text input */}
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Frage stellen oder sprechen …"
                disabled={loading || isListening}
                style={{
                  width: '100%', padding: '10px 12px',
                  borderRadius: 8, border: `1px solid ${panelBorder}`,
                  background: inputBg, color: textPrimary,
                  fontSize: '0.85rem', outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = accentColor}
                onBlur={e => e.target.style.borderColor = panelBorder}
              />
            </div>

            {/* Mic button */}
            <button
              onClick={toggleListening}
              disabled={loading}
              title={isListening ? 'Aufnahme stoppen' : 'Sprachassistent starten'}
              style={{
                width: 40, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: isListening ? '#ef4444' : inputBg,
                color: isListening ? '#fff' : textSecond,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
                boxShadow: isListening ? '0 0 0 3px rgba(239,68,68,0.3)' : 'none',
              }}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            {/* Send button */}
            <button
              onClick={() => handleSubmit()}
              disabled={!query.trim() || loading}
              style={{
                width: 40, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: query.trim() && !loading ? accentColor : inputBg,
                color: query.trim() && !loading ? '#fff' : textSecond,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
              }}
            >
              <Send size={15} />
            </button>
          </div>

          <div style={{ fontSize: '0.68rem', color: textSecond, marginTop: 8, textAlign: 'center' }}>
            Enter senden · Ctrl+Shift+Space öffnen/schliessen
          </div>
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-20px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
