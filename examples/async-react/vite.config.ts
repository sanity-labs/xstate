import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

export default defineConfig(({mode}) => ({
  plugins: [react(mode === 'no-compiler' ? {} : {compiler: {target: '19'}}), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
    // `@sanity-labs/xstate-react` resolves to its workspace source, next to its own dev copies of
    // these. Hooks need a single React, and `xstate`'s `Actor` class is checked with `instanceof`.
    dedupe: ['react', 'react-dom', 'xstate'],
  },
}))
