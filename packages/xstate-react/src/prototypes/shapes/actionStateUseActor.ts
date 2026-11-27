import type {Actor, ActorOptions, AnyActorLogic, SnapshotFrom} from 'xstate'

import {isActor, useActorLifecycle, useIdleActorRef} from '../../actorRef'
import {useActorActionState} from '../useActorActionState'

/**
 * Shape (a): the current `useActor`, with `useActionState` driving `send` and holding the
 * snapshot. The live actor stays as it is on `main`; only the way its snapshot enters React and
 * the way `send` reaches it change. `isPending` is dropped, as decided for `useActor`.
 */
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
  const [snapshot, send] = useActorActionState(actorRef)
  useActorLifecycle(actorRef, setActorRef, readyActor ? actorRef.options : options)
  return [snapshot, send as Actor<TLogic>['send']]
}
