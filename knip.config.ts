import type {KnipConfig} from 'knip'

const config: KnipConfig = {
  // `pnpm change` is a pnpm 12 built-in, not a package binary.
  ignoreBinaries: ['change'],
  ignore: ['.agents/skills/**', '.claude/skills/**'],
  workspaces: {
    '.': {},
    'packages/xstate-react': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
    },
  },
}

export default config
