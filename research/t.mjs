import { createMachine, createActor, transition } from 'xstate';
const m = createMachine({ context: { v: '' }, on: { change: ({ event }) => ({ context: { v: event.value } }) } });
const a = createActor(m); a.start();
a.subscribe(s => console.log('notified', s.context.v));
console.log('before send'); a.send({ type: 'change', value: 'x' }); console.log('after send', a.getSnapshot().context.v);
const [n] = transition(m, a.getSnapshot(), { type: 'change', value: 'y' }); console.log('pure', n.context.v, 'actor still', a.getSnapshot().context.v);
console.log(typeof a.trigger?.change);
