import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { audio_url } = await req.json();
    if (!audio_url) {
      return Response.json({ error: 'No audio_url provided' }, { status: 400 });
    }

    // Download the audio file from the URL
    const audioResponse = await fetch(audio_url);
    if (!audioResponse.ok) {
      return Response.json({ error: 'Failed to download audio file' }, { status: 500 });
    }
    const audioBlob = await audioResponse.blob();

    // Send to OpenAI Whisper
    const openaiForm = new FormData();
    openaiForm.append('file', new File([audioBlob], 'audio.webm', { type: 'audio/webm' }));
    openaiForm.append('model', 'whisper-1');
    openaiForm.append('language', 'de');
    // Hint Whisper about our keywords for better recognition
    openaiForm.append('prompt', 'Titel Beschreibung Spalte Priorität zugewiesen an Datum Intern Extern Hoch Niedrig');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: openaiForm,
    });

    if (!whisperResponse.ok) {
      const err = await whisperResponse.text();
      return Response.json({ error: 'Whisper API error: ' + err }, { status: 500 });
    }

    const result = await whisperResponse.json();
    return Response.json({ transcript: result.text });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});