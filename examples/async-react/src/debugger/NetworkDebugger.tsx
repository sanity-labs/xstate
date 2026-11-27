import {createActorContext} from '@sanity-labs/xstate-react'
import {useEffect, useState} from 'react'

import {API_PATHS, readLatencies, subscribeToMockActivity, type ApiPath} from '@/mocks/latency'
import {Router} from '@/router/index'

import './debugger.css'
import {networkMachine} from './machine'

// The mock server reports requests from outside React. Rendering those reports as regular updates
// shows a request as it starts, even while the transition that is waiting for it is suspended.
const Network = createActorContext(networkMachine, {updates: 'sync'})

const LABELS: Record<ApiPath, string> = {
  '/api/lessons': 'GET /api/lessons',
  '/api/lesson/:id/toggle': 'POST /api/lesson/:id/toggle',
}

function NetworkRow({path}: {path: ApiPath}) {
  const latency = Network.useSelector(({context}) => context.latency[path])
  const requests = Network.useSelector(({context}) => context.requests[path])
  const send = Network.useOptimisticSend()
  const label = LABELS[path]

  return (
    <div className="network-row">
      <div className="network-row-header">
        <div>{label}</div>
        <div className="network-controls">
          <span>{latency.ms}ms</span>
          <input
            type="range"
            min={0}
            max={3000}
            step={50}
            aria-label={`Latency for ${label}`}
            value={latency.ms}
            disabled={latency.mode === 'real'}
            onChange={(event) =>
              send({
                type: 'latency.set',
                path,
                latency: {mode: 'fixed', ms: Number(event.target.value)},
              })
            }
          />
          <label className="network-real-toggle">
            <input
              type="checkbox"
              title="Use a realistic random network delay"
              aria-label={`Real latency for ${label}`}
              checked={latency.mode === 'real'}
              onChange={(event) =>
                send({
                  type: 'latency.set',
                  path,
                  latency: {mode: event.target.checked ? 'real' : 'fixed', ms: latency.ms},
                })
              }
            />
            <span>real</span>
          </label>
        </div>
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

function NetworkRows() {
  const actor = Network.useActorRef()
  const path = Router.useSelector(({context}) => context.location.path)

  useEffect(() => subscribeToMockActivity((activity) => actor.send(activity)), [actor])

  const paths: readonly ApiPath[] = path === '/login' ? ['/api/lessons'] : API_PATHS
  return (
    <div className="debugger">
      {paths.map((apiPath) => (
        <NetworkRow key={apiPath} path={apiPath} />
      ))}
    </div>
  )
}

export function NetworkDebugger() {
  const [latency] = useState(readLatencies)
  return (
    <Network.Provider options={{input: {latency}}}>
      <NetworkRows />
    </Network.Provider>
  )
}
