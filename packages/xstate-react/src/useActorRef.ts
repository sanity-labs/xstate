import {useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {
  _hotSwapActorLogic as hotSwapActorLogic,
  _toObserver as toObserver,
  Actor,
  createActor,
  type ActorOptions,
  type AnyActorLogic,
  type AnyStateMachine,
  type IsNotNever,
  type Observer,
  type RequiredActorOptionsFor,
  type RequiredActorOptionsKeys,
  type SnapshotFrom,
} from 'xstate'

import {getStore, type BindingOptions} from './store'

/**
 * `useActor`, `useActorRef` and `createActorContext` options: the actor's own options, read once
 * when the actor is created, and how its snapshots reach React.
 *
 * @public
 */
export type HookOptions<TLogic extends AnyActorLogic> = ActorOptions<TLogic> & BindingOptions

function isStateMachine(logic: AnyActorLogic): logic is AnyStateMachine {
  return (
    typeof (logic as any).provide === 'function' &&
    !!(logic as any).config &&
    !!(logic as any).sources
  )
}

export function isActor(value: unknown): value is Actor<AnyActorLogic> {
  return value instanceof Actor
}

// The hook updates the sources of its machine on later renders. A per-hook copy keeps those
// updates from reaching the caller's machine, which other actors may share.
function ownLogic<TLogic extends AnyActorLogic>(logic: TLogic): TLogic {
  return isStateMachine(logic) ? (logic.provide({}) as any) : logic
}

function create<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options: HookOptions<TLogic> | undefined,
): Actor<TLogic> {
  const {updates, ...actorOptions} = options ?? {}
  const actor = createActor(logic, actorOptions as ActorOptions<TLogic>)
  if (updates) {
    getStore(actor).updates = updates
  }
  return actor
}

function adoptLogic<TLogic extends AnyActorLogic>(
  actorRef: Actor<TLogic>,
  logic: TLogic,
  refreshed: boolean,
  options: HookOptions<TLogic> | undefined,
  setActorRef: (actorRef: Actor<TLogic>) => void,
): void {
  const currentLogic = actorRef.logic
  if ((logic as any).config === (currentLogic as any).config) {
    if (isStateMachine(logic) && isStateMachine(currentLogic)) {
      currentLogic.sources = logic.sources
    }
    return
  }
  // Fast Refresh re-evaluated the module that defines the machine: keep the running actor and
  // carry its live snapshot over, or start a fresh actor if it cannot be carried.
  if (refreshed) {
    const nextLogic = ownLogic(logic)
    if (!hotSwapActorLogic(actorRef, nextLogic as any as AnyStateMachine)) {
      setActorRef(create(nextLogic, options))
    }
  }
}

export function useIdleActorRef<TLogic extends AnyActorLogic>(
  logicOrActor: TLogic | Actor<TLogic>,
  options: HookOptions<TLogic> | undefined,
): [Actor<TLogic>, (actorRef: Actor<TLogic>) => void] {
  // React Compiler would turn the `useMemo` below into a cache slot that Fast Refresh never resets.
  'use no memo'
  const [actorRef, setActorRef] = useState(() =>
    isActor(logicOrActor) ? logicOrActor : create(ownLogic(logicOrActor), options),
  )
  // Its identity changes only when React Fast Refresh re-renders this component: Fast Refresh
  // ignores dependency lists while it applies an update.
  const refreshSignal = useMemo(() => ({}), [])
  const refreshSignalRef = useRef(refreshSignal)

  // The logic passed on the first render is used for the hook's lifetime. Later renders only
  // contribute implementations provided with `machine.provide()` for the same machine config.
  useLayoutEffect(() => {
    const refreshed = refreshSignalRef.current !== refreshSignal
    refreshSignalRef.current = refreshSignal
    if (!isActor(logicOrActor)) {
      adoptLogic(actorRef, logicOrActor, refreshed, options, setActorRef)
    }
  }, [actorRef, logicOrActor, refreshSignal, options])

  return [actorRef, setActorRef]
}

