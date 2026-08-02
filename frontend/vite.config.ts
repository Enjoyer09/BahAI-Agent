/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared wire contract (see shared/contract.js) — single source of
      // truth for SSE event types, message roles and web privacy keys.
      '@bahai/shared': path.resolve(__dirname, '../shared/contract.js'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssMinify: true,
    // shared/contract.js is CJS (backend requires it via require()); make
    // Rollup treat it as CommonJS too so named exports resolve at build time.
    commonjsOptions: {
      include: [/node_modules/, /[/\\]shared[/\\]contract\.js$/]
    },
    // FUNC-FIX: split heavy vendor chunks so the initial app load stays under
    // 500KB. Previous build was 1.17MB single chunk.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'editor': ['@monaco-editor/react'],
          'markdown': ['react-markdown', 'react-syntax-highlighter', 'remark-gfm'],
          'icons': ['lucide-react'],
        }
      }
    },
    chunkSizeWarningLimit: 600
  },
  optimizeDeps: {
    include: ['lucide-react', 'react-markdown', 'react-syntax-highlighter']
  }
})
