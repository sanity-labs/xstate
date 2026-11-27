import {mkdirSync, writeFileSync} from 'node:fs'

// Research (PALS-152), not a regression suite: E1, E3, E6, transition types, React's >10 updates
// warning and render cost for the fate-style reader, against `useActor` with a context fan-out
// and against plain uSES. Results are written to `$FATE_READER_OUT/<plain|compiler>.out`
// (default `/tmp/fate-reader`); the recorded outputs are in `research/fate-reader-*.out`.
import {act, render} from '@testing-library/react'
import {
  addTransitionType,
  createContext,
  memo,
  Profiler,
  startTransition,
  Suspense,
  use,
  useLayoutEffect,
  useOptimistic,
  useState,
  ViewTransition,
  type ReactNode,
} from 'react'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActor, createMachine, transition, types, type Actor} from 'xstate'

import {useActor} from '../../index'
import {recordViewTransitionTypes} from '../helpers'
import {useFateActor, useUsesActor} from './fateReader'

const machine = createMachine({
  schemas: {
    context: types<{q: string; n: number; v: number}>(),
    events: {
      set: types<{q: string}>(),
      tEv: types<void>(),
      sEv: types<void>(),
      setV: types<{v: number}>(),
    },
  },
  context: {q: '', n: 0, v: 0},
  on: {
    set: ({event}) => ({context: {q: event.q}}),
    tEv: () => ({context: {q: 'a'}}),
    sEv: ({context}) => ({context: {n: context.n + 1}}),
    setV: ({event}) => ({context: {v: event.v}}),
  },
})
type Snap = ReturnType<Actor<typeof machine>['getSnapshot']>

const compiled = /\.c\)\(\d+\)|\b_c\(\d+\)/.test(String(useFateActor))
const lines: string[] = []
function log(line: string) {
  lines.push(line)
}
afterAll(() => {
  const dir = process.env.FATE_READER_OUT ?? '/tmp/fate-reader'
  mkdirSync(dir, {recursive: true})
  writeFileSync(`${dir}/${compiled ? 'compiler' : 'plain'}.out`, lines.join('\n') + '\n')
})

type Variant = 'current' | 'fate' | 'uses'
const VARIANTS: Variant[] = ['current', 'fate', 'uses']

interface Binding {
  actor: Actor<typeof machine>
  Root: (props: {children: ReactNode}) => ReactNode
  useSnap: () => Snap
}

/** `current` is `useActor` at the top with a context fan-out; the others subscribe per reader. */
function makeBinding(variant: Variant): Binding {
  if (variant === 'current') {
    const actor = createActor(machine)
    const Ctx = createContext<Snap | null>(null)
    return {
      actor,
      Root: function Root({children}) {
        const [snapshot] = useActor(actor)
        return <Ctx value={snapshot}>{children}</Ctx>
      },
      useSnap: () => use(Ctx)!,
    }
  }
  const actor = createActor(machine).start()
  const hook = variant === 'fate' ? useFateActor : useUsesActor
  return {actor, Root: ({children}) => children, useSnap: () => hook(actor) as Snap}
}

const never = new Promise<void>(() => {})
function Results({q}: {q: string}) {
  if (q !== '') {
    use(never)
  }
  return <span>results={JSON.stringify(q)} </span>
}

const text = (container: HTMLElement) => container.textContent!.trim()

describe('E1: transition send (data suspends), then urgent mount of reader B', () => {
  for (const variant of VARIANTS) {
    it(variant, async () => {
      const b = makeBinding(variant)
      let showB!: () => void
      function Reader({id}: {id: string}) {
        return (
          <span>
            {id}={JSON.stringify(b.useSnap().context.q)}{' '}
          </span>
        )
      }
      function R() {
        return <Results q={b.useSnap().context.q} />
      }
      function App() {
        const [shown, setShown] = useState(false)
        useLayoutEffect(() => {
          showB = () => setShown(true)
        })
        return (
          <b.Root>
            <Reader id="A" />
            <Suspense fallback={<span>[FALLBACK] </span>}>
              <R />
            </Suspense>
            {shown ? <Reader id="B" /> : null}
          </b.Root>
        )
      }
      const {container, unmount} = render(<App />)
      const t0 = text(container)
      await act(async () => startTransition(() => b.actor.send({type: 'set', q: 'a'})))
      const t1 = text(container)
      await act(async () => showB())
      const t2 = text(container)
      log(
        `E1 ${variant.padEnd(8)}| initial: ${t0} | after transition send: ${t1} | after urgent mount of B: ${t2}`,
      )
      unmount()
    })
  }
})

