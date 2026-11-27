import react from '@vitejs/plugin-react'
import {playwright} from '@vitest/browser-playwright'
import {defineConfig} from 'vitest/config'

import {shapeAlias} from './vitest.prototype.config'

/**
 * Runs the real-view-transition suite against a PALS-175 prototype in headless Chromium, plain
 * and through the React Compiler. Pick the shape with `PROTOTYPE_SHAPE` as for
 * `vitest.prototype.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: [shapeAlias()],
  },
  test: {
    setupFiles: ['vitest-cleanup-after-each.ts'],
    include: ['src/__tests__/browser/*.test.tsx', 'src/__tests__/prototype.*.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}],
    },
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {name: 'chromium'},
      },
      {
        extends: true,
        plugins: [react({compiler: {target: '19'}})],
        test: {name: 'chromium-react-compiler'},
      },
    ],
  },
})
