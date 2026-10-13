"use client";

/**
 * The counter's lock cover (owner, 2026-10-13).
 *
 * Covers the whole app while the till is locked; whatever was open underneath — a
 * half-made bill — stays exactly as it was, and the person's 4-digit PIN lifts the
 * cover at once with no page load. Somebody with no PIN on this counter unlocks with
 * their password. "Sign out fully" is the way out: end of day, or somebody else
 * taking the till.
 *
 * While covered it swallows every key that is not typed into the cover itself, so a
 * POS shortcut cannot fire on the hidden screen behind it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import PinPad from "@/app/staff/login/PinPad";
import styles from "@/app/staff/login/login.module.css";
import {
    getCounterLock, getServerCounterLock, refreshCounterLock, subscribeCounterLock, unlockCounter,
} from "@/shared/lib/auth/counterLock";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import { captureMyDay } from "@/shared/lib/hr/myDay";
import { PIN_LENGTH } from "@/shared/lib/constants/session";

export default function CounterLock() {
    const lock = useSyncExternalStore(subscribeCounterLock, getCounterLock, getServerCounterLock);
    const { data: session } = useSession();
    const user = session?.user as { name?: string | null; email?: string | null; avatarUrl?: string } | undefined;

    // The digits live in a ref as well as state: keys can arrive faster than React
    // re-renders, and a press reading a stale `typed` would drop digits.
    const [typed, setTypedState] = useState("");
    const typedRef = useRef("");
    const setTyped = useCallback((next: string | ((was: string) => string)) => {
        typedRef.current = typeof next === "function" ? next(typedRef.current) : next;
        setTypedState(typedRef.current);
    }, []);
    const busyRef = useRef(false);
    const [password, setPassword] = useState("");
    const [usePassword, setUsePassword] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const coverRef = useRef<HTMLDivElement>(null);

    // Does this till lock, and is it locked already (a refresh, a new window)?
    useEffect(() => { void refreshCounterLock(); }, []);

    const passwordMode = usePassword || !lock.hasPin;

    const signOutFully = useCallback(async (lockedAt: number | null) => {
        busyRef.current = true;
        setBusy(true);
        await captureMyDay({ lastInputAt: lockedAt });
        await signOutTo("/staff/login");
    }, []);

    const tryUnlock = useCallback(async (secret: { pin: string } | { password: string }) => {
        busyRef.current = true;
        setBusy(true);
        setError("");
        const out = await unlockCounter(secret);
        busyRef.current = false;
        if (out.ok) {
            setTyped(""); setPassword(""); setUsePassword(false); setBusy(false);
            return;
        }
        if (out.signedOut) {
            // 5 wrong tries, or 3 idle days: the till has already ended the login.
            setError(out.error);
            await signOutFully(getCounterLock().lockedAt);
            return;
        }
        setError(out.error);
        setBusy(false);
    }, [signOutFully, setTyped]);

    const press = useCallback((digit: string) => {
        if (busyRef.current) return;
        setError("");
        const next = typedRef.current + digit;
        if (next.length >= PIN_LENGTH) { setTyped(""); void tryUnlock({ pin: next.slice(0, PIN_LENGTH) }); }
        else setTyped(next);
    }, [setTyped, tryUnlock]);

    // Every key while covered. Capture phase on the window, ahead of every shortcut
    // the app has: a key typed INTO the cover (the password box) goes through, any
    // other is stopped here and, on the keypad, typed into it.
    useEffect(() => {
        if (!lock.locked) return;
        // Nothing on the hidden app may keep focus; the password box takes it instead.
        if (passwordMode) document.getElementById("lock-pass")?.focus();
        else (document.activeElement as HTMLElement | null)?.blur?.();
        const onKey = (e: KeyboardEvent) => {
            if (coverRef.current?.contains(e.target as Node) && e.target !== coverRef.current) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            if (passwordMode) return;
            if (e.key >= "0" && e.key <= "9") press(e.key);
            else if (e.key === "Backspace") setTyped((t) => t.slice(0, -1));
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [lock.locked, passwordMode, press, setTyped]);

    if (!lock.enabled || !lock.locked) return null;

    const entry = {
        email: user?.email ?? "",
        name: user?.name || user?.email || "Locked",
        avatarUrl: user?.avatarUrl,
        hasPin: lock.hasPin,
    };

    const links = (
        <div className={styles.rowlinks}>
            {lock.hasPin ? (
                <button type="button" className={styles.pinlink} disabled={busy}
                    onClick={() => { setUsePassword((on) => !on); setError(""); setTyped(""); }}>
                    {usePassword ? "Use PIN" : "Use password"}
                </button>
            ) : <span />}
            <button type="button" className={styles.pinlink} disabled={busy}
                onClick={() => void signOutFully(lock.lockedAt)}>
                Someone else? Sign out fully
            </button>
        </div>
    );

    return (
        <div
            ref={coverRef}
            role="dialog"
            aria-modal="true"
            aria-label="Counter locked"
            className={styles.root}
            style={{ position: "fixed", inset: 0, zIndex: 2147483000, minHeight: 0 }}
        >
            <div className={styles.bg} />
            <div className={styles.scrim} />
            {passwordMode ? (
                <form
                    className={styles.card}
                    onSubmit={(e) => { e.preventDefault(); if (password) void tryUnlock({ password }); }}
                >
                    <h1 className={styles.greet}>Locked</h1>
                    <p className={styles.clock}>{entry.name} — type your password to carry on.</p>
                    <div className={styles.field}>
                        <label htmlFor="lock-pass">Password</label>
                        <input
                            id="lock-pass" type="password" autoComplete="current-password" autoFocus
                            value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }}
                        />
                    </div>
                    <button className={styles.go} type="submit" disabled={busy || !password}>
                        {busy ? "Unlocking…" : "Unlock"}
                    </button>
                    {error && <p className={styles.err}>{error}</p>}
                    {links}
                </form>
            ) : (
                <PinPad
                    entry={entry}
                    length={PIN_LENGTH}
                    typed={typed}
                    note={busy ? "Unlocking…" : `Locked — enter your ${PIN_LENGTH}-digit PIN`}
                    error={error}
                    onPress={press}
                    onDelete={() => setTyped((t) => t.slice(0, -1))}
                >
                    {links}
                </PinPad>
            )}
        </div>
    );
}
