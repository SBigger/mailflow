
Deno.serve(async (req) => {
  const { text } = await req.json()
  const response = await fetch("http://infinity:7997/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: [text],
      model: "gte-small"
    })
  });
  const json = await response.json();
  const embedding = json.data[0].embedding;
  return new Response(JSON.stringify({ embedding }), {
    headers: { "Content-Type": "application/json" }
  })
})