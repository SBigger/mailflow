// index.ts (Supabase Edge Function)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // CORS-Anfragen (Preflight) für den Browser erlauben
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Initialisiere den Supabase-Client mit den Service-Rollen-Schlüsseln der Edge Function
        const adminClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            {
                db: { schema: 'storage' }
            }
        )

        // 2. Hole den Bucket-Namen aus dem Request-Body oder Query-Parameter
        const bucketName = 'dokumente';

        if (!bucketName) {
            return new Response(
                JSON.stringify({ error: 'Es wurde kein bucketName übergeben.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            )
        }

        // 3. Datenbank-Abfrage an das "storage.objects"-Schema senden.
        // Wir summieren die Spalte 'size' (in Bytes) aller Objekte dieses Buckets
        const { data, error } = await adminClient
            .from('objects')
            .select('metadata')
            .eq('bucket_id', bucketName)

        if (error) throw error

        // Die Dateigrößen aus den Metadaten extrahieren und aufsummieren
        const totalBytes = data.reduce((acc, obj) => {
            const size = obj.metadata?.size || 0
            return acc + size
        }, 0)

        // Bytes in Gigabyte umrechnen (1 GB = 1.073.741.824 Bytes)
        const totalGB = (totalBytes / 1073741824)

        return new Response(
            JSON.stringify({
                bucket: bucketName,
                usedSizeGB: parseFloat(totalGB.toFixed(3)), // z. B. 0.452 GB
                usedSizeBytes: totalBytes
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (err) {
        console.log(err);
        return new Response(
            JSON.stringify({ error: err.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})