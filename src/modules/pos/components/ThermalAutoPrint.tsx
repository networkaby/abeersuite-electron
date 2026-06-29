"use client";

// Relay-aware print toolbar for the POS receipt pages (/receipt/invoice?kind=POS
// and /receipt/payment). On mount it prints to the thermal bridge (thermal.js on
// :9191) BY DEFAULT; if the relay is offline (or the POST fails) it falls back to
// the browser print dialog. Manual buttons let the cashier force either path or
// close the tab. Replaces ReceiptButtons on the POS thermal surfaces only —
// office A4 invoices keep the plain browser ReceiptButtons.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const RELAY = "http://localhost:9191";

type Props = {
    /** Relay route for this voucher kind. `/print/voucher` is the generic office
     *  endpoint used by the template-driven voucher print page; if the bridge
     *  doesn't implement it the POST fails and we fall back to browser print. */
    endpoint: "/print/pos" | "/print/payment" | "/print/voucher";
    /** Ready-to-send relay payload (built server-side on the page). */
    payload: unknown;
    /** Auto-print on mount (default true — these pages exist to print). */
    auto?: boolean;
};

export default function ThermalAutoPrint({ endpoint, payload, auto = true }: Props) {
    const [status, setStatus] = useState<"idle" | "trying" | "thermal" | "browser">("idle");
    const ranRef = useRef(false);

    const sendToRelay = async (): Promise<boolean> => {
        try {
            const ok = await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(1200) })
                .then((r) => r.ok).catch(() => false);
            if (!ok) return false;
            const res = await fetch(`${RELAY}${endpoint}`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload),
            });
            return res.ok;
        } catch {
            return false;
        }
    };

    const run = async () => {
        setStatus("trying");
        if (await sendToRelay()) {
            setStatus("thermal");
        } else {
            setStatus("browser");
            window.print();
        }
    };

    useEffect(() => {
        if (!auto || ranRef.current) return;
        ranRef.current = true;
        void run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="no-print mb-3 flex items-center gap-2">
            <Button onClick={() => void run()} size="sm" disabled={status === "trying"}>
                🖨️ Print (thermal)
            </Button>
            <Button onClick={() => window.print()} size="sm" variant="outline">
                Print in browser
            </Button>
            <Button onClick={() => window.close()} size="sm" variant="ghost">
                ✕ Close
            </Button>
            {status === "trying"  && <span className="text-xs text-muted-foreground">Sending to thermal printer…</span>}
            {status === "thermal" && <span className="text-xs text-green-600">✓ Sent to thermal printer</span>}
            {status === "browser" && <span className="text-xs text-amber-600">Relay offline — using browser print</span>}
        </div>
    );
}
