"use client";

/**
 * The counter's lock cover (owner, 2026-10-13).
 *
 * Covers the whole app while the till is locked; whatever was open underneath — a
 * half-made bill — stays exactly as it was, and the person's 4-digit PIN lifts the
 * cover at once with no page load. Somebody with no PIN on this counter unlocks with
 * their password. "Not <name>? Switch person" is the way out for somebody else taking
 * the till: it ends this login and lands on the photographs, where the next person
 * taps their own face and types their own PIN (owner, 2026-10-15).
 *
 * It wears the sign-in screen's own pieces (owner, 2026-10-13): the till card (next
 * duty, today, the drawer), the greeting with the shop's next opening, and the
 * "Choose / Change your PIN" card — the password is typed there, never assumed.
 *
 * While covered it swallows every key that is not typed into the cover itself, so a
 * POS shortcut cannot fire on the hidden screen behind it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import PinPad from "@/app/staff/login/PinPad";
import ChoosePinCard from "@/app/staff/login/ChoosePinCard";
import NextOpening from "@/app/staff/login/NextOpening";
import TillCard from "@/app/staff/login/TillCard";
import { useLocalClock } from "@/app/staff/login/useLocalClock";
import { useBackdropPhoto } from "@/app/staff/login/useBackdropPhoto";
import { LOGIN_BACKGROUNDS, LOGIN_SCRIM } from "@/shared/lib/constants/loginShowcase";
import styles from "@/app/staff/login/login.module.css";
import { getLocalCounterSetup } from "@/shared/lib/counter/setupGate";
import {
    forgetCounterLockHint, getCounterLock, getServerCounterLock, refreshCounterLock, subscribeCounterLock, unlockCounter,
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
    // "Set PIN" / "Change PIN" from the cover — the same card the sign-in uses.
    const [choosingPin, setChoosingPin] = useState(false);
    const [counterNumber, setCounterNumber] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const coverRef = useRef<HTMLDivElement>(null);
    const { greet, clock } = useLocalClock();
    // The sign-in screen's own photograph, so locking does not swap the room for a gradient.
    const backdrop = useBackdropPhoto(LOGIN_BACKGROUNDS);

    // Does this till lock, and is it locked already (a refresh, a new window)?
    useEffect(() => { void refreshCounterLock(); }, []);
    // The server's first-paint stand-in (CounterLockVeil) goes once this screen knows:
    // either this cover is up in its place, or the till says it is not locked.
    useEffect(() => {
        if (lock.enabled === null && !lock.locked) return;
        // Hidden, not removed: the node is React's (server-rendered), and pulling it
        // out from under React breaks the next render of the root layout.
        const veil = document.getElementById("counter-lock-veil");
        if (veil) veil.style.display = "none";
    }, [lock.enabled, lock.locked]);
    useEffect(() => {
        void getLocalCounterSetup().then((s) => setCounterNumber(s?.counterNumber ?? null)).catch(() => { });
    }, []);

    // Typing goes into boxes, never to the keypad: the password card and the PIN card.
    const passwordMode = usePassword || !lock.hasPin || choosingPin;

    const signOutFully = useCallback(async (lockedAt: number | null) => {
        busyRef.current = true;
        setBusy(true);
        await captureMyDay({ lastInputAt: lockedAt });
        forgetCounterLockHint();
        await signOutTo("/staff/login");
    }, []);

    const tryUnlock = useCallback(async (secret: { pin: string } | { password: string }) => {
        busyRef.current = true;
        setBusy(true);
        setError("");
        const out = await unlockCounter(secret);
        busyRef.current = false;
        if (out.ok) {
            setTyped(""); setPassword(""); setUsePassword(false); setChoosingPin(false); setBusy(false);
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
        // Nothing on the hidden app may keep focus; the cover's first box takes it instead.
        if (passwordMode) document.getElementById(choosingPin ? "pin-pass" : "lock-pass")?.focus();
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
    }, [lock.locked, passwordMode, choosingPin, press, setTyped]);

    if (!lock.enabled || !lock.locked) return null;

    const entry = {
        email: user?.email ?? "",
        name: user?.name || user?.email || "Locked",
        avatarUrl: user?.avatarUrl,
        hasPin: lock.hasPin,
    };

    const firstName = entry.name.split(/\s+/)[0];
    const links = (
        <>
            <div className={styles.rowlinks}>
                {lock.hasPin ? (
                    <button type="button" className={styles.pinlink} disabled={busy}
                        onClick={() => { setUsePassword((on) => !on); setError(""); setTyped(""); }}>
                        {usePassword ? "Use PIN" : "Use password"}
                    </button>
                ) : <span />}
                <button type="button" className={styles.pinlink} disabled={busy}
                    onClick={() => void signOutFully(lock.lockedAt)}>
                    Not {firstName}? Switch person
                </button>
            </div>
            <div className={styles.rowlinks}>
                <button type="button" className={styles.pinlink} disabled={busy}
                    onClick={() => { setChoosingPin(true); setError(""); setTyped(""); }}>
                    {lock.hasPin ? "Change PIN" : "Set a PIN"}
                </button>
            </div>
        </>
    );

    // The greeting, the date and the shop's next opening — the sign-in card's head.
    const head = (
        <>
            <h1 className={styles.greet}>{greet}</h1>
            <p className={styles.clock}>{clock || " "}</p>
            <NextOpening />
        </>
    );

    return (
        <div
            ref={coverRef}
            role="dialog"
            aria-modal="true"
            aria-label="Counter locked"
            className={`${styles.root} ${backdrop ? styles.blobsOut : ""}`}
            style={{ position: "fixed", inset: 0, zIndex: 2147483000, minHeight: 0 }}
        >
            <div className={styles.bg} />
            <div
                className={`${styles.bgphoto} ${backdrop ? styles.bgphotoIn : ""}`}
                style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
            />
            <div className={styles.scrim} style={{ background: `rgba(2, 6, 23, ${LOGIN_SCRIM})` }} />
            <div className={styles.stage}>
            {/* The till's own card, as on the sign-in screen: next duty, today, the drawer. */}
            <TillCard locked />
            {choosingPin ? (
                <ChoosePinCard
                    hasPin={lock.hasPin}
                    counterNumber={counterNumber}
                    saveLabel="Save and unlock"
                    skipLabel="Back"
                    // The PIN route has just checked this password — it lifts the cover too.
                    // A refused unlock then shows on the ordinary card, not on this one.
                    onDone={(pw) => {
                        setChoosingPin(false);
                        void refreshCounterLock();
                        void tryUnlock({ password: pw });
                    }}
                    onSkip={() => { setChoosingPin(false); setError(""); }}
                />
            ) : passwordMode ? (
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
                    note={busy ? "Unlocking…" : `Locked for ${firstName} — enter your ${PIN_LENGTH}-digit PIN`}
                    error={error}
                    onPress={press}
                    onDelete={() => setTyped((t) => t.slice(0, -1))}
                    header={head}
                >
                    {links}
                </PinPad>
            )}
            </div>
        </div>
    );
}
