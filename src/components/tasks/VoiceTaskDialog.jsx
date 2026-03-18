import React, { useState, useRef } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, MicOff, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export default function VoiceTaskDialog({ open, onClose, onAdd, columns, priorities, currentUser }) {
  const [phase, setPhase] = useState("idle"); // idle | recording | analyzing | preview
  const [transcript, setTranscript] = useState("");
  const [taskData, setTaskData] = useState(null);
  const recognitionRef = useRef(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await functions.invoke('getAllUsers', {});
      return response.data.users || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list(),
  });

  const highPriority   = priorities?.find(p => p.level === 1) || priorities?.[0];
  const internalColumn = columns?.find(c => c.name?.toLowerCase().includes("intern")) || columns?.[0];

  // Alle User inkl. aktueller Benutzer
  const allUsers = currentUser
    ? [{ id: currentUser.id, email: currentUser.email, full_name: currentUser.full_name || currentUser.email }, ...users.filter(u => u.email !== currentUser.email)]
    : users;

  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Spracherkennung wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'de-CH'; // Schweizerdeutsch/Hochdeutsch
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => setPhase("recording");

    recognition.onresult = async (event) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      setPhase("analyzing");
      await analyzeWithAI(text);
    };

    recognition.onerror = (event) => {
      console.error("SpeechRecognition error:", event.error);
      if (event.error === 'no-speech') {
        toast.error("Kein Sprache erkannt. Bitte nochmals versuchen.");
      } else if (event.error === 'not-allowed') {
        toast.error("Mikrofonzugriff verweigert. Bitte in den Browser-Einstellungen erlauben.");
      } else {
        toast.error("Spracherkennungsfehler: " + event.error);
      }
      setPhase("idle");
    };

    recognition.onend = () => {
      // Falls phase noch "recording" (kein Ergebnis), zurück zu idle
      setPhase(prev => prev === "recording" ? "idle" : prev);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
  };

  const analyzeWithAI = async (text) => {
    try {
      const result = await functions.invoke('parse-voice-task', {
        transcript: text,
        columns:    columns  || [],
        priorities: priorities || [],
        users:      allUsers,
        customers:  customers || [],
      });

      const data = result.data || {};

      const col  = data.column_id   ? (columns?.find(c => c.id === data.column_id) || internalColumn)  : internalColumn;
      const prio = data.priority_id ? (priorities?.find(p => p.id === data.priority_id) || highPriority) : highPriority;

      // assignee: aus KI oder aktueller Benutzer
      const assigneeEmail      = data.assignee_email      || currentUser?.email || "";
      // verantwortlich: aus KI oder aktueller Benutzer
      const verantwortlichEmail = data.verantwortlich_email || currentUser?.email || "";

      setTaskData({
        title:          data.title       || "",
        description:    (data.description && data.description !== "null") ? data.description : "",
        column_id:      col?.id          || "",
        priority_id:    prio?.id         || "",
        due_date:       data.due_date ? data.due_date.split("T")[0] : "",
        assignee:       assigneeEmail,
        verantwortlich: verantwortlichEmail,
      });

      setPhase("preview");
    } catch (err) {
      toast.error("KI-Analyse fehlgeschlagen: " + err.message);
      setPhase("idle");
    }
  };

  const handleSave = () => {
    if (!taskData?.title?.trim()) { toast.error("Titel ist ein Pflichtfeld."); return; }
    if (!taskData.column_id)       { toast.error("Bitte eine Spalte auswählen."); return; }
    if (!taskData.assignee)        { toast.error("Bitte 'Zugewiesen an' auswählen."); return; }
    if (!taskData.verantwortlich)  { toast.error("Bitte 'Verantwortlich' auswählen."); return; }

    onAdd({
      ...taskData,
      due_date: taskData.due_date ? taskData.due_date + "T00:00:00.000Z" : null,
    });
    handleClose();
  };

  const handleClose = () => {
    recognitionRef.current?.stop();
    setPhase("idle");
    setTranscript("");
    setTaskData(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <Mic className="h-5 w-5 text-violet-400" />
            Task per Sprache erfassen
          </DialogTitle>
        </DialogHeader>

        {/* IDLE / RECORDING */}
        {(phase === "idle" || phase === "recording") && (
          <div className="flex flex-col items-center gap-6 py-8">
            <button
              onClick={phase === "idle" ? startRecording : stopRecording}
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                phase === "recording"
                  ? "bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/40"
                  : "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/30"
              }`}
            >
              {phase === "recording"
                ? <MicOff className="h-10 w-10 text-white" />
                : <Mic className="h-10 w-10 text-white" />
              }
            </button>
            <p className="text-zinc-400 text-sm text-center">
              {phase === "recording"
                ? "Aufnahme läuft... Klicke zum Stoppen (oder einfach aufhören zu sprechen)"
                : "Klicke und beschreibe deinen Task auf Deutsch"
              }
            </p>
            {phase === "idle" && (
              <p className="text-zinc-600 text-xs text-center max-w-xs">
                Einfach frei sprechen – z.B. „Ich muss die Rechnung von Müller AG dringend prüfen, bis Freitag, zugewiesen an Reto, verantwortlich bin ich"
              </p>
            )}
          </div>
        )}

        {/* ANALYZING */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="h-10 w-10 text-violet-400 animate-spin" />
            <p className="text-zinc-400 text-sm">KI analysiert und weist Felder zu...</p>
            {transcript && (
              <p className="text-zinc-500 text-xs italic text-center max-w-sm">„{transcript}"</p>
            )}
          </div>
        )}

        {/* PREVIEW / EDIT */}
        {phase === "preview" && taskData && (
          <div className="space-y-4 py-2">
            {transcript && (
              <p className="text-zinc-500 text-xs italic border border-zinc-800 rounded-md px-3 py-2 bg-zinc-950">
                🎙 „{transcript}"
              </p>
            )}

            <div className="space-y-3">
              {/* Titel */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Titel *</label>
                <input
                  value={taskData.title}
                  onChange={e => setTaskData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Task-Titel"
                />
              </div>

              {/* Beschreibung */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Beschreibung</label>
                <textarea
                  value={taskData.description}
                  onChange={e => setTaskData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                  placeholder="Beschreibung (optional)"
                />
              </div>

              {/* Spalte + Priorität */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Spalte *</label>
                  <Select value={taskData.column_id} onValueChange={v => setTaskData(prev => ({ ...prev, column_id: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-9">
                      <SelectValue placeholder="Spalte wählen" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      {columns?.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-zinc-200">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Priorität</label>
                  <Select value={taskData.priority_id} onValueChange={v => setTaskData(prev => ({ ...prev, priority_id: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-9">
                      <SelectValue placeholder="Priorität" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      {priorities?.map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                            {p.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Datum */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Fälligkeitsdatum</label>
                <input
                  type="date"
                  value={taskData.due_date}
                  onChange={e => setTaskData(prev => ({ ...prev, due_date: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              {/* Zugewiesen + Verantwortlich */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Zugewiesen an *</label>
                  <Select value={taskData.assignee || 'none'} onValueChange={v => setTaskData(prev => ({ ...prev, assignee: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-9">
                      <SelectValue placeholder="Benutzer wählen..." />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      <SelectItem value="none" className="text-zinc-400">Niemand</SelectItem>
                      {allUsers.map(u => (
                        <SelectItem key={u.id} value={u.email} className="text-zinc-200">
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Verantwortlich *</label>
                  <Select value={taskData.verantwortlich || 'none'} onValueChange={v => setTaskData(prev => ({ ...prev, verantwortlich: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-9">
                      <SelectValue placeholder="Verantwortliche/r..." />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      <SelectItem value="none" className="text-zinc-400">Niemand</SelectItem>
                      {allUsers.map(u => (
                        <SelectItem key={u.id} value={u.email} className="text-zinc-200">
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === "preview" && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setPhase("idle"); setTranscript(""); }} className="text-zinc-400">
              <Mic className="h-4 w-4 mr-1" /> Neu aufnehmen
            </Button>
            <Button onClick={handleSave} className="bg-violet-600 hover:bg-violet-500 text-white">
              <Wand2 className="h-4 w-4 mr-1" /> Task erstellen
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
