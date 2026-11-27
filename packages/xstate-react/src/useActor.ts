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

import {useActorLifecycle, useIdleActorRef} from './actorRef'
import {useActorSnapshot} from './useActorSnapshot'

/**
 * Creates an actor from `logic`, starts it on mount, stops it on unmount, and returns its snapshot
 * and a `send` for it.
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
  logic: TLogic,
  ...[options]: ConditionalRequired<
    [options?: ActorOptions<TLogic> & RequiredActorOptionsFor<TLogic>],
    IsNotNever<RequiredActorOptionsKeys<TLogic>>
  >
): [SnapshotFrom<TLogic>, Actor<TLogic>['send']]
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, Actor<TLogic>['send']] {
  if (!!logic && 'send' in logic && typeof logic.send === 'function') {
    throw new Error(
      `useActor() expects actor logic (e.g. a machine), but received an actor. Pass the logic it was created from instead.`,
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

  useActorLifecycle(actorRef, setActorRef, options)

  return [snapshot, send]
}