describe('E6: transition tEv pending (suspended), then sync sEv', () => {
  const cases = [
    'current+plainSend',
    'current+useOptimistic',
    'fate+plainSend',
    'fate+useOptimistic',
    'uses+plainSend',
  ] as const
  for (const name of cases) {
    it(name, async () => {
      const b = makeBinding(name.split('+')[0] as Variant)
      const optimistic = name.endsWith('useOptimistic')
      let api!: {t: () => void; s: () => void}
      function View() {
        const snap = b.useSnap()
        const [opt, setOpt] = useOptimistic(
          snap,
          (base: Snap, event: {type: 'sEv'}) => transition(machine, base, event)[0],
        )
        useLayoutEffect(() => {
          api = {
            t: () => startTransition(() => b.actor.send({type: 'tEv'})),
            s: optimistic
              ? () =>
                  startTransition(() => {
                    setOpt({type: 'sEv'})
                    b.actor.send({type: 'sEv'})
                  })
              : () => b.actor.send({type: 'sEv'}),
          }
        })
        const shown = optimistic ? opt : snap
        return (
          <div>
            <span>n={shown.context.n} </span>
            <Suspense fallback={<span>[FALLBACK] </span>}>
              <Results q={shown.context.q} />
            </Suspense>
          </div>
        )
      }
      const {container, unmount} = render(
        <b.Root>
          <View />
        </b.Root>,
      )
      await act(async () => api.t())
      const pending = text(container)
      await act(async () => api.s())
      log(
        `E6 ${name.padEnd(22)}| pending transition: ${pending.padEnd(26)}| after sync sEv: ${text(container)}`,
      )
      unmount()
    })
  }
})

describe('E9: addTransitionType types reaching <ViewTransition>', () => {
  const recorded = recordViewTransitionTypes()
  for (const variant of VARIANTS) {
    it(variant, async () => {
      const b = makeBinding(variant)
      function Reader() {
        return (
          <ViewTransition>
            <p>{b.useSnap().context.q}</p>
          </ViewTransition>
        )
      }
      const {container, unmount} = render(
        <b.Root>
          <Reader />
        </b.Root>,
      )
      await act(async () =>
        startTransition(() => {
          addTransitionType('typing')
          b.actor.send({type: 'set', q: 'x'})
        }),
      )
      log(
        `E9 ${variant.padEnd(8)}| view transitions started: ${recorded.length}, types per view transition: ${JSON.stringify(recorded)} | shown: ${text(container)}`,
      )
      unmount()
    })
  }

  // With a React state update in the same `startTransition`, the root has a pending transition
  // lane when `startTransition` ends, so React queues the types on the root for the next commit.
  for (const variant of VARIANTS) {
    it(`${variant} + a setState in the same transition`, async () => {
      const b = makeBinding(variant)
      let bump!: () => void
      function Reader() {
        const [n, setN] = useState(0)
        useLayoutEffect(() => {
          bump = () => setN((x) => x + 1)
        })
        return (
          <ViewTransition>
            <p>
              {b.useSnap().context.q}
              {n}
            </p>
          </ViewTransition>
        )
      }
      const {container, unmount} = render(
        <b.Root>
          <Reader />
        </b.Root>,
      )
      await act(async () =>
        startTransition(() => {
          addTransitionType('typing')
          bump()
          b.actor.send({type: 'set', q: 'x'})
        }),
      )
      log(
        `E9b ${variant.padEnd(8)}| +setState in transition | view transitions started: ${recorded.length}, types: ${JSON.stringify(recorded)} | shown: ${text(container)}`,
      )
      unmount()
    })
  }
})

describe("E10: React's >10 updates inside startTransition warning", () => {
  for (const variant of VARIANTS) {
    it(variant, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const b = makeBinding(variant)
      function Reader() {
        return <span>{b.useSnap().context.q}</span>
      }
      const {unmount} = render(
        <b.Root>
          {Array.from({length: 20}, (_, i) => (
            <Reader key={i} />
          ))}
        </b.Root>,
      )
      await act(async () => startTransition(() => b.actor.send({type: 'set', q: 'a'})))
      const warned = warn.mock.calls.some((call) =>
        String(call[0]).includes('Detected a large number of updates'),
      )
      warn.mockRestore()
      log(
        `E10 ${variant.padEnd(8)}| 20 readers, send in startTransition: ${warned ? 'WARNING fired' : 'no warning'}`,
      )
      unmount()
    })
  }
})