export function useActorLifecycle<TLogic extends AnyActorLogic>(
  actorRef: Actor<TLogic>,
  setActorRef: (actorRef: Actor<TLogic>) => void,
  createReplacement: () => Actor<TLogic>,
): void {
  const pendingStopsRef = useRef(new Map<Actor<TLogic>, () => void>())
  const replace = useEffectEvent(() => setActorRef(createReplacement()))

  useEffect(() => {
    const pendingStops = pendingStopsRef.current
    const cancelPendingStop = pendingStops.get(actorRef)
    if (cancelPendingStop) {
      cancelPendingStop()
      pendingStops.delete(actorRef)
    }

    // A stopped actor cannot be restarted, so one that stopped before this effect reconnected is
    // replaced.
    if (
      (actorRef as any)._processingStatus === 2 &&
      (actorRef.getSnapshot() as any)?.status === 'stopped'
    ) {
      replace()
      return
    }

    actorRef.start()
    // Stopping waits a microtask so that StrictMode's simulated unmount and remount, and a move
    // within the tree, keep the running actor.
    return () => {
      let canceled = false
      const cancel = () => {
        canceled = true
      }
      pendingStops.set(actorRef, cancel)
      queueMicrotask(() => {
        if (!canceled) {
          actorRef.stop()
        }
        if (pendingStops.get(actorRef) === cancel) {
          pendingStops.delete(actorRef)
        }
      })
    }
  }, [actorRef])
}

/** Creates an actor to replace a stopped one, keeping how its snapshots reach React. */
export function recreate<TLogic extends AnyActorLogic>(
  actorRef: Actor<TLogic>,
  options: ActorOptions<TLogic> | undefined,
): Actor<TLogic> {
  return create(actorRef.logic, {...options, updates: getStore(actorRef).updates})
}

/**
 * Creates an actor from `logic` (or uses an already-created `actor`, e.g. from `restoreActor`),
 * starts it on mount and stops it on unmount. Create a passed actor once, e.g.
 * `useState(() => restoreActor(machine, persisted))[0]`.
 *
 * The logic passed on the first render is used for the component's lifetime. To start over, or to
 * switch to a different machine, change the component's `key`.
 *
 * @public
 */
export function useActorRef<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
  observerOrListener?: Observer<SnapshotFrom<TLogic>> | ((value: SnapshotFrom<TLogic>) => void),
): Actor<TLogic>
/** @public */
export function useActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic,
  ...[options, observerOrListener]: IsNotNever<RequiredActorOptionsKeys<TLogic>> extends true
    ? [
        options: HookOptions<TLogic> & RequiredActorOptionsFor<TLogic>,
        observerOrListener?:
          | Observer<SnapshotFrom<TLogic>>
          | ((value: SnapshotFrom<TLogic>) => void),
      ]
    : [
        options?: HookOptions<TLogic>,
        observerOrListener?:
          | Observer<SnapshotFrom<TLogic>>
          | ((value: SnapshotFrom<TLogic>) => void),
      ]
): Actor<TLogic>
export function useActorRef(
  logicOrActor: AnyActorLogic | Actor<AnyActorLogic>,
  ...args: any[]
): Actor<AnyActorLogic> {
  const readyActor = isActor(logicOrActor)
  const options: HookOptions<AnyActorLogic> | undefined = readyActor ? undefined : args[0]
  const observerOrListener: Observer<unknown> | ((value: unknown) => void) | undefined = readyActor
    ? args[0]
    : args[1]
  const [actorRef, setActorRef] = useIdleActorRef(logicOrActor, options)

  useEffect(() => {
    if (!observerOrListener) {
      return
    }
    const subscription = actorRef.subscribe(toObserver(observerOrListener))
    return () => subscription.unsubscribe()
  }, [actorRef, observerOrListener])

  useActorLifecycle(actorRef, setActorRef, () => recreate(actorRef, actorRef.options))

  return actorRef
}
