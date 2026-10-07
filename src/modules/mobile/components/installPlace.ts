"use client";

import { useEffect, useState } from "react";

/** useSyncExternalStore subscribe for values that never change during a visit. */
export const noSubscribe = () => () => {};

/** "installed" | "iphone" | "android" | "browser" on the phone; "server" while rendering on the server. */
export function readPlace(): string {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as { standalone?: boolean }).standalone === true
        // The customer app (shop-app/, TWA) opens its first page with this referrer.
        || document.referrer.startsWith("android-app://");
    // The staff app (phone-app/, Capacitor) is a WebView, not "standalone" — it
    // says so through its own global.
    const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (standalone || native) return "installed";
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return "iphone";
    return /Android/i.test(navigator.userAgent) ? "android" : "browser";
}

/**
 * Is the APK actually on the site? It is built by hand after a deploy, so a
 * fresh deploy can be without it — never offer a download that 404s.
 * null while asking. A HEAD on a static file: no DB, browser-cached.
 */
export function useApkAvailable(apk: string, ask: boolean): boolean | null {
    const [ok, setOk] = useState<boolean | null>(null);
    useEffect(() => {
        if (!ask) return;
        let live = true;
        fetch(apk, { method: "HEAD" })
            .then((r) => { if (live) setOk(r.ok); })
            .catch(() => { if (live) setOk(false); });
        return () => { live = false; };
    }, [apk, ask]);
    return ok;
}
