import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { searchQuery, limit = 5 } = await req.json();

    if (!searchQuery) {
      return new Response(JSON.stringify({ error: "Missing 'searchQuery'" }), { status: 400 });
    }

    // 1. Get embedding from your local Infinity container
    const embeddingResponse = await fetch("http://192.168.5.10:7997/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [searchQuery],
        model: "BAAI/bge-small-en-v1.5"
      })
    });

    if (!embeddingResponse.ok) {
      throw new Error("Failed to generate embedding via Infinity container");
    }

    const json = await embeddingResponse.json();
    const queryEmbedding = json.data[0].embedding;

    // 2. Init Supabase
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 3. Perform Hybrid RPC search
    const { data: results, error: searchError } = await supabase.rpc('match_documents_hybrid', {
      query_text: searchQuery.replace('*', ':*'),
      query_embedding: queryEmbedding,
      match_count: limit
    });

    if (searchError) {
      console.error("Hybrid Search Error:", searchError);
      throw searchError;
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error during search function processing:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});