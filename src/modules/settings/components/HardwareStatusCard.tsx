"use client";

/**
 * "Is the hardware this counter is pointed at actually there?" — the one line the
 * cashier needs on a device settings page, plus the poll that keeps it honest.
 *
 * Printer settings and QR display settings had a byte-identical copy of both; a
 * third device would have made three. Only the noun and the "nothing chosen yet"
 * hint differ, so those are the props.
 */

import { useCallback, useRef, useState } from "react";
import { Loader2, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/shared/hooks";

/** What every bridge module's probe answers with. */
export interface HardwareProbe {
    connected: boolean;
    /** What we looked for — an IP:port, a COM port, or a Windows printer name. */
    target: string;
    detail: string;
}

/**
 * Runs `probe` on mount, then every 10s while the tab is visible, and again the
 * moment it becomes visible — which is when someone has just been at the hardware.
 * A minimised counter PC spawns nothing, which matters: a probe walks real devices
 * (wmic / SerialPort.list / a TCP connect), it is not a free call.
 *
 * `loading` is the page's own first-load flag, so the card shows one spinner rather
 * than flickering between two.
 */
export function useHardwareProbe(probe: () => Promise<HardwareProbe>, loading: boolean) {
    const [result, setResult] = useState<HardwareProbe | null>(null);
    const [probing, setProbing] = useState(false);
    // The poll, the refresh button and the post-save re-check must not stack.
    const inFlight = useRef(false);

    const run = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setProbing(true);
        try {
            setResult(await probe());
        } catch {
            setResult(null); // Bridge itself unreachable — the notice on the page covers that.
        } finally {
            inFlight.current = false;
            setProbing(false);
        }
    }, [probe]);

    usePolling(run, 10_000);

    // Spinner only until the first answer arrives. The background poll re-probes with a
    // result already on screen, and swapping that for "Checking…" every 10s would read
    // as a fault where there is none.
    return { result, probing, checking: loading || (probing && !result), refresh: run };
}

export function HardwareStatusCard({
    noun,
    probe,
    probing,
    checking,
    onRefresh,
    emptyHint,
}: {
    /** "Printer", "Display" — used in every line of copy. */
    noun: string;
    probe: HardwareProbe | null;
    probing: boolean;
    checking: boolean;
    onRefresh: () => void;
    /** Shown when nothing is configured yet, e.g. "Choose a COM port below, then Save." */
    emptyHint: string;
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 text-sm min-w-0">
                {checking ? (
                    <Loader2 size={16} className="animate-spin text-muted-foreground mt-0.5" />
                ) : probe?.connected ? (
                    <CheckCircle size={16} className="text-green-600 mt-0.5" />
                ) : (
                    <XCircle size={16} className="text-destructive mt-0.5" />
                )}
                <div className="min-w-0">
                    <p className={probe?.connected ? "text-green-700 font-medium" : "text-destructive font-medium"}>
                        {checking
                            ? `Checking ${noun.toLowerCase()}…`
                            // Nothing chosen yet, or the bridge could not answer at all —
                            // either way there is no device to call connected.
                            : !probe || !probe.target
                                ? `${noun} not selected`
                                : probe.connected
                                    ? `${noun} connected — ${probe.target}`
                                    : `${noun} not connected — ${probe.target}`}
                    </p>
                    {!checking && (
                        <p className="text-xs text-muted-foreground truncate">
                            {probe?.detail ?? emptyHint}
                        </p>
                    )}
                </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={probing}>
                <RefreshCw size={14} />
            </Button>
        </div>
    );
}
