import type {
  Actor,
  AnyStateMachine,
  ConditionalRequired,
  IsNotNever,
  RequiredActorOptionsFor,
  RequiredActorOptionsKeys,
  StateFrom,
} from 'xstate'

import {useActor} from './useActor'
import type {HookOptions} from './useActorRef'

/**
 * @deprecated Use `useActor(machine, options)`.
 * @public
 */
export function useMachine<TMachine extends AnyStateMachine>(
  actor: Actor<TMachine>,
): [StateFrom<TMachine>, Actor<TMachine>['send'], Actor<TMachine>]
/**
 * @deprecated Use `useActor(machine, options)`.
 * @public
 */
export function useMachine<TMachine extends AnyStateMachine>(
  machine: TMachine,
  ...[options]: ConditionalRequired<
    [options?: HookOptions<TMachine> & RequiredActorOptionsFor<TMachine>],
    IsNotNever<RequiredActorOptionsKeys<TMachine>>
  >
): [StateFrom<TMachine>, Actor<TMachine>['send'], Actor<TMachine>]
export function useMachine<TMachine extends AnyStateMachine>(
  machine: TMachine | Actor<TMachine>,
  options?: HookOptions<TMachine>,
): [StateFrom<TMachine>, Actor<TMachine>['send'], Actor<TMachine>] {
  return (useActor as any)(machine, options)
}
