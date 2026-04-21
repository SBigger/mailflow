import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { Bell, X, Clock, AlarmClock, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useNavigate } from "react-router-dom";

const SNOOZE_OPTIONS = [
  { label: "5 Min",  minutes: 5 },
  { label: "15 Min", minutes: 15 },
  { label: "30 Min", minutes: 30 },
  { label: "1 Std",  minutes: 60 },
];

// localStorage-Schlüssel
const lsKey = (taskId, type) => `task_reminder_${type}_${taskId}`;

// Native Desktop-Notification (Electron) oder Web-Notification (Browser PWA).
// Deduplikation pro Task via localStorage, damit bei jedem 60s-Poll nicht
// erneut getoastet wird.
function fireNativeNotification(task) {
  const key = lsKey(task.id, "notified");
  if (localStorage.getItem(key)) return;
  const title = "Erinnerung: " + (task.title || "Aufgabe fällig");
  const body = task.description
    ? String(task.description).slice(0, 140)
    : "Jetzt fällig";
  try {
    if (typeof window !== "undefined" && window.smartis && window.smartis.notify) {
      window.smartis.notify(title, body);
      localStorage.setItem(key, "1");
      return;
    }
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        localStorage.setItem(key, "1");
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") {
            new Notification(title, { body });
            localStorage.setItem(key, "1");
          }
        });
      }
    }
  } catch (e) {
    console.warn("Notification fehlgeschlagen:", e);
  }
}

function isDismissed(taskId) {
  const v = localStorage.getItem(lsKey(taskId, "dismissed"));
  return !!v;
}

function getSnoozedUntil(taskId) {
  const v = localStorage.getItem(lsKey(taskId, "snoozed"));
  return v ? new Date(v) : null;
}

function dismiss(taskId) {
  localStorage.setItem(lsKey(taskId, "dismissed"), "1");
  localStorage.removeItem(lsKey(taskId, "snoozed"));
}

function snooze(taskId, minutes) {
  const until = new Date(Date.now() + minutes * 60 * 1000);
  localStorage.setItem(lsKey(taskId, "snoozed"), until.toISOString());
  // Notified-Flag zurücksetzen, damit nach Ablauf der Snooze-Zeit
  // eine neue Desktop-Notification getriggert wird.
  localStorage.removeItem(lsKey(taskId, "notified"));
}

// Reminder wird angezeigt wenn:
// - due_date in den nächsten 15 Minuten ODER bis zu 2 Stunden überfällig
// - nicht erledigt
// - nicht dismissed
// - snooze-Zeit abgelaufen
function shouldShowReminder(task) {
  if (!task.due_date || task.completed) return false;
  if (isDismissed(task.id)) return false;

  const snoozedUntil = getSnoozedUntil(task.id);
  if (snoozedUntil && new Date() < snoozedUntil) return false;

  const due = new Date(task.due_date);
  const now = new Date();
  const diffMs = due - now; // negativ = überfällig
  const diffMin = diffMs / 60000;

  // Zeige wenn: fällig in ≤15 Min ODER bis zu 120 Min überfällig
  return diffMin <= 15 && diffMin >= -120;
}

