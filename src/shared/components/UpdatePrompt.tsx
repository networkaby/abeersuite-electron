"use client";

import { useEffect, useState } from "react";
import { usePosDraftStore } from "@/store/posDraftStore";
import type { UpdateState } from "../../../electron/preload";

/**
 * The visible half of auto-update. Renders nothing off Electron and nothing until an
 * update has finished downloading — the check and the download are silent.
 *
 * Policy lives in electron/updateManager.ts; this only shows its state and offers
 * "Restart now". What it adds of its own is the busy flag: the POS cart is a Zustand
 * singleton, so subscribing to it here covers Sale, Order and Estimate without touching
 * any POS screen. Main never restarts while the cart holds lines.
 *
 * Two looks, because two situations:
 *   quiet          A small card in the corner. It never installs on its own, so this card
 *                  is the only way in: "Later" hides it for LATER_HIDE_MS, then it comes
 *                  back, and staff may keep saying Later for good.
 *   urgent/schema  A blocking dialog with the countdown main is running. Nothing to
 *                  dismiss: the restart is coming, the choice is only "now" or "when
 *                  this bill is done".
 */

const LATER_KEY = "abeersuite:update-later";
/** About one shift: long enough not to nag, short enough that the card is seen again. */
const LATER_HIDE_MS = 8 * 60 * 60 * 1000;

/** "version|hide-until" → is the card for this version still hidden? */
function hiddenFor(saved: string | null, version: string, now: number): boolean {
    if (!saved) return false;
    const [v, until] = saved.split("|");
    return v === version && Number(until) > now;
}

function api() {
    if (typeof window === "undefined") return null;
    return window.electronAPI?.update ?? null;
}

function countdown(deadlineAt: number | null, now: number): string {
    if (deadlineAt === null) return "";
    const s = Math.max(0, Math.round((deadlineAt - now) / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

export default function UpdatePrompt() {
    const [state, setState] = useState<UpdateState | null>(null);
    const [later, setLater] = useState<string | null>(() => {
        try {
            return typeof window === "undefined" ? null : localStorage.getItem(LATER_KEY);
        } catch {
            return null; // No storage — the card simply stays.
        }
    });
    const [now, setNow] = useState(() => Date.now());
    const cartLines = usePosDraftStore((s) => s.cart.length);

    useEffect(() => {
        const u = api();
        if (!u) return;
        void u.getState().then(setState).catch(() => {});
        return u.onState(setState);
    }, []);

    useEffect(() => {
        void api()?.setBusy(cartLines > 0).catch(() => {});
    }, [cartLines]);

    const deadlineAt = state?.deadlineAt ?? null;
    useEffect(() => {
        if (deadlineAt === null) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [deadlineAt]);

    // Bring a "Later" card back when its hide runs out — a counter stays open for weeks.
    useEffect(() => {
        const until = Number(later?.split("|")[1]);
        if (!until) return;
        const t = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()) + 1000);
        return () => clearTimeout(t);
    }, [later]);

    if (!state || !state.version) return null;
    if (state.phase !== "ready" && state.phase !== "installing") return null;

    const installing = state.phase === "installing";
    const restartNow = () => void api()?.installNow().catch(() => {});

    if (state.tier === "quiet") {
        if (hiddenFor(later, state.version, now)) return null;
        return (
            <div
                role="status"
                className="fixed bottom-4 right-4 z-10000 w-80 rounded-lg border bg-background p-4 shadow-lg"
            >
                <p className="text-sm font-semibold">AbeerSuite {state.version} is ready</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {installing
                        ? "Restarting to install…"
                        : "Not urgent — it installs only when you choose. Restart when you are free."}
                </p>
                {!installing && (
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                            onClick={() => {
                                const saved = `${state.version}|${Date.now() + LATER_HIDE_MS}`;
                                setLater(saved);
                                try {
                                    localStorage.setItem(LATER_KEY, saved);
                                } catch {
                                    // Fine without it.
                                }
                            }}
                        >
                            Later
                        </button>
                        <button
                            type="button"
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            onClick={restartNow}
                        >
                            Restart now
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const schema = state.tier === "schema";
    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="update-prompt-title"
            className="fixed inset-0 z-10000 flex items-center justify-center bg-background/95 px-4 backdrop-blur-sm"
        >
            <div className="max-w-md space-y-3 text-center">
                <div
                    aria-hidden="true"
                    className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 border-destructive text-lg font-semibold text-destructive"
                >
                    !
                </div>
                <h2 id="update-prompt-title" className="text-lg font-semibold">
                    {schema ? "This counter must update to keep billing" : "An important update is ready"}
                </h2>
                <p className="text-sm text-muted-foreground">
                    {schema
                        ? `The office data has changed shape and this app is older than it. AbeerSuite ${state.version} fixes that; nothing can be saved until it is installed.`
                        : `AbeerSuite ${state.version} must be installed today. Finish the bill you are on, then restart.`}
                </p>
                <p className="font-mono text-xs text-foreground/80" aria-live="polite">
                    {installing
                        ? "Restarting to install…"
                        : cartLines > 0
                            ? `Waiting for this bill to finish · restarts anyway in ${countdown(state.deadlineAt, now)}`
                            : `Restarts on its own in ${countdown(state.deadlineAt, now)}`}
                </p>
                {!installing && (
                    <button
                        type="button"
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={restartNow}
                    >
                        Restart now
                    </button>
                )}
            </div>
        </div>
    );
}
