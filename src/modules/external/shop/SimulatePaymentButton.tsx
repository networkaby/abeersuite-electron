"use client";

import { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";

// Floating "Simulate payment success" button — the demo gateway's stand-in for a
// real PSP redirect/webhook. Shown on the order confirmation page for an unpaid
// ONLINE order when the active gateway is the demo provider. On click it fires the
// success signal (marks the order paid + confirms it), then refreshes the page.
export default function SimulatePaymentButton({ orderId }: { orderId: number }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const pay = async () => {
        setBusy(true);
        setError("");
        try {
            await axios.post(`/api/shop/orders/${orderId}/demo-pay`);
            router.refresh();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : null;
            setError(msg || "Simulation failed");
            setBusy(false);
        }
    };

    return (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
            {error ? (
                <span className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground shadow">
                    {error}
                </span>
            ) : null}
            <button
                type="button"
                onClick={() => void pay()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-600 disabled:opacity-60"
            >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                {busy ? "Simulating…" : "Simulate payment success"}
            </button>
        </div>
    );
}
