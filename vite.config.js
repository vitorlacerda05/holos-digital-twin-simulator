import { defineConfig } from 'vite';

// Servimos tudo localmente (modelo + wasm em /public) para a demo rodar offline.
export default defineConfig({
  server: { host: true, open: true },
  build: { target: 'esnext' },
});
