"use client";

import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppRelease } from "@/shared/lib/constants/appVersions";

/** Builds before the version was stamped into the user agent all carry versionCode 2. */
const UNSTAMPED_CODE = 2;
const LATER_MS = 24 * 60 * 60 * 1000;
/** useSyncExternalStore subscribe for values that never change during a visit. */
const noSubscribe = () => () => {};

/** The installed app's versionCode from its user agent; null outside the app. */
function installedAppCode(uaTag: string): number | null {
    const m = navigator.userAgent.match(new RegExp(`${uaTag}(?:/(\\d+))?`));
    if (!m) return null;
    return m[1] ? Number(m[1]) : UNSTAMPED_CODE;
}

/** The staff app's in-app updater (phone-app, NsUpdatePlugin.java) — absent in older
 *  builds, the customer app and a browser. */
type NativeUpdate = {
    install: (o: { path: string }) => Promise<void>;
    addListener: (event: "progress", cb: (e: { percent: number }) => void) => Promise<{ remove: () => Promise<void> }>;
};
const nativeUpdate = (): NativeUpdate | null =>
    (window as { Capacitor?: { Plugins?: { NsUpdate?: NativeUpdate } } }).Capacitor?.Plugins?.NsUpdate ?? null;

/**
 * The download tap. With the app's own updater: download inside the app, then
 * Android's Install screen — `status` says how far it got. Without it: nothing
 * here, the link opens `installUrl` in Chrome. A failed in-app download keeps the
 * Chrome page on hand (`failed`).
 */
function useAppUpdate(release: AppRelease, apk: string) {
    const native = useSyncExternalStore(noSubscribe, () => nativeUpdate() !== null, () => false);
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const start = async (e: MouseEvent) => {
        const updater = nativeUpdate();
        if (!updater) return; // the link does it
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setFailed(false);
        setStatus("Downloading…");
        const sub = await updater.addListener("progress", ({ percent }) => setStatus(`Downloading… ${percent}%`)).catch(() => null);
        try {
            await updater.install({ path: `${apk}?v=${release.code}` });
            setStatus("Tap Install on the next screen. You stay signed in.");
        } catch (err) {
            const { code, message } = err as { code?: string; message?: string };
            if (code === "permission") {
                setStatus("Allow this app to install apps (the switch on the screen that opened), come back and tap Update now again.");
            } else {
                setFailed(true);
                setStatus(`${message || "Download failed"}.`);
            }
        } finally {
            setBusy(false);
            void sub?.remove();
        }
    };
    return { native, status, busy, failed, start };
}

/**
 * "New version available" for the sideloaded Android apps (no Play Store). The
 * shell appends `<uaTag>/<versionCode>` to its user agent (build-apk.ps1 stamps
 * capacitor.config.json); older than `release.code` → a bar with Download, or a
 * full-screen notice when `release.urgent`. Outside the app (no tag) → nothing.
 * No server call: the page compares against the constant it was built with.
 *
 * Staff app from 2.3.0 (versionCode 6): "Update now" downloads `apk` inside the app
 * and opens Android's Install screen (NsUpdatePlugin) — no Chrome. Older builds and
 * the customer app have no updater, so they fall back to `installUrl`.
 *
 * `installUrl` is the app's install page on its own site written with a trailing dot
 * (`office.networkservice.in./m-staff-app/install`): the app's WebView cannot
 * download a file, and Capacitor keeps a link to its own host inside it — the dotted
 * host reads as another host, so it opens in Chrome, while still being served by the
 * app's own site (owner: staff app from office, customer app from shop, no cross-site
 * fallback). The page, not the raw APK: Chrome handed a bare .apk from another app
 * left the download stuck (owner, 2026-10-24) — no open page for its "keep this
 * file?" question — while the same tap on the install page, the fresh-install path,
 * always worked. That site must be deployed whenever its APK changes, or phones
 * reinstall the old file in a loop.
 */
export default function AppUpdateBar({ uaTag, release, installUrl, apk }: { uaTag: string; release: AppRelease; installUrl: string; apk: string }) {
    const [dismissed, setDismissed] = useState(false);
    const update = useAppUpdate(release, apk);
    const laterKey = `app-update-later:${uaTag}:${release.code}`;
    // Read once per visit, never on the server — the user agent and a "Later" tap
    // from an earlier visit do not change while the page is open.
    const due = useSyncExternalStore(noSubscribe, () => {
        const installed = installedAppCode(uaTag);
        if (installed === null || installed >= release.code) return false;
        if (release.urgent) return true;
        try {
            return Date.now() - Number(localStorage.getItem(laterKey) ?? 0) >= LATER_MS;
        } catch { return true; /* storage blocked — just show it */ }
    }, () => false);

    if (!due || dismissed) return null;

    const later = () => {
        try { localStorage.setItem(laterKey, String(Date.now())); } catch { /* fine */ }
        setDismissed(true);
    };
    const download = (
        <Button asChild size="sm" className="gap-1.5">
            <a href={installUrl} target="_blank" rel="noopener" onClick={update.start} aria-disabled={update.busy}>
                <Download className="size-4" /> {update.native ? "Update now" : "Download update"}
            </a>
        </Button>
    );
    const help = update.status ?? (update.native
        ? "Downloads inside the app, then tap Install. You stay signed in."
        : "Chrome opens the download page: tap Download, open the file and tap Install. You stay signed in.");
    const fallback = update.failed && (
        <a href={installUrl} target="_blank" rel="noopener" className="text-xs font-medium text-primary underline">
            Download from Chrome instead
        </a>
    );

    if (release.urgent) {
        return (
            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
                <p className="text-lg font-semibold">Please update the app</p>
                <p className="text-sm text-muted-foreground">Version {release.name} is needed to keep using the app.</p>
                {download}
                <p className="text-xs text-muted-foreground">{help}</p>
                {fallback}
            </div>
        );
    }
    return (
        <div className="fixed inset-x-0 top-0 z-[100] border-b bg-primary/10 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">New version {release.name} available</p>
                    <p className="text-xs text-muted-foreground">{help}</p>
                </div>
                <button onClick={later} className="text-muted-foreground" aria-label="Later">
                    <X className="size-4" />
                </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
                {download}
                <Button size="sm" variant="ghost" onClick={later}>Later</Button>
                {fallback}
            </div>
        </div>
    );
}

/**
 * One quiet line — "App build 2 · latest 2.1.0" — so anyone can see at a glance
 * whether this phone is up to date, with the download always on hand when it is
 * not (even after "Later" hid the bar). Shown only inside the app.
 */
export function AppVersionLine({ uaTag, release, installUrl, apk }: { uaTag: string; release: AppRelease; installUrl: string; apk: string }) {
    const installed = useSyncExternalStore(noSubscribe, () => installedAppCode(uaTag), () => null);
    const update = useAppUpdate(release, apk);
    if (installed === null) return null;
    const old = installed < release.code;
    return (
        <p className="py-3 text-center text-xs text-muted-foreground">
            App build {installed} · latest {release.name} (build {release.code})
            {old ? (
                <> · <a href={installUrl} target="_blank" rel="noopener" onClick={update.start} className="font-medium text-primary underline">{update.native ? "Update now" : "Download update"}</a></>
            ) : " · up to date"}
            {update.status && <span className="block">{update.status}</span>}
            {update.failed && (
                <a href={installUrl} target="_blank" rel="noopener" className="block font-medium text-primary underline">Download from Chrome instead</a>
            )}
        </p>
    );
}
