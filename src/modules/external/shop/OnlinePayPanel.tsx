"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";

// The order/payment page's single "pay online" surface. Lists every enabled online
// gateway as a selectable row (like the courier picker), pre-selecting the one the
// customer chose at checkout, and launches that gateway's flow on Pay:
//   demo      → POST /demo-pay, refresh
//   payu      → POST /payu, auto-submit the signed form (redirect)
//   razorpay  → Checkout.js modal, then POST /razorpay-verify (signature)
//   cashfree  → Cashfree SDK checkout (redirect; confirmed by the callback)

type Gateway = { provider: string; displayName: string };

type RazorpayHandlerResponse = {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
};
type RazorpayInstance = { open: () => void };
type RazorpayCtor = new (opts: {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name?: string;
    description?: string;
    handler: (r: RazorpayHandlerResponse) => void;
    modal?: { ondismiss?: () => void };
}) => RazorpayInstance;
type CashfreeInstance = {
    checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => void;
};
type CashfreeCtor = (cfg: { mode: string }) => CashfreeInstance;

declare global {
    interface Window {
        Razorpay?: RazorpayCtor;
        Cashfree?: CashfreeCtor;
    }
}

function loadScript(src: string): Promise<boolean> {
    return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
    });
}

export default function OnlinePayPanel({
    orderId,
    amountLabel,
    gateways,
    chosen,
    autoLaunch = false,
}: {
    orderId: number;
    amountLabel: string;
    gateways: Gateway[];
    chosen: string | null;
    /** Fire the chosen gateway immediately (skip the picker) — used on first arrival
     *  from checkout, where the customer already picked the gateway. */
    autoLaunch?: boolean;
}) {
    const router = useRouter();
    const initial = useMemo(() => {
        if (chosen && gateways.some((g) => g.provider === chosen)) return chosen;
        return gateways[0]?.provider ?? "";
    }, [chosen, gateways]);
    const [selected, setSelected] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    // Skip the picker while we auto-launch; reveal it on failure / "choose another".
    const [showPicker, setShowPicker] = useState(!autoLaunch);
    const startedRef = useRef(false);

    // Any failure drops back to the picker so the customer can retry or switch.
    const fail = (m: string) => {
        setError(m);
        setBusy(false);
        setShowPicker(true);
    };
    const errMsg = (e: unknown) =>
        axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
            ? ((e.response.data as { error?: string }).error ?? "")
            : "";

    const payDemo = async () => {
        await axios.post(`/api/shop/orders/${orderId}/demo-pay`);
        router.refresh();
    };
    const payPayu = async () => {
        const { data } = await axios.post<{ action: string; fields: Record<string, string> }>(
            `/api/shop/orders/${orderId}/payu`,
        );
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.action;
        for (const [k, v] of Object.entries(data.fields)) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = k;
            input.value = v;
            form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
    };
    const payRazorpay = async () => {
        const ok = await loadScript("https://checkout.razorpay.com/v1/checkout.js");
        if (!ok || !window.Razorpay) throw new Error("Could not load Razorpay.");
        const { data } = await axios.post<{ keyId: string; orderId: string; amount: number; currency: string }>(
            `/api/shop/orders/${orderId}/razorpay`,
        );
        const rz = new window.Razorpay({
            key: data.keyId,
            order_id: data.orderId,
            amount: data.amount,
            currency: data.currency,
            name: COMPANY_DETAILS.brandName,
            description: `Order #${orderId}`,
            handler: (r) => {
                void axios
                    .post(`/api/shop/orders/${orderId}/razorpay-verify`, r)
                    .then(() => router.refresh())
                    .catch((e) => fail(errMsg(e) || "Payment verification failed."));
            },
            modal: {
                ondismiss: () => {
                    setBusy(false);
                    setShowPicker(true); // let them retry / switch gateway
                },
            },
        });
        rz.open();
        // Busy stays until the modal's handler/ondismiss fires.
    };
    const payCashfree = async () => {
        const ok = await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
        if (!ok || !window.Cashfree) throw new Error("Could not load Cashfree.");
        const { data } = await axios.post<{ paymentSessionId: string; mode: string }>(
            `/api/shop/orders/${orderId}/cashfree`,
        );
        const cf = window.Cashfree({ mode: data.mode });
        cf.checkout({ paymentSessionId: data.paymentSessionId, redirectTarget: "_self" });
        // Redirects away; nothing after this runs.
    };

    const pay = async () => {
        setBusy(true);
        setError("");
        try {
            if (selected === "demo") await payDemo();
            else if (selected === "payu") await payPayu();
            else if (selected === "razorpay") await payRazorpay();
            else if (selected === "cashfree") await payCashfree();
            else fail("Unknown payment method.");
        } catch (e) {
            fail(errMsg(e) || (e instanceof Error ? e.message : "Could not start payment."));
        }
    };

    const selectedLabel = gateways.find((g) => g.provider === selected)?.displayName ?? "online";

    // On first arrival from checkout the customer already picked a gateway — fire it
    // immediately (once) instead of asking again.
    useEffect(() => {
        if (autoLaunch && selected && !startedRef.current) {
            startedRef.current = true;
            void pay();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoLaunch, selected]);

    if (gateways.length === 0) return null;

    // While auto-launching, show a "redirecting" state rather than the picker.
    if (!showPicker) {
        return (
            <div className="space-y-3 rounded-lg border border-border px-4 py-5 text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Taking you to {selectedLabel} to pay{" "}
                    {amountLabel}…
                </div>
                <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2"
                    onClick={() => setShowPicker(true)}
                >
                    Choose a different payment method
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <ul className="space-y-2">
                {gateways.map((g) => {
                    const active = g.provider === selected;
                    return (
                        <li key={g.provider}>
                            <button
                                type="button"
                                onClick={() => setSelected(g.provider)}
                                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                                    active
                                        ? "border-primary ring-1 ring-primary bg-primary/5"
                                        : "border-border hover:border-primary/50"
                                }`}
                            >
                                <CreditCard className="size-5 shrink-0" />
                                <span className="text-sm font-medium">{g.displayName}</span>
                                {g.provider === "demo" ? (
                                    <span className="text-xs text-muted-foreground">· simulate</span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <Button type="button" className="w-full gap-2" disabled={busy || !selected} onClick={() => void pay()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                {busy ? "Processing…" : `Pay ${amountLabel} via ${selectedLabel}`}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
    );
}
