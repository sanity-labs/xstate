// PALS-151 prototype: useActorSnapshot backed by react-concurrent-store's experimental
// committed/head store. It classifies updates by reading React internals and rebases a sync
// update onto the committed snapshot with the source reducer. Readers must be below StoreProvider.
//
// The reducer keeps the committed snapshot when there is no event to replay. useActor has no sync
// send, so an update that arrives outside a transition cannot be rebased onto a pending one: the
// ponyfill reveals the head or keeps the committed snapshot according to its own priority check.
import {useEffect} from 'react'
import {experimental} from 'react-concurrent-store'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

import {isErrored} from '../useActorSnapshot.main'

const {createStoreFromSource, useStoreSelector} = experimental

type Source<TLogic extends AnyActorLogic> = ReturnType<
  typeof createStoreFromSource<SnapshotFrom<TLogic>, null>
>

interface Bridge<TLogic extends AnyActorLogic> {
  xs: Source<TLogic>
  refs: number
  unsubscribe: (() => void) | undefined
}

const bridges = new WeakMap<Actor<any>, Bridge<any>>()

function identity<T>(value: T): T {
  return value
}

function getBridge<TLogic extends AnyActorLogic>(actor: Actor<TLogic>): Bridge<TLogic> {
  let bridge = bridges.get(actor) as Bridge<TLogic> | undefined
  if (!bridge) {
    bridge = {
      xs: createStoreFromSource<SnapshotFrom<TLogic>, null>({
        getState: () => actor.getSnapshot(),
        reducer: (snapshot) => snapshot,
      }),
      refs: 0,
      unsubscribe: undefined,
    }
    bridges.set(actor, bridge)
  }
  return bridge
}

function retain<TLogic extends AnyActorLogic>(actor: Actor<TLogic>): () => void {
  const bridge = getBridge(actor)
  if (bridge.refs++ === 0) {
    const push = () => bridge.xs.handleUpdate(null)
    const subscription = actor.subscribe({
      next: push,
      error: push,
    })
    bridge.unsubscribe = () => subscription.unsubscribe()
    if (bridge.xs.getState() !== actor.getSnapshot()) {
      push()
    }
  }
  return () => {
    if (--bridge.refs === 0) {
      bridge.unsubscribe?.()
      bridge.unsubscribe = undefined
    }
  }
}

export function useActorSnapshot<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): SnapshotFrom<TLogic> {
  const bridge = getBridge(actor)
  const snapshot = useStoreSelector(bridge.xs, identity)

  useEffect(() => retain(actor), [actor])

  const value: unknown = snapshot
  if (isErrored(value)) {
    throw value.error
  }
  return snapshot
}

export const StoreProvider = experimental.StoreProvider
