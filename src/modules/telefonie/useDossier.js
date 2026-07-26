import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, entities } from "@/api/supabaseClient";
import { normalizePhone } from "./theme";

// Letzte 6 Ziffern einer normalisierten Nummer (Sascha-Entscheid 2026-07-26:
// vorher 9 – das ist bei CH-Nummern faktisch die ganze nationale Nummer, und
// jede Format-/Präfix-Abweichung zwischen peoplefone und CRM liess den Match
// scheitern, Dossier blieb leer). 6 Ziffern sind bei unserem Kundenstamm
// eindeutig genug; erster Treffer gewinnt.
function suffix(raw) {
  const d = normalizePhone(raw).replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-6) : "";
}

// Nummer -> Kunde (über customers.phone UND contact_persons[].phone/phone2).
export function matchCustomer(number, customers) {
  const suf = suffix(number);
  if (!suf) return null;
  for (const c of customers || []) {
    if (c.phone && suffix(c.phone) === suf) return { customer: c, contactName: null };
    const cps = Array.isArray(c.contact_persons) ? c.contact_persons : [];
    for (const cp of cps) {
      if ((cp.phone && suffix(cp.phone) === suf) || (cp.phone2 && suffix(cp.phone2) === suf)) {
        const nm = [cp.vorname, cp.name].filter(Boolean).join(" ").trim();
        return { customer: c, contactName: nm || null };
      }
    }
  }
  return null;
}

// Dossier fürs Screen-Pop: löst die Anrufernummer zum Kunden auf und lädt dessen
// offene Pendenzen (tasks), letzte Mails (mail_items) und letzte Dokumente (dokumente).
// Alles read-only. Ohne Treffer bleiben die Listen leer (matched = false).
export function useIncomingDossier(number) {
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
    staleTime: 5 * 60_000,
  });

  const match = useMemo(() => (number ? matchCustomer(number, customers) : null), [number, customers]);
  const customer = match?.customer || null;
  const cid = customer?.id || null;

  const { data: pendenzen = [] } = useQuery({
    queryKey: ["tele-doss-tasks", cid], enabled: !!cid, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("tasks")
        .select("id,title,due_date,completed,customer_id")
        .eq("customer_id", cid).eq("completed", false)
        .order("due_date", { ascending: true }).limit(4);
      return data || [];
    },
  });

  const { data: mails = [] } = useQuery({
    queryKey: ["tele-doss-mails", cid], enabled: !!cid, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("mail_items")
        .select("id,subject,sender_email,received_date,customer_id")
        .eq("customer_id", cid).order("received_date", { ascending: false }).limit(3);
      return data || [];
    },
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["tele-doss-docs", cid], enabled: !!cid, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("dokumente")
        .select("id,name,filename,updated_at,customer_id")
        .eq("customer_id", cid).order("updated_at", { ascending: false }).limit(3);
      return data || [];
    },
  });

  return {
    matched: !!customer,
    customer,
    contactName: match?.contactName || null,
    pendenzen, mails, docs,
  };
}
