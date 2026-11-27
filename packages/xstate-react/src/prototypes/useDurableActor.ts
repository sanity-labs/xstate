import type {ActorOptions, AnyActorLogic, EventFromLogic, SnapshotFrom} from 'xstate'

import {durableEngine} from './engines'
import {useActionStateDriver} from './useActionStateDriver'

/**
 * Shape (c): a separate hook built on `useActionState`, driven by `xstate/durable`. This is the
 * PALS-150 prototype behind a dedicated name.
 *
 * @public
 */
export function useDurableActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): [SnapshotFrom<TLogic>, (event: EventFromLogic<TLogic>) => void, boolean] {
  return useActionStateDriver(durableEngine, logic, options)
}
