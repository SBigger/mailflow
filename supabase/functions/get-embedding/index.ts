
Deno.serve(async (req) => {
  console.log("👉 Function get-embedding triggered!");

  // Always handle CORS preflight first
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

    // 1. Parse the top-level body wrapper
    const body = await req.json();
    const  text  = body.text;
    const response = await fetch("http://192.168.5.10:7997/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [text],
        model: "BAAI/bge-small-en-v1.5"
      })
    });
    const json = await response.json();
    const embedding = json.data[0].embedding;
    return new Response(JSON.stringify({ embedding }), {headers: { "Content-Type": "application/json" }})
})