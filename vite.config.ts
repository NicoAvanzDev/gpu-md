import { defineConfig } from 'vite'

export default defineConfig({
  // Relative assets let the playground work below a static host's subdirectory.
  base: './',
  worker: { format: 'es' },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  build: { target: 'es2022' },
})
