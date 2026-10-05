"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Download } from "lucide-react";
import { PHONE_APP_APK, PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Chrome's install event — not in the DOM typings. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const noSubscribe = () => () => {};

/** "installed" | "iphone" | "android" | "browser" on the phone; "server" while rendering on the server. */
function readPlace(): string {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as { standalone?: boolean }).standalone === true;
    // The Android app (phone-app/, Capacitor) is a WebView, not "standalone" — it
    // says so through its own global.
    const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (standalone || native) return "installed";
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return "iphone";
    return /Android/i.test(navigator.userAgent) ? "android" : "browser";
}

/**
 * The install page's one job — the closest a web page may come to "install from a
 * QR": phones never let a site install itself, so the best is one tap here and the
 * phone's own Install confirm.
 *   • Android: the APK (the `android/` wrapper) → "Download NS Staff", then the
 *     phone's own steps; Chrome's `beforeinstallprompt` stays as the second way.
 *   • iPhone: no such event — the two Share steps.
 *   • already the installed app, or just installed: "Open app".
 *   • no install offer (an http test address, another browser): open in Chrome,
 *     ⋮ → Install app — plus "Open app" to use it in the browser meanwhile.
 * Used ONLY on the install page; the app itself shows no install prompt (owner).
 */
export default function InstallAppButton({ appName }: { appName: string }) {
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    // Already installed on this device, while this page is open in the browser.
    const [installedHere, setInstalledHere] = useState(false);
    const place = useSyncExternalStore(noSubscribe, readPlace, () => "server");

    useEffect(() => {
        // The install page's inline script catches Chrome's offer (it may fire before
        // this runs) and keeps it on window; take it from there, now or when it comes.
        const w = window as { __installPrompt?: InstallPromptEvent };
        const take = () => { if (w.__installPrompt) setPrompt(w.__installPrompt); };
        const onInstalled = () => { setInstalled(true); setPrompt(null); };
        take();
        // Chrome only (manifest `related_applications`): is the app installed here?
        const nav = navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> };
        void nav.getInstalledRelatedApps?.().then((apps) => { if (apps.length > 0) setInstalledHere(true); }).catch(() => {});
        window.addEventListener("install-offer", take);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("install-offer", take);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const installFromChrome = (offer: InstallPromptEvent) => {
        void offer.prompt();
        void offer.userChoice.then((c) => { if (c.outcome === "accepted") setInstalled(true); setPrompt(null); });
    };

    const openApp = (
        <Link href={PHONE_APP_HOME} className="block w-full rounded-xl border py-3 text-center font-medium active:bg-muted">
            Open app
        </Link>
    );

    if (place === "server") return null;
    if (!installed && place !== "installed" && installedHere && !prompt) {
        return (
            <div className="space-y-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">You are in the browser</p>
                <p className="flex items-center justify-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-5" /> {appName} is already installed on this device.
                </p>
                <p className="text-sm text-muted-foreground">Open it from your home screen (or apps list).</p>
                {openApp}
            </div>
        );
    }
    if (installed || place === "installed") {
        return (
            <div className="space-y-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {place === "installed" ? "You are in the installed app" : "Just installed"}
                </p>
                <p className="flex items-center justify-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-5" /> {place === "installed" ? <>This is <b>{appName}</b>.</> : <>Installed — open <b>{appName}</b> from your home screen.</>}
                </p>
                {openApp}
            </div>
        );
    }
    if (place === "android") {
        return (
            <div className="space-y-3">
                <a
                    href={PHONE_APP_APK}
                    download
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-semibold text-primary-foreground active:opacity-90"
                >
                    <Download className="size-6" /> Download {appName}
                </a>
                <ol className="list-decimal space-y-1 rounded-xl border p-4 pl-8 text-sm">
                    <li>Open the downloaded file (Chrome shows <b>Open</b>, or find it in <b>Downloads</b>).</li>
                    <li>If the phone asks, allow <b>Install unknown apps</b> for Chrome, then go back.</li>
                    <li>Tap <b>Install</b>, then <b>Open</b>, and sign in.</li>
                </ol>
                {prompt && (
                    <button
                        type="button"
                        onClick={() => installFromChrome(prompt)}
                        className="block w-full rounded-xl border py-3 text-center text-sm active:bg-muted"
                    >
                        Or add it from Chrome instead
                    </button>
                )}
            </div>
        );
    }
    if (prompt) {
        return (
            <button
                type="button"
                onClick={() => installFromChrome(prompt)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-semibold text-primary-foreground active:opacity-90"
            >
                <Download className="size-6" /> Install {appName}
            </button>
        );
    }
    if (place === "iphone") {
        return (
            <div className="space-y-3">
                <p className="rounded-xl border p-4 text-sm">
                    In <b>Safari</b>: tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>, then <b>Add</b>.
                </p>
                {openApp}
            </div>
        );
    }
    return (
        <div className="space-y-3">
            <p className="rounded-xl border p-4 text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">You are in the browser</span>
                Not installed yet? Use <b>Chrome</b> (not Incognito) on the live address, then <b>⋮</b> → <b>Install app</b>.
            </p>
            {openApp}
        </div>
    );
}
