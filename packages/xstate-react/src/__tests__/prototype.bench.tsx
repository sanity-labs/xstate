import {act, render} from '@testing-library/react'
import {memo, useLayoutEffect} from 'react'
import {describe, expect, it} from 'vitest'
import {createMachine, types} from 'xstate'

import {useActor as prototype} from '../useActionStateActor'
import {useActor as current} from '../useActor'

const machine = createMachine({
  schemas: {context: types<{count: number}>(), events: {inc: types<void>()}},
  context: {count: 0},
  on: {inc: ({context}) => ({context: {count: context.count + 1}})},
})

type Hook = (
  logic: typeof machine,
) => readonly [{context: {count: number}}, (e: {type: 'inc'}) => void, ...unknown[]]

const LEAVES = 50

const Leaf = memo(function Leaf({count, renders}: {count: number; renders: {leaf: number}}) {
  renders.leaf++
  return <span>{count}</span>
})

function setup(useActor: Hook) {
  const stats = {ownerRenders: 0, ownerCommits: 0, leaf: 0, lastCommitAt: 0, lastCount: 0}
  let send!: (e: {type: 'inc'}) => void
  function Owner() {
    const [snapshot, _send] = useActor(machine)
    stats.ownerRenders++
    useLayoutEffect(() => {
      send = _send
      stats.ownerCommits++
      stats.lastCommitAt = performance.now()
      stats.lastCount = snapshot.context.count
    })
    return (
      <>
        {Array.from({length: LEAVES}, (_, i) => (
          <Leaf key={i} count={snapshot.context.count} renders={stats} />
        ))}
      </>
    )
  }
  const {unmount} = render(<Owner />)
  return {stats, send: (e: {type: 'inc'}) => send(e), unmount}
}

function times(n: number, fn: (i: number) => Promise<void>): Promise<void> {
  return Array.from({length: n}).reduce<Promise<void>>(
    (previous, _, i) => previous.then(() => fn(i)),
    Promise.resolve(),
  )
}

async function measure(name: string, useActor: Hook) {
  const N = 300
  const {stats, send, unmount} = setup(useActor)
  await act(async () => {})
  const base = {...stats}

  // Sequential: one send per act, measuring send -> commit latency.
  const latencies: number[] = []
  const t0 = performance.now()
  await times(N, async () => {
    const sentAt = performance.now()
    await act(async () => send({type: 'inc'}))
    latencies.push(stats.lastCommitAt - sentAt)
  })
  const sequentialMs = performance.now() - t0
  const afterSequential = {...stats}
  expect(afterSequential.lastCount).toBe(N)

  // Burst: N sends in one act.
  const t1 = performance.now()
  await act(async () => {
    for (let i = 0; i < N; i++) {
      send({type: 'inc'})
    }
  })
  const burstMs = performance.now() - t1
  expect(stats.lastCount).toBe(2 * N)
  unmount()

  latencies.sort((a, b) => a - b)
  const p = (q: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!
  const row = {
    name,
    sequential: {
      msPerSend: +(sequentialMs / N).toFixed(3),
      ownerRendersPerSend: +((afterSequential.ownerRenders - base.ownerRenders) / N).toFixed(2),
      ownerCommitsPerSend: +((afterSequential.ownerCommits - base.ownerCommits) / N).toFixed(2),
      leafRendersPerSend: +((afterSequential.leaf - base.leaf) / N).toFixed(1),
      latencyP50ms: +p(0.5).toFixed(3),
      latencyP95ms: +p(0.95).toFixed(3),
    },
    burst: {
      totalMs: +burstMs.toFixed(1),
      ownerRenders: stats.ownerRenders - afterSequential.ownerRenders,
      ownerCommits: stats.ownerCommits - afterSequential.ownerCommits,
      leafRenders: stats.leaf - afterSequential.leaf,
    },
  }
  return row
}

describe('bench: current useActor vs useActionState prototype', () => {
  it('measures', async () => {
    const rows: Awaited<ReturnType<typeof measure>>[] = []
    await measure('warmup-current', current as Hook)
    await measure('warmup-prototype', prototype as Hook)
    await times(3, async (round) => {
      rows.push(await measure(`current#${round}`, current as Hook))
      rows.push(await measure(`prototype#${round}`, prototype as Hook))
    })
    // The benchmark result is the point of this test, so it is printed. `console.log` is what
    // both jsdom and the browser test runner can write to.
    // oxlint-disable-next-line eslint/no-console
    console.log(`\nBENCH ${JSON.stringify(rows, null, 2)}`)
  }, 120_000)
})
