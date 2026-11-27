// E5b: same as E5, but effects are keyed by dispatched-event identity (id assigned outside the reducer).
// (b) React rebasing a sync update over a pending transition re-derives the effect queue in a
// different order, so naive id-based "run once" dedupe double-runs / drops effects.
import './dom.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { act, startTransition, Suspense, use, useReducer, useEffect, useRef, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { createMachine, transition, initialTransition } = await import('xstate');
const runs = { A: 0, B: 0 };
const machine = createMachine({ context: { q: '', n: 0 }, on: {
  tEv: ({ context }, enq) => { enq(() => { runs.A++; }); return { context: { q: 'a' } }; },
  sEv: ({ context }, enq) => { enq(() => { runs.B++; }); return { context: { n: context.n + 1 } }; } } });
const reducer = (s, ev) => { const [snap, fx] = transition(machine, s.snap, ev); return { snap, seq: 0, queue: [...s.queue, ...fx.map((e, i) => ({ key: ev.__id + ":" + i, e, ev: ev.type }))] }; }; let nextId = 0;
let resolveA; const pA = new Promise((r) => (resolveA = r)); const ok = Object.assign(Promise.resolve(), { status: 'fulfilled' });
const Results = ({ q }) => { use(q === '' ? ok : pA); return h('span', null, `results=${q} `); };
let send; const executed = [];
const App = () => {
  const [s, d] = useReducer(reducer, undefined, () => ({ snap: initialTransition(machine)[0], seq: 0, queue: [] })); send = d;
  const done = useRef(new Set());
  useEffect(() => { for (const { key, e, ev } of s.queue) if (!done.current.has(key)) { done.current.add(key); executed.push(`${ev}@${key}`); e.exec(); } }, [s.queue]);
  return h('div', null, h('span', null, `n=${s.snap.context.n} `), h(Suspense, { fallback: 'FALLBACK' }, h(Results, { q: s.snap.context.q })));
};
const el = document.createElement('div'); const root = createRoot(el);
await act(async () => root.render(h(App)));
await act(async () => startTransition(() => send({ type: "tEv", __id: ++nextId })));
console.log('after transition tEv (pending, suspended):', el.textContent, '| runs', JSON.stringify(runs));
await act(async () => send({ type: "sEv", __id: ++nextId })); // urgent, rebased over the pending transition
console.log('after urgent sEv:', el.textContent, '| runs', JSON.stringify(runs), '| executed', executed.join(','));
await act(async () => { resolveA(); await pA; });
console.log('after transition commits:', el.textContent, '| runs', JSON.stringify(runs), '| executed', executed.join(','));
console.log('expected: A=1 B=1');
