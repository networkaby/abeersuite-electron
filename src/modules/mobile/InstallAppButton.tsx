"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Download } from "lucide-react";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Chrome's install event — not in the DOM typings. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const noSubscribe = () => () => {};

/** "installed" | "iphone" | "browser" on the phone; "server" while rendering on the server. */
function readPlace(): string {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return "installed";
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "iphone" : "browser";
}

/**
 * The install page's one job — the closest a web page may come to "install from a
 * QR": phones never let a site install itself, so the best is one tap here and the
 * phone's own Install confirm.
 *   • Android Chrome: holds Chrome's `beforeinstallprompt` → "Install NS Staff".
 *   • iPhone: no such event — the two Share steps.
 *   • already the installed app, or just installed: "Open app".
 *   • no install offer (an http test address, another browser): open in Chrome,
 *     ⋮ → Install app — plus "Open app" to use it in the browser meanwhile.
 * Used ONLY on the install page; the app itself shows no install prompt (owner).
 */
export default function InstallAppButton({ appName }: { appName: string }) {
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    const place = useSyncExternalStore(noSubscribe, readPlace, () => "server");

    useEffect(() => {
        const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
        const onInstalled = () => { setInstalled(true); setPrompt(null); };
        window.addEventListener("beforeinstallprompt", onPrompt);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onPrompt);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const openApp = (
        <Link href={PHONE_APP_HOME} className="block w-full rounded-xl border py-3 text-center font-medium active:bg-muted">
            Open app
        </Link>
    );

    if (place === "server") return null;
    if (installed || place === "installed") {
        return (
            <div className="space-y-3 text-center">
                <p className="flex items-center justify-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-5" /> Installed — open <b>{appName}</b> from your home screen.
                </p>
                {openApp}
            </div>
        );
    }
    if (prompt) {
        return (
            <button
                type="button"
                onClick={() => { void prompt.prompt(); void prompt.userChoice.then((c) => { if (c.outcome === "accepted") setInstalled(true); setPrompt(null); }); }}
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
                Open this page in <b>Chrome</b>, then tap <b>⋮</b> → <b>Install app</b>. (Installing needs the live https address — the shop Wi-Fi test address only opens in the browser.)
            </p>
            {openApp}
        </div>
    );
}
