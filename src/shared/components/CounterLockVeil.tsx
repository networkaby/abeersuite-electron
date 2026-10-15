import { readLocalLock } from "@/shared/lib/auth/localLock";

/**
 * The lock cover's stand-in for the first paint (owner, 2026-10-13: "refresh
 * uncovers the lock screen for a second").
 *
 * The server sends the page's HTML before any script runs, and the real cover
 * (`CounterLock.tsx`) is a script — so a refreshed, locked till painted the app
 * first. This plain backdrop is drawn by the SERVER whenever the till's lock file
 * says locked, so the first paint is already covered. The real cover reads it the
 * moment its script loads (`counterLock.ts`) and puts the keypad up straight away,
 * without waiting for the till's answer (owner, 2026-10-16: "it takes time to load").
 *
 * It fails CLOSED: on a page that has the real cover it never lifts on its own — a
 * slow till keeps the cover up, never shows the work. Only a page without the cover
 * (no `__counterLockMounted`) lets it fade, so a till is not stuck on a blank screen.
 *
 * Off a counter there is no lock file and this renders nothing.
 */
export default function CounterLockVeil() {
    let locked = false;
    try { locked = readLocalLock() !== null; } catch { locked = false; }
    if (!locked) return null;

    return (
        <div
            id="counter-lock-veil"
            data-locked="1"
            aria-hidden="true"
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 2147483001,
                background: "radial-gradient(1200px 700px at 20% 10%, #0b2a6b 0%, transparent 60%), #0a0f24",
            }}
        >
            <script
                dangerouslySetInnerHTML={{
                    __html: "setTimeout(function(){if(!window.__counterLockMounted){var v=document.getElementById('counter-lock-veil');if(v)v.style.display='none';}},20000);",
                }}
            />
        </div>
    );
}
