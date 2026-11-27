// Research prototype (PALS-152), not exported: a fate-style reader for an xstate actor, modeled on
// nkzw-tech/fate packages/react-fate/src/useViewSnapshots.ts `useSnapshot`:
//   useSyncExternalStore(subscribe, getSnapshot) where the snapshot is a thenable,
//   useDeferredValue({reader, snapshot}), then use() to unwrap.
import {use, useCallback, useDeferredValue, useMemo, useSyncExternalStore} from 'react'
import type {AnyActorRef, SnapshotFrom} from 'xstate'

interface FulfilledThenable<T> extends PromiseLike<T> {
  status: 'fulfilled'
  value: T
}

function fulfilledThenable<T>(value: T): FulfilledThenable<T> {
  return {
    status: 'fulfilled',
    then(onfulfilled, onrejected) {
      return Promise.resolve(value).then(onfulfilled, onrejected)
    },
    value,
  }
}

type ReadableActor = Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>

interface Cached {
  snapshot: unknown
  thenable: FulfilledThenable<unknown>
}

// One thenable per actor snapshot, so `getSnapshot` is referentially stable for uSES.
const cache = new WeakMap<ReadableActor, Cached>()

function readThenable(actor: ReadableActor): FulfilledThenable<unknown> {
  const snapshot = actor.getSnapshot()
  let cached = cache.get(actor)
  if (!cached || cached.snapshot !== snapshot) {
    cached = {snapshot, thenable: fulfilledThenable(snapshot)}
    cache.set(actor, cached)
  }
  return cached.thenable
}

/** fate's `useSnapshot`, for an actor. Per-component subscription, like fate. */
export function useFateActor<TActor extends AnyActorRef>(actor: TActor): SnapshotFrom<TActor> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const subscription = actor.subscribe(onStoreChange)
      return () => subscription.unsubscribe()
    },
    [actor],
  )
  const getSnapshot = useCallback(() => readThenable(actor), [actor])
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const input = useMemo(() => ({reader: getSnapshot, snapshot: current}), [getSnapshot, current])
  const deferred = useDeferredValue(input)
  const snapshot = use(deferred.reader === getSnapshot ? deferred.snapshot : current)
  return snapshot as SnapshotFrom<TActor>
}

/** Control: the same uSES thenable read without `useDeferredValue` (E8's "usesPromise"). */
export function useUsesActor<TActor extends AnyActorRef>(actor: TActor): SnapshotFrom<TActor> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const subscription = actor.subscribe(onStoreChange)
      return () => subscription.unsubscribe()
    },
    [actor],
  )
  const getSnapshot = useCallback(() => readThenable(actor), [actor])
  return use(useSyncExternalStore(subscribe, getSnapshot, getSnapshot)) as SnapshotFrom<TActor>
}
