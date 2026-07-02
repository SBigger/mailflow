// cache-bust: 2026-05-07-v3
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
    base: '/',
    plugins: [
      react(),
      // Polyfills für swissqrbill (PDFKit nutzt Node-Builtins: buffer, events, util)
      // WICHTIG: fs, zlib, stream werden NICHT über nodePolyfills gepolyfilled –
      // wir haben eigene Shims (fsPdfkitShim, zlibShim, streamShim) die via
      // optimizeDeps.esbuildOptions.alias direkt eingebunden werden.
      // nodePolyfills würde fs → empty.js mappen (null) → readFileSync-Crash.
      nodePolyfills({
        include: ['buffer', 'events', 'util', 'process'],
        globals: { Buffer: true, process: true },
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
        'fontkit': path.resolve(__dirname, './src/lib/fontkitStub.js'),
        'fs': path.resolve(__dirname, './src/lib/fsPdfkitShim.js'),
        'zlib': path.resolve(__dirname, './src/lib/zlibShim.js'),
        'stream': path.resolve(__dirname, './src/lib/streamShim.js'),
        '@swissqrbill-pdf': path.resolve(__dirname, 'node_modules/swissqrbill/lib/esm/pdf')
      },
      // Wichtig für swissqrbill v3: nutze die "browser" conditional export
      conditions: ['browser', 'module', 'import', 'default'],
    },
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      // pdfkit.es5.js nutzt __dirname für AFM-Pfade (z.B. __dirname + '/data/Helvetica.afm').
      // Im Browser/ESM ist __dirname nicht definiert. Wir mappen es auf '/' damit
      // unser fsPdfkitShim._basename(...) den Filename korrekt extrahieren kann.
      '__dirname': JSON.stringify('/'),
      '__filename': JSON.stringify('/index.js'),
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
      include: [
        'pdfjs-dist',
        'jspdf-autotable',
        'linebreak', 'browserify-zlib', 'stream-browserify', 'events',
        'blob-stream', 'crypto-js', 'svgpath',
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
      ],
      // pdfkit: MUSS draussen bleiben → Vite Transform-Pipeline statt esbuild (→ alias greift)
      exclude: ['pdfkit'],
    },
    build: {
      rollupOptions: {
        external: ['/config.js']
      },
      commonjsOptions: {
        include: [/jspdf-autotable/, /node_modules/],
        transformMixedEsModules: true,
      }
    },
  };
});