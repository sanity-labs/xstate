# @sanity-labs/xstate-react

## 0.3.0

### Minor Changes

- [#17](https://github.com/sanity-labs/xstate/pull/17) [`e9a01ee`](https://github.com/sanity-labs/xstate/commit/e9a01eec00316afbe06f50bcaeec47fbe7ea87f6) - The API is now a single hook: `useActor(logic, options)`, which returns `[snapshot, send]`.
  
  - Removed `useActorRef`, `useMachine`, `useSelector`, `useSend`, `useOptimisticSend`, `createActorContext`, `shallowEqual`, and the `HookOptions`, `BindingOptions`, `Updates` and `ActorContext` types.
  - Removed the `updates: 'sync'` option. Every snapshot change renders in `startTransition`.
  - `useActor` no longer returns the actor. It still accepts an already-created actor, like one from `restoreActor`. To start over, change the component's `key`.
  - For UI that must update right away, like a controlled input, hold its value with React's `useOptimistic` in the component that renders it, and call `send` from the action that sets it.
  - Requires `react` `^19.3.1`. `xstate/fsm` machines work as logic.

## 0.2.0

### Minor Changes

- [#5](https://github.com/sanity-labs/xstate/pull/5) [`5a91dbd`](https://github.com/sanity-labs/xstate/commit/5a91dbdbaaf6f468e120f3924a83c89855c0697c) - Snapshots now reach React through a single subscriber per actor. The `createActorContext` provider holds the snapshot in state and passes it to `useSelector` readers through context, so a reader that mounts during a transition renders the same snapshot as the rest of the tree.
  
  `send` is now always a transition, and no longer previews events sent outside one. Send events that must show right away, like a controlled input's `onChange`, with the new `useOptimisticSend(actor)` (or `useOptimisticSend()` from `createActorContext`).

## 0.1.0

### Minor Changes

- [#1](https://github.com/sanity-labs/xstate/pull/1) [`2247fab`](https://github.com/sanity-labs/xstate/commit/2247fab766ca34fa4e446b918d9121feac89464c) - Initial release: `useActor`, `useActorRef`, `useSelector`, `useSend` and `createActorContext` for XState v6, where `send` is a React transition and controlled inputs stay in sync through `useOptimistic`.
