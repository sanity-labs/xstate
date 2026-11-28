import {useActorSnapshot as rcsx} from './rcs/experimental'
import {useActorSnapshot as rcs} from './rcs/ponyfill'
import {useActorSnapshot as main} from './useActorSnapshot.main'

// PALS-151 prototype switch. VITE_XSTATE_REACT_IMPL selects what holds the snapshot in React.
//   (unset) -> the current hook: one subscription, snapshot in useState, startTransition(setState)
//   rcs     -> react-concurrent-store default useStore (per-component cache + useTransition)
//   rcsx    -> react-concurrent-store experimental committed/head store (needs StoreProvider)

declare const __XSTATE_REACT_IMPL__: string | undefined

const impl = typeof __XSTATE_REACT_IMPL__ === 'string' ? __XSTATE_REACT_IMPL__ : undefined

export const useActorSnapshot: typeof main = impl === 'rcs' ? rcs : impl === 'rcsx' ? rcsx : main
