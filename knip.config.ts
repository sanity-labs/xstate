import type {KnipConfig} from 'knip'

const config: KnipConfig = {
  // `pnpm change` is a pnpm 12 built-in, not a package binary.
  ignoreBinaries: ['change'],
  ignore: ['.agents/skills/**', '.claude/skills/**', 'research/**'],
  workspaces: {
    '.': {},
    'examples/async-react': {
      entry: ['src/main.tsx', 'vite.config.ts'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
      paths: {'@/*': ['./src/*']},
      ignore: ['public/mockServiceWorker.js'],
      // Imported from CSS, which knip does not read.
      ignoreDependencies: ['tailwindcss', 'tw-animate-css'],
    },
    'packages/xstate-react': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
      // Research configs and the shims they alias the suites to; see `vitest.prototype.config.ts`.
      ignore: [
        'vitest.prototype.config.ts',
        'vitest.prototype.browser.config.ts',
        'src/prototypes/shapes/*.ts',
      ],
    },
  },
}

export default config
