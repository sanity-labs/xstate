// E3: real scheduler (no act). A transition render is time-sliced across many slow readers;
// a second mutation lands mid-render. Do readers commit different values in ONE commit?
import './dom.mjs';
const React = (await import('react')).default;
const { startTransition, useReducer, createContext, useContext, Profiler, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { createMachine, createActor, transition, initialTransition } = await import('xstate');
const jotai = await import('jotai');
const { useSelector } = await import('@xstate/react');
const { useJotaiStyle, useValueInUpdate, makeSingleSubscriber } = await import('./hooks.mjs');
const N = 120, SPIN = 0.4;
const machine = createMachine({ context: { v: 0 }, on: { set: ({ event }) => ({ context: { v: event.v } }) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spin = () => { const t = performance.now(); while (performance.now() - t < SPIN); };

function makeVariant(name) {
  if (name === 'topReducer') {
    const Ctx = createContext(0); let dispatch;
    const Root = ({ children }) => { const [s, d] = useReducer((s, e) => transition(machine, s, e)[0], undefined, () => initialTransition(machine)[0]); dispatch = d; return h(Ctx.Provider, { value: s.context.v }, children); };
    return { Root, useV: () => useContext(Ctx), send: (e) => dispatch(e) };
  }
  if (name === 'jotaiReal') {
    const store = jotai.createStore(); const a = jotai.atom(0);
    return { Root: ({ children }) => h(jotai.Provider, { store }, children), useV: () => jotai.useAtomValue(a), send: (e) => store.set(a, e.v) };
  }
  const actor = createActor(machine).start(); const sel = (s) => s.context.v;
  if (name === 'singleSubscriber') { const ss = makeSingleSubscriber(actor); return { Root: ss.Root, useV: () => sel(ss.useSnap()), send: (e) => actor.send(e) }; }
  const hook = { jotaiStyle: useJotaiStyle, valueInUpdate: useValueInUpdate, xstateReact: useSelector }[name];
  return { Root: ({ children }) => children, useV: () => hook(actor, sel), send: (e) => actor.send(e) };
}

async function run(name, second) {
  const v = makeVariant(name); const commits = [];
  const Reader = React.memo(() => { const val = v.useV(); spin(); return h('span', { 'data-r': '' }, String(val)); });
  const onRender = () => { const vals = [...el.querySelectorAll('[data-r]')].map((n) => n.textContent); commits.push([...new Set(vals)].join('|')); };
  const App = () => h(Profiler, { id: 'p', onRender }, h(v.Root, null, Array.from({ length: N }, (_, i) => h(Reader, { key: i }))));
  const el = document.createElement('div'); const root = createRoot(el);
  root.render(h(App)); await sleep(150); commits.length = 0;
  startTransition(() => v.send({ type: 'set', v: 1 }));
  await sleep(12); // mid-render of the time-sliced transition
  if (second === 'transition') startTransition(() => v.send({ type: 'set', v: 2 })); else v.send({ type: 'set', v: 2 });
  await sleep(400);
  const torn = commits.filter((c) => c.includes('|'));
  console.log(`${name.padEnd(13)} 2nd=${second.padEnd(10)} commits: ${commits.join(' , ').padEnd(18)} ${torn.length ? 'TORN commit(s): ' + torn.join(' ; ') : 'no torn commit'}`);
  root.unmount(); await sleep(20);
}
for (const second of ['transition', 'urgent'])
  for (const n of ['xstateReact', 'jotaiReal', 'jotaiStyle', 'valueInUpdate', 'singleSubscriber', 'topReducer']) await run(n, second);
