import { readLocalLock } from "@/shared/lib/auth/localLock";

/**
 * The lock cover's stand-in for the first paint (owner, 2026-10-13: "refresh
 * uncovers the lock screen for a second").
 *
 * The server sends the page's HTML before any script runs, and the real cover
 * (`CounterLock.tsx`) is a script — so a refreshed, locked till painted the app
 * first. This plain backdrop is drawn by the SERVER whenever the till's lock file
 * says locked, so the first paint is already covered. The real cover removes it
 * the moment it has an answer (it takes over, or the till says "not locked").
 *
 * Off a counter there is no lock file and this renders nothing. If no script ever
 * comes to remove it (a page without the cover), it fades on its own after a while
 * rather than leave a till stuck on a blank screen.
 */
export default function CounterLockVeil() {
    let locked = false;
    try { locked = readLocalLock() !== null; } catch { locked = false; }
    if (!locked) return null;

    return (
        <div
            id="counter-lock-veil"
            aria-hidden="true"
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483001,
                background: "radial-gradient(1200px 700px at 20% 10%, #0b2a6b 0%, transparent 60%), #0a0f24",
                animation: "counter-lock-veil-release 0s linear 20s forwards",
            }}
        >
            <style>{"@keyframes counter-lock-veil-release { to { visibility: hidden; } }"}</style>
        </div>
    );
}
