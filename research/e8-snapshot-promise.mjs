// E8: getSnapshotPromise() + use() under E1 (mount tear while transition pending), E3 (time-sliced),
// E6 (sync over suspended transition, incl. useOptimistic(transition())), plus boot cost and SSR.
import './dom.mjs';
const React = (await import('react')).default;
const { act, startTransition, Suspense, use, useState, useOptimistic, useLayoutEffect, Profiler, createElement: h } = React;
const { createRoot } = await import('react-dom/client');
const { renderToString } = await import('react-dom/server');
const { createMachine, transition } = await import('xstate');
const { createPromiseActor, useRenderRead, useRenderReadSubscribed, useUsesPromise, makePromiseContext, BootRoot } = await import('./snapshotPromise.mjs');
const machine = createMachine({ context: { q: '', n: 0, v: 0 }, on: {
  set: ({ event }) => ({ context: { q: event.q } }), tEv: () => ({ context: { q: 'a' } }),
  sEv: ({ context }) => ({ context: { n: context.n + 1 } }), setV: ({ event }) => ({ context: { v: event.v } }) } });
const ok = Object.assign(Promise.resolve(), { status: 'fulfilled' }); const never = new Promise(() => {});
const Results = ({ q }) => { use(q === '' ? ok : never); return h('span', null, `results=${JSON.stringify(q)} `); };
const VARIANTS = ['renderRead', 'renderRead+subscribe', 'usesPromise', 'contextPromise'];
function make(name) {
  const pa = createPromiseActor(machine);
  if (name === 'contextPromise') { const c = makePromiseContext(pa); return { pa, Root: c.Root, useSnap: c.useSnap, Ctx: c.Ctx }; }
  return { pa, Root: ({ children }) => h(BootRoot, { pa }, children), useSnap: () => ({ renderRead: useRenderRead, 'renderRead+subscribe': useRenderReadSubscribed, usesPromise: useUsesPromise })[name](pa) };
}
const quiet = console.error; console.error = (...a) => { if (!/act\(|not wrapped/.test(String(a[0]))) quiet(...a); };

// ---------- boot cost + SSR ----------
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
console.log('== boot cost / SSR');
for (const placement of ['provider inside <Suspense>', 'provider outside <Suspense>'])
for (const name of VARIANTS) {
  const v = make(name); let bootFallbackCommits = 0;
  const BootFallback = () => { useLayoutEffect(() => { bootFallbackCommits++; }, []); return h('i', null, '[BOOT FALLBACK]'); };
  const Reader = () => h('span', null, `A=${JSON.stringify(v.useSnap().context.q)}`);
  const app = placement.includes('inside') ? h(Suspense, { fallback: h(BootFallback) }, h(v.Root, null, h(Reader))) : h(v.Root, null, h(Suspense, { fallback: h(BootFallback) }, h(Reader)));
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(app));
  console.log(`${placement} ${name.padEnd(21)} boot fallback committed ${bootFallbackCommits}x, settled DOM: ${el.textContent}`);
  await act(async () => root.unmount());
}
{ const v = make('contextPromise'); const Reader = () => h('span', null, `A=${JSON.stringify(v.useSnap().context.q)}`);
  const html = renderToString(h(v.Root, null, h(Suspense, { fallback: h('i', null, '[BOOT FALLBACK]') }, h(Reader))));
  console.log('SSR (renderToString, contextPromise, provider outside boundary):', html.replace(/<template[^>]*>.*?<\/template>/s, '<template …client-render…>').replace(/<!--.*?-->/g, '')); }

// ---------- E1 ----------
console.log('== E1: transition send (data suspends), then urgent mount of reader B');
for (const name of VARIANTS) {
  const v = make(name); let setShowB;
  const Reader = ({ id }) => h('span', null, `${id}=${JSON.stringify(v.useSnap().context.q)} `);
  const R = () => h(Results, { q: v.useSnap().context.q });
  const App = () => { const [b, s] = useState(false); setShowB = s;
    return h(v.Root, null, h(Suspense, { fallback: '[BOOT] ' }, h(Reader, { id: 'A' }), h(Suspense, { fallback: '[FALLBACK] ' }, h(R)), b ? h(Reader, { id: 'B' }) : null)); };
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(h(App)));
  const t0 = el.textContent;
  await act(async () => startTransition(() => v.pa.send({ type: 'set', q: 'a' })));
  const t1 = el.textContent;
  await act(async () => setShowB(true));
  console.log(`${name.padEnd(15)}| ${t0.trim()} | after transition send: ${t1.trim()} | after urgent mount B: ${el.textContent.trim()}`);
  await act(async () => root.unmount());
}

// ---------- E6 ----------
console.log('== E6: transition tEv pending (suspended), then sync sEv');
for (const name of [...VARIANTS, 'contextPromise+optimistic']) {
  const base = name.startsWith('contextPromise') ? 'contextPromise' : name; const v = make(base); let api;
  const View = ({ snap }) => h('div', null, h('span', null, `n=${snap.context.n} `), h(Suspense, { fallback: '[FALLBACK] ' }, h(Results, { q: snap.context.q })));
  const Inner = () => {
    const snap = v.useSnap();
    const [opt, setOpt] = useOptimistic(snap, (b, e) => transition(machine, b, e)[0]);
    api = { t: () => startTransition(() => v.pa.send({ type: 'tEv' })),
      s: name.endsWith('optimistic') ? () => startTransition(() => { setOpt({ type: 'sEv' }); v.pa.send({ type: 'sEv' }); }) : () => v.pa.send({ type: 'sEv' }) };
    return h(View, { snap: name.endsWith('optimistic') ? opt : snap });
  };
  const el = document.createElement('div'); const root = createRoot(el);
  await act(async () => root.render(h(v.Root, null, h(Suspense, { fallback: '[BOOT]' }, h(Inner)))));
  await act(async () => api.t()); const a = el.textContent;
  await act(async () => api.s());
  console.log(`${name.padEnd(26)}| pending: ${a.padEnd(16)}| after sync sEv: ${el.textContent}`);
  await act(async () => root.unmount());
}

// ---------- E3 (real scheduler) ----------
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
console.log('== E3: time-sliced transition, second mutation mid-render');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const second of ['transition', 'outside-transition'])
  for (const name of VARIANTS) {
    const v = make(name); const commits = []; const N = 120;
    const Reader = React.memo(() => { const val = v.useSnap().context.v; const t = performance.now(); while (performance.now() - t < 0.4); return h('span', { 'data-r': '' }, String(val)); });
    const el = document.createElement('div'); const root = createRoot(el);
    const onRender = () => { const vals = [...el.querySelectorAll('[data-r]')].map((n) => n.textContent); if (vals.length) commits.push([...new Set(vals)].join('|')); };
    root.render(h(Profiler, { id: 'p', onRender }, h(v.Root, null, h(Suspense, { fallback: 'boot' }, Array.from({ length: N }, (_, i) => h(Reader, { key: i }))))));
    await sleep(300); commits.length = 0;
    startTransition(() => v.pa.send({ type: 'setV', v: 1 })); await sleep(12);
    if (second === 'transition') startTransition(() => v.pa.send({ type: 'setV', v: 2 })); else v.pa.send({ type: 'setV', v: 2 });
    await sleep(400);
    const torn = commits.filter((c) => c.includes('|'));
    console.log(`${name.padEnd(15)} 2nd=${second.padEnd(19)} commits: ${commits.join(' , ').padEnd(12)} ${torn.length ? 'TORN: ' + torn.join(' ; ') : 'no torn commit'}`);
    root.unmount(); await sleep(20);
  }
