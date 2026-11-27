import {startTransition, useMemo} from 'react'
import type {
  Actor,
  ActorOptions,
  AnyActorLogic,
  ConditionalRequired,
  IsNotNever,
  RequiredActorOptionsFor,
  RequiredActorOptionsKeys,
  SnapshotFrom,
} from 'xstate'

import {isActor, useActorLifecycle, useIdleActorRef} from './actorRef'
import {useActorSnapshot} from './useActorSnapshot'

/**
 * Creates an actor from `logic` (or uses an already-created `actor`, e.g. from `restoreActor`),
 * starts it on mount, stops it on unmount, and returns its snapshot and a `send` for it. Create a
 * passed actor once, e.g. `useState(() => restoreActor(machine, persisted))[0]`.
 *
 * Every snapshot change renders as a transition. `send` sends in a transition: the one it is called
 * in, or a transition of its own. For UI that must update right away, like a controlled input, hold
 * the value with `useOptimistic` in the component that renders it, and call `send` from the action
 * that sets it.
 *
 * The logic passed on the first render is used for the component's lifetime, and `options` are
 * read once. To start over, or to switch to a different machine, change the component's `key`.
 *
 * @public
 */
export function useActor<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): [SnapshotFrom<TLogic>, Actor<TLogic>['send']]
/** @public */
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  ...[options]: ConditionalRequired<
    [options?: ActorOptions<TLogic> & RequiredActorOptionsFor<TLogic>],
    IsNotNever<RequiredActorOptionsKeys<TLogic>>
  >
): [SnapshotFrom<TLogic>, Actor<TLogic>['send']]
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic | Actor<TLogic>,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, Actor<TLogic>['send']] {
  const readyActor = isActor(logic)
  if (!readyActor && !!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine) or an Actor created with createActor() or restoreActor(), but received another kind of actor ref.`,
    )
  }

  const [actorRef, setActorRef] = useIdleActorRef(logic, options)
  const snapshot = useActorSnapshot(actorRef)
  const send = useMemo(
    () =>
      ((event: unknown) => {
        startTransition(() => {
          actorRef.send(event as never)
        })
      }) as Actor<TLogic>['send'],
    [actorRef],
  )

  useActorLifecycle(actorRef, setActorRef, readyActor ? actorRef.options : options)

  return [snapshot, send]
}
