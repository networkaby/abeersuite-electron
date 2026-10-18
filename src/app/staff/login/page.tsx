"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup, reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { refreshCounterStatus } from "@/shared/hooks/useCounterMode";
import { refreshSyncStatus } from "@/shared/hooks/useSyncStatus";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { OUTSIDE_COUNTER_SIGNIN_CODE, PIN_LENGTH } from "@/shared/lib/constants/session";
import { isPhoneAppPath, PHONE_APP_FORGOT, PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { isPhoneOnlySession } from "@/shared/lib/auth/phoneOnly";
import {
    LOGIN_BACKGROUNDS,
    LOGIN_MODULES,
    LOGIN_ROTATE_SECONDS,
    LOGIN_SCRIM,
    LOGIN_SHOP_MESSAGE,
    LOGIN_SPOTLIGHTS,
    LOGIN_TAGLINE,
    LOGIN_TIPS,
} from "@/shared/lib/constants/loginShowcase";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";
import FaceGrid from "./FaceGrid";
import TillCard from "./TillCard";
import { useBackdropPhoto } from "./useBackdropPhoto";
import NextOpening from "./NextOpening";
import ChoosePinCard from "./ChoosePinCard";
import PinPad from "./PinPad";
import { useLocalClock } from "./useLocalClock";
import DesktopSiteNotice from "@/modules/mobile/components/DesktopSiteNotice";
import { ShiftTakeoverDialog, type CounterTakeover } from "@/modules/pos/components/ShiftTakeoverDialog";
import { fetchCounterTakeover } from "@/modules/pos/lib/currentShift";
import { readShellRoster, type ShellRosterEntry } from "@/shared/lib/counter/shellRoster";

/** Why a right password still did not open the app here: not a counter, and no
 *  "Can login outside counter". Said by the server's refusal and by the check after
 *  sign-in alike. */
function outsideCounterMessage(electron: boolean): string {
    return electron
        ? "This PC is not set up as a counter yet. Only a user with 'Can login outside counter' permission can sign in here to set it up."
        : "The office website is for office staff only. Sign in on a counter, or ask admin for 'Can login outside counter' — or 'Can use Mobile App' for the phone app.";
}

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
 * Can this person use their PIN on this counter now? `/api/counter-pin/status`:
 * "ready", "password-due", "left", "none" — or null when it could not be asked
 * (offline from an older server, not a counter).
 */
async function counterPinState(email: string): Promise<string | null> {
    try {
        const res = await fetch("/api/counter-pin/status", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
        });
        if (!res.ok) return null;
        const out = await res.json() as { state?: string };
        return out.state ?? null;
    } catch {
        return null;
    }
}

/** Does a PIN exist here — so the face card knows, and "Set PIN" reads "Change PIN". */
async function hasCounterPin(email: string): Promise<boolean> {
    const state = await counterPinState(email);
    return state === "ready" || state === "password-due";
}

/** The phone-app sign-in shows no photograph — it costs mobile data for nothing. */
const NO_PHOTOS: readonly string[] = [];

function StaffLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/office/work-flow-inbox";
    // Signing in for the staff phone app: the light, thumb-sized card (`.phone` in
    // login.module.css), no photo, no counter tips, no way out to the customer portal.
    const phoneApp = isPhoneAppPath(callbackUrl.split("?")[0]);
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
    const [pending, setPending] = useState<{ dest: string; password: string; hasPin: boolean; isCounter: boolean } | null>(null);

    // Somebody else's drawer on this counter, found on the way in. The app stays
    // shut behind it: Accept goes to POS as the drawer's new owner, Reject signs
    // out and the drawer waits for the next person.
    const [takeover, setTakeover] = useState<CounterTakeover | null>(null);

    // ── The sequence ────────────────────────────────────────────────────────
    //
    //   faces ──tap a face with a live PIN──→ keypad ──4 digits──→ signed in
    //     ↑   └─tap, no PIN / password due──→ password ──sign in──→ signed in
    //     └── Pick your photo / Back ─────────┘          (if Set PIN was pressed) └──→ choosePin
    //
    // The same names as `resources/shell/login.html`, which paints before this page
    // exists and hands a tapped face over; this page owns them for every OTHER arrival
    // — a sign-out, an expiry, a released counter, a proxy bounce.
    //
    // The PIN signs in on this counter inside its two clocks (owner, 2026-10-15:
    // "respect the 4-digit PIN even on a fresh boot"); past them, the password once.
    // `choosePin` is only after a password: a PIN cannot be set before anyone is in.
    const [stage, setStage] = useState<"faces" | "keypad" | "password" | "choosePin">("password");
    const [roster, setRoster] = useState<ShellRosterEntry[]>([]);
    const [chosen, setChosen] = useState<ShellRosterEntry | null>(null);
    // The digits live in a ref as well as state: keys can arrive faster than React
    // re-renders, and a press reading a stale `typed` would drop digits.
    const [typed, setTypedState] = useState("");
    const typedRef = useRef("");
    const setTyped = useCallback((next: string | ((was: string) => string)) => {
        typedRef.current = typeof next === "function" ? next(typedRef.current) : next;
        setTypedState(typedRef.current);
    }, []);
    const [padError, setPadError] = useState("");
    const [editing, setEditing] = useState(false);
    const [counterNumber, setCounterNumber] = useState<number | null>(null);

    const spotlight = useRotation(LOGIN_SPOTLIGHTS.length, LOGIN_ROTATE_SECONDS);
    const tip = useRotation(LOGIN_TIPS.length, LOGIN_ROTATE_SECONDS);
    const { greet, clock } = useLocalClock();
    const backdrop = useBackdropPhoto(phoneApp ? NO_PHOTOS : LOGIN_BACKGROUNDS);

    /**
     * Into the app — unless another cashier's drawer is waiting on this counter.
     *
     * `replace`, never `push`, on every way out of this page: pushed, the sign-in screen
     * sat in the window's history right behind the first page, so that page's Back / Esc
     * (`router.back()` on every voucher) landed on the faces screen while still signed
     * in. Counter 23, 2026-09-29: locked with a Sales voucher open, back in by PIN, and
     * the voucher's Back went to the lock screen.
     */
    const enter = useCallback(async (dest: string, isCounter: boolean) => {
        const t = isCounter ? await fetchCounterTakeover() : null;
        if (t) { setTakeover(t); setLoading(false); return; }
        router.replace(dest);
    }, [router]);

    /**
     * `kind` picks the provider, and nothing else changes: the counter reconciliation,
     * the released-PC reset and the "login outside counter" rule below run the same for
     * both, and both end with the identical session (authorizeStaff.ts).
     */
    const doSignIn = useCallback(async (
        emailValue: string,
        secret: string,
        setPin = false,
        kind: "password" | "pin" = "password",
    ) => {
        setLoading(true);
        setError("");
        setPadError("");

        const res = kind === "pin"
            ? await signIn("credentials-staff-pin", { email: emailValue, pin: secret, redirect: false })
            : await signIn("credentials-staff", { email: emailValue, password: secret, redirect: false });

        if (res?.error && kind === "pin") {
            // Wrong digits — or, since the face was tapped, the clocks ran out or the
            // tries did. Ask once more which, so the screen says the right thing.
            const state = await counterPinState(emailValue);
            if (state === "ready") {
                setPadError("That PIN is not right.");
            } else {
                setStage("password");
                setError(state === "left"
                    ? "No longer on the staff list."
                    : "Too many wrong PINs, or a few days since your password — type your password once.");
            }
            setLoading(false);
            return;
        }

        if (res?.error && res.code === OUTSIDE_COUNTER_SIGNIN_CODE) {
            // The password was right; the server refused because this is not a counter
            // and the person lacks "Can login outside counter" (authorizeStaff.ts).
            setError(outsideCounterMessage(isElectronEnvironment()));
            setStage("password");
            setLoading(false);
        } else if (res?.error) {
            // A PC with no counter has an empty replica, so the user lookup goes to the
            // cloud — offline, that fails and reads as a wrong password. Say what it is:
            // this machine must be online to bind a counter before it can sign in offline.
            const unbound = isElectronEnvironment() && !(await getLocalCounterSetup());
            setError(unbound
                ? "Sign-in failed. This PC is not set up as a counter yet, so it needs the internet to sign in and bind a counter. Check the connection, or the email and password."
                : "Invalid email or password");
            setStage("password");
            setLoading(false);
        } else {
            const dest = callbackUrl.startsWith("/") ? callbackUrl : "/office/work-flow-inbox";

            // Wake the two status stores. Both back off to a day-long tick while nobody
            // is signed in (their endpoints 401), and login navigates with router.replace —
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
            // online, the replica when offline). The office website is never a
            // counter: browser tills through the legacy bridge were retired once the
            // desktop app took the counters over, so the website is for office staff.
            const electron = isElectronEnvironment();
            let isCounter = false;
            if (electron) {
                // A PC with no local file short-circuits to "not-set-up" without fetching.
                const status = await reconcileCounterSetup(true);
                // Released: reset the PC — no counter, no local data (replicaWipe.ts).
                if (status === "released") await window.electronAPI?.clearCounterSetup?.();
                // "unreachable" — the replica could not answer; trust the file, the
                // readiness gate keeps the app covered until it can.
                isCounter = status === "valid" || status === "unreachable";
            }

            // ── Not a counter: only "login outside counter" may proceed ─────────
            // The server already refused a sign-in without it (authorizeStaff.ts);
            // this catches the one case it cannot see — a desktop PC whose counter
            // was released, which it still reads as a counter until the file above
            // is cleared. On the desktop app this is also who may onboard a fresh
            // PC — setting up a counter is an office action, not a cashier's.
            if (!isCounter) {
                // A phone-only sign-in (auth/phoneOnly.ts) — the server let it in for
                // the phone app alone, so that is where it goes.
                if (isPhoneOnlySession(session?.user)) {
                    router.replace(isPhoneAppPath(dest.split("?")[0]) ? dest : PHONE_APP_HOME);
                    return;
                }
                const perms = (session?.user as { permissions?: string[] })?.permissions ?? [];
                if (!hasPermissionWithScope(perms, PERMISSIONS.AUTH_LOGIN_OUTSIDE_COUNTER)) {
                    await signOut({ redirect: false });
                    setError(outsideCounterMessage(electron));
                    setLoading(false);
                    return;
                }
                // Desktop app with no counter: onboarding, online only.
                if (electron) {
                    router.replace(`/setup/counter?next=${encodeURIComponent(dest)}`);
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
                    // Signed in BY a PIN is proof of one.
                    hasPin: kind === "pin" || await hasCounterPin(emailValue),
                }).catch(() => { /* a missing face costs nothing */ });
            }

            // Asked for a PIN: stop here rather than navigating. They are signed in —
            // the session is real — but the app waits behind this card until they have
            // chosen their four digits or said no.
            if (setPin && kind === "password") {
                setCounterNumber((await getLocalCounterSetup())?.counterNumber ?? null);
                setPending({ dest, password: secret, hasPin: await hasCounterPin(emailValue), isCounter });
                setStage("choosePin");
                setLoading(false);
                return;
            }

            await enter(dest, isCounter);
        }
    }, [callbackUrl, router, enter]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await doSignIn(email, password, wantsPin);
    };

    // ── A face was tapped: the keypad, or their password with the email filled in ──
    // The status is asked first — a local round trip on a counter — so the screen goes
    // straight to the right card: the keypad, or the password with the reason why.
    const tapFace = useCallback(async (entry: ShellRosterEntry) => {
        setError("");
        setPadError("");
        setTyped("");
        setEmail(entry.email);
        setChosen(entry);
        const state = await counterPinState(entry.email);
        if (state === "left") {
            // HR marked them as left. The card goes (same as the shell's Forget — a
            // cache, nothing more), and the screen says so once.
            void window.electronAPI?.forgetShellUser?.(entry.email).catch(() => { });
            setRoster((was) => was.filter((r) => r.email !== entry.email));
            setChosen(null);
            setEmail("");
            setStage("faces");
            setError(`${entry.name} is no longer on the staff list.`);
        } else if (state === "ready" || (state === null && entry.hasPin)) {
            setStage("keypad");
        } else {
            setStage("password");
            if (state === "password-due") {
                setError("A few days since your password — type it once, and your PIN works again.");
            }
        }
    }, [setTyped]);

    // ── Credentials typed on the counter's sign-in shell ────────────────────────
    // The desktop app shows its own sign-in screen off disk while Postgres and this
    // server are still starting (electron/main.ts, resources/shell/login.html), so the
    // cashier types during the boot instead of watching it. Main parks what they typed
    // — or only the email of a tapped photograph, for the keypad here — and navigates
    // here; this picks it up and carries on.
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
    // Once, and only once: without this guard a rebuilt `doSignIn` ran the effect
    // again, re-read the roster and threw the screen back to the photographs.
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

            if (held?.password) {
                setEmail(held.email);
                setPassword(held.password);
                void doSignIn(held.email, held.password, held.setPin === true);
                return;
            }

            // Nobody was handed over — a sign-out, an expiry, a release, a bounce — or
            // only a tapped photograph. This is where the photographs matter most.
            const list = await readShellRoster();
            setRoster(list);
            const tapped = held?.email ? list.find((r) => r.email === held.email) : undefined;
            if (tapped) { void tapFace(tapped); return; }
            if (held?.email) setEmail(held.email);
            if (list.length > 0) setStage("faces");
        })();
    }, [doSignIn, tapFace]);

    // ── The keypad ─────────────────────────────────────────────────────────────
    // The fourth digit goes straight out and the dots empty with it, so a refused PIN
    // is already waiting on a clean pad.
    const press = useCallback((digit: string) => {
        if (loading || !chosen) return;
        setPadError("");
        const next = typedRef.current + digit;
        if (next.length >= PIN_LENGTH) {
            setTyped("");
            void doSignIn(chosen.email, next.slice(0, PIN_LENGTH), false, "pin");
        } else {
            setTyped(next);
        }
    }, [loading, chosen, doSignIn, setTyped]);

    // The number row and the numpad both work — a cashier who reaches for the keyboard
    // should not have to go back to the mouse.
    useEffect(() => {
        if (stage !== "keypad") return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key >= "0" && e.key <= "9") { press(e.key); e.preventDefault(); }
            else if (e.key === "Backspace") { setTyped((t) => t.slice(0, -1)); e.preventDefault(); }
            else if (e.key === "Escape") { setChosen(null); setPadError(""); setStage("faces"); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [stage, press, setTyped]);

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
        <div className={`${styles.root} ${backdrop ? styles.blobsOut : ""} ${phoneApp ? styles.phone : ""}`}>
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
            {phoneApp && <div className={styles.phoneNotice}><DesktopSiteNotice /></div>}

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

                {/* The till's own card: next duty, the day just finished and whose
                    drawer is on this counter. Counter PCs only; renders nothing
                    the rest of the time. */}
                <TillCard />

                {takeover && (
                    <ShiftTakeoverDialog
                        takeover={takeover}
                        rejectLabel="Reject & sign out"
                        onAccepted={() => router.replace("/vouchers/pos/new")}
                        onReject={() => {
                            void signOut({ redirect: false }).then(() => {
                                setTakeover(null);
                                setPending(null);
                                setPassword("");
                                setStage(roster.length ? "faces" : "password");
                            });
                        }}
                    />
                )}

                {stage === "faces" ? (
                    <section className={styles.card}>
                        <h1 className={styles.greet}>{greet}</h1>
                        <p className={styles.clock}>{clock || "\u00a0"}</p>
                        <NextOpening />
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
                        length={PIN_LENGTH}
                        typed={typed}
                        note={loading ? "Signing in…" : `Enter your ${PIN_LENGTH}-digit PIN`}
                        error={padError}
                        onPress={press}
                        onDelete={() => setTyped((t) => t.slice(0, -1))}
                        header={<><h1 className={styles.greet}>{greet}</h1><p className={styles.clock}>{clock || " "}</p></>}
                    >
                        <div className={styles.rowlinks}>
                            <button type="button" className={styles.pinlink} disabled={loading} onClick={backToFaces}>
                                Not {chosen.name.split(/\s+/)[0]}? Pick your photo
                            </button>
                            <button type="button" className={styles.pinlink} disabled={loading}
                                onClick={() => { setPadError(""); setTyped(""); setStage("password"); }}>
                                Use password
                            </button>
                        </div>
                    </PinPad>
                ) : pending ? (
                    <ChoosePinCard
                        hasPin={pending.hasPin}
                        counterNumber={counterNumber}
                        // The password they typed a moment ago — nothing asked twice.
                        password={pending.password}
                        saveLabel="Save and open"
                        skipLabel="Skip for now"
                        onDone={() => void enter(pending.dest, pending.isCounter)}
                        onSkip={() => void enter(pending.dest, pending.isCounter)}
                    />
                ) : (
                <form className={styles.card} onSubmit={handleSubmit} autoComplete="on">
                    {/* Plain <img>: a single-path vector has nothing for the optimizer to
                        re-encode, and the shell shows the same mark inlined. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <span className={styles.logo}><img src="/logo.svg" alt={COMPANY_DETAILS.brandName} /></span>

                    {phoneApp ? (
                        <>
                            <h1 className={styles.greet}>{COMPANY_DETAILS.brandName} Staff</h1>
                            <p className={styles.clock}>{greet}. Sign in to continue.</p>
                        </>
                    ) : (
                        <>
                            <h1 className={styles.greet}>{greet}</h1>
                            <p className={styles.clock}>{clock || " "}</p>
                        </>
                    )}
                    <NextOpening />

                    <div className={styles.field}>
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="name@networkservice.in"
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
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

                    {/* Desktop only — a counter PIN means nothing on the website. Pressed
                        before signing in, so all it can do is ask; the panel opens on
                        the other side. "Pick your photo" goes back to the faces whenever
                        this PC has any — the same pair as the shell. */}
                    <div className={styles.rowlinks}>
                        {roster.length > 0 ? (
                            <button type="button" className={styles.pinlink} onClick={backToFaces}>
                                Pick your photo
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

                    {/* The tips are counter keys and scanners — nothing on a phone. */}
                    {!phoneApp && (
                        <div className={styles.status}>
                            <p className={`${styles.tip} ${tip.fading ? "" : styles.tipIn}`}>
                                {LOGIN_TIPS[tip.index]}
                            </p>
                            <p className={styles.shopmsg}>{LOGIN_SHOP_MESSAGE}</p>
                        </div>
                    )}

                    <p className={styles.customer}>
                        <Link href={phoneApp ? PHONE_APP_FORGOT : "/staff/forgot-password"}>Forgot password?</Link>
                        {/* Signing in for the staff phone app: no way out to the
                            customer portal from inside the app. */}
                        {!phoneApp && <>{" · "}Customer? <Link href="/login">Sign in here</Link></>}
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
