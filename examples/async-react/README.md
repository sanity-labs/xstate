# Async React Demo

Ricky Hanlon's React Conf 2025 [Async React demo](https://github.com/rickhanlonii/async-react), by
way of its [`react-rx` adaptation](https://github.com/sanity-io/react-rx/tree/current/async-react),
rebuilt on XState v6 and `@sanity-labs/xstate-react`.

The behavior is the same: on a fast network the app feels synchronous, and as the network slows it
shows delayed loading states, keeps the current page on screen while the next one loads, and
animates between pages with view transitions. The design components are unchanged apart from taking
controlled values, so the differences are in the router, the forms and the network debugger.

Try it at [async-react-xstate.sanity.dev](https://async-react-xstate.sanity.dev). It is deployed
from `main` by a Vercel project with `examples/async-react` as its root directory, and
[`vercel.json`](./vercel.json) rewrites client routes such as `/login` to `index.html`, so a deep
link survives a reload.

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

**The router is a machine.** The location, the search box's text and a refresh revision live in one
actor, provided once with `createActorContext`. Every event is a transition, so navigating, changing
tabs, searching and refreshing keep the current page on screen until the next one is ready. Each
component selects only what it renders:

```tsx
import {createActorContext, shallowEqual} from '@sanity-labs/xstate-react'
import {use} from 'react'

export const Router = createActorContext(routerMachine)

function LessonList() {
  const query = Router.useSelector(
    ({context}) => ({
      tab: context.location.tab,
      q: context.location.q,
      revision: context.revision,
    }),
    shallowEqual,
  )
  const lessons = use(data.lessons(query))
  // ...
}
```

**Controlled inputs stay responsive.** The search box sends its text with `useOptimisticSend`, so
each keystroke shows at once while the search it starts loads in a transition. The login form is a
tiny machine of its own, driven the same way.

```tsx
function Search() {
  const send = Router.useSend()
  const sendOptimistic = Router.useOptimisticSend()
  const {draft, q} = Router.useSelector(
    ({context}) => ({draft: context.draft, q: context.location.q}),
    shallowEqual,
  )

  return (
    <SearchInput
      value={draft}
      isPending={draft !== q}
      onChange={(value) => {
        sendOptimistic({type: 'search.change', value})
        send({type: 'search.submit'})
      }}
    />
  )
}
```

**Some state should not wait.** The network debugger renders requests as they start, even while
the transition waiting on them is suspended, by opting its actor into synchronous updates:

```tsx
const Network = createActorContext(networkMachine, {updates: 'sync'})
```

**Transition types pick the animation.** Back and forward send the router event inside a transition
tagged `navigation-back` or `navigation-forward`, and the page's `<ViewTransition>` slides in that
direction.

# Async React Working Group

At React Conf 2025, the React team announced a working group to make Async React the default for
React apps. Follow its progress in the
[Async React Working Group](https://github.com/reactwg/async-react/discussions).
