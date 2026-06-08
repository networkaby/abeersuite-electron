"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, Check, MessageCircle, Loader2, QrCode } from "lucide-react";

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
    DEFAULT_PAYEE_NAME,
    paymentLinkMessage,
    type PaymentContext,
} from "@/modules/pos/lib/paymentLink";

const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Load a data-URL into an <img> so it can be drawn onto a canvas.
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Rasterise a self-contained "Scan to Pay" card (QR + amount + payee) so the
// shared PHOTO explains itself even if the caption is dropped. Dependency-free
// canvas — no html-to-image needed.
async function composeQrCard(qrDataUrl: string, amountLabel: string, payeeName: string): Promise<Blob> {
    const W = 640, H = 820;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 32px system-ui, Segoe UI, sans-serif";
    ctx.fillText("Scan to Pay", W / 2, 74);
    ctx.font = "700 56px system-ui, Segoe UI, sans-serif";
    ctx.fillText(amountLabel, W / 2, 144);
    const qr = await loadImage(qrDataUrl);
    const size = 460, x = (W - size) / 2, y = 188;
    ctx.drawImage(qr, x, y, size, size);
    ctx.fillStyle = "#334155";
    ctx.font = "500 26px system-ui, Segoe UI, sans-serif";
    ctx.fillText(payeeName, W / 2, y + size + 56);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "400 20px system-ui, Segoe UI, sans-serif";
    ctx.fillText("Pay with any UPI app — GPay · PhonePe · Paytm", W / 2, y + size + 92);
    return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
}

