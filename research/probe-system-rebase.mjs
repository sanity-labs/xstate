// Effect ids in system snapshots are order counters. If React rebases (sync branch first, then
// chronological), the id a host received for an effect can name a DIFFERENT effect in the final state.
import { createMachine, createAsyncLogic, initialSystemTransition, systemTransition } from 'xstate';
const job = (name) => createAsyncLogic({ run: async () => name });
const root = createMachine({ id: 'root', context: { got: [] }, type: 'parallel', states: {
  t: { initial: 'idle', states: { idle: { on: { tEv: { target: 'run' } } }, run: { invoke: { src: job('T'), onDone: ({ context, event }) => ({ target: 'ok', context: { got: [...context.got, 'T:' + event.output] } }) } }, ok: {} } },
  s: { initial: 'idle', states: { idle: { on: { sEv: { target: 'run' } } }, run: { invoke: { src: job('S'), onDone: ({ context, event }) => ({ target: 'ok', context: { got: [...context.got, 'S:' + event.output] } }) } }, ok: {} } } } });
const L = { root }; const [s0] = initialSystemTransition(L, { time: 0 });
const addr = (e) => e.source.$actor ?? e.source['@actor'];
// sync branch (what React commits first when sEv is urgent and tEv is a pending transition):
const [syncBranch, fxSync] = systemTransition(L, s0, s0.root, { type: 'sEv' });
const sEffect = fxSync.find((e) => e.type === '@xstate.effect'); console.log('sync branch: S effect id =', sEffect.id, 'source', addr(sEffect));
// chronological branch (what the transition commit computes): tEv then sEv
const [c1, fx1] = systemTransition(L, s0, s0.root, { type: 'tEv' }); const [c2, fx2] = systemTransition(L, c1, c1.root, { type: 'sEv' });
console.log('chronological: T effect id =', fx1.find((e) => e.type === '@xstate.effect').id, ', S effect id =', fx2.find((e) => e.type === '@xstate.effect').id);
// The host already started S work with the sync-branch id/source; deliver its result against the chronological state:
try { const [r] = systemTransition(L, c2, addr(sEffect), { type: 'xstate.system.effect.result', effectId: sEffect.id, event: { type: 'xstate.async.resolve', data: 'S' } });
  console.log('delivered sync-branch result into chronological state ->', JSON.stringify(r.actors[r.root].snapshot.context.got)); }
catch (err) { console.log('delivered sync-branch result into chronological state -> THROWS:', err.message); }
