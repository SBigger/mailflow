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
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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

  const highPriority = priorities?.find(p => p.level === 1) || priorities?.[0];
  const internalColumn = columns?.find(c => c.name?.toLowerCase().includes("intern")) || columns?.[0];

  const startRecording = async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast.error("Mikrofonzugriff verweigert: " + e.message);
      return;
    }

    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      await transcribeAndAnalyze(audioBlob);
    };

    mediaRecorder.start();
    setPhase("recording");
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setPhase("analyzing");
  };

  const transcribeAndAnalyze = async (audioBlob) => {
    setPhase("analyzing");

    let transcriptText = "";
    // Upload audio to Base44 storage, then send URL to Whisper backend
    const uploadRes = await entities.integrations.Core.UploadFile({ file: new File([audioBlob], 'audio.webm', { type: 'audio/webm' }) });
    const fileUrl = uploadRes.file_url;

    const transcribeRes = await functions.invoke('whisperTranscribe', { audio_url: fileUrl });
    transcriptText = transcribeRes.data?.transcript || "";

    if (!transcriptText) {
      toast.error("Kein Text erkannt. Bitte nochmals versuchen.");
      setPhase("idle");
      return;
    }

    setTranscript(transcriptText);
    await analyzeWithAI(transcriptText);
  };

  const analyzeWithAI = async (text) => {
    const columnList = columns?.map(c => `${c.name} (id: ${c.id})`).join(", ") || "";
    const priorityList = priorities?.map(p => `${p.name} (id: ${p.id}, level: ${p.level})`).join(", ") || "";
    const userList = users.map(u => `${u.full_name || u.email} → ${u.email}`).join("\n") || "";
    const customerList = customers?.map(c => c.company_name).join(", ") || "";

    const result = await entities.integrations.Core.InvokeLLM({
      prompt: `Du erstellst einen strukturierten Task aus einem frei gesprochenen Text. Der Benutzer spricht natürlich, ohne Schlüsselwörter.

Gesprochener Text: "${text}"

Heute: ${new Date().toISOString().split("T")[0]}

Verfügbare Spalten (Name + ID): ${columnList}
Verfügbare Prioritäten (Name + ID): ${priorityList}
Bekannte Mitarbeiter (Name → E-Mail):
${userList}
Bekannte Kunden: ${customerList}

Deine Aufgabe:
1. TITEL: Pflichtformat: "[Kundenname] – [Tätigkeit in 1-2 Wörtern]"
   - Erkenne den Kundennamen aus dem Text (auch bei leicht abweichender Aussprache, z.B. "Banderet" → "Banderet AG").
   - Falls kein Kunde erkennbar ist, schreibe nur die Tätigkeit ohne Prefix.
   - Beispiele: "Müller AG – Rechnung prüfen", "Banderet AG – Jahresabschluss", "Kanton Graubünden – Steuererklärung"
2. BESCHREIBUNG: Falls der Text mehr Details enthält als der Titel abdeckt, schreibe sie als Beschreibung. Wenn der Text mehrere Unteraufgaben oder Punkte enthält, formatiere sie als Liste mit "- " am Anfang jeder Zeile (z.B. "- GV Protokoll\n- Bilanz prüfen"). Sonst null.
3. SPALTE: Wähle die passende Spalten-ID aus der Liste. Falls unklar, gib null zurück.
4. PRIORITÄT: Wähle die passende Prioritäts-ID. Wörter wie "dringend", "wichtig", "sofort" → höchste Priorität. Falls nicht erwähnt, gib null zurück.
5. DATUM: Interpretiere Datumsangaben ("morgen", "nächste Woche", "bis Freitag"). Format: YYYY-MM-DD. Falls nicht erwähnt, null.
6. PERSON: Suche den ähnlichsten Namen und gib seine E-Mail zurück. Falls nicht erwähnt, null.

Gib die IDs direkt zurück (nicht die Namen).`,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: ["string", "null"] },
          column_id: { type: ["string", "null"] },
          priority_id: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          assignee_email: { type: ["string", "null"] },
        }
      }
    });

    const col = result.column_id
      ? columns?.find(c => c.id === result.column_id) || internalColumn
      : internalColumn;

    const prio = result.priority_id
      ? priorities?.find(p => p.id === result.priority_id) || highPriority
      : highPriority;

    const assigneeEmail = result.assignee_email || currentUser?.email || "";

    setTaskData({
      title: result.title || "",
      description: (result.description && result.description !== "null") ? result.description : "",
      column_id: col?.id || "",
      priority_id: prio?.id || "",
      due_date: result.due_date ? result.due_date.split("T")[0] : "",
      assignee: assigneeEmail,
    });

    setPhase("preview");
  };

  const handleSave = () => {
    if (!taskData.title?.trim()) {
      toast.error("Titel ist ein Pflichtfeld.");
      return;
    }
    if (!taskData.column_id) {
      toast.error("Bitte eine Spalte auswählen.");
      return;
    }
    onAdd({
      ...taskData,
      due_date: taskData.due_date ? taskData.due_date + "T00:00:00.000Z" : null,
    });
    handleClose();
  };

  const handleClose = () => {
    mediaRecorderRef.current?.stop();
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
                ? "Aufnahme läuft... Klicke zum Stoppen"
                : "Klicke und beschreibe deinen Task auf Deutsch"
              }
            </p>
            {phase === "idle" && (
              <p className="text-zinc-600 text-xs text-center max-w-xs">
                Einfach frei sprechen – z.B. „Ich muss die Rechnung von Müller AG dringend prüfen, bis Freitag, für Reto"
              </p>
            )}
          </div>
        )}

        {/* ANALYZING */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="h-10 w-10 text-violet-400 animate-spin" />
            <p className="text-zinc-400 text-sm">Whisper transkribiert & KI analysiert...</p>
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
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Titel *</label>
                <input
                  value={taskData.title}
                  onChange={e => setTaskData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Task-Titel"
                />
              </div>

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

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Fälligkeitsdatum</label>
                <input
                  type="date"
                  value={taskData.due_date}
                  onChange={e => setTaskData(prev => ({ ...prev, due_date: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Zugewiesen an</label>
                <Select value={taskData.assignee} onValueChange={v => setTaskData(prev => ({ ...prev, assignee: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 h-9">
                    <SelectValue placeholder="Benutzer wählen..." />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value={null} className="text-zinc-400">Niemand</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.email} className="text-zinc-200">
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {phase === "preview" && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPhase("idle")} className="text-zinc-400">
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