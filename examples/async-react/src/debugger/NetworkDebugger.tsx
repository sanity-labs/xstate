import {useActor} from '@sanity-labs/xstate-react'
import {startTransition, useEffect, useOptimistic, useState} from 'react'

import {
  API_PATHS,
  readLatencies,
  subscribeToMockActivity,
  type ApiPath,
  type Latency,
  type MockActivity,
  type MockRequest,
} from '@/mocks/latency'
import {useRouter} from '@/router/index'

import './debugger.css'
import {addRequest, networkMachine, removeRequest, type Requests} from './machine'

const LABELS: Record<ApiPath, string> = {
  '/api/lessons': 'GET /api/lessons',
  '/api/lesson/:id/toggle': 'POST /api/lesson/:id/toggle',
}

function reduceRequests(requests: Requests, activity: MockActivity): Requests {
  switch (activity.type) {
    case 'request.start':
      return addRequest(requests, activity.request)
    case 'request.end':
      return removeRequest(requests, activity.path, activity.id)
    default: {
      const unhandled: never = activity
      throw new Error(`Unhandled mock activity: ${JSON.stringify(unhandled)}`)
    }
  }
}

function LatencyControls({
  label,
  latency,
  changeAction,
}: {
  label: string
  latency: Latency
  changeAction: (latency: Latency) => void | Promise<void>
}) {
  const [optimisticLatency, setOptimisticLatency] = useOptimistic(latency)

  function change(next: Latency) {
    startTransition(async () => {
      setOptimisticLatency(next)
      await changeAction(next)
    })
  }

  return (
    <div className="network-controls">
      <span>{optimisticLatency.ms}ms</span>
      <input
        type="range"
        min={0}
        max={3000}
        step={50}
        aria-label={`Latency for ${label}`}
        value={optimisticLatency.ms}
        disabled={optimisticLatency.mode === 'real'}
        onChange={(event) => change({mode: 'fixed', ms: Number(event.target.value)})}
      />
      <label className="network-real-toggle">
        <input
          type="checkbox"
          title="Use a realistic random network delay"
          aria-label={`Real latency for ${label}`}
          checked={optimisticLatency.mode === 'real'}
          onChange={(event) =>
            change({mode: event.target.checked ? 'real' : 'fixed', ms: optimisticLatency.ms})
          }
        />
        <span>real</span>
      </label>
    </div>
  )
}

function NetworkRow({
  path,
  latency,
  requests,
  latencyAction,
}: {
  path: ApiPath
  latency: Latency
  requests: readonly MockRequest[]
  latencyAction: (latency: Latency) => void
}) {
  const label = LABELS[path]
  const latest = requests.at(-1)
  const shown = latency.mode === 'real' && latest ? {...latency, ms: latest.ms} : latency

  return (
    <div className="network-row">
      <div className="network-row-header">
        <div>{label}</div>
        <LatencyControls label={label} latency={shown} changeAction={latencyAction} />
      </div>
      <div className="network-row-requests">
        {requests.length === 0 ? (
          <div className="network-request min-h-6" />
        ) : (
          requests.map((request) => (
            <div key={request.id} className="network-request">
              <span>{request.label}</span>
              <div className="network-progress" role="progressbar" aria-label="Timed progress">
                <div
                  className="network-progress-bar"
                  style={{animationDuration: `${request.ms}ms`}}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function NetworkDebugger() {
  const [latency] = useState(readLatencies)
  const [snapshot, send] = useActor(networkMachine, {input: {latency}})
  const [requests, updateRequests] = useOptimistic(snapshot.context.requests, reduceRequests)
  const {path} = useRouter().location

  // The mock server reports requests from outside React. The machine renders each report in a
  // transition, which waits while an async action of the app is pending, so the report is also
  // shown optimistically, at once, until the machine's snapshot with it renders.
  useEffect(
    () =>
      subscribeToMockActivity((activity) => {
        startTransition(() => {
          updateRequests(activity)
          send(activity)
        })
      }),
    [send, updateRequests],
  )

  const paths: readonly ApiPath[] = path === '/login' ? ['/api/lessons'] : API_PATHS
  return (
    <div className="debugger">
      {paths.map((apiPath) => (
        <NetworkRow
          key={apiPath}
          path={apiPath}
          latency={snapshot.context.latency[apiPath]}
          requests={requests[apiPath]}
          latencyAction={(next) => send({type: 'latency.set', path: apiPath, latency: next})}
        />
      ))}
    </div>
  )
}
