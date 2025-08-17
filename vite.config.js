import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/postcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3003,
    host: '0.0.0.0',
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    https: {
      key: fs.readFileSync('./localhost-key.pem'),
      cert: fs.readFileSync('./localhost.pem')
    }
  },
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  define: {
    'process.env': process.env ?? {},
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'audio-processor.js') {
            return 'assets/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['audio-processor.js'],
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  }
}) 