// An actor wrapper that only exposes getSnapshotPromise(), modeled on react-rx useObservablePromise:
// pending until boot (actor.start() in useEffect), then each snapshot swaps in a pre-settled promise.
import React from 'react';
import { createActor } from 'xstate';
const settled = (value) => Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
export function createPromiseActor(machine) {
  const actor = createActor(machine);
  let resolveBoot; let current = new Promise((r) => (resolveBoot = r)); current.status = 'pending';
  const listeners = new Set(); let booted = false;
  return {
    actor, // internal: send only
    send: (e) => actor.send(e),
    getSnapshotPromise: () => current,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    boot() {
      if (booted) return; booted = true; actor.start();
      const first = actor.getSnapshot(); current.status = 'fulfilled'; current.value = first; resolveBoot(first);
      actor.subscribe((snap) => { current = settled(snap); for (const l of listeners) l(); });
    },
  };
}
// Delivery 1: read from the actor at render time
export const useRenderRead = (pa) => React.use(pa.getSnapshotPromise());
// Delivery 1b: read from the actor at render time, plus a subscription that forces a re-render
export function useRenderReadSubscribed(pa) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => pa.subscribe(force), []);
  return React.use(pa.getSnapshotPromise());
}
// Delivery 2: uSES of the promise (like useObservablePromise), then use()
export const useUsesPromise = (pa) => React.use(React.useSyncExternalStore(pa.subscribe, pa.getSnapshotPromise, pa.getSnapshotPromise));
// Delivery 3: top-level useState holding the promise, passed through context
export function makePromiseContext(pa) {
  const Ctx = React.createContext(null);
  function Root({ children }) {
    const [p, setP] = React.useState(() => pa.getSnapshotPromise());
    React.useEffect(() => { const un = pa.subscribe(() => setP(pa.getSnapshotPromise())); pa.boot(); setP(pa.getSnapshotPromise()); return un; }, []);
    return React.createElement(Ctx.Provider, { value: p }, children);
  }
  return { Root, useSnap: () => React.use(React.useContext(Ctx)), Ctx };
}
// Boot for deliveries 1/2: a provider that only boots in an effect
export function BootRoot({ pa, children }) { React.useEffect(() => { pa.boot(); }, []); return children; }
