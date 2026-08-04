import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Eigenständiger Build — keine Verbindung zum MailFlow-Vite-Setup.
// Alias @ zeigt ausschliesslich in diese App.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
