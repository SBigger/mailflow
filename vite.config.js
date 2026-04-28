import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());

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
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp,json}'],
          globDirectory: 'dist',
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      // Wir stellen sicher, dass die Dateien in einem Standard-Pfad landen
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
              if (id.includes('lucide-react')) return 'vendor-icons';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('@tanstack')) return 'vendor-query';
              return 'vendor';
            }
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      proxy: {
        '/pdf-sg': { target: 'https://www.sg.ch', changeOrigin: true, rewrite: p => p.replace(/^\/pdf-sg/, '') },
        '/pdf-tg': { target: 'https://steuerverwaltung.tg.ch', changeOrigin: true, rewrite: p => p.replace(/^\/pdf-tg/, '') },
        '/pdf-estv': { target: 'https://www.estv.admin.ch', changeOrigin: true, rewrite: p => p.replace(/^\/pdf-estv/, '') },
      },
    },
    optimizeDeps: {
      include: ['pdfjs-dist'],
    },
  };
});