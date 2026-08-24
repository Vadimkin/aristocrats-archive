import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Dev is served from a sub-path (https://vadymklymenko.com/aristocrats/), so every
// emitted URL — the entry script, the CSS, everything copied out of public/ — has to
// carry that prefix. The app reads it back through import.meta.env.BASE_URL rather
// than hardcoding it anywhere. For a root deploy: BASE_PATH=/ npm run build.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/aristocrats/',
  plugins: [preact()],
  build: { target: 'es2020' },
})
