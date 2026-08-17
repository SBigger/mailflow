// supabase/functions/_shared/cors.ts

const ALLOWED_ORIGINS = [
  'https://sm-artis.ch',
  'https://www.sm-artis.ch',
  // 'http://localhost:3000', // optional für lokale Entwicklung
];

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'https://sm-artis.ch',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

export function handleCors(req: Request) {
  const headers = getCorsHeaders(req);

  // Liefert direkt eine Antwort für OPTIONS Preflight-Anfragen zurück
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  return null;
}