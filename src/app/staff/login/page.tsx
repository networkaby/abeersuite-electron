"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup, isWebCounterBound, reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    LOGIN_MODULES,
    LOGIN_ROTATE_SECONDS,
    LOGIN_SHOP_MESSAGE,
    LOGIN_SPOTLIGHTS,
    LOGIN_TAGLINE,
    LOGIN_TIPS,
    loginGreeting,
} from "@/shared/lib/constants/loginShowcase";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";

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

function StaffLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/office/work-flow-inbox";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const spotlight = useRotation(LOGIN_SPOTLIGHTS.length, LOGIN_ROTATE_SECONDS);
    const tip = useRotation(LOGIN_TIPS.length, LOGIN_ROTATE_SECONDS);
    const { greet, clock } = useLocalClock();

    const doSignIn = useCallback(async (emailValue: string, passwordValue: string) => {
        setLoading(true);
        setError("");

        const res = await signIn("credentials-staff", {
            email: emailValue,
            password: passwordValue,
            redirect: false,
        });

        if (res?.error) {
            // A PC with no counter has an empty replica, so the user lookup goes to the
            // cloud — offline, that fails and reads as a wrong password. Say what it is:
            // this machine must be online to bind a counter before it can sign in offline.
            const unbound = isElectronEnvironment() && !(await getLocalCounterSetup());
            setError(unbound
                ? "Sign-in failed. This PC is not set up as a counter yet, so it needs the internet to sign in and bind a counter. Check the connection, or the email and password."
                : "Invalid email or password");
            setLoading(false);
        } else {
            const dest = callbackUrl.startsWith("/") ? callbackUrl : "/office/work-flow-inbox";

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
                const session = await getSession();
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

            router.push(dest);
        }
    }, [callbackUrl, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await doSignIn(email, password);
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
    useEffect(() => {
        const take = window.electronAPI?.takeShellCredentials;
        if (!take) return;
        let cancelled = false;
        void take().then((held) => {
            if (cancelled || !held) return;
            setEmail(held.email);
            setPassword(held.password);
            void doSignIn(held.email, held.password);
        }).catch(() => { /* nothing parked, or an older build — the form just waits */ });
        return () => { cancelled = true; };
    }, [doSignIn]);

    const spot = LOGIN_SPOTLIGHTS[spotlight.index];

    // The desktop app paints `resources/shell/login.html` before this page exists and
    // hands over the moment this paints. The two look the same on purpose — see the
    // header of `login.module.css`.
    return (
        <div className={styles.root}>
            <div className={styles.bg} />
            <div className={`${styles.blob} ${styles.b1}`} />
            <div className={`${styles.blob} ${styles.b2}`} />
            <div className={`${styles.blob} ${styles.b3}`} />
            <div className={styles.scrim} />
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
