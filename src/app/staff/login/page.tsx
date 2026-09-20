"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup, isWebCounterBound, reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { refreshCounterStatus } from "@/shared/hooks/useCounterMode";
import { refreshSyncStatus } from "@/shared/hooks/useSyncStatus";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    LOGIN_BACKGROUNDS,
    LOGIN_MODULES,
    LOGIN_ROTATE_SECONDS,
    LOGIN_SCRIM,
    LOGIN_SHOP_MESSAGE,
    LOGIN_SPOTLIGHTS,
    LOGIN_TAGLINE,
    LOGIN_TIPS,
    loginGreeting,
} from "@/shared/lib/constants/loginShowcase";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";
import FaceGrid from "./FaceGrid";
import PinPad from "./PinPad";
import { readShellRoster, type ShellRosterEntry } from "@/shared/lib/counter/shellRoster";

/**
 * Rotates through a list on a fixed beat, fading out and back in.
 *
 * The order is rotating, not random, so every entry gets seen — the same rule
 * the shell follows. It starts on index 0 and only moves in an effect, so the
 * server and the first client render agree and there is no hydration mismatch.
 */
function useRotation(length: number, seconds: number): { index: number; fading: boolean } {
    const [index, setIndex] = useState(0);
    const [fading, setFading] = useState(false);

    useEffect(() => {
        if (length < 2) return;
        const timer = setInterval(() => {
            setFading(true);
            // Long enough for the .45s fade-out to finish before the text swaps.
            setTimeout(() => {
                setIndex((i) => (i + 1) % length);
                setFading(false);
            }, 460);
        }, Math.max(2, seconds) * 1000);
        return () => clearInterval(timer);
    }, [length, seconds]);

    return { index, fading };
}

/**
 * The backdrop photo — tried in order, first one that loads wins.
 *
 * Nothing waits on it. The drawn CSS background is already a finished screen, so
 * a photo that is slow or never arrives costs a photograph, not a blank page.
 * It is loaded through an `Image` rather than set straight on the layer so the
 * fade only starts once the picture is actually decoded — half a photo sliding
 * in looks worse than none.
 */
function useBackdropPhoto(candidates: readonly string[]): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let at = 0;
        const tryNext = () => {
            if (cancelled || at >= candidates.length) return;
            const candidate = candidates[at++];
            const img = new Image();
            img.onload = () => { if (!cancelled) setUrl(candidate); };
            img.onerror = tryNext;
            img.src = candidate;
        };
        tryNext();
        return () => { cancelled = true; };
    }, [candidates]);

    return url;
}

// ── The clock, as an outside thing React reads ──────────────────────────────
// The time is not React state — it is the machine's clock — so it is subscribed
// to rather than copied into state. Ticking every twenty seconds is plenty for a
// display that only shows minutes, and the snapshot is the minute itself so a
// tick that lands inside the same minute re-renders nothing.
function subscribeToMinute(onChange: () => void): () => void {
    const timer = setInterval(onChange, 20_000);
    return () => clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
/** The server has no idea what time it is where the user is, so it renders no clock at all. */
const noMinuteOnServer = () => null;

/** The greeting and the clock line, both from the user's own machine. */
function useLocalClock(): { greet: string; clock: string } {
    const minute = useSyncExternalStore(subscribeToMinute, currentMinute, noMinuteOnServer);
    if (minute === null) return { greet: "Welcome", clock: "" };

    const now = new Date(minute * 60_000);
    return {
        greet: loginGreeting(now.getHours()),
        clock: now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
            + " · " + now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
}

/**
 * Does this person have a live PIN on this counter?
 *
 * Only so the shell knows whether to put a keypad up next time. Silent on every
 * failure — off a counter, offline, or on an older server the answer is simply "no
 * keypad", which costs one typed password and never a sign-in.
 */
async function hasCounterPin(email: string): Promise<boolean> {
    try {
        const res = await fetch("/api/counter-pin/status", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
        });
        if (!res.ok) return false;
        const out = await res.json() as { state?: string };
        // "password-due" still means a PIN exists — the card should show, and the
        // shell asks again when it is tapped.
        return out.state === "ready" || out.state === "password-due";
    } catch {
        return false;
    }
}

/** A PIN box takes digits and nothing else — six of them. */
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);

function StaffLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/office/work-flow-inbox";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    // Asked for on the way in, acted on the moment they are in — a PIN cannot be set
    // by somebody who has not proved who they are yet.
    const [wantsPin, setWantsPin] = useState(false);
    const isDesktop = isElectronEnvironment();

    // ── The PIN step ────────────────────────────────────────────────────────
    // Setting a PIN happens HERE, on the sign-in card, before the app opens —
    // outside the office, before anyone enters the house. It is the right place for
    // two reasons beyond looks: the password is still in hand, so nothing has to be
    // asked twice, and a cashier never has to go hunting through a settled app for
    // something they only ever want on their way in.
    //
    // `pending` holds the finished sign-in until the step is done with — the session
    // is real from this moment, only the navigation waits.
    const [pending, setPending] = useState<{ dest: string; password: string; hasPin: boolean } | null>(null);

    // ── The sequence ────────────────────────────────────────────────────────
    //
    //   faces ──tap a face with a PIN──→ keypad ──6 digits──→ signed in
    //     ↑                                │ Back / Escape
    //     │ Login with PIN                 └──────→ faces
    //     │
    //   password ──sign in──→ signed in ──(if Set PIN was pressed)──→ choosePin
    //
    // The same four names, in the same order, as `resources/shell/login.html`. The shell
    // paints these before this page exists and hands over; this page owns them for every
    // OTHER arrival — a sign-out, a session expiry, a released counter, a proxy bounce —
    // which is every arrival but one. Before this, all of those put a cashier in front of
    // a bare email box on a PC that had a photograph of them on disk.
    //
    // `choosePin` is only here: a PIN cannot be set before anyone is signed in.
    const [stage, setStage] = useState<"faces" | "keypad" | "password" | "choosePin">("password");
    const [roster, setRoster] = useState<ShellRosterEntry[]>([]);
    const [chosen, setChosen] = useState<ShellRosterEntry | null>(null);
    const [padNote, setPadNote] = useState("Enter your 6-digit PIN");
    const [padError, setPadError] = useState("");
    const [editing, setEditing] = useState(false);
    const [pin, setPin] = useState("");
    const [pinAgain, setPinAgain] = useState("");
    const [pinBusy, setPinBusy] = useState(false);
    const [pinError, setPinError] = useState("");
    const [counterNumber, setCounterNumber] = useState<number | null>(null);

    const spotlight = useRotation(LOGIN_SPOTLIGHTS.length, LOGIN_ROTATE_SECONDS);
    const tip = useRotation(LOGIN_TIPS.length, LOGIN_ROTATE_SECONDS);
    const { greet, clock } = useLocalClock();
    const backdrop = useBackdropPhoto(LOGIN_BACKGROUNDS);

    /**
     * `kind` picks the provider, and nothing else changes.
     *
     * A PIN buys a faster way to prove who you are, never a shorter way in: the
     * counter reconciliation, the released-PC reset and the "login outside counter"
     * rule below run exactly the same for both, and both end up with the identical
     * session (see shared/lib/auth/authorizeStaff.ts).
     */
    const doSignIn = useCallback(async (
        emailValue: string,
        secret: string,
        kind: "password" | "pin" = "password",
        setPin = false,
    ) => {
        setLoading(true);
        setError("");

        const res = kind === "pin"
            ? await signIn("credentials-staff-pin", { email: emailValue, pin: secret, redirect: false })
            : await signIn("credentials-staff", { email: emailValue, password: secret, redirect: false });

        if (res?.error) {
            // A PC with no counter has an empty replica, so the user lookup goes to the
            // cloud — offline, that fails and reads as a wrong password. Say what it is:
            // this machine must be online to bind a counter before it can sign in offline.
            const unbound = isElectronEnvironment() && !(await getLocalCounterSetup());
            const message = unbound
                ? "Sign-in failed. This PC is not set up as a counter yet, so it needs the internet to sign in and bind a counter. Check the connection, or the email and password."
                : kind === "pin"
                    ? "That PIN is not right."
                    : "Invalid email or password";
            // A refused PIN goes back to the KEYPAD with the reason — not to a bare
            // password box, which is where it used to land with the keypad and the
            // photograph gone.
            if (kind === "pin" && !unbound && chosen) {
                setPadError(message);
                setStage("keypad");
            } else {
                setError(message);
                setStage("password");
            }
            setLoading(false);
        } else {
            const dest = callbackUrl.startsWith("/") ? callbackUrl : "/office/work-flow-inbox";

            // Wake the two status stores. Both back off to a day-long tick while nobody
            // is signed in (their endpoints 401), and login navigates with router.push —
            // the React tree survives, so nothing would otherwise tell them the answer
            // has changed and a counter's badge would stay dark until the next tab focus.
            refreshCounterStatus();
            refreshSyncStatus();

            // One read, two readers: the permission gate below and the face roster at
            // the end. getSession() is a round trip — asking twice on the slowest
            // screen of the day would waste the seconds this feature exists to save.
            const session = await getSession();

            // ── Is this machine a counter? ──────────────────────────────────────
            // Desktop app: the local file plus the counter row (one DB read when
            // online, the replica when offline). Web version: is the local bridge's id
            // bound to a counter in the DB. The two ids are never cross-matched.
            const electron = isElectronEnvironment();
            let isCounter: boolean;
            if (electron) {
                // A PC with no local file short-circuits to "not-set-up" without fetching.
                const status = await reconcileCounterSetup(true);
                // Released: reset the PC — no counter, no local data (replicaWipe.ts).
                if (status === "released") await window.electronAPI?.clearCounterSetup?.();
                // "unreachable" — the replica could not answer; trust the file, the
                // readiness gate keeps the app covered until it can.
                isCounter = status === "valid" || status === "unreachable";
            } else {
                isCounter = await isWebCounterBound();
            }

            // ── Not a counter: only "login outside counter" may proceed ─────────
            // Same rule for both versions. On the desktop app this is also who may
            // onboard a fresh PC — setting up a counter is an office action, not a
            // cashier's.
            if (!isCounter) {
                const perms = (session?.user as { permissions?: string[] })?.permissions ?? [];
                if (!hasPermissionWithScope(perms, PERMISSIONS.AUTH_LOGIN_OUTSIDE_COUNTER)) {
                    await signOut({ redirect: false });
                    setError(electron
                        ? "This PC is not set up as a counter yet. Only a user with 'Can login outside counter' permission can sign in here to set it up."
                        : "This machine is not a counter. Contact admin to grant 'Can login outside counter' permission.");
                    setLoading(false);
                    return;
                }
                // Desktop app with no counter: onboarding, online only.
                if (electron) {
                    router.push(`/setup/counter?next=${encodeURIComponent(dest)}`);
                    return;
                }
            }

            // ── Leave a face on the sign-in screen for next time ────────────────
            // The shell has no server and no session, so what it knows about a person
            // it learns here, on the way past. Local to this PC, best-effort, and a
            // convenience only — see electron/main.ts's roster helpers.
            const remember = window.electronAPI?.rememberShellUser;
            if (remember && session?.user) {
                const u = session.user as {
                    name?: string | null; title?: string; avatarUrl?: string;
                    seats?: { title: string; scope: string }[];
                };
                void remember({
                    email: emailValue.trim().toLowerCase(),
                    name: u.name || emailValue,
                    // `User.title` is free text and is null for every person in the real
                    // books, so the seats below are what actually print. It still wins
                    // when somebody types one in.
                    title: u.title,
                    seats: u.seats,
                    avatarUrl: u.avatarUrl,
                    // Signed in BY a PIN is proof of one. Otherwise ask the server, so a
                    // PIN set yesterday still puts a keypad up tomorrow.
                    hasPin: kind === "pin" || await hasCounterPin(emailValue),
                }).catch(() => { /* a missing face costs nothing */ });
            }

            // Asked for a PIN: stop here rather than navigating. They are signed in —
            // the session is real — but the app waits behind this card until they have
            // chosen their six digits or said no. Only ever reached from the password
            // path, which is the only one that can prove who they are again.
            if (setPin && kind === "password") {
                setCounterNumber((await getLocalCounterSetup())?.counterNumber ?? null);
                setPending({ dest, password: secret, hasPin: await hasCounterPin(emailValue) });
                setStage("choosePin");
                setLoading(false);
                return;
            }

            router.push(dest);
        }
        // `chosen` is read in the failure branch to decide whether a refused PIN goes
        // back to the keypad. Without it here, that branch closes over a stale null and
        // the cashier is dropped on the password form — the very thing being fixed.
    }, [callbackUrl, router, chosen]);

    /** Save the six digits, then let the app open. */
    const savePin = async () => {
        if (!pending) return;
        if (pin !== pinAgain) { setPinError("The two PINs are not the same."); return; }
        setPinBusy(true);
        setPinError("");
        try {
            const res = await fetch("/api/me/counter-pin", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                // The password they typed a moment ago. The route asks for it because a
                // PIN is a second key to this account, and an unattended till with a
                // session open must not be enough to cut one.
                body: JSON.stringify({ pin, password: pending.password }),
            });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setPinError(out.error || "Could not save your PIN."); return; }
            router.push(pending.dest);
        } catch {
            setPinError("Could not reach the office. A PIN can only be saved with the line up.");
        } finally {
            setPinBusy(false);
        }
    };

    const removePin = async (scope: "counter" | "all") => {
        if (!pending) return;
        setPinBusy(true);
        setPinError("");
        try {
            const res = await fetch(`/api/me/counter-pin?scope=${scope}`, { method: "DELETE" });
            const out = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) { setPinError(out.error || "Could not remove your PIN."); return; }
            router.push(pending.dest);
        } catch {
            setPinError("Could not reach the office. A PIN can only be removed with the line up.");
        } finally {
            setPinBusy(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await doSignIn(email, password, "password", wantsPin);
    };

    // ── Credentials typed on the counter's sign-in shell ────────────────────────
    // The desktop app shows its own sign-in screen off disk while Postgres and this
    // server are still starting (electron/main.ts, resources/shell/login.html), so the
    // cashier types during the boot instead of watching it. Main parks what they typed
    // and navigates here; this picks it up and runs the ordinary sign-in.
    //
    // It has to land HERE rather than main signing in directly, because everything
    // below the signIn call — the counter reconciliation, the released-PC reset, the
    // "login outside counter" rule — is this page's job and must not be skipped.
    //
    // Read-once on main's side, so a failed sign-in leaves the cashier at this form
    // with the error, and their retry is typed here.
    //
    // ONE effect, in order, on purpose. The parked credentials are asked for first and
    // the photographs only after: two effects racing here would sometimes paint a grid
    // underneath a sign-in that was already running, which is a flicker with no meaning.
    // Once, and only once. `doSignIn` is rebuilt whenever `chosen` changes — which is
    // every tap on a face — and without this guard the effect ran again, re-read the
    // roster and threw the screen straight back to the photographs. The credentials are
    // read-once on main's side anyway, so a second run could never do anything useful.
    //
    // No cancellation flag alongside it, deliberately. React runs an effect twice in
    // development — mount, clean up, mount — and a guard that blocks the second run
    // while the first run's cleanup cancels its own work leaves NOTHING running at all:
    // the photographs simply never appeared. A late setState on an unmounted component
    // is harmless here; an effect that silently does nothing is not.
    const handedOver = useRef(false);
    useEffect(() => {
        if (handedOver.current) return;
        handedOver.current = true;
        void (async () => {
            const held = await window.electronAPI?.takeShellCredentials?.().catch(() => null);

            if (held) {
                setEmail(held.email);
                // Exactly one of the two is ever set. A PIN is never put in the password
                // box: it would be shown by the peek button and submitted to the wrong
                // provider on a retry.
                if (held.pin) {
                    setChosen((await readShellRoster()).find((r) => r.email === held.email) ?? null);
                    void doSignIn(held.email, held.pin, "pin");
                    return;
                }
                if (held.password) {
                    setPassword(held.password);
                    void doSignIn(held.email, held.password, "password", held.setPin === true);
                    return;
                }
            }

            // Nobody was handed over — a sign-out, an expiry, a release, a bounce. This
            // is where the photographs matter most, and where there were none before.
            const list = await readShellRoster();
            if (list.length === 0) return;
            setRoster(list);
            setStage("faces");
        })();
    }, [doSignIn]);

    // ── The keypad's own sign-in ────────────────────────────────────────────
    const tapFace = useCallback(async (entry: ShellRosterEntry) => {
        setChosen(entry);
        setPadError("");
        setPadNote("Enter your 6-digit PIN");
        setError("");
        setEmail(entry.email);
        if (!entry.hasPin) { setStage("password"); return; }
        setStage("keypad");

        // Is that PIN still live? Unlike the shell — whose `file://` origin cannot reach
        // the server at all — this page is served over http and can simply ask.
        try {
            const res = await fetch("/api/counter-pin/status", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: entry.email }),
            });
            const out = res.ok ? await res.json() as { state?: string } : null;
            if (out?.state === "password-due") {
                setStage("password");
                setError("Password time — it has been a few days. Your PIN keeps working after this.");
            } else if (out?.state === "none") {
                setStage("password");
            } else if (out?.state === "left") {
                // HR marked this person as left. The card goes (same as the shell's
                // Forget — a cache, nothing more), and the screen says so once
                // rather than refusing a correct PIN in silence.
                void window.electronAPI?.forgetShellUser?.(entry.email).catch(() => { });
                setRoster((was) => was.filter((r) => r.email !== entry.email));
                setChosen(null);
                setEmail("");
                setStage("faces");
                setError(`${entry.name} is no longer on the staff list.`);
            }
        } catch {
            /* offline or not a counter — the sign-in itself is the real check */
        }
    }, []);

    const forgetFace = useCallback((entry: ShellRosterEntry) => {
        void window.electronAPI?.forgetShellUser?.(entry.email).catch(() => { });
        setRoster((was) => {
            const left = was.filter((r) => r.email !== entry.email);
            if (left.length === 0) setStage("password");
            return left;
        });
    }, []);

    const backToFaces = useCallback(() => {
        setChosen(null);
        setPadError("");
        setError("");
        setStage("faces");
    }, []);

    const spot = LOGIN_SPOTLIGHTS[spotlight.index];

    // The desktop app paints `resources/shell/login.html` before this page exists and
    // hands over the moment this paints. The two look the same on purpose — see the
    // header of `login.module.css`.
    return (
        <div className={`${styles.root} ${backdrop ? styles.blobsOut : ""}`}>
            <div className={styles.bg} />
            <div className={`${styles.blob} ${styles.b1}`} />
            <div className={`${styles.blob} ${styles.b2}`} />
            <div className={`${styles.blob} ${styles.b3}`} />
            <div
                className={`${styles.bgphoto} ${backdrop ? styles.bgphotoIn : ""}`}
                style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
            />
            <div className={styles.scrim} style={{ background: `rgba(2, 6, 23, ${LOGIN_SCRIM})` }} />
            <div className={styles.readscrim} />

            <div className={styles.stage}>

                <section className={styles.side}>
                    <p className={styles.tagline}>{LOGIN_TAGLINE}</p>
                    <div className={`${styles.spot} ${spotlight.fading ? styles.fade : ""}`}>
                        <h2>{spot.head}</h2>
                        <p>{spot.body}</p>
                    </div>
                    <div className={styles.mods}>
                        {LOGIN_MODULES.map((name) => <span key={name}>{name}</span>)}
                    </div>
                </section>

                {stage === "faces" ? (
                    <section className={styles.card}>
                        <h1 className={styles.greet}>{greet}</h1>
                        <p className={styles.clock}>{clock || "\u00a0"}</p>
                        <FaceGrid
                            roster={roster}
                            editing={editing}
                            onChoose={(entry) => void tapFace(entry)}
                            onForget={forgetFace}
                            onOther={() => { setEmail(""); setError(""); setStage("password"); }}
                            onEdit={() => setEditing((on) => !on)}
                        />
                    </section>
                ) : stage === "keypad" && chosen ? (
                    <PinPad
                        entry={chosen}
                        note={padNote}
                        error={padError}
                        busy={loading}
                        onSubmit={(pin) => void doSignIn(chosen.email, pin, "pin")}
                        onBack={backToFaces}
                        onUsePassword={() => { setEmail(chosen.email); setPadError(""); setStage("password"); }}
                    />
                ) : pending ? (
                    <section className={styles.card}>
                        <h1 className={styles.greet}>
                            {pending.hasPin ? "Change your PIN" : "Choose your PIN"}
                        </h1>
                        <p className={styles.clock}>
                            Six digits{counterNumber !== null ? `, for counter ${counterNumber} only` : ""}.
                            Tomorrow you just tap your photo.
                        </p>

                        <div className={styles.field}>
                            <label htmlFor="pin">{pending.hasPin ? "New PIN" : "PIN"}</label>
                            <input
                                id="pin" type="password" inputMode="numeric" autoComplete="off"
                                placeholder="6 digits" autoFocus
                                value={pin}
                                onChange={(e) => { setPin(digitsOnly(e.target.value)); setPinError(""); }}
                            />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="pin2">Type it again</label>
                            <input
                                id="pin2" type="password" inputMode="numeric" autoComplete="off"
                                placeholder="6 digits"
                                value={pinAgain}
                                onChange={(e) => { setPinAgain(digitsOnly(e.target.value)); setPinError(""); }}
                                onKeyDown={(e) => { if (e.key === "Enter" && pin.length === 6) void savePin(); }}
                            />
                        </div>

                        <button
                            className={styles.go} type="button"
                            disabled={pinBusy || pin.length !== 6 || pinAgain.length !== 6}
                            onClick={() => void savePin()}
                        >
                            {pinBusy ? "Saving…" : "Save and open"}
                        </button>
                        {pinError && <p className={styles.err}>{pinError}</p>}

                        {/* Removing is the same errand, so it lives on the same card —
                            there is nowhere else to do it now, and nowhere else needed. */}
                        {pending.hasPin && (
                            <div className={styles.pinrow}>
                                <button type="button" className={styles.pinlink} disabled={pinBusy}
                                    onClick={() => void removePin("counter")}>
                                    Remove from this counter
                                </button>
                                <button type="button" className={styles.pinlink} disabled={pinBusy}
                                    onClick={() => void removePin("all")}>
                                    Remove from all
                                </button>
                            </div>
                        )}

                        <button type="button" className={styles.pinlink} disabled={pinBusy}
                            onClick={() => router.push(pending.dest)}>
                            Skip for now
                        </button>

                        <p className={styles.pinnote}>
                            The line must be up to save a PIN. Using one later works offline, and your
                            password is still asked for every few days.
                        </p>
                    </section>
                ) : (
                <form className={styles.card} onSubmit={handleSubmit} autoComplete="on">
                    {/* Plain <img>: a single-path vector has nothing for the optimizer to
                        re-encode, and the shell shows the same mark inlined. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <span className={styles.logo}><img src="/logo.svg" alt={COMPANY_DETAILS.brandName} /></span>

                    <h1 className={styles.greet}>{greet}</h1>
                    <p className={styles.clock}>{clock || " "}</p>

                    <div className={styles.field}>
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="name@networkservice.in"
                            autoComplete="username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="pass">Password</label>
                        <input
                            id="pass"
                            name="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Your password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <button
                            className={styles.peek}
                            type="button"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            onClick={() => setShowPassword((s) => !s)}
                        >
                            {showPassword ? "Hide" : "Show"}
                        </button>
                    </div>

                    <button className={styles.go} type="submit" disabled={loading}>
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                    {error && <p className={styles.err}>{error}</p>}

                    {/* Desktop only — six digits mean nothing on the website. Pressed
                        before signing in, so all it can do is ask; the panel opens on
                        the other side. */}
                    {/* TWO controls, never one link doing both jobs — the same pair as
                        the shell. "Login with PIN" is offered whenever this PC has any,
                        never conditional on who holds a PIN: that condition is what made
                        this a dead end. */}
                    <div className={styles.rowlinks}>
                        {roster.length > 0 ? (
                            <button type="button" className={styles.pinlink} onClick={backToFaces}>
                                Login with PIN
                            </button>
                        ) : <span />}
                        {isDesktop && (
                            <button
                                type="button"
                                className={styles.pinlink}
                                onClick={() => setWantsPin((on) => !on)}
                            >
                                {wantsPin ? "Set PIN after signing in ✓" : "Set PIN"}
                            </button>
                        )}
                    </div>

                    <div className={styles.status}>
                        <p className={`${styles.tip} ${tip.fading ? "" : styles.tipIn}`}>
                            {LOGIN_TIPS[tip.index]}
                        </p>
                        <p className={styles.shopmsg}>{LOGIN_SHOP_MESSAGE}</p>
                    </div>

                    <p className={styles.customer}>
                        Customer? <Link href="/login">Sign in here</Link>
                    </p>
                </form>
                )}

            </div>

            <p className={styles.meta}>AbeerSuite</p>
        </div>
    );
}

export default function StaffLoginPage() {
    return (
        <Suspense
            // Same navy as the screen itself, so the wait is never a white flash between
            // the desktop shell handing over and this page painting.
            fallback={<div className={styles.root} />}
        >
            <StaffLoginForm />
        </Suspense>
    );
}
