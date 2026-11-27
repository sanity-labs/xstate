import type {ActorOptions, AnyActorLogic, EventFromLogic, SnapshotFrom} from 'xstate'

import {transitionEngine} from './engines'
import {useActionStateDriver} from './useActionStateDriver'

/**
 * The pure FSM API (`initialTransition`/`transition`/`executeEffects`) as the driver behind
 * `useActionState`. Exists to answer whether the pure API can drive the hook at all; see the
 * caveat on `transitionEngine`.
 *
 * @public
 */
export function useTransitionActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  return useActionStateDriver(transitionEngine, logic, options)
}
