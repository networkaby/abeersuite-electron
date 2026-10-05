"use client";

import { useEffect } from "react";

/** What the Android app (phone-app/, Capacitor) puts on window — nothing in a browser. */
type CapacitorGlobal = {
    isNativePlatform?: () => boolean;
    Plugins?: { SplashScreen?: { hide: () => Promise<void> } };
};

/**
 * Runs once on every phone-app page.
 *   • Inside the Android app: drops the launch screen the moment the page is drawn
 *     (it would otherwise wait out its 4 s fallback).
 *   • Everywhere: asks for persistent storage, so Android never clears the saved
 *     answers and catalogues in Dexie under storage pressure. Chrome grants it to an
 *     installed app; a plain tab may be refused, which changes nothing.
 */
export default function NativeAppReady() {
    useEffect(() => {
        const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
        if (cap?.isNativePlatform?.()) void cap.Plugins?.SplashScreen?.hide().catch(() => {});
        void navigator.storage?.persist?.().catch(() => false);
    }, []);
    return null;
}
