import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'pdf.worker.min.mjs') {
            return 'pdf.worker.min.mjs';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
