import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite' // loadEnv hinzugefügt
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // Lädt alle Umgebungsvariablen basierend auf dem aktuellen Modus (z.B. 'production')
  // Der dritte Parameter '' sorgt dafür, dass ALLE Variablen geladen werden,
  // nicht nur die mit VITE_ (gut zum Debuggen)
  const env = loadEnv(mode, process.cwd(), '');

  // --- DEBUG LOGS (erscheinen im Terminal beim Build) ---
  console.log('🚀 Vite Build Debugging:');
  console.log(`   Modus: ${mode}`);
  console.log(`   VITE_SUPABASE_URL: ${env.VITE_SUPABASE_URL || '❌ Nicht gefunden!'}`);
  console.log(`   VITE_SUPABASE_ANON_KEY: ${env.VITE_SUPABASE_ANON_KEY || '❌ Nicht gefunden!'}`);
  console.log('-------------------------');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false,
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Optional: Hier kannst du die Variablen global verfügbar machen,
    // falls du sie außerhalb von import.meta.env brauchst
    define: {
      'process.env': env,
    },
    server: {
      port: 3000,
      host: '127.0.0.1',
    },
    build: {
      outDir: 'dist',
    }
  };
});