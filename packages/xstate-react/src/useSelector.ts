import {useMemo} from 'react'
import type {AnyActorRef} from 'xstate'

import {getStore} from './store'
import {useStoreSelection} from './useStoreSelection'

function defaultCompare<T>(a: T, b: T) {
  return a === b
}

/**
 * Reads a value derived from an actor's snapshot, and re-renders only when `compare` says it
 * changed.
 *
 * @public
 */
export function useSelector<
  TActor extends Pick<AnyActorRef, 'subscribe' | 'getSnapshot'> | undefined,
  T,
>(
  actor: TActor,
  selector: (
    snapshot: TActor extends {getSnapshot(): infer TSnapshot} ? TSnapshot : undefined,
  ) => T,
  compare: (a: T, b: T) => boolean = defaultCompare,
): T {
  const store = useMemo(() => (actor ? getStore(actor) : undefined), [actor])
  return useStoreSelection(store, selector, compare)
}