describe('E3 and cost: real scheduler, 120 slow readers', () => {
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })
  const N = 120
  const SPIN = 0.4
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  function spin() {
    const end = performance.now() + SPIN
    while (performance.now() < end) {
      // Make each reader slow, so React yields between them.
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  /** The longest gap between consecutive macrotasks: how long the main thread was blocked. */
  function startBlockingProbe(): () => number {
    let max = 0
    let last = performance.now()
    let running = true
    function tick() {
      const now = performance.now()
      max = Math.max(max, now - last)
      last = now
      if (running) {
        setImmediate(tick)
      }
    }
    setImmediate(tick)
    return () => {
      running = false
      return max
    }
  }

  function shown(el: HTMLElement) {
    return Array.from(el.querySelectorAll('[data-r]'), (node) => node.textContent)
  }

  async function run(variant: Variant, second: 'none' | 'transition' | 'urgent') {
    const b = makeBinding(variant)
    const commits: string[] = []
    const counter = {renders: 0}
    const Reader = memo(function Reader() {
      const value = b.useSnap().context.v
      counter.renders++
      spin()
      return <span data-r="">{String(value)}</span>
    })
    const el = document.createElement('div')
    document.body.append(el)
    function onRender() {
      const values = shown(el)
      if (values.length) {
        commits.push([...new Set(values)].join('|'))
      }
    }
    const {unmount} = render(
      <Profiler id="p" onRender={onRender}>
        <b.Root>
          {Array.from({length: N}, (_, i) => (
            <Reader key={i} />
          ))}
        </b.Root>
      </Profiler>,
      {container: el},
    )
    await sleep(200)
    commits.length = 0
    counter.renders = 0
    const stopProbe = startBlockingProbe()
    const t0 = performance.now()
    startTransition(() => b.actor.send({type: 'setV', v: 1}))
    if (second !== 'none') {
      await sleep(12)
      if (second === 'transition') {
        startTransition(() => b.actor.send({type: 'setV', v: 2}))
      } else {
        b.actor.send({type: 'setV', v: 2})
      }
    }
    const target = second === 'none' ? '1' : '2'
    await vi.waitFor(() => expect(shown(el).every((value) => value === target)).toBe(true), {
      timeout: 5000,
      interval: 1,
    })
    const settled = performance.now() - t0
    await sleep(50)
    const maxBlock = stopProbe()
    unmount()
    el.remove()
    const torn = commits.filter((commit) => commit.includes('|'))
    return {commits, renders: counter.renders, maxBlock, settled, torn}
  }

  for (const second of ['transition', 'urgent'] as const) {
    for (const variant of VARIANTS) {
      it(`E3 ${variant} 2nd=${second}`, async () => {
        const r = await run(variant, second)
        log(
          `E3 ${variant.padEnd(8)} 2nd=${second.padEnd(10)}| commits: ${r.commits.join(' , ').padEnd(16)} ${r.torn.length ? 'TORN: ' + r.torn.join(' ; ') : 'no torn commit'} | reader renders: ${r.renders}`,
        )
      })
    }
  }

  // An unchanged selection: 120 readers select `n` and memoize a slow child on it, while `q` changes.
  for (const variant of VARIANTS) {
    it(`unchanged selection ${variant}`, async () => {
      const b = makeBinding(variant)
      const counter = {readers: 0, children: 0}
      const Slow = memo(function Slow({n}: {n: number}) {
        counter.children++
        spin()
        return <span>{n}</span>
      })
      const Reader = memo(function Reader() {
        const n = b.useSnap().context.n
        counter.readers++
        return <Slow n={n} />
      })
      const {unmount} = render(
        <b.Root>
          {Array.from({length: N}, (_, i) => (
            <Reader key={i} />
          ))}
        </b.Root>,
      )
      await sleep(100)
      counter.readers = 0
      counter.children = 0
      startTransition(() => b.actor.send({type: 'set', q: 'changed'}))
      await sleep(250)
      log(
        `COST2 ${variant.padEnd(8)}| q changes, 120 readers select n | reader function calls: ${counter.readers} | slow child renders: ${counter.children}`,
      )
      unmount()
    })
  }

  for (const variant of VARIANTS) {
    it(`cost ${variant}`, async () => {
      const runs = []
      for (let i = 0; i < 5; i++) {
        runs.push(await run(variant, 'none'))
      }
      log(
        `COST ${variant.padEnd(8)}| one send in startTransition, ${N} readers x ${SPIN}ms | reader renders: ${median(runs.map((r) => r.renders))} | commits: ${median(runs.map((r) => r.commits.length))} | longest main-thread block: ${median(runs.map((r) => r.maxBlock)).toFixed(1)}ms | settled after: ${median(runs.map((r) => r.settled)).toFixed(1)}ms (medians of 5)`,
      )
    })
  }
})
