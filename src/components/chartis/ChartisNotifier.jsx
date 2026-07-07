import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, auth } from "@/api/supabaseClient";
import { toast } from "sonner";

// ──────────────────────────────────────────────────────────────────────────
// CHARTIS – globaler Benachrichtiger. Einmal im Layout gemountet.
// Abonniert chartis_notifications (RLS: nur eigene) via Realtime und zeigt
// bei neuer Nachricht/Erwähnung: Toast + kurzer Ton + (falls erlaubt) natives
// Popup (Web-Notifications-API – funktioniert im Browser UND im Tauri-WebView).
// ──────────────────────────────────────────────────────────────────────────
export default function ChartisNotifier() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => auth.me(), staleTime: 300000 });
  const audioCtxRef = useRef(null);

  // Einmalig um Popup-Erlaubnis bitten
  useEffect(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch { /* WebView ohne Notification-API */ }
  }, []);

  useEffect(() => {
    if (!me?.id) return;

    const beep = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = audioCtxRef.current || (audioCtxRef.current = new Ctx());
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = "sine"; o.frequency.value = 680; g.gain.value = 0.045;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.13);
      } catch { /* Audio nicht verfügbar */ }
    };

    const ch = supabase
      .channel(`chartis-notif-${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chartis_notifications", filter: `user_id=eq.${me.id}` },
        ({ new: n }) => {
          const title = n?.kind === "mention" ? `Erwähnt · ${n.title || "Chartis"}` : (n?.title || "Neue Nachricht");
          const body = n?.preview || "";
          toast(title, { description: body });
          beep();
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              const notif = new Notification(title, { body, icon: "/artis-logo.png", tag: n?.thread_id || n?.id });
              notif.onclick = () => { try { window.focus(); } catch {} notif.close(); };
            }
          } catch { /* WebView ohne Notification-API */ }
          // Badges/Listen auffrischen
          qc.invalidateQueries({ queryKey: ["chartisMyThreads"] });
          qc.invalidateQueries({ queryKey: ["chartisMentions"] });
          qc.invalidateQueries({ queryKey: ["chartisReadState"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [me?.id, qc]);

  return null;
}
