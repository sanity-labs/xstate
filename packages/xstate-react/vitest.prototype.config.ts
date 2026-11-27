import {fileURLToPath} from 'node:url'

import react from '@vitejs/plugin-react'
import {defineConfig} from 'vitest/config'

/**
 * Runs the existing suites against a PALS-175 prototype by aliasing their `../index` import.
 * Pick the shape with `PROTOTYPE_SHAPE`: `actionState` (a: the live actor behind
 * `useActionState`), `durable` (c: `xstate/durable`) or `transition` (the pure FSM API).
 */
const shapes = {
  actionState: './src/prototypes/shapes/actionStateUseActor.ts',
  durable: './src/prototypes/shapes/durableUseActor.ts',
  transition: './src/prototypes/shapes/transitionUseActor.ts',
} as const

export function shapeAlias(): {find: RegExp; replacement: string} {
  const shape = process.env['PROTOTYPE_SHAPE'] ?? 'durable'
  if (!(shape in shapes)) {
    throw new Error(`Unknown PROTOTYPE_SHAPE "${shape}"; one of ${Object.keys(shapes).join(', ')}`)
  }
  return {
    find: /^(\.\.\/)+index$/,
    replacement: fileURLToPath(new URL(shapes[shape as keyof typeof shapes], import.meta.url)),
  }
}

export default defineConfig({
  resolve: {
    alias: [shapeAlias()],
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
