import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

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
      // Polyfills für swissqrbill (PDFKit nutzt Node-Builtins: buffer, stream, events, util)
      nodePolyfills({
        include: ['buffer', 'stream', 'events', 'util', 'fs', 'zlib'],
        globals: { Buffer: true, process: false },
      }),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false,
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      // Wichtig für swissqrbill v3: nutze die "browser" conditional export,
      // damit fontkit/pdfkit's Node-Bundle (mit fs.readFileSync) NICHT geladen wird.
      conditions: ['browser', 'module', 'import', 'default'],
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
      // pdfjs-dist 3.11 ist AMD/UMD (package.json "format": "amd").
      // OHNE Pre-Bundling kommt `getDocument` nicht im ES-Namespace an → "is not a function".
      // MIT Pre-Bundling konvertiert Vite es sauber auf ES-Module — named/namespace imports funktionieren.
      include: ['pdfjs-dist'],
      // swissqrbill+fontkit pre-bundeln, damit fs/readFileSync nicht im
      // Rollup-Build-Pfad landen (Browser-Bundle ist in einer Datei zusammengefasst).
      exclude: ['swissqrbill', 'fontkit', 'pdfkit'],
    },
    build: {
      rollupOptions: {
        // fontkit/pdfkit Node-only; im Build durch leere Stubs ersetzen.
        // Tatsächliche Nutzung passiert nur via swissqrbill-Browser-Bundle
        // (Pre-Bundled, lädt seine eigenen gebundelten Deps).
        external: (id) => /^(fontkit|pdfkit)($|\/)/.test(id),
      },
    },
  };
});