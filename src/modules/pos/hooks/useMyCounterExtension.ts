"use client";

/**
 * useMyCounterExtension — which EPBX extension THIS PC sits at, without
 * needing a shift open.
 *
 * `PosCounter.boundDeviceId` is set once, on a counter's FIRST shift-open
 * (see ShiftOpenDialog), and persists after the shift closes — so "which
 * counter is this PC" is knowable long after anyone last opened one there.
 * We ask the local bridge for its stable per-PC deviceId, then look up which
 * counter (if any) is bound to it.
 *
 * Three states, not two: "unknown" (still resolving) is distinct from `null`
 * (resolved — no bridge running, or this PC isn't bound to any counter) so a
 * caller doesn't treat "haven't checked yet" as "checked, nothing found" and
 * flash into fallback mode for a moment on every page load.
 *
 * `null` is also the deliberate FALLBACK signal: no known extension means
 * "this PC's counter can't be determined right now" (bridge down, or simply
 * never bound) — callers should widen their scope rather than show nothing.
 */

import { useEffect, useState } from "react";
import axios from "axios";

const BRIDGE = "http://localhost:9191";

type Counter = { id: number; epbxExtension: string | null; boundDeviceId: string | null };

export function useMyCounterExtension(): string | null | "unknown" {
    const [extension, setExtension] = useState<string | null | "unknown">("unknown");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const cfgRes = await fetch(`${BRIDGE}/config`, { signal: AbortSignal.timeout(2000) });
                if (!cfgRes.ok) throw new Error("no bridge");
                const cfg: { deviceId?: string | null } = await cfgRes.json();
                if (!cfg.deviceId) throw new Error("bridge has no device id yet");

                const { data: counters } = await axios.get<Counter[]>("/api/pos/counters");
                if (cancelled) return;
                const mine = counters.find((c) => c.boundDeviceId === cfg.deviceId);
                setExtension(mine?.epbxExtension ?? null);
            } catch {
                // Bridge offline, or this PC isn't bound to a counter — resolved to
                // "unknown extension", not stuck forever in the "still checking" state.
                if (!cancelled) setExtension(null);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return extension;
}
