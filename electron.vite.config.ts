import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@core': resolve('src/core')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@core': resolve('src/core')
      }
    },
    plugins: [react()]
  }
})
