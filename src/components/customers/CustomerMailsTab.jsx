import React, { useContext } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Mail, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";

export default function CustomerMailsTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const queryClient = useQueryClient();

  const { data: mails = [], isLoading } = useQuery({
    queryKey: ["customer-mails", customer.id],
    queryFn: () => entities.CustomerMail.filter({ customer_id: customer.id }, "-received_date"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.CustomerMail.delete(id),
    onSuccess: () => {
      toast.success("Mail entfernt");
      queryClient.invalidateQueries({ queryKey: ["customer-mails", customer.id] });
    },
  });

  if (isLoading) return <div className="text-sm py-4" style={{ color: isLight ? '#9090b8' : '#52525b' }}>Lade Mails...</div>;

  if (mails.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: isLight ? '#9090b8' : '#52525b' }}>
        Noch keine Mails zugeordnet.<br />
        <span style={{ color: isLight ? '#b0b0cc' : '#3f3f46' }}>Mails können in der Mailverwaltung über „Firma zuweisen" hinzugefügt werden.</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {mails.map(mail => (
        <div key={mail.id} className="group flex items-start gap-3 p-3 rounded-lg border border-transparent transition-colors"
          style={{ color: isLight ? '#1a1a2e' : '#e4e4e7' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = isLight ? '#ebebf4' : 'rgba(63,63,70,0.4)'; e.currentTarget.style.borderColor = isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          <Mail className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: isLight ? '#8080a0' : '#71717a' }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: isLight ? '#1a1a2e' : '#e4e4e7' }}>{mail.subject}</div>
            <div className="text-xs" style={{ color: isLight ? '#7a7a9a' : '#a1a1aa' }}>Von: {mail.sender_name || mail.sender_email}</div>
            {mail.body && (
              <div className="text-xs truncate mt-0.5" style={{ color: isLight ? '#9090b8' : '#52525b' }}>{mail.body.replace(/<[^>]*>/g, '').slice(0, 100)}</div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs" style={{ color: isLight ? '#9090b8' : '#52525b' }}>
              {mail.received_date && format(new Date(mail.received_date), "dd.MM.yy", { locale: de })}
            </span>
            <button
              onClick={() => deleteMutation.mutate(mail.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}