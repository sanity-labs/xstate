import {useActor} from '@sanity-labs/xstate-react'
import {
  addTransitionType,
  createContext,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {routerMachine, toHref, type Location} from './machine'

type RouterSend = ReturnType<typeof useActor<typeof routerMachine>>[1]

interface Router {
  location: Location
  /** Increases on every refresh, so the route's data is fetched again. */
  revision: number
  send: RouterSend
}

const RouterContext = createContext<Router | null>(null)

/** The router's location and revision, and its `send`, which sends in a transition. */
export function useRouter(): Router {
  const router = use(RouterContext)
  if (!router) {
    throw new Error('useRouter() must be used inside <RouterProvider>')
  }
  return router
}

function parseLocation(href: string): Location {
  const url = new URL(href)
  return {
    path: url.pathname,
    q: url.searchParams.get('q') ?? '',
    tab: url.searchParams.get('tab') ?? 'all',
  }
}

/**
 * Keeps the browser's history in step with the router. A new location is pushed once React has
 * committed it, so the address bar never shows a page that is still loading.
 */
function HistorySync({href, send}: {href: string; send: RouterSend}) {
  useLayoutEffect(() => {
    if (href !== toHref(parseLocation(window.location.href))) {
      window.history.pushState(null, '', href)
    }
  }, [href])

  useEffect(() => {
    // React renders an update from `popstate` synchronously, without view transitions, so going
    // back and forward is intercepted with the Navigation API where the browser has it.
    if (typeof window.navigation === 'undefined') {
      function handlePopState() {
        send({type: 'history.traverse', location: parseLocation(window.location.href)})
      }
      window.addEventListener('popstate', handlePopState)
      return () => {
        window.removeEventListener('popstate', handlePopState)
      }
    }

    function handleNavigate(event: NavigateEvent) {
      const from = window.navigation.currentEntry
      if (event.navigationType !== 'traverse' || !event.canIntercept || !from) {
        return
      }
      const direction =
        event.destination.index < from.index ? 'navigation-back' : 'navigation-forward'
      const location = parseLocation(event.destination.url)
      event.intercept({
        handler() {
          startTransition(() => {
            addTransitionType(direction)
            send({type: 'history.traverse', location})
          })
        },
      })
    }
    window.navigation.addEventListener('navigate', handleNavigate)
    return () => {
      window.navigation.removeEventListener('navigate', handleNavigate)
    }
  }, [send])

  return null
}

export function RouterProvider({children}: {children: ReactNode}) {
  const [input] = useState(() => ({location: parseLocation(window.location.href)}))
  const [snapshot, send] = useActor(routerMachine, {input})
  const {location, revision} = snapshot.context
  const router = useMemo(() => ({location, revision, send}), [location, revision, send])

  return (
    <RouterContext value={router}>
      <HistorySync href={toHref(location)} send={send} />
      {children}
    </RouterContext>
  )
}
