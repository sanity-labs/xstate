import {useActor} from '@sanity-labs/xstate-react'
import {startTransition, useEffect, useOptimistic, useState} from 'react'

import {
  API_PATHS,
  readLatencies,
  subscribeToMockActivity,
  type ApiPath,
  type Latency,
  type MockRequest,
} from '@/mocks/latency'
import {useRouter} from '@/router/index'

import './debugger.css'
import {networkMachine} from './machine'

const LABELS: Record<ApiPath, string> = {
  '/api/lessons': 'GET /api/lessons',
  '/api/lesson/:id/toggle': 'POST /api/lesson/:id/toggle',
}

type Requests = Record<ApiPath, readonly MockRequest[]>

type RequestAction =
  | {type: 'start'; request: MockRequest}
  | {type: 'end'; path: ApiPath; id: string}

const noRequests: Requests = {'/api/lessons': [], '/api/lesson/:id/toggle': []}

function reduceRequests(requests: Requests, action: RequestAction): Requests {
  switch (action.type) {
    case 'start': {
      const {path} = action.request
      return {...requests, [path]: [...requests[path], action.request]}
    }
    case 'end':
      return {
        ...requests,
        [action.path]: requests[action.path].filter((request) => request.id !== action.id),
      }
    default: {
      const unhandled: never = action
      throw new Error(`Unhandled request action: ${JSON.stringify(unhandled)}`)
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
  const [requests, updateRequests] = useOptimistic(noRequests, reduceRequests)
  const {path} = useRouter().location

  // The mock server reports requests from outside React. Each request is shown optimistically by
  // an action that lasts as long as the request, so it shows as it starts, even while a
  // transition waiting for it is suspended.
  useEffect(() => {
    const ends = new Map<string, () => void>()
    const unsubscribe = subscribeToMockActivity((activity) => {
      switch (activity.type) {
        case 'request.start': {
          const {request} = activity
          const ended = new Promise<void>((resolve) => ends.set(request.id, resolve))
          startTransition(async () => {
            updateRequests({type: 'start', request})
            send(activity)
            await ended
          })
          break
        }
        case 'request.end': {
          ends.get(activity.id)?.()
          ends.delete(activity.id)
          // An action that outlives this request, entangled with it, would keep showing it.
          startTransition(() => {
            updateRequests({type: 'end', path: activity.path, id: activity.id})
          })
          break
        }
        default: {
          const unhandled: never = activity
          throw new Error(`Unhandled mock activity: ${JSON.stringify(unhandled)}`)
        }
      }
    })
    return () => {
      unsubscribe()
      for (const end of ends.values()) {
        end()
      }
    }
  }, [send, updateRequests])

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
