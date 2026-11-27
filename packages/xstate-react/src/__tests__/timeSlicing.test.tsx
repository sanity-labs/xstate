import {render} from '@testing-library/react'
import {memo, startTransition, useEffect, useLayoutEffect, useReducer, type ReactNode} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActor, type Actor} from 'xstate'

import {createActorContext} from '../index'
import {textMachine} from './helpers'

// In its own file: whether a change during a render restarts it depends on which transition lanes
// React hands out, and React's lane counter is module state that earlier tests would advance.

type TextActor = Actor<typeof textMachine>
type TextSource = (props: {actor: TextActor; children: (text: string) => ReactNode}) => ReactNode

const Text = createActorContext(textMachine)

function ProvidedText({children}: {children: (text: string) => ReactNode}) {
  return children(Text.useSelector((snapshot) => snapshot.context.text))
}

/** A hook that reads the actor during render and re-renders on change, as a control. */
function useReadDuringRender(actor: TextActor): string {
  'use no memo'
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const subscription = actor.subscribe(() => startTransition(rerender))
    return () => subscription.unsubscribe()
  }, [actor])
  return actor.getSnapshot().context.text
}

function busy(ms: number) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    // Make each reader slow, so React yields between them.
  }
}

function ReadDuringRenderText({actor, children}: Parameters<TextSource>[0]) {
  return children(useReadDuringRender(actor))
}

describe('a change arriving during a time-sliced transition render', () => {
  const global = globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = false
  })
  afterEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  const readers = 120

  async function run(Source: TextSource): Promise<{torn: string[]; commits: string[]}> {
    const actor = createActor(textMachine).start()
    const torn: string[] = []
    const commits = new Set<string>()
    const changed = new Set<string>()
    function Shown({text, index}: {text: string; index: number}) {
      // The second change arrives while React yields during the render of the first.
      if (index === 10 && text === '1' && !changed.has(text)) {
        changed.add(text)
        queueMicrotask(() => actor.send({type: 'change', text: '2'}))
      }
      busy(1)
      useLayoutEffect(() => {
        const shown = new Set(
          Array.from(document.querySelectorAll('[data-reader]'), (node) => node.textContent),
        )
        commits.add([...shown].join('|'))
        if (shown.size > 1) {
          torn.push([...shown].join('|'))
        }
      })
      return <span data-reader="">{text}</span>
    }
    const Reader = memo(function Reader({index}: {index: number}) {
      return <Source actor={actor}>{(text) => <Shown text={text} index={index} />}</Source>
    })
    function Provider({children}: {children: ReactNode}) {
      return <Text.Provider actor={actor}>{children}</Text.Provider>
    }
    const {unmount} = render(
      <Provider>
        {Array.from({length: readers}, (_, i) => (
          <Reader key={i} index={i} />
        ))}
      </Provider>,
    )
    startTransition(() => actor.send({type: 'change', text: '1'}))
    await vi.waitFor(
      () => {
        const shown = Array.from(document.querySelectorAll('[data-reader]'), (n) => n.textContent)
        expect(shown.every((text) => text === '2')).toBe(true)
      },
      {timeout: 5000},
    )
    unmount()
    return {torn, commits: [...commits]}
  }

  it('never commits readers showing different snapshots', async () => {
    const {torn, commits} = await run(ProvidedText)
    expect(torn).toEqual([])
    // The render the change interrupted committed the first snapshot instead of restarting.
    expect(commits).toEqual(['', '1', '2'])
  })

  it('tears when readers read the actor during render (control)', async () => {
    const {torn} = await run(ReadDuringRenderText)
    expect(torn).toContain('1|2')
  })
})
