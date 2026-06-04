// Vercel-Einstiegspunkt: stellt die Express-App als eine serverlose Funktion
// bereit. Alle /api/*-Anfragen werden per vercel.json hierher geleitet.
import app from '../server.js';

export default app;
