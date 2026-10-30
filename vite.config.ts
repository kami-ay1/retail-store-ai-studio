import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  server: { proxy: { '/api': 'http://127.0.0.1:4317' } },
  build: { outDir: 'dist', emptyOutDir: true },
})
