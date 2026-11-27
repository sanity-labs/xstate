// E1: does send() inside startTransition stay a transition (old UI kept while new data suspends)?
// E2: while that transition is pending, an urgent update mounts a new reader. Does it tear?
import './dom.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { act, startTransition, Suspense, use, useState, useReducer, createContext, useContext, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { createMachine, createActor, transition, initialTransition } = await import('xstate');
const { useSelector } = await import('@xstate/react');
const jotai = await import('jotai');
const { experimental: rcs } = await import('react-concurrent-store');
const { useJotaiStyle, useValueInUpdate, makeSingleSubscriber } = await import('./hooks.mjs');

const machine = createMachine({ context: { q: '' }, on: { set: ({ event }) => ({ context: { q: event.q } }) } });
const cache = new Map();
const getP = (q) => { if (!cache.has(q)) { const p = q === '' ? Promise.resolve('ok') : new Promise(() => {}); if (q === '') { p.status = 'fulfilled'; p.value = 'ok'; } cache.set(q, p); } return cache.get(q); };
const sel = (s) => s.context.q;

function makeVariant(name) {
  if (name === 'topReducer') {
    // Q3 shape: React state is canonical; reducer = pure v6 transition()
    const Ctx = createContext(null); let dispatch;
    const reducer = (snap, ev) => transition(machine, snap, ev)[0];
    const Root = ({ children }) => { const [snap, d] = useReducer(reducer, undefined, () => initialTransition(machine)[0]); dispatch = d; return h(Ctx.Provider, { value: snap }, children); };
    return { Root, useQ: () => useContext(Ctx).context.q, send: (e) => dispatch(e) };
  }
  if (name === 'jotaiReal') {
    const store = jotai.createStore(); const qAtom = jotai.atom('');
    return { Root: ({ children }) => h(jotai.Provider, { store }, children), useQ: () => jotai.useAtomValue(qAtom), send: (e) => store.set(qAtom, e.q) };
  }
  const actor = createActor(machine).start();
  if (name === 'rcsExperimental') {
    const store = rcs.createStoreFromSource({ getState: () => actor.getSnapshot(), reducer: (s, e) => transition(machine, s, e)[0] });
    return { Root: ({ children }) => h(rcs.StoreProvider, null, children), useQ: () => rcs.useStoreSelector(store, sel), send: (e) => { actor.send(e); store.handleUpdate(e); } };
  }
  if (name === 'singleSubscriber') { const ss = makeSingleSubscriber(actor); return { Root: ss.Root, useQ: () => sel(ss.useSnap()), send: (e) => actor.send(e) }; }
  const hook = { jotaiStyle: useJotaiStyle, valueInUpdate: useValueInUpdate, xstateReact: useSelector }[name];
  return { Root: ({ children }) => children, useQ: () => hook(actor, sel), send: (e) => actor.send(e) };
}

async function run(name) {
  const v = makeVariant(name); let setShowB;
  const Reader = ({ id }) => h('span', null, `${id}=${JSON.stringify(v.useQ())} `);
  const Results = () => { const q = v.useQ(); use(getP(q)); return h('span', null, `results=${JSON.stringify(q)} `); };
  const App = () => { const [showB, s] = useState(false); setShowB = s;
    return h(v.Root, null, h(Reader, { id: 'A' }), h(Suspense, { fallback: h('span', null, '[FALLBACK] ') }, h(Results)), showB ? h(Reader, { id: 'B' }) : null); };
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(h(App)));
  const t0 = el.textContent.trim();
  await act(async () => startTransition(() => v.send({ type: 'set', q: 'a' })));
  const t1 = el.textContent.trim();
  await act(async () => setShowB(true)); // urgent update mid-pending-transition
  const t2 = el.textContent.trim();
  console.log(`${name.padEnd(16)}| initial: ${t0} | after transition send: ${t1} | after urgent mount of B: ${t2}`);
  await act(async () => root.unmount());
}
const origErr = console.error; console.error = (...a) => { if (!String(a[0]).includes('not wrapped in act')) origErr(...a); };
for (const n of ['xstateReact', 'jotaiReal', 'jotaiStyle', 'valueInUpdate', 'rcsExperimental', 'singleSubscriber', 'topReducer']) await run(n);
