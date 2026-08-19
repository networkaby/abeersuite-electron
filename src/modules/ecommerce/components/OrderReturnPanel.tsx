"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Loader2, Undo2, IndianRupee } from "lucide-react";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";
import { DELIVERY_STAGE } from "@/modules/delivery/lib/shiprocketStatus";

// Office order page → Return / Refund panel. Two one-click cases (both post a
// SALE_RETURN credit note against the ONLINE_INVOICE, put stock back, reverse
// loyalty/coupon, move the order to Returned, and queue a P9 refund when paid):
//   RTO      — the courier reported delivery failed and the parcel came back;
//              refund = FULL paid amount incl. shipping.
//   CUSTOMER — delivered, customer returned it; refund = goods amount only.

type ReturnVoucher = { id: number; reference: string | null; status: string | null; totalAmount: string };
type RefundInfo = {
    id: number;
    stageLabel: string | null;
    stageColor: string | null;
    amountPaise: number;
    paidOut: boolean;
    reason: string | null;
};

type Props = {
    orderId: number;
    statusId: string | null;
    deliveryStageId: string | null;
    isPaid: boolean;
    hasInvoice: boolean;
    returnVoucher: ReturnVoucher | null;
    refund: RefundInfo | null;
    onUpdated: () => void;
};

export default function OrderReturnPanel({
    orderId,
    statusId,
    deliveryStageId,
    isPaid,
    hasInvoice,
    returnVoucher,
    refund,
    onUpdated,
}: Props) {
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState<"RTO" | "CUSTOMER" | null>(null);

    const rtoReported = deliveryStageId === DELIVERY_STAGE.FAILED_RTO;
    const delivered = statusId === ORDER_STAGE.DELIVERED;
    const returned = statusId === ORDER_STAGE.RETURNED;

    // Nothing to show while the order hasn't reached a returnable situation.
    if (!returnVoucher && !refund && !rtoReported && !delivered && !returned) return null;

    const post = async (mode: "RTO" | "CUSTOMER") => {
        setBusy(true);
        try {
            const res = await axios.post<{ reference: string | null; refundPaise: number; refundTicketId: number | null; already?: boolean }>(
                `/api/ecommerce/orders/${orderId}/return`,
                { mode },
            );
            toast.success(
                res.data.already
                    ? `Return already posted (${res.data.reference ?? ""})`
                    : `Return ${res.data.reference ?? ""} posted` +
                      (res.data.refundTicketId ? ` · refund ${formatRupeesFromPaise(res.data.refundPaise)} queued` : ""),
            );
            setConfirming(null);
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to post the return"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className={`rounded-lg border p-4 ${
                rtoReported && !returnVoucher
                    ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
                    : "border-border"
            }`}
        >
            <h2 className="mb-3 font-medium flex items-center gap-2">
                <Undo2 size={15} className="text-muted-foreground" />
                Return / Refund
            </h2>

            {/* Posted return credit note */}
            {returnVoucher && (
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <p className="font-mono text-sm font-semibold text-primary">{returnVoucher.reference}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Credit note · {returnVoucher.status} ·{" "}
                            {formatRupeesFromPaise(Math.round(Number(returnVoucher.totalAmount) * 100))} · stock back in
                        </p>
                    </div>
                </div>
            )}

            {/* Refund state */}
            {refund && (
                <div className="mb-3 flex items-center justify-between border-t border-border/60 pt-2">
                    <div>
                        <p className="flex items-center gap-2 text-sm font-medium">
                            <IndianRupee size={13} className="text-muted-foreground" />
                            Refund {formatRupeesFromPaise(refund.amountPaise)}
                            {refund.stageLabel && (
                                <Badge className={`text-xs ${refund.stageColor ?? "bg-gray-100 text-gray-600"}`} variant="outline">
                                    {refund.stageLabel}
                                </Badge>
                            )}
                            {refund.paidOut && <Badge className="bg-green-100 text-green-700">Paid back</Badge>}
                        </p>
                        {refund.reason && <p className="text-xs text-muted-foreground mt-0.5">{refund.reason}</p>}
                    </div>
                </div>
            )}

            {/* Actions — only until a return exists */}
            {!returnVoucher && (
                <div className="space-y-2">
                    {rtoReported && (
                        <p className="text-sm text-red-700 dark:text-red-300">
                            Courier reported <b>delivery failed / RTO</b> — the parcel is coming back to us.
                        </p>
                    )}
                    {!hasInvoice ? (
                        <p className="text-xs text-muted-foreground">
                            No posted invoice on this order — nothing to reverse.
                        </p>
                    ) : confirming ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm">
                                {confirming === "RTO"
                                    ? "Post the return + full refund (incl. shipping)?"
                                    : "Post the return + refund of the goods amount?"}
                            </span>
                            <Button size="sm" disabled={busy} onClick={() => void post(confirming)}>
                                {busy && <Loader2 size={12} className="animate-spin" />}
                                Yes, post it
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {rtoReported && (
                                <Button size="sm" variant="destructive" onClick={() => setConfirming("RTO")}>
                                    <Undo2 size={13} /> Parcel received back{isPaid ? " — full refund" : ""}
                                </Button>
                            )}
                            {delivered && (
                                <Button size="sm" variant="outline" onClick={() => setConfirming("CUSTOMER")}>
                                    <Undo2 size={13} /> Customer return{isPaid ? " — refund goods" : ""}
                                </Button>
                            )}
                        </div>
                    )}
                    {(rtoReported || delivered) && hasInvoice && !confirming && (
                        <p className="text-xs text-muted-foreground">
                            One click posts the credit note (stock in, GST + discounts + loyalty + coupon reversed)
                            {isPaid ? ", moves the order to Returned and queues the refund on the Refund board." : " and moves the order to Returned."}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
