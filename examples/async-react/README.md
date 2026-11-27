# Async React Demo

Ricky Hanlon's React Conf 2025 [Async React demo](https://github.com/rickhanlonii/async-react), by
way of its [`react-rx` adaptation](https://github.com/sanity-io/react-rx/tree/current/async-react),
rebuilt on XState v6 and `@sanity-labs/xstate-react`.

The behavior is the same: on a fast network the app feels synchronous, and as the network slows it
shows delayed loading states, keeps the current page on screen while the next one loads, and
animates between pages with view transitions. The design components are the original's, except
that `LoginForm` keeps its fields with `useOptimistic` and calls a `changeAction`, so the
differences are in the router, the forms and the network debugger.

## Run it

```bash
pnpm install
pnpm dev
```

To run it without the React Compiler, use `pnpm --filter async-react dev:no-compiler`.

The app is a static Vite app. [MSW](https://mswjs.io) serves `/api/*` from a service worker, and
the network debugger at the bottom sets each endpoint's latency. Going back and forward animates
through the [Navigation API](https://developer.mozilla.org/docs/Web/API/Navigation_API).

## What it shows

**The router is a machine.** The location and a refresh revision live in one actor, which
`RouterProvider` runs with `useActor` and shares through a context. Every event is a transition, so
navigating, changing tabs, searching and refreshing keep the current page on screen until the next
one is ready:

```tsx
import {useActor} from '@sanity-labs/xstate-react'

export function RouterProvider({children}: {children: ReactNode}) {
  const [input] = useState(() => ({location: parseLocation(window.location.href)}))
  const [snapshot, send] = useActor(routerMachine, {input})
  const {location, revision} = snapshot.context
  const router = useMemo(() => ({location, revision, send}), [location, revision, send])
  return <RouterContext value={router}>{children}</RouterContext>
}

function LessonList() {
  const {location, revision} = useRouter()
  const lessons = use(data.lessons({tab: location.tab, q: location.q, revision}))
  // ...
}
```

**Controlled inputs stay responsive.** As in the original, `SearchInput`, `TabList` and
`CompleteButton` hold what must show right away with `useOptimistic`, and call an action prop inside
a transition. The router only sends:

```tsx
function Home() {
  const {location, send} = useRouter()
  return (
    <Design.SearchInput value={location.q} changeAction={(q) => send({type: 'search.change', q})} />
  )
}
```

The login form is a tiny machine of its own, and `LoginForm` keeps its fields with `useOptimistic`
the same way.

**Some state should not wait.** The network debugger shows each request as it starts, even while
the transition waiting on it is suspended. Each request is added with `useOptimistic` by an action
that lasts as long as the request, while the latency settings live in a machine.

**Transition types pick the animation.** Back and forward send the router event inside a transition
tagged `navigation-back` or `navigation-forward`, and the page's `<ViewTransition>` slides in that
direction.

# Async React Working Group

At React Conf 2025, the React team announced a working group to make Async React the default for
React apps. Follow its progress in the
[Async React Working Group](https://github.com/reactwg/async-react/discussions).
