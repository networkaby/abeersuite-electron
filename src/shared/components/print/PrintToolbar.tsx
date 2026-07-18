"use client";

// Unified print toolbar — the SINGLE toolbar for every printable document
// (except barcode labels / QR cards, which keep their own real-size browser
// print). Implements the house print rule:
//
//   1. Thermal print ALWAYS tries the combined bridge (relay on :9191) first.
//   2. On bridge offline / failure → fall back to the browser print dialog.
//   3. The browser fallback offers a FORMAT PICKER (A4 / thermal 80 / 72).
//   4. Each format re-renders through its own template (via ?paper=/?width=,
//      resolved server-side by the page → ReceiptPreview).
//
// Replaces the old split between <ThermalAutoPrint> (bridge + fallback, no
// picker) and <ReceiptButtons> (picker, no bridge). The page decides the
// starting mode: pass `bridge` when the resolved format is thermal (so the
// bridge is tried on mount); omit it for a plain browser document.

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

const RELAY = "http://localhost:9191";

// Format picker options. `value` encodes "<paper>|<width>" so the 72mm thermal
// variant (same PaperFormat, narrower width) is distinct from the standard 80mm.
const FORMAT_OPTIONS = [
    { value: "A4|",             label: "A4" },
    { value: "THERMAL_80MM|",   label: "Thermal 80mm" },
    { value: "THERMAL_80MM|72", label: "Thermal 72mm" },
] as const;

export type BridgeEndpoint = "/print/pos" | "/print/payment" | "/print/voucher";

export interface PrintToolbarBridge {
    /** Relay route for this document kind. If the bridge doesn't implement it
     *  the POST fails and we fall back to browser print. */
    endpoint: BridgeEndpoint;
    /** Ready-to-send relay payload (built server-side on the page). */
    payload:  unknown;
}

export interface PrintToolbarProps {
    /** When set, this document is in THERMAL mode: try the bridge on mount,
     *  then fall back to browser print. Omit for a plain browser document. */
    bridge?: PrintToolbarBridge;
    /** Browser-mode: fire the print dialog on mount (default true). The
     *  "Print after save" / format-switch flows pass false so the user can
     *  pick a format first. Ignored in bridge/thermal mode (we auto-fire the
     *  bridge, then window.print() only if it falls back). */
    autoPrint?: boolean;
    /** Render the A4 / thermal format dropdown once we're on the browser path. */
    showFormatPicker?: boolean;
    /** Server-resolved current paper ("A4" | "THERMAL_80MM"), for the selector. */
    currentPaper?: string;
    /** Server-resolved current width override ("" | "72"), for the selector. */
    currentWidth?: string;
}

type Status = "idle" | "trying" | "thermal" | "browser";

export default function PrintToolbar({
    bridge,
    autoPrint = true,
    showFormatPicker = false,
    currentPaper,
    currentWidth = "",
}: PrintToolbarProps) {
    // Bridge mode starts by trying the relay; plain browser mode starts on the
    // browser path straight away (so the picker is available immediately).
    const [status, setStatus] = useState<Status>(bridge ? "idle" : "browser");
    const ranRef = useRef(false);

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const sendToRelay = async (): Promise<boolean> => {
        if (!bridge) return false;
        try {
            const ok = await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(1200) })
                .then((r) => r.ok).catch(() => false);
            if (!ok) return false;
            const res = await fetch(`${RELAY}${bridge.endpoint}`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(bridge.payload),
            });
            return res.ok;
        } catch {
            return false;
        }
    };

    // Thermal path: try the bridge; on failure fall back to a browser print.
    const runThermal = async () => {
        setStatus("trying");
        if (await sendToRelay()) {
            setStatus("thermal");
        } else {
            setStatus("browser");
            window.print();
        }
    };

    useEffect(() => {
        if (ranRef.current) return;
        ranRef.current = true;
        if (bridge) {
            void runThermal();
        } else if (autoPrint) {
            window.print();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentValue = `${currentPaper ?? ""}|${currentWidth}`;

    const onFormatChange = (value: string) => {
        const [paper, width] = value.split("|");
        const params = new URLSearchParams(searchParams.toString());
        if (paper) params.set("paper", paper); else params.delete("paper");
        if (width) params.set("width", width); else params.delete("width");
        // Switching format shouldn't re-fire the dialog or re-try the bridge —
        // the user prints when ready via the Print button.
        params.set("autoprint", "0");
        params.delete("mode");
        router.replace(`${pathname}?${params.toString()}`);
    };

    // Picker only appears on the browser path — while the bridge is being tried
    // or after a successful thermal send it stays hidden (a clean one-tap flow).
    const pickerVisible = showFormatPicker && status === "browser";

    return (
        <div className="no-print mb-3 flex items-center gap-2">
            {pickerVisible && (
                <select
                    value={currentValue}
                    onChange={(e) => onFormatChange(e.target.value)}
                    aria-label="Paper format"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                    {FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            )}

            {bridge && (
                <Button onClick={() => void runThermal()} size="sm" disabled={status === "trying"}>
                    🖨️ Print (thermal)
                </Button>
            )}
            <Button
                onClick={() => window.print()}
                size="sm"
                variant={bridge ? "outline" : "default"}
            >
                {bridge ? "Print in browser" : "🖨️ Print"}
            </Button>
            <Button onClick={() => window.close()} size="sm" variant="ghost">
                ✕ Close
            </Button>

            {status === "trying"  && <span className="text-xs text-muted-foreground">Sending to thermal printer…</span>}
            {status === "thermal" && <span className="text-xs text-green-600">✓ Sent to thermal printer</span>}
            {bridge && status === "browser" && (
                <span className="text-xs text-amber-600">Relay offline — using browser print</span>
            )}
        </div>
    );
}
