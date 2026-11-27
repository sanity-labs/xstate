---
'@sanity-labs/xstate-react': minor
---

Snapshots now reach React through a single subscriber per actor. The `createActorContext` provider holds the snapshot in state and passes it to `useSelector` readers through context, so a reader that mounts during a transition renders the same snapshot as the rest of the tree.

`send` is now always a transition, and no longer previews events sent outside one. Send events that must show right away, like a controlled input's `onChange`, with the new `useOptimisticSend(actor)` (or `useOptimisticSend()` from `createActorContext`).