export default function TaskReminderPopup({ currentUser }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const navigate = useNavigate();

  const [reminders, setReminders] = useState([]);   // Tasks die jetzt angezeigt werden
  const [snoozeOpen, setSnoozeOpen] = useState(null); // taskId mit offenem Snooze-Menu
  const intervalRef = useRef(null);

  const checkReminders = useCallback(async () => {
    if (!currentUser?.email) return;

    try {
      // Tasks laden: fällig in den nächsten 15 Min (UTC), nicht erledigt, zugewiesen an mich
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 120 * 60 * 1000);

      const { data: tasks, error } = await supabase
        .from("tasks")
        .select("id, title, due_date, description, completed, assignee, verantwortlich")
        .eq("completed", false)
        .gte("due_date", windowStart.toISOString())
        .lte("due_date", windowEnd.toISOString())
        .or(`assignee.eq.${currentUser.email},verantwortlich.eq.${currentUser.email}`);

      if (error || !tasks) return;

      const visible = tasks.filter(shouldShowReminder);
      visible.forEach(fireNativeNotification);
      setReminders(visible);
    } catch (e) {
      console.error("TaskReminder check error:", e);
    }
  }, [currentUser?.email]);

  // Initiales Laden + Polling alle 60s
  useEffect(() => {
    checkReminders();
    intervalRef.current = setInterval(checkReminders, 60_000);
    return () => clearInterval(intervalRef.current);
  }, [checkReminders]);

  // Auch nach Snooze/Dismiss sofort neu rendern (ohne API-Call)
  const handleDismiss = useCallback((taskId) => {
    dismiss(taskId);
    setSnoozeOpen(null);
    setReminders(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const handleSnooze = useCallback((taskId, minutes) => {
    snooze(taskId, minutes);
    setSnoozeOpen(null);
    setReminders(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const handleOpen = useCallback((taskId) => {
    dismiss(taskId);
    setReminders(prev => prev.filter(t => t.id !== taskId));
    navigate("/TaskBoard");
  }, [navigate]);

  if (reminders.length === 0) return null;

  // Farben
  const bg = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#1c1c21";
  const border = isArtis ? "#c8dac8" : isLight ? "#e0e0f0" : "#3f3f46";
  const titleColor = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#f4f4f5";
  const mutedColor = isArtis ? "#6b826b" : isLight ? "#6b7280" : "#a1a1aa";
  const accentBg = isArtis ? "#e8f4e8" : isLight ? "#f0f0ff" : "#27272a";
  const accentBorder = isArtis ? "#7a9b7f" : isLight ? "#7c3aed" : "#7c3aed";
  const snoozeBg = isArtis ? "#f4f9f4" : isLight ? "#f9f9ff" : "#27272a";
  const snoozeBorder = isArtis ? "#bfd4bf" : isLight ? "#d0d0e8" : "#52525b";

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] grid grid-cols-3 gap-2"
      style={{ maxWidth: 960, pointerEvents: "auto" }}
    >
      {reminders.map((task) => {
        const due = new Date(task.due_date);
        const now = new Date();
        const isOverdue = due < now;
        const diffMin = Math.round((due - now) / 60000);

        let timeLabel;
        if (isOverdue) {
          timeLabel = `Überfällig – vor ${Math.abs(diffMin)} Min`;
        } else if (diffMin <= 1) {
          timeLabel = "Jetzt fällig!";
        } else {
          timeLabel = `Fällig in ${diffMin} Min (${format(due, "HH:mm", { locale: de })} Uhr)`;
        }

        return (
          <div
            key={task.id}
            className="rounded-xl shadow-2xl border overflow-hidden"
            style={{
              backgroundColor: bg,
              borderColor: isOverdue ? "#ef4444" : accentBorder,
              borderWidth: 1,
              minWidth: 300,
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{
                backgroundColor: isOverdue
                  ? "rgba(239,68,68,0.08)"
                  : isArtis ? "#eef6ee" : isLight ? "#f0f0ff" : "#27272a",
                borderBottom: `1px solid ${isOverdue ? "rgba(239,68,68,0.2)" : border}`,
              }}
            >
              <AlarmClock
                className="h-4 w-4 flex-shrink-0"
                style={{ color: isOverdue ? "#ef4444" : isArtis ? "#4a7a50" : "#7c3aed" }}
              />
              <span
                className="text-xs font-semibold uppercase tracking-wide flex-1"
                style={{ color: isOverdue ? "#ef4444" : mutedColor }}
              >
                {isOverdue ? "Aufgabe überfällig" : "Erinnerung"}
              </span>
              <button
                onClick={() => handleDismiss(task.id)}
                className="rounded hover:opacity-70 transition-opacity"
                title="Schliessen"
              >
                <X className="h-3.5 w-3.5" style={{ color: mutedColor }} />
              </button>
            </div>

            {/* Body */}
            <div className="px-3 py-2.5">
              <p
                className="text-sm font-semibold leading-snug mb-1 cursor-pointer hover:underline"
                style={{ color: titleColor }}
                onClick={() => handleOpen(task.id)}
              >
                {task.title}
              </p>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 flex-shrink-0" style={{ color: isOverdue ? "#ef4444" : mutedColor }} />
                <span className="text-xs" style={{ color: isOverdue ? "#ef4444" : mutedColor }}>
                  {timeLabel}
                </span>
              </div>
            </div>

            {/* Snooze-Menu (aufgeklappt) */}
            {snoozeOpen === task.id && (
              <div
                className="px-3 pb-2 pt-1 border-t flex flex-wrap gap-1.5"
                style={{ borderColor: border, backgroundColor: snoozeBg }}
              >
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.minutes}
                    onClick={() => handleSnooze(task.id, opt.minutes)}
                    className="text-xs px-2.5 py-1 rounded-full border transition-colors hover:opacity-80"
                    style={{
                      borderColor: snoozeBorder,
                      color: titleColor,
                      backgroundColor: bg,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div
              className="flex items-center gap-1.5 px-3 py-2 border-t"
              style={{ borderColor: border }}
            >
              <button
                onClick={() => setSnoozeOpen(snoozeOpen === task.id ? null : task.id)}
                className="flex-1 text-xs py-1 rounded-lg border transition-colors hover:opacity-80"
                style={{
                  borderColor: border,
                  color: mutedColor,
                  backgroundColor: accentBg,
                }}
              >
                Snooze
              </button>
              <button
                onClick={() => handleOpen(task.id)}
                className="flex-1 text-xs py-1 rounded-lg font-medium transition-colors hover:opacity-90 flex items-center justify-center gap-1"
                style={{
                  backgroundColor: isArtis ? "#7a9b7f" : "#7c3aed",
                  color: "#ffffff",
                }}
              >
                Öffnen
                <ChevronRight className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDismiss(task.id)}
                className="flex-1 text-xs py-1 rounded-lg border transition-colors hover:opacity-80"
                style={{
                  borderColor: border,
                  color: mutedColor,
                  backgroundColor: "transparent",
                }}
              >
                Verwerfen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
