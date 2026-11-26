import {useMemo} from 'react'
import type {AnyActorRef} from 'xstate'

import {getStore} from './store'

/**
 * Returns the same `send` that `useActor` returns, for an actor created elsewhere, e.g. with
 * `useActorRef` or `createActorContext`.
 *
 * @public
 */
export function useSend<TActor extends AnyActorRef>(actor: TActor): TActor['send'] {
  return useMemo(() => getStore(actor).send, [actor]) as TActor['send']
}
