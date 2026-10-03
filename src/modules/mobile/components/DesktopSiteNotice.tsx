"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

const DISMISSED_KEY = "phone-app:desktop-site-notice";

/** How much wider than the phone the page is drawn — 0 when it is not (or the
 *  note was closed), which is also the server's answer. */
function readScale(): number {
    try {
        if (sessionStorage.getItem(DISMISSED_KEY)) return 0;
    } catch { /* private mode — just show it */ }
    const ratio = window.innerWidth / window.screen.width;
    return window.screen.width < 600 && ratio > 1.5 ? ratio : 0;
}
function subscribe(onChange: () => void): () => void {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
}

/**
 * "Desktop site" is on — the phone is drawing the app ~980px wide and shrinking
 * it to fit, so everything looks tiny. The page cannot undo that (Chrome ignores
 * the viewport meta in that mode) and the switch is per site, shared with the
 * office: an admin who turns it on to reach the full office shrinks this app too.
 * So say how to turn it off.
 *
 * Told apart from a real wide screen by the screen itself: in Desktop mode the
 * layout is far wider than the phone (screen.width stays the phone's own width).
 * Text is scaled up by the same factor, so the note reads at a normal size on a
 * shrunk page. Closing it holds for the browser session.
 */
export default function DesktopSiteNotice() {
    const scale = useSyncExternalStore(subscribe, readScale, () => 0);
    const [closed, setClosed] = useState(false);
    if (!scale || closed) return null;

    const dismiss = () => {
        try { sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* fine */ }
        setClosed(true);
    };

    return (
        <div
            role="alert"
            className="flex items-start gap-3 bg-amber-100 px-4 py-3 text-amber-950 dark:bg-amber-900 dark:text-amber-50"
            style={{ fontSize: `${15 * scale}px`, lineHeight: 1.4 }}
        >
            <p className="flex-1">
                <b>Everything looks small?</b>{" "}&ldquo;Desktop site&rdquo; is on. Open the browser&rsquo;s
                &#8942; menu and untick <b>Desktop site</b>, then reopen the app.
            </p>
            <button type="button" onClick={dismiss} aria-label="Close" className="shrink-0">
                <X style={{ width: `${20 * scale}px`, height: `${20 * scale}px` }} />
            </button>
        </div>
    );
}
