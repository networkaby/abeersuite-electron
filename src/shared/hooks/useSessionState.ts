"use client";

// Screen state that survives leaving the page and coming Back — the open party,
// its tab, the period, how far down the list was scrolled. Kept in this tab's
// sessionStorage, so a new window starts clean and nothing outlives the session.
//
// Restored after mount, not in the initial state: the first render must match
// the server's, and the server has no sessionStorage.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

function read<T>(key: string): T | undefined {
    try {
        const raw = sessionStorage.getItem(key);
        return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch { return undefined; }
}

function write(key: string, value: unknown): void {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/** `useState` that remembers its value for this tab under `key`. */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(initial);
    const restored = useRef(false);

    useEffect(() => {
        const saved = read<T>(key);
        // One-time restore after mount — the server render has no sessionStorage.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (saved !== undefined) setValue(saved);
        restored.current = true;
    }, [key]);

    useEffect(() => {
        if (restored.current) write(key, value);
    }, [key, value]);

    return [value, setValue];
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
