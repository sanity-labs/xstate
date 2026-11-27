import {createContext, use, useMemo, type ReactNode} from 'react'
import type {Actor, AnyActorLogic, SnapshotFrom} from 'xstate'

import {createSnapshotContext, registerProvider} from './snapshotContext'
import {getStore} from './store'
import {useActorRef, type HookOptions} from './useActorRef'
import {useSelector as useSelectorUnbound} from './useSelector'
import {useOptimisticSend as useOptimisticSendUnbound, useSend as useSendUnbound} from './useSend'
import {useStoreSelection} from './useStoreSelection'

/** @public */
export interface ActorContext<TLogic extends AnyActorLogic> {
  /**
   * Reads a value derived from the provided actor's snapshot. The provider holds the snapshot, so
   * every reader renders the same snapshot. A reader re-renders whenever the snapshot changes, and
   * returns the previous value while `compare` says it is unchanged, for memoizing what it renders.
   */
  useSelector: <T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ) => T
  /** The provided actor. Reading it does not re-render when the snapshot changes. */
  useActorRef: () => Actor<TLogic>
  /** The provided actor's `send`, which sends in a transition, like the one `useActor` returns. */
  useSend: () => Actor<TLogic>['send']
  /** The provided actor's `send` for updates that must show right away, like `useOptimisticSend`. */
  useOptimisticSend: () => Actor<TLogic>['send']
  Provider: (props: {
    children: ReactNode
    options?: HookOptions<TLogic>
    logic?: TLogic
    /**
     * An already-created actor (e.g. from `restoreActor`) to provide instead of creating one from
     * `logic` and `options`. Create it once.
     */
    actor?: Actor<TLogic>
  }) => ReactNode
}

function identity<T>(value: T): T {
  return value
}

/** @public */
export function createActorContext<TLogic extends AnyActorLogic>(
  actorLogic: TLogic,
  actorOptions?: HookOptions<TLogic>,
): ActorContext<TLogic> {
  const ReactContext = createContext<Actor<TLogic> | null>(null)
  const SnapshotContext = createSnapshotContext()

  function Provider({
    children,
    logic: providedLogic = actorLogic,
    options: providedOptions,
    actor: providedActor,
  }: {
    children: ReactNode
    logic?: TLogic
    options?: HookOptions<TLogic>
    actor?: Actor<TLogic>
  }) {
    const actor = (useActorRef as any)(
      providedActor ?? providedLogic,
      providedActor ? undefined : {...actorOptions, ...providedOptions},
    ) as Actor<TLogic>
    const store = useMemo(() => getStore(actor), [actor])
    const snapshot = useStoreSelection(store, identity, Object.is, false)
    const provided = useMemo(() => ({actor, snapshot}), [actor, snapshot])
    registerProvider(actor, SnapshotContext)

    return (
      <ReactContext value={actor}>
        <SnapshotContext value={provided}>{children}</SnapshotContext>
      </ReactContext>
    )
  }

  Provider.displayName = `ActorProvider`

  function useContext(): Actor<TLogic> {
    const actor = use(ReactContext)
    if (!actor) {
      throw new Error(
        `You used a hook from "${Provider.displayName}" but it's not inside a <${Provider.displayName}> component.`,
      )
    }
    return actor
  }

  function useSelector<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ): T {
    return useSelectorUnbound(useContext(), selector, compare)
  }

  function useSend(): Actor<TLogic>['send'] {
    return useSendUnbound(useContext())
  }

  function useOptimisticSend(): Actor<TLogic>['send'] {
    return useOptimisticSendUnbound(useContext())
  }

  return {Provider, useActorRef: useContext, useSelector, useSend, useOptimisticSend}
}
