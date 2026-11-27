import {fileURLToPath} from 'node:url'

import react from '@vitejs/plugin-react'
import {defineConfig} from 'vitest/config'

// Runs the existing suites against the PALS-150 prototype by aliasing their `../index` import.
const prototype = fileURLToPath(new URL('./src/useActionStateActor.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{find: /^(\.\.\/)+index$/, replacement: prototype}],
  },
  test: {
    setupFiles: ['vitest-cleanup-after-each.ts'],
    environment: 'jsdom',
    include: ['src/__tests__/*.test.tsx', 'src/__tests__/upstream/*.test.tsx'],
    exclude: ['**/dist/**', '**/node_modules/**', 'src/__tests__/browser/**'],
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {name: 'default'},
      },
      {
        extends: true,
        plugins: [react({compiler: {target: '19'}})],
        test: {name: 'react-compiler'},
      },
    ],
  },
})
