import React, { useMemo } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { isPast, isToday, isTomorrow, isThisWeek, startOfDay, addDays } from "date-fns";
import { toast } from "sonner";
import Layout from "../Layout";
import ReminderItem from "../components/mail/ReminderItem";

export default function ReminderBoard() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: mails = [] } = useQuery({
    queryKey: ["mailItems", currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return [];
      const allMails = await entities.MailItem.list("-received_date");
      return allMails.filter(mail => mail.created_by === currentUser.email);
    },
    enabled: !!currentUser,
  });

  const queryClient = useQueryClient();

  const updateMailMutation = useMutation({
    mutationFn: ({ id, data }) => entities.MailItem.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mailItems"] }),
  });

  // Get all reminders (exclude completed, from received AND sent mails)
  const reminders = useMemo(() => {
    return mails
      .filter(mail => mail.reminder_date && !mail.is_completed)
      .sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
  }, [mails]);

  // Categorize reminders
  const now = new Date();
  const categorized = useMemo(() => {
    const overdue = [];
    const today = [];
    const soon = [];
    const later = [];

    reminders.forEach((mail) => {
      if (!mail.reminder_date) {
        // Items with only tags go to "soon" section
        soon.push(mail);
      } else {
        const date = new Date(mail.reminder_date);
        if (isPast(date) || isToday(date)) {
          overdue.push(mail);
        } else if (isThisWeek(date) || isTomorrow(date) || (date <= addDays(startOfDay(now), 3))) {
          soon.push(mail);
        } else {
          later.push(mail);
        }
      }
    });

    return { overdue, today, soon, later };
  }, [reminders]);

  const handleDelete = async (mail) => {
    try {
      await updateMailMutation.mutateAsync({
        id: mail.id,
        data: { reminder_date: null }
      });
      toast.success("Reminder gelöscht");
    } catch (error) {
      toast.error("Fehler: " + error.message);
    }
  };

  const handleComplete = async (mail) => {
    try {
      await updateMailMutation.mutateAsync({
        id: mail.id,
        data: { reminder_date: null }
      });
      toast.success("Reminder entfernt");
    } catch (error) {
      toast.error("Fehler: " + error.message);
    }
  };

  const handleReschedule = async (mail, newDate) => {
    try {
      await updateMailMutation.mutateAsync({
        id: mail.id,
        data: { reminder_date: newDate }
      });
      toast.success("Reminder aktualisiert");
    } catch (error) {
      toast.error("Fehler: " + error.message);
    }
  };

  const renderCategory = (title, items, color) => {
    if (items.length === 0) return null;

    return (
      <div key={title} className="space-y-3">
        <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${color}`}>
          <Calendar className="h-4 w-4" />
          {title}
          <span className="ml-auto text-xs font-normal bg-zinc-800 px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        </h3>
        <div className="space-y-2">
          {items.map((mail) => (
            <ReminderItem
              key={mail.id}
              mail={mail}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onReschedule={handleReschedule}
              onClick={() => {
                // Navigate to MailKanban with mail selected
                window.location.href = `${createPageUrl('MailKanban')}?mail=${mail.id}`;
              }}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-6 border-b border-zinc-800/50">
          <div className="flex items-center gap-4 mb-4">
            <Link to={createPageUrl('MailKanban')}>
              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-zinc-200">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-3xl font-bold text-zinc-100 flex items-center gap-3">
              <Bell className="h-8 w-8 text-amber-400" />
              Erinnerungen
            </h1>
          </div>
          <p className="text-sm text-zinc-500 ml-14">
            {reminders.length === 0
              ? "🎉 Keine aktiven Erinnerungen"
              : `${reminders.length} aktive Erinnerung${reminders.length !== 1 ? "en" : ""}`}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {reminders.length === 0 ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <Bell className="h-16 w-16 text-zinc-700 mx-auto mb-4 opacity-50" />
                <p className="text-zinc-400 text-lg">Keine aktiven Erinnerungen</p>
                <p className="text-zinc-600 text-sm mt-2">Setze einen Reminder auf einer E-Mail, um ihn hier zu sehen</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-8">
              {renderCategory("🚨 ÜBERFÄLLIG", categorized.overdue, "text-red-400")}
              {renderCategory("📌 HEUTE", categorized.today, "text-amber-400")}
              {renderCategory("⏱️ BALD", categorized.soon, "text-blue-400")}
              {renderCategory("📅 SPÄTER", categorized.later, "text-zinc-400")}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}