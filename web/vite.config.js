import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works wherever it's served: the GitHub
  // Pages project subpath (https://<user>.github.io/<repo>/), or the root of
  // Netlify/Vercel. A hardcoded '/<repo>/' breaks silently (blank page) if it
  // doesn't match the repo name exactly — it's case-sensitive too.
  base: './',
  build: { outDir: 'dist', sourcemap: false },
})
