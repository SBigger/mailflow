import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // CORS Preflight Handler
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log("🚀 Starte Batch-Verarbeitung für Dokumente ohne Status...");

    // 1. Supabase Service-Role Client initialisieren
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 2. Max. 1000 Zeilen holen, bei denen der Status NULL ist
    // Wichtig: Wir brauchen die 'storage_object_id', um das File zu verarbeiten
    const { data: pendingDocs, error: fetchError } = await supabase
        .from('dokumente')
        .select('id, storage_object_id, storage_path, name, filename')
        .ilike('status', '%error%')
        .ilike('file_type', '%outlook%')
        .limit(1);

    if (fetchError) {
      console.error("Fehler beim Abrufen der Dokumente:", fetchError);
      throw fetchError;
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "Keine Dokumente zur Verarbeitung ausstehend."
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Für jedes Dokument die Storage-Informationen aus 'storage.objects' holen
    // Da deine 'process-document' Funktion das 'rec' Objekt aus dem Storage-Webhook erwartet,
    // bauen wir dieses hier exakt nach.
    let processedCount = 0;
    let failedCount = 0;

    // Wir verarbeiten die Dokumente nacheinander (oder in kleinen Batches),
    // um ein Timeout der Edge Function oder Überlastung des Infinity-Containers zu vermeiden.
    for (const doc of pendingDocs) {
      try {
        // Hol den vollständigen Pfad und Metadaten aus dem Supabase Storage System
        const { data: storageObj, error: storageError } = await supabase
            .schema('storage')
            .from('objects')
            .select('id, name, bucket_id')
            .eq('name', doc.storage_path)
            .single();

        if (storageError || !storageObj) {
          console.error(`Skipping: Storage-Objekt für Dokument ${doc.name} (${doc.id}) nicht gefunden.`);
          const { error } = await supabase
              .from('dokumente')
              .update({ status: 'doc_not_found', storage_object_id: doc.id })
              .eq('id', doc.id);
          failedCount++;
          continue;
        }

        // Simuliere exakt die Struktur des Webhooks ('rec'), die deine Hauptfunktion erwartet:
        // rec.id und rec.fullPath (wobei fullPath = bucket_id/file_path ist)
        const payload = {
          rec: {
            id: storageObj.id,
            name:doc.name,
            fullPath: `${storageObj.bucket_id}/${storageObj.name}`,
            filename: doc.filename
          }
        };

        // 4. Deine bestehende 'process-document' Edge Function per HTTP aufrufen
        // (Alternativ kannst du den Code aus deiner ersten Funktion auch direkt hier importieren)
        const processResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify(payload)
        });

        if (!processResponse.ok) {
          const errText = await processResponse.text();
          throw new Error(`Pipeline-Fehler: ${errText}`);
        } else {
          // 5. Nach erfolgreicher Vektorisierung den Status in 'dokumente' updaten,
          // damit es beim nächsten Scan nicht wieder mitgenommen wird.
          const {error: updateError} = await supabase
              .from('dokumente')
              .update({status: 'processed', storage_object_id: storageObj.id})
              .eq('id', doc.id);

          if (updateError) {
            console.error(`Fehler beim Aktualisieren des Status für ${doc.name}:`, updateError);
          } else {
            processedCount++;
          }
        }

      } catch (docError) {
        console.error(`❌ Fehler bei Dokument ID ${doc.id} (${doc.name}):`, docError.message);

        // Optional: Setze den Status auf 'error', damit es nicht in einer Endlosschleife hängen bleibt
        await supabase
            .from('dokumente')
            .update({ status: `error: ${docError.message}` })
            .eq('id', doc.id);

        failedCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      failed: failedCount
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Kritischer Fehler im Cron-Job:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});