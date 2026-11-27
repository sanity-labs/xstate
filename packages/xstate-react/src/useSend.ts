import {useMemo} from 'react'
import type {AnyActorRef} from 'xstate'

import {getStore} from './store'

/**
 * Returns the same `send` that `useActor` returns, for an actor created elsewhere, e.g. with
 * `useActorRef` or `createActorContext`. It sends in a transition: the one it is called in, or a
 * transition of its own.
 *
 * @public
 */
export function useSend<TActor extends AnyActorRef>(actor: TActor): TActor['send'] {
  return useMemo(() => getStore(actor).send, [actor]) as TActor['send']
}

/**
 * Returns a `send` for updates that must show right away, like a controlled input's `onChange`.
 * The event's outcome is computed with XState's `transition()` and shown with `useOptimistic` by
 * every hook that holds the actor's snapshot, while the actor's own snapshot renders in a
 * transition. Previews never run effects: a child actor in a preview is a copy that never starts and
 * ignores events, until the transition renders the snapshot with the running child.
 *
 * @public
 */
export function useOptimisticSend<TActor extends AnyActorRef>(actor: TActor): TActor['send'] {
  return useMemo(() => getStore(actor).sendOptimistic, [actor]) as TActor['send']
}
