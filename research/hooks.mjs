// Candidate bindings, each returning a selected value from a v6 actor.
import React from 'react';
import { transition } from 'xstate';
const { useReducer, useEffect, useState, createElement: h } = React;

// H1: Jotai-style (mirrors jotai/src/react/useAtomValueRaw.ts): useReducer whose reducer
// re-reads the store at render time; subscribe in useEffect, re-check on subscribe.
export function useJotaiStyle(actor, sel) {
  const [[value, sub], rerender] = useReducer(
    (prev) => { const next = sel(actor.getSnapshot()); return Object.is(prev[0], next) ? prev : [next, prev[1]]; },
    undefined,
    () => { const v = sel(actor.getSnapshot()); return [v, (cb) => { const s = actor.subscribe(cb); if (!Object.is(v, sel(actor.getSnapshot()))) cb(); return () => s.unsubscribe(); }]; }
  );
  useEffect(() => sub(rerender), [sub]);
  return value;
}

// H2: value carried in the update: setState(selected) at notify time (no render-time store read).
export function useValueInUpdate(actor, sel) {
  const [value, setValue] = useState(() => sel(actor.getSnapshot()));
  useEffect(() => {
    const s = actor.subscribe((snap) => setValue(sel(snap)));
    setValue(sel(actor.getSnapshot())); // mount-gap check
    return () => s.unsubscribe();
  }, [actor]);
  return value;
}

// H5: single subscriber: one live actor, ONE React state holding the snapshot at the top,
// fanned out through context. React state is canonical for rendering; the actor runs effects.
export function makeSingleSubscriber(actor) {
  const Ctx = React.createContext(null);
  function Root({ children }) {
    const [snap, setSnap] = useState(() => actor.getSnapshot());
    useEffect(() => { const s = actor.subscribe(setSnap); setSnap(actor.getSnapshot()); return () => s.unsubscribe(); }, []);
    return h(Ctx.Provider, { value: snap }, children);
  }
  return { Root, useSnap: () => React.useContext(Ctx) };
}
