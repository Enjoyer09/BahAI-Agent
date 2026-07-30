/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
