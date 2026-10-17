"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppRelease } from "@/shared/lib/constants/appVersions";

/** Builds before the version was stamped into the user agent all carry versionCode 2. */
const UNSTAMPED_CODE = 2;
const LATER_MS = 24 * 60 * 60 * 1000;

/**
 * "New version available" for the sideloaded Android apps (no Play Store). The
 * shell appends `<uaTag>/<versionCode>` to its user agent (build-apk.ps1 stamps
 * capacitor.config.json); older than `release.code` → a bar with Download, or a
 * full-screen notice when `release.urgent`. Outside the app (no tag) → nothing.
 * No server call: the page compares against the constant it was built with.
 *
 * `apkUrl` is the app's own site written with a trailing dot (`office.networkservice.in.`):
 * the app's WebView cannot download a file, and Capacitor keeps a link to its own
 * host inside it — the dotted host reads as another host, so it opens in Chrome,
 * which can, while still being served by the app's own site (owner: staff app from
 * office, customer app from shop, no cross-site fallback). That site must be
 * deployed whenever its APK changes, or phones reinstall the old file in a loop.
 */
export default function AppUpdateBar({ uaTag, release, apkUrl }: { uaTag: string; release: AppRelease; apkUrl: string }) {
    const [show, setShow] = useState(false);
    const laterKey = `app-update-later:${uaTag}:${release.code}`;

    useEffect(() => {
        const m = navigator.userAgent.match(new RegExp(`${uaTag}(?:/(\\d+))?`));
        if (!m) return;
        const installed = m[1] ? Number(m[1]) : UNSTAMPED_CODE;
        if (installed >= release.code) return;
        if (!release.urgent) {
            try {
                if (Date.now() - Number(localStorage.getItem(laterKey) ?? 0) < LATER_MS) return;
            } catch { /* storage blocked — just show it */ }
        }
        setShow(true);
    }, [uaTag, release.code, release.urgent, laterKey]);

    if (!show) return null;

    const later = () => {
        try { localStorage.setItem(laterKey, String(Date.now())); } catch { /* fine */ }
        setShow(false);
    };
    const download = (
        <Button asChild size="sm" className="gap-1.5">
            <a href={apkUrl} target="_blank" rel="noopener">
                <Download className="size-4" /> Download update
            </a>
        </Button>
    );
    const help = "When it finishes, open the downloaded file and tap Install. You stay signed in.";

    if (release.urgent) {
        return (
            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
                <p className="text-lg font-semibold">Please update the app</p>
                <p className="text-sm text-muted-foreground">Version {release.name} is needed to keep using the app.</p>
                {download}
                <p className="text-xs text-muted-foreground">{help}</p>
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
            <div className="mt-2 flex gap-2">
                {download}
                <Button size="sm" variant="ghost" onClick={later}>Later</Button>
            </div>
        </div>
    );
}
