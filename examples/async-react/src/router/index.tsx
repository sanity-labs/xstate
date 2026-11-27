import {createActorContext} from '@sanity-labs/xstate-react'
import {
  addTransitionType,
  startTransition,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

import {routerMachine, toHref, type Location} from './machine'

export const Router = createActorContext(routerMachine)

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
function HistorySync() {
  const send = Router.useSend()
  const href = Router.useSelector(({context}) => toHref(context.location))

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
  return (
    <Router.Provider options={{input}}>
      <HistorySync />
      {children}
    </Router.Provider>
  )
}
