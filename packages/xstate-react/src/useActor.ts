import {useMemo} from 'react'
import type {
  Actor,
  AnyActorLogic,
  ConditionalRequired,
  IsNotNever,
  RequiredActorOptionsFor,
  RequiredActorOptionsKeys,
  SnapshotFrom,
} from 'xstate'

import {getStore} from './store'
import {
  isActor,
  recreate,
  useActorLifecycle,
  useIdleActorRef,
  type HookOptions,
} from './useActorRef'
import {useStoreSelection} from './useStoreSelection'

function identity<T>(value: T): T {
  return value
}

/**
 * Creates an actor from `logic` (or uses an already-created `actor`, e.g. from `restoreActor`) and
 * subscribes to its snapshot. Create a passed actor once, e.g.
 * `useState(() => restoreActor(machine, persisted))[0]`.
 *
 * `send` is a transition: snapshot updates it causes render together with the transition it is
 * called in, or in a transition of its own. Until that transition settles, the returned snapshot
 * already shows the event's outcome, so a controlled input can call `send` in `onChange`.
 *
 * The logic passed on the first render is used for the component's lifetime, and `input` is read
 * once. To start over, or to switch to a different machine, change the component's `key`.
 *
 * @public
 */
export function useActor<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>]
/** @public */
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  ...[options]: ConditionalRequired<
    [options?: HookOptions<TLogic> & RequiredActorOptionsFor<TLogic>],
    IsNotNever<RequiredActorOptionsKeys<TLogic>>
  >
): [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>]
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic | Actor<TLogic>,
  options?: HookOptions<TLogic>,
): [SnapshotFrom<TLogic>, Actor<TLogic>['send'], Actor<TLogic>] {
  const readyActor = isActor(logic)
  if (!readyActor && !!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine), but received an ActorRef. Pass an Actor created with createActor()/restoreActor(), or use the useSelector(actorRef, ...) hook to read an ActorRef's snapshot.`,
    )
  }

  const [actorRef, setActorRef] = useIdleActorRef(logic, options)
  const store = useMemo(() => getStore(actorRef), [actorRef])
  const snapshot = useStoreSelection(store, identity, Object.is) as SnapshotFrom<TLogic>

  useActorLifecycle(actorRef, setActorRef, () =>
    recreate(actorRef, readyActor ? actorRef.options : options),
  )

  return [snapshot, store.send as Actor<TLogic>['send'], actorRef]
}
