"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";

/** Chrome's install event — not in the DOM typings. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Install app" on the phone app's Home — one tap from the QR to an installed app.
 *
 * Android Chrome: it holds Chrome's `beforeinstallprompt` and shows a button that
 * opens Chrome's own Install confirm (only offered over https — the live office
 * site, not the shop Wi-Fi test address). iPhone has no such event, so it shows the
 * two steps instead. Hidden once running as the installed app.
 */
const noSubscribe = () => () => {};
/** "browser" | "iphone" | "installed" on the phone; "server" while rendering on the server. */
function readPlace(): string {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return "installed";
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "iphone" : "browser";
}

export default function InstallAppButton() {
    const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
    const [justInstalled, setJustInstalled] = useState(false);
    const place = useSyncExternalStore(noSubscribe, readPlace, () => "server");
    const installed = justInstalled || place === "installed" || place === "server";
    const iphone = place === "iphone";

    useEffect(() => {
        const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
        const onInstalled = () => { setJustInstalled(true); setPrompt(null); };
        window.addEventListener("beforeinstallprompt", onPrompt);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onPrompt);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    if (installed) return null;
    if (prompt) {
        return (
            <button
                type="button"
                onClick={() => { void prompt.prompt(); void prompt.userChoice.then(() => setPrompt(null)); }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary py-3 font-medium text-primary active:bg-primary/10"
            >
                <Download className="size-5" /> Install app on this phone
            </button>
        );
    }
    if (iphone) {
        return (
            <p className="rounded-xl border p-3 text-sm text-muted-foreground">
                To install: tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>.
            </p>
        );
    }
    return null;
}
