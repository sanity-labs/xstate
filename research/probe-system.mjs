import { createMachine, createAsyncLogic, initialSystemTransition, systemTransition, advanceSystemTime } from 'xstate';
const fetcher = createAsyncLogic({ run: async ({ input }) => input * 2 });
const root = createMachine({ id: 'root', context: { q: '', n: 0 }, initial: 'idle', states: {
  idle: { on: { go: { target: 'loading' } }, after: { 200: { target: 'timedOut' } } },
  loading: { invoke: { src: fetcher, input: 21, onDone: ({ event }) => ({ target: 'done', context: { n: event.output } }) } }, timedOut: {}, done: {} },
  on: { tEv: (_, enq) => { enq.emit({ type: 'A' }); }, sEv: (_, enq) => { enq.emit({ type: 'B' }); } } });
const L = { root };
const [s0, fx0] = initialSystemTransition(L, { time: 0 });
console.log('initial timers', s0.timers.map(t => [t.dueAt, t.event.type]), 'fx', fx0.map(e => e.type));
const fmt = (fx) => fx.map(e => `${e.type}/${e.kind}/${e.id}`).join(', ');
const [a1, fa1] = systemTransition(L, s0, s0.root, { type: 'tEv' }); const [a2, fa2] = systemTransition(L, a1, a1.root, { type: 'sEv' });
const [b1, fb1] = systemTransition(L, s0, s0.root, { type: 'sEv' });
console.log('chronological: tEv ->', fmt(fa1), '| sEv ->', fmt(fa2));
console.log('rebased sync-first: sEv ->', fmt(fb1));
const [g, fg] = systemTransition(L, s0, s0.root, { type: 'go' });
console.log('go ->', g.actors[g.root].snapshot.value, fmt(fg));
const eff = fg.find(e => e.type === '@xstate.effect');
if (eff) { console.log('effect source', JSON.stringify(eff.source));  const [r] = systemTransition(L, g, (eff.source.$actor ?? eff.source['@actor']), { type: 'xstate.system.effect.result', effectId: eff.id, event: { type: 'xstate.async.resolve', data: 42 } }); console.log('after result ->', r.actors[r.root].snapshot.value, r.actors[r.root].snapshot.context.n); }
const [t] = advanceSystemTime(L, s0, { time: 250 }); console.log('advance 250 ->', t.actors[t.root].snapshot.value);
