import {useMemo, useState} from 'react'
import type {AnyActorRef} from 'xstate'

import {notProvided, useProvidedSnapshot} from './snapshotContext'
import {getStore} from './store'
import {isErrored, useStoreSelection} from './useStoreSelection'

function defaultCompare<T>(a: T, b: T) {
  return a === b
}

function ignore(): undefined {
  return undefined
}

/**
 * Keeps the previous selection while `compare` says it is unchanged, so that what the caller
 * renders from it can be memoized.
 */
function useSelection<T>(
  snapshot: unknown,
  selector: (snapshot: any) => T,
  compare: (a: T, b: T) => boolean,
): T | undefined {
  const [previous, setPrevious] = useState<{snapshot: unknown; selected: T} | undefined>(() =>
    snapshot === notProvided || isErrored(snapshot)
      ? undefined
      : {snapshot, selected: selector(snapshot)},
  )
  if (snapshot === notProvided) {
    return undefined
  }
  if (isErrored(snapshot)) {
    throw snapshot.error
  }
  const next = selector(snapshot)
  if (previous && compare(previous.selected, next)) {
    return previous.selected
  }
  if (previous?.snapshot !== snapshot) {
    setPrevious({snapshot, selected: next})
  }
  return next
}

/**
 * Reads a value derived from an actor's snapshot, and returns the previous value while `compare`
 * says it is unchanged.
 *
 * Below a `createActorContext` provider of the actor, the snapshot comes from that provider, which
 * is the only component that subscribes to the actor. Elsewhere this hook subscribes to the actor
 * itself, and re-renders only when the selection changes.
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
  const provided = useProvidedSnapshot(actor)
  const isProvided = provided !== notProvided
  const store = useMemo(
    () => (actor && !isProvided ? getStore(actor) : undefined),
    [actor, isProvided],
  )
  const subscribed = useStoreSelection<T | undefined>(
    store,
    isProvided ? ignore : selector,
    isProvided ? defaultCompare : (compare as (a: T | undefined, b: T | undefined) => boolean),
  )
  const selected = useSelection(provided, selector, compare)
  return (isProvided ? selected : subscribed) as T
}
