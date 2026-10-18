"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { CheckCircle2, Download } from "lucide-react";
import { PHONE_APP_APK, PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { noSubscribe, readPlace, useApkAvailable } from "@/modules/mobile/components/installPlace";
import { STAFF_APP_RELEASE, type AppRelease } from "@/shared/lib/constants/appVersions";

/** Chrome's install event — not in the DOM typings. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * The install page's one job — the closest a web page may come to "install from a
 * QR": phones never let a site install itself, so the best is one tap here and the
 * phone's own Install confirm.
 *   • Android: the APK (the staff or customer wrapper) → "Download …", then the
 *     phone's own steps; Chrome's `beforeinstallprompt` stays as the second way.
 *     No APK on the site yet (built by hand after a deploy) → Chrome's way only.
 *   • iPhone: no such event — the two Share steps.
 *   • already the installed app, or just installed: "Open app" — and, in Chrome on
 *     Android, the latest version's download too: the phone cannot tell this page
 *     WHICH version is installed, so an old one must still be able to update here.
 *   • no install offer (an http test address, another browser): open in Chrome,
 *     ⋮ → Install app — plus "Open app" to use it in the browser meanwhile.
 *   • `apkOnly` (customer app): with the APK on the site, no Chrome install as a
 *     second way — the real app only; Chrome's stays the fallback without it.
 *   • `qrOnComputer` (customer app): a computer gets a QR of this page to scan
 *     with the phone instead of the Chrome steps.
 * Used ONLY on the install pages (staff /m-staff-app/install, customer /app); the
 * apps themselves show no install prompt (owner).
 */
export default function InstallAppButton({
    appName,
    home = PHONE_APP_HOME,
    apk = PHONE_APP_APK,
    release = STAFF_APP_RELEASE,
    apkOnly = false,
    qrOnComputer = false,
}: {
    appName: string;
    /** "Open app" target — the staff app by default; the customer app passes its own. */
    home?: string;
    /** Android wrapper download. */
    apk?: string;
    /** The APK's version, named on the update button — the staff app's by default. */
    release?: AppRelease;
    /** Android with the APK: hide "Or add it from Chrome instead". */
    apkOnly?: boolean;
    /** A computer sees a QR of this page instead of the Chrome steps. */
    qrOnComputer?: boolean;
}) {
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    // Already installed on this device, while this page is open in the browser.
    const [installedHere, setInstalledHere] = useState(false);
    const place = useSyncExternalStore(noSubscribe, readPlace, () => "server");
    const apkOk = useApkAvailable(apk, place === "android");
    const [qr, setQr] = useState<string | null>(null);

    useEffect(() => {
        if (!qrOnComputer || place !== "browser") return;
        void QRCode.toDataURL(window.location.origin + window.location.pathname, { width: 240, margin: 1 })
            .then(setQr)
            .catch(() => {});
    }, [qrOnComputer, place]);

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
        <Link href={home} className="block w-full rounded-xl border py-3 text-center font-medium active:bg-muted">
            Open app
        </Link>
    );

    if (place === "server" || (place === "android" && apkOk === null)) return null;
    if (!installed && place !== "installed" && installedHere && !prompt) {
        return (
            <div className="space-y-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">You are in the browser</p>
                <p className="flex items-center justify-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-5" /> {appName} is already installed on this device.
                </p>
                <p className="text-sm text-muted-foreground">Open it from your home screen (or apps list).</p>
                {openApp}
                {place === "android" && apkOk && (
                    <>
                        <a
                            href={apk}
                            download
                            className="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium active:bg-muted"
                        >
                            <Download className="size-4" /> Download latest version {release.name}
                        </a>
                        <p className="text-xs text-muted-foreground">
                            Older version on the phone? Install this over it — you stay signed in.
                        </p>
                    </>
                )}
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
    if (place === "android" && apkOk) {
        return (
            <div className="space-y-3">
                <a
                    href={apk}
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
                {prompt && !apkOnly && (
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
    if (qrOnComputer && place === "browser") {
        return (
            <div className="space-y-3 text-center">
                {qr && (
                    // eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing to optimise
                    <img src={qr} alt={`QR code to get ${appName} on your phone`} width={240} height={240} className="mx-auto rounded-xl border bg-white p-2" />
                )}
                <p className="text-sm">
                    Scan with your <b>phone camera</b> to get the app on your phone.
                </p>
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
