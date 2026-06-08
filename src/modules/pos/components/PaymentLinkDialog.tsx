"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, Check, MessageCircle, QrCode } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
    PAYMENT_LINK_PROVIDERS,
    paymentLinkMessage,
    whatsappWebShareUrl,
} from "@/modules/pos/lib/paymentLink";

const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Keep only a positive decimal (no `input type="number"`, per house rule).
function sanitizeAmount(raw: string): string {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

export function PaymentLinkDialog({
    open,
    onOpenChange,
    defaultAmount,
    partyName,
    partyPhone,
    billRef,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    defaultAmount: number;
    partyName?: string | null;
    partyPhone?: string | null;
    billRef?: string | null;
}) {
    const [providerId, setProviderId] = useState(PAYMENT_LINK_PROVIDERS[0]?.id ?? "");
    const [amountStr, setAmountStr] = useState("");
    const [qr, setQr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const provider = useMemo(
        () => PAYMENT_LINK_PROVIDERS.find((p) => p.id === providerId) ?? PAYMENT_LINK_PROVIDERS[0],
        [providerId],
    );

    // Reset the amount to the default each time the dialog opens.
    useEffect(() => {
        if (open) setAmountStr(defaultAmount > 0 ? defaultAmount.toFixed(2) : "");
    }, [open, defaultAmount]);

    const amount = Number(amountStr) || 0;
    const note = billRef || (partyName ? `Payment — ${partyName}` : "Payment");

    const link = useMemo(() => {
        if (!provider?.available || amount <= 0) return "";
        return provider.build({ amountRupees: amount, note });
    }, [provider, amount, note]);

    // Recompute the QR whenever the link changes.
    useEffect(() => {
        let alive = true;
        if (!link) {
            setQr(null);
            return;
        }
        QRCode.toDataURL(link, { width: 240, margin: 1, errorCorrectionLevel: "M" })
            .then((url) => {
                if (alive) setQr(url);
            })
            .catch(() => {
                if (alive) setQr(null);
            });
        return () => {
            alive = false;
        };
    }, [link]);

    const phoneDigits = (partyPhone ?? "").replace(/\D/g, "");
    const canShare = !!link && amount > 0;

    async function copyLink() {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            toast.success("Payment link copied");
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error("Couldn't copy — long-press the link to copy manually");
        }
    }

    function shareWhatsApp() {
        if (!canShare) return;
        const text = paymentLinkMessage({ partyName, amountRupees: amount, link, billRef });
        window.open(whatsappWebShareUrl(phoneDigits, text), "_blank", "noopener,noreferrer");
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode size={18} /> Share payment link
                    </DialogTitle>
                    <DialogDescription>
                        Show the QR for an in-store scan, or send the link over WhatsApp to collect remotely.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    {/* Amount + rail */}
                    <div className="grid grid-cols-[1fr_120px] gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Amount</Label>
                            <Input
                                value={amountStr}
                                onChange={(e) => setAmountStr(sanitizeAmount(e.target.value))}
                                inputMode="decimal"
                                placeholder="₹ amount"
                                className="text-right"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Pay via</Label>
                            <Select value={providerId} onValueChange={setProviderId}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_LINK_PROVIDERS.map((p) => (
                                        <SelectItem key={p.id} value={p.id} disabled={!p.available}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Rail hint / not-configured notice */}
                    {provider && !provider.available && (
                        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            {provider.hint}
                        </p>
                    )}

                    {/* QR */}
                    <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-muted/30 p-4">
                        {qr ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qr} alt="Payment QR" width={200} height={200} className="rounded bg-white p-1" />
                        ) : (
                            <div className="flex h-[200px] w-[200px] items-center justify-center text-center text-xs text-muted-foreground">
                                {provider?.available
                                    ? "Enter an amount to generate the QR"
                                    : "QR appears once UPI is configured"}
                            </div>
                        )}
                        {canShare && <div className="text-sm font-semibold">{fmtINR(amount)}</div>}
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" onClick={copyLink} disabled={!canShare}>
                            {copied ? <Check size={16} /> : <Copy size={16} />} Copy link
                        </Button>
                        <Button
                            onClick={shareWhatsApp}
                            disabled={!canShare || !phoneDigits}
                            title={!phoneDigits ? "This customer has no phone number on file" : undefined}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            <MessageCircle size={16} /> WhatsApp
                        </Button>
                    </div>
                    {!phoneDigits && canShare && (
                        <p className="text-center text-[11px] text-muted-foreground">
                            No phone on file — copy the link or let the customer scan the QR.
                        </p>
                    )}
                    <p className="text-center text-[11px] text-muted-foreground">
                        WhatsApp sends the link text; the QR is for an in-person scan.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