// WhatsApp wants digits WITH country code, no "+". Default a bare 10-digit Indian
// mobile to +91 so `web.whatsapp.com/send?phone=` opens the right chat.
function waNumber(raw: string | null | undefined): string {
    let d = (raw ?? "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 10) d = "91" + d;
    else if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
    return d;
}

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
    upiVpa,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    defaultAmount: number;
    partyName?: string | null;
    partyPhone?: string | null;
    billRef?: string | null;
    /** This counter's UPI VPA (PosCounter.upiVpa); null/empty = not configured. */
    upiVpa?: string | null;
}) {
    const ctx: PaymentContext = useMemo(
        () => ({ upiVpa: upiVpa ?? null, payeeName: DEFAULT_PAYEE_NAME }),
        [upiVpa],
    );
    const [providerId, setProviderId] = useState(PAYMENT_LINK_PROVIDERS[0]?.id ?? "");
    const [amountStr, setAmountStr] = useState("");
    const [qr, setQr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [sharing, setSharing] = useState(false);
    // Pre-built share image (File) — kept ready so the Share click can call
    // navigator.share() SYNCHRONOUSLY. Doing the (async) QR + canvas work inside
    // the click instead would drop the user-gesture activation and the browser
    // would refuse the share / clipboard write.
    const [shareFile, setShareFile] = useState<File | null>(null);

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

    const providerAvailable = !!provider?.available(ctx);
    const link = useMemo(() => {
        if (!provider || !provider.available(ctx) || amount <= 0) return "";
        return provider.build(ctx, { amountRupees: amount, note });
    }, [provider, ctx, amount, note]);

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

    // Pre-build the high-res share image (the "Scan to Pay" card) whenever the
    // link/amount/payee change, so the Share click below is synchronous.
    useEffect(() => {
        let alive = true;
        if (!link || amount <= 0) {
            setShareFile(null);
            return;
        }
        (async () => {
            try {
                const hiRes = await QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: "M" });
                const blob = await composeQrCard(hiRes, fmtINR(amount), ctx.payeeName);
                if (alive) setShareFile(new File([blob], `payment-qr-${amount.toFixed(2)}.png`, { type: "image/png" }));
            } catch {
                if (alive) setShareFile(null);
            }
        })();
        return () => {
            alive = false;
        };
    }, [link, amount, ctx.payeeName]);

    const canShare = !!link && amount > 0;

    async function copyUpiId() {
        const vpa = ctx.upiVpa?.trim();
        if (!vpa) return;
        try {
            await navigator.clipboard.writeText(vpa);
            setCopied(true);
            toast.success("UPI ID copied");
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error("Couldn't copy — long-press to copy manually");
        }
    }

    const waNum = waNumber(partyPhone);

    // Send the QR to the customer's WhatsApp. Hybrid (targets the number AND sends
    // the image): copy the pre-built QR photo to the clipboard, then open THIS
    // customer's WhatsApp Web chat with the amount + link prefilled as the caption —
    // the cashier pastes the QR (Ctrl+V) and hits Send. The text link rides along so
    // nothing is lost if the paste is missed. Clipboard + window.open are both called
    // synchronously in the click so the user-gesture activation survives.
    function sendOnWhatsApp() {
        const file = shareFile;
        if (!file) return;
        const caption = paymentLinkMessage({ partyName, amountRupees: amount, payTo: ctx.upiVpa ?? "", billRef });
        const chatUrl = waNum
            ? `https://web.whatsapp.com/send?phone=${waNum}&text=${encodeURIComponent(caption)}`
            : `https://web.whatsapp.com/send?text=${encodeURIComponent(caption)}`;

        const CI = typeof ClipboardItem !== "undefined" ? ClipboardItem : undefined;
        if (CI && navigator.clipboard?.write) {
            // Initiate the image copy (sync, while focused), then open the chat.
            navigator.clipboard
                .write([new CI({ "image/png": file })])
                .then(() =>
                    toast.success(
                        waNum
                            ? "WhatsApp opened — press Ctrl+V to paste the QR, then Send"
                            : "QR copied — paste it (Ctrl+V) into the chat, then Send",
                    ),
                )
                .catch(() =>
                    toast.message("Chat opened with the payment link — attach the QR (shown here) manually"),
                );
            window.open(chatUrl, "_blank", "noopener,noreferrer");
            return;
        }

        // Phones without clipboard-image support: native share sheet sends the photo
        // (the cashier picks the chat). Number can't be pre-targeted on this path.
        if (navigator.canShare?.({ files: [file] }) && navigator.share) {
            setSharing(true);
            navigator
                .share({ files: [file], title: "Payment QR", text: caption })
                .catch((e: { name?: string }) => {
                    if (e?.name !== "AbortError") toast.error("Couldn't open the share menu");
                })
                .finally(() => setSharing(false));
            return;
        }

        // Last resort: download the PNG + open the chat to attach it manually.
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        window.open(chatUrl, "_blank", "noopener,noreferrer");
        toast.success("QR downloaded — attach it in the WhatsApp chat");
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode size={18} /> Share payment link
                    </DialogTitle>
                    <DialogDescription>
                        Show the QR for an in-store scan, or share it as a photo over WhatsApp to collect remotely.
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
                                        <SelectItem key={p.id} value={p.id} disabled={!p.available(ctx)}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Rail hint / not-configured notice */}
                    {provider && !providerAvailable && (
                        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            {provider.hint(ctx)}
                        </p>
                    )}

                    {/* QR */}
                    <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-muted/30 p-4">
                        {qr ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qr} alt="Payment QR" width={200} height={200} className="rounded bg-white p-1" />
                        ) : (
                            <div className="flex h-[200px] w-[200px] items-center justify-center text-center text-xs text-muted-foreground">
                                {providerAvailable
                                    ? "Enter an amount to generate the QR"
                                    : "QR appears once a UPI ID is set for this counter"}
                            </div>
                        )}
                        {canShare && <div className="text-sm font-semibold">{fmtINR(amount)}</div>}
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" onClick={copyUpiId} disabled={!canShare}>
                            {copied ? <Check size={16} /> : <Copy size={16} />} Copy UPI ID
                        </Button>
                        <Button
                            onClick={sendOnWhatsApp}
                            disabled={!canShare || !shareFile || sharing}
                            className="bg-[#128C7E] hover:bg-[#128C7E]/90 text-white"
                        >
                            {sharing || (canShare && !shareFile)
                                ? <Loader2 size={16} className="animate-spin" />
                                : <MessageCircle size={16} />} WhatsApp
                        </Button>
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                        {waNum
                            ? <>Opens <span className="font-medium">{partyName || "the customer"}</span>&apos;s WhatsApp &amp; copies the QR — press <span className="font-medium">Ctrl+V</span> to paste it, then Send.</>
                            : "No phone on file — opens a blank WhatsApp compose; the QR is copied to paste in."}
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
