// E6: a transition (tEv: q='a', suspends) is pending; then a "sync" event sEv (n+1) arrives.
// Does the sync render leak the pending transition's state (q='a' -> Suspense fallback)?
import './dom.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { act, startTransition, Suspense, use, useState, useEffect, useReducer, useOptimistic, createContext, useContext, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { createMachine, createActor, transition, initialTransition } = await import('xstate');
const machine = createMachine({ context: { q: '', n: 0 }, on: {
  tEv: () => ({ context: { q: 'a' } }), sEv: ({ context }) => ({ context: { n: context.n + 1 } }) } });
const ok = Object.assign(Promise.resolve(), { status: 'fulfilled' }); const never = new Promise(() => {});
const Ctx = createContext(null);
const View = () => { const s = useContext(Ctx); return h('div', null, h('span', null, `n=${s.context.n} `), h(Suspense, { fallback: '[FALLBACK] ' }, h(Results, { q: s.context.q }))); };
const Results = ({ q }) => { use(q === '' ? ok : never); return h('span', null, `results=${q} `); };

async function run(name) {
  const actor = createActor(machine).start(); let api = {};
  function Root() {
    if (name === 'topReducer') {
      const [s, d] = useReducer((s, e) => transition(machine, s, e)[0], undefined, () => initialTransition(machine)[0]);
      api = { t: () => startTransition(() => d({ type: 'tEv' })), s: () => d({ type: 'sEv' }) };
      return h(Ctx.Provider, { value: s }, h(View));
    }
    const [snap, setSnap] = useState(() => actor.getSnapshot());
    useEffect(() => { const sub = actor.subscribe(setSnap); return () => sub.unsubscribe(); }, []);
    const [opt, setOpt] = useOptimistic(snap, (base, e) => transition(machine, base, e)[0]);
    api = { t: () => startTransition(() => actor.send({ type: 'tEv' })),
      s: name === 'singleSubscriber+optimistic'
        ? () => startTransition(() => { setOpt({ type: 'sEv' }); actor.send({ type: 'sEv' }); })
        : name === 'singleSubscriber+transitionSend' ? () => startTransition(() => actor.send({ type: 'sEv' }))
        : () => actor.send({ type: 'sEv' }) };
    return h(Ctx.Provider, { value: name === 'singleSubscriber+optimistic' ? opt : snap }, h(View));
  }
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(h(Root)));
  await act(async () => api.t());
  const a = el.textContent;
  await act(async () => api.s());
  console.log(`${name.padEnd(28)}| pending transition: ${a.padEnd(18)}| after sync sEv: ${el.textContent}`);
  await act(async () => root.unmount());
}
for (const n of ['singleSubscriber', 'singleSubscriber+transitionSend', 'singleSubscriber+optimistic', 'topReducer']) await run(n);
