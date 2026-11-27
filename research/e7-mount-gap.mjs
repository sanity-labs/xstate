// E7: Jotai's documented mount gap: a change between a reader's render and its useEffect subscribe
// (here: a sibling's useLayoutEffect writes). Is the change picked up?
import './dom.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { act, useLayoutEffect, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const jotai = await import('jotai');
const { createMachine, createActor } = await import('xstate');
const { useJotaiStyle, useValueInUpdate } = await import('./hooks.mjs');
const machine = createMachine({ context: { v: 0 }, on: { set: ({ event }) => ({ context: { v: event.v } }) } });
for (const name of ['jotaiReal(useAtomValue)', 'jotaiReal(useAtomValueRaw)', 'jotaiStyle', 'valueInUpdate', 'noRecheck']) {
  let read, write;
  if (name.startsWith('jotaiReal')) { const store = jotai.createStore(); const a = jotai.atom(0); const hook = name.includes('Raw') ? jotai.useAtomValueRaw : jotai.useAtomValue; read = () => hook(a, { store }); write = () => store.set(a, 1); }
  else { const actor = createActor(machine).start(); const sel = (s) => s.context.v;
    const noRecheck = (actor, sel) => { const [v, s] = React.useState(() => sel(actor.getSnapshot())); React.useEffect(() => { const sub = actor.subscribe((x) => s(sel(x))); return () => sub.unsubscribe(); }, []); return v; };
    const hook = { jotaiStyle: useJotaiStyle, valueInUpdate: useValueInUpdate, noRecheck }[name]; read = () => hook(actor, sel); write = () => actor.send({ type: 'set', v: 1 }); }
  const Reader = () => h('span', null, `reader=${read()} `);
  const Writer = () => { useLayoutEffect(() => { write(); }, []); return null; };
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(h('div', null, h(Reader), h(Writer))));
  console.log(`${name.padEnd(26)} store=1, ${el.textContent}`);
  await act(async () => root.unmount());
}
