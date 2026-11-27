// E4 (Q3 prototype): React state is canonical. useReducer(reducer = pure v6 transition()).
// Effects are queued IN STATE with deterministic ids and executed once, after commit, by an
// effect runner that installs a host runtime: timers and child->root sends come back as dispatch().
import './dom.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { act, StrictMode, startTransition, useReducer, useEffect, useRef, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { createMachine, createAsyncLogic, transition, initialTransition, deliverEvent } = await import('xstate');

let customRuns = 0, reducerCalls = 0;
const fetcher = createAsyncLogic({ run: async ({ input }) => { await new Promise((r) => setTimeout(r, 30)); return input * 2; } });
const machine = createMachine({
  initial: 'idle', context: { n: 0 },
  states: {
    idle: { on: { go: { target: 'loading' } }, after: { '200ms': { target: 'timedOut' } } },
    loading: { entry: (_, enq) => { enq(() => { customRuns++; }); }, invoke: { src: fetcher, input: 21, onDone: ({ event }) => ({ target: 'done', context: { n: event.output } }) } },
    timedOut: {}, done: {}
  }
});

function reducer(state, event) {
  reducerCalls++;
  const [snap, effects] = transition(machine, state.snap, event);
  return { snap, seq: state.seq + effects.length, queue: [...state.queue, ...effects.map((e, i) => ({ id: state.seq + i + 1, e }))] };
}
function init() { const [snap, effects] = initialTransition(machine); return { snap, seq: effects.length, queue: effects.map((e, i) => ({ id: i + 1, e })) }; }

function useMachineState() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const done = useRef(0); const timers = useRef(new Map());
  useEffect(() => {
    for (const { id, e } of state.queue) {
      if (id <= done.current) continue; done.current = id;
      const system = (e.source ?? e.actor)?.system;
      const host = {
        scheduleTimer: (source, timer, delay) => { const k = JSON.stringify([timer.type ?? '', timer.id ?? '', timer.event?.type, timer.event?.delay, timer.event?.stateId]); timers.current.set(k, setTimeout(() => dispatch({ type: 'xstate.timer', ...timer }), delay)); },
        cancelTimer: (source, timer) => { for (const [k, t] of timers.current) if (k.includes(JSON.stringify(timer.event?.stateId ?? '')) ) { clearTimeout(t); timers.current.delete(k); } },
        sendEvent: (source, target, ev) => { if (!target._parent) dispatch(ev); else deliverEvent(source, target, ev); }
      };
      if (system) system.runtime = host; // children's sends to the root route through here too
      const runtime = new Proxy(host, { get: (t, k) => t[k] ?? (typeof system?.[k] === 'function' ? system[k].bind(system) : undefined) });
      e.exec(runtime);
    }
  }, [state.queue]);
  return [state.snap, dispatch];
}

const log = [];
for (const strict of [false, true]) {
  customRuns = 0; reducerCalls = 0; log.length = 0;
  let send;
  const App = () => { const [snap, d] = useMachineState(); send = d; log.push(JSON.stringify(snap.value) + ':' + snap.context.n); return h('div', null, String(snap.value)); };
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(strict ? h(StrictMode, null, h(App)) : h(App)));
  await act(async () => startTransition(() => send({ type: 'go' })));
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  const afterInvoke = el.textContent;
  // timer path: fresh mount, wait past 200ms
  await act(async () => root.unmount());
  const el2 = document.createElement('div'); const root2 = createRoot(el2);
  await act(async () => root2.render(strict ? h(StrictMode, null, h(App)) : h(App)));
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  console.log(`strict=${strict}: invoke path -> "${afterInvoke}" (custom entry action ran ${customRuns}x, reducer calls ${reducerCalls}); timer path -> "${el2.textContent}"`);
  await act(async () => root2.unmount());
}
