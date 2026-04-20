import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // 1. Only load variables prefixed with VITE_ (standard security)
  // Removing the empty string '' ensures only VITE_ variables are loaded
  const env = loadEnv(mode, process.cwd());

  console.log('🚀 Vite Build Debugging:');
  console.log(`   Modus: ${mode}`);
  console.log(`   VITE_SUPABASE_URL: ${env.VITE_SUPABASE_URL || '❌'}`);

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
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true, // Prevents Vite from trying 3001 if 3000 is "busy"
      proxy: {
        // Für /Steuern: AcroForm-Formulare werden proxied geladen, damit pdf-lib/pdfjs
        // sie CORS-frei lesen kann (ehemals steuerapp).
        '/pdf-sg': {
          target: 'https://www.sg.ch',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/pdf-sg/, ''),
        },
        '/pdf-tg': {
          target: 'https://steuerverwaltung.tg.ch',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/pdf-tg/, ''),
        },
        '/pdf-estv': {
          target: 'https://www.estv.admin.ch',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/pdf-estv/, ''),
        },
      },
    },
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
  };
});