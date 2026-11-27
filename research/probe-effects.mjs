import { createMachine, initialTransition, transition, createAsyncLogic, describeExecutableEffect } from 'xstate';
const fetcher = createAsyncLogic({ run: async ({ input }) => input * 2 });
const m = createMachine({
  context: { n: 0, log: [] },
  initial: 'idle',
  states: {
    idle: { on: { go: { target: 'loading' } }, after: { '1s': { target: 'timedOut' } } },
    loading: { entry: (_, enq) => { enq(() => console.log('  [custom action ran]')) }, invoke: { src: fetcher, input: 21, onDone: ({ event }) => ({ target: 'done', context: { n: event.output } }) } },
    timedOut: {}, done: {}
  }
});
const [s0, e0] = initialTransition(m);
console.log('initial', s0.value, e0.map(e => [e.kind, e.type ?? e.action?.type, JSON.stringify(describeExecutableEffect(e)).slice(0,160)]));
const [s1, e1] = transition(m, s0, { type: 'go' });
console.log('after go', s1.value, Object.keys(s1.children), e1.map(e => [e.kind, e.type, JSON.stringify(describeExecutableEffect(e)).slice(0,200)]));
