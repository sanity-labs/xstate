# AGENTS.md

## Cursor Cloud specific instructions

This is the `sanity-labs/xstate` pnpm monorepo (workspaces defined in `pnpm-workspace.yaml`):

- `packages/xstate-react` — the `@sanity-labs/xstate-react` library (XState v6 bindings for React 19 transitions). Built with `tsdown` (configured through `@sanity/tsdown-config` in `packages/xstate-react/tsdown.config.ts`), tested with Vitest.

Standard commands are defined in the root `package.json` scripts and mirror CI (`.github/workflows/ci.yml`): `pnpm build`, `pnpm lint`, `pnpm exec oxfmt --check`, `pnpm knip`, `pnpm test`. Dependencies are installed with `pnpm install` (pnpm version is pinned via `packageManager`).

Non-obvious notes:

- `pnpm lint` runs Oxlint (type-aware + type-check via `.oxlintrc.json` `options`), including the React Compiler rules. `react/rule-suppression` is on, so React Compiler findings cannot be silenced with disable comments: restructure the code instead.
- `pnpm test` runs Vitest with `--typecheck` and runs each suite twice: once normally and once through the React Compiler (the `react-compiler` project in `packages/xstate-react/vitest.config.ts`). The published build is compiled with the React Compiler too.
- `packages/xstate-react/src/__tests__/upstream` holds tests adapted from `@xstate/react`. They keep upstream's style, so they have their own relaxed `tsconfig.json` and a lint override in `.oxlintrc.json`.
- `useIdleActorRef` opts out of the React Compiler with `'use no memo'`: it detects Fast Refresh through a `useMemo` that React recomputes on refresh, which a compiler cache slot would not.
- `tsdown` requires Node `^22.18.0 || >=24.11.0`; older Node 22 releases fail with `Failed to import module "unrun"`.
- tsdown owns the `exports` map in `packages/xstate-react/package.json`. Locally `exports` points at `./src/index.ts` and `publishConfig.exports` carries the `dist` entry points, which `pnpm publish` swaps in.
- Agent skills live in `.agents/skills`, with symlinks in `.claude/skills`, and are pinned in `skills-lock.json`. Add or update them with `npx skills add <source> -a cursor -a claude-code`. The `xstate-v6` skill reads the docs that ship in the installed `xstate` package.
