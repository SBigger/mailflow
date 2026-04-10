import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const action = url.searchParams.get("action") || "info"; // info | download | create | deactivate

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── CREATE: Neuen Share-Link erstellen (authentifiziert) ──────────────────
    if (action === "create") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { doc_id, customer_id, category, year, name, expires_days } = body;

      const insertData: any = { name };
      if (doc_id) insertData.doc_id = doc_id;
      if (customer_id) insertData.customer_id = customer_id;
      if (category) insertData.category = category;
      if (year) insertData.year = year;
      if (expires_days) {
        const exp = new Date();
        exp.setDate(exp.getDate() + parseInt(expires_days));
        insertData.expires_at = exp.toISOString();
      }

      const { data, error } = await supabase
        .from("share_links")
        .insert(insertData)
        .select("token, id")
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ token: data.token, id: data.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DEACTIVATE: Link deaktivieren (authentifiziert) ───────────────────────
    if (action === "deactivate") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json();
      await supabase.from("share_links").update({ is_active: false }).eq("id", body.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Öffentliche Aktionen: token erforderlich ──────────────────────────────
    if (!token) {
      return new Response(JSON.stringify({ error: "Token erforderlich" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Share-Link laden
    const { data: link, error: linkErr } = await supabase
      .from("share_links")
      .select("*")
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: "Link nicht gefunden oder abgelaufen" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ablaufdatum prüfen
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Dieser Link ist abgelaufen" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── INFO: Metadaten zurückgeben (für SharePage) ───────────────────────────
    if (action === "info") {
      let docs: any[] = [];

      if (link.doc_id) {
        // Einzelne Datei
        const { data } = await supabase
          .from("dokumente")
          .select("id, name, filename, file_size, file_type, storage_path, customer_id")
          .eq("id", link.doc_id)
          .single();
        if (data) docs = [data];
      } else if (link.customer_id) {
        // Ordner: alle Dokumente des Kunden (+ optionale Kategorie/Jahr-Filter)
        let q = supabase
          .from("dokumente")
          .select("id, name, filename, file_size, file_type, storage_path, customer_id, category, year")
          .eq("customer_id", link.customer_id);
        if (link.category) q = q.eq("category", link.category);
        if (link.year) q = q.eq("year", link.year);
        q = q.order("name");
        const { data } = await q;
        docs = data || [];
      }

      // Kunden-Name laden
      let customerName = "";
      if (link.customer_id) {
        const { data: cust } = await supabase
          .from("customers")
          .select("company_name")
          .eq("id", link.customer_id)
          .single();
        customerName = cust?.company_name || "";
      }

      return new Response(JSON.stringify({
        name: link.name,
        is_folder: !link.doc_id,
        customer_name: customerName,
        expires_at: link.expires_at,
        download_count: link.download_count,
        docs,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DOWNLOAD: Datei via Supabase Storage herunterladen ────────────────────
    if (action === "download") {
      const doc_id_param = url.searchParams.get("doc_id") || link.doc_id;
      if (!doc_id_param) {
        return new Response(JSON.stringify({ error: "doc_id fehlt" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: doc } = await supabase
        .from("dokumente")
        .select("storage_path, filename, name")
        .eq("id", doc_id_param)
        .single();

      if (!doc) {
        return new Response(JSON.stringify({ error: "Dokument nicht gefunden" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Download-Zähler erhöhen
      await supabase.from("share_links")
        .update({ download_count: (link.download_count || 0) + 1 })
        .eq("id", link.id);

      if (!doc.storage_path) {
        return new Response(JSON.stringify({ error: "Datei nicht im Storage verfügbar" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Signed URL generieren (1 Stunde gültig)
      const { data: signed } = await supabase.storage
        .from("dokumente")
        .createSignedUrl(doc.storage_path, 3600, {
          download: doc.filename || doc.name,
        });

      if (signed?.signedUrl) {
        return new Response(JSON.stringify({ url: signed.signedUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Signed URL konnte nicht erstellt werden" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unbekannte Aktion" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("share-link error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
