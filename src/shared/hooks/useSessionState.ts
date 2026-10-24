"use client";

// Screen state that survives leaving the page and coming Back — the open party,
// its tab, the period, how far down the list was scrolled. Kept in this tab's
// sessionStorage, so a new window starts clean and nothing outlives the session.
// `useLocalState` is the same for a choice that should outlive the session too
// (a view toggle, which columns show) — kept in localStorage.
//
// Restored after mount, not in the initial state: the first render must match
// the server's, and the server has no sessionStorage / localStorage.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

type Store = "session" | "local";
const storage = (store: Store): Storage => (store === "session" ? sessionStorage : localStorage);

function read<T>(key: string, store: Store = "session"): T | undefined {
    try {
        const raw = storage(store).getItem(key);
        if (raw == null) return undefined;
        // A plain string saved by older code (no JSON quotes) reads back as itself.
        try { return JSON.parse(raw) as T; } catch { return raw as T; }
    } catch { return undefined; }
}

function write(key: string, value: unknown, store: Store = "session"): void {
    try { storage(store).setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function useStoredState<T>(store: Store, key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    // `restoredFor` says which key the value has been restored for. Nothing is
    // written until it matches: writing earlier (in the same commit as the
    // restore, or on a key change) put the default over the saved value — and
    // under React's development double-run of effects, the second restore then
    // read that default back and the saved choice was lost.
    const [state, setState] = useState<{ value: T; restoredFor: string | null }>({ value: initial, restoredFor: null });

    useEffect(() => {
        const saved = read<T>(key, store);
        // One-time restore after mount — the server render has no browser storage.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState((s) => ({ value: saved !== undefined ? saved : s.value, restoredFor: key }));
    }, [key, store]);

    useEffect(() => {
        if (state.restoredFor === key) write(key, state.value, store);
    }, [key, state, store]);

    const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
        setState((s) => ({
            ...s,
            value: typeof action === "function" ? (action as (prev: T) => T)(s.value) : action,
        }));
    }, []);

    return [state.value, setValue];
}

/** `useState` that remembers its value for this tab under `key`. */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    return useStoredState("session", key, initial);
}

/** `useState` that remembers its value in this browser under `key`, across sessions. */
export function useLocalState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    return useStoredState("local", key, initial);
}

/**
 * Remembers a scroll box's position under `key`, and puts it back once `ready`
 * turns true (the rows are on screen). Re-arms whenever `key` changes, so each
 * party keeps its own place.
 */
export function useSessionScroll<E extends HTMLElement = HTMLDivElement>(key: string, ready: boolean) {
    const ref = useRef<E>(null);
    const doneFor = useRef<string | null>(null);

    useEffect(() => {
        if (!ready || doneFor.current === key) return;
        doneFor.current = key;
        const top = read<number>(key) ?? 0;
        requestAnimationFrame(() => { if (ref.current) ref.current.scrollTop = top; });
    }, [key, ready]);

    const onScroll = useCallback(() => {
        if (doneFor.current === key && ref.current) write(key, ref.current.scrollTop);
    }, [key]);

    return { ref, onScroll };
}
