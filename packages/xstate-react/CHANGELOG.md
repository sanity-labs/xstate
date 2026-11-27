# @sanity-labs/xstate-react

## 0.2.0

### Minor Changes

- [#5](https://github.com/sanity-labs/xstate/pull/5) [`5a91dbd`](https://github.com/sanity-labs/xstate/commit/5a91dbdbaaf6f468e120f3924a83c89855c0697c) Thanks [@stipsan](https://github.com/stipsan)! - Snapshots now reach React through a single subscriber per actor. The `createActorContext` provider holds the snapshot in state and passes it to `useSelector` readers through context, so a reader that mounts during a transition renders the same snapshot as the rest of the tree.
  
  `send` is now always a transition, and no longer previews events sent outside one. Send events that must show right away, like a controlled input's `onChange`, with the new `useOptimisticSend(actor)` (or `useOptimisticSend()` from `createActorContext`).

## 0.1.0

### Minor Changes

- [#1](https://github.com/sanity-labs/xstate/pull/1) [`2247fab`](https://github.com/sanity-labs/xstate/commit/2247fab766ca34fa4e446b918d9121feac89464c) Thanks [@stipsan](https://github.com/stipsan)! - Initial release: `useActor`, `useActorRef`, `useSelector`, `useSend` and `createActorContext` for XState v6, where `send` is a React transition and controlled inputs stay in sync through `useOptimistic`.
