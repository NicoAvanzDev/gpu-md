import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'lib',
    lib: { entry: 'src/engine/index.ts', formats: ['es'], fileName: 'gpu-md' },
    minify: true,
  },
})
