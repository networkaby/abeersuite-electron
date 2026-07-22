"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORDER_STATUS_TRANSITIONS } from "@/modules/ecommerce/lib/orderStatusTransitions";
import type { ShopOrderStatus } from "@/generated/prisma/enums";

type NextPipelineStatus = {
    id: string;
    label: string;
    color: string;
    isTerminal: boolean;
    actionLabel: string | null;
};

type Props = {
    orderId: number;
    onUpdated: () => void;
    // Pipeline mode — preferred
    statusId?: string | null;
    nextStatuses?: NextPipelineStatus[];
    // Legacy enum fallback (Razorpay / old orders)
    status?: ShopOrderStatus | null;
    // Pre-fill for the Dispatched fields — the order's courier + auto-booked AWB
    // flow in so staff don't retype them (still editable for manual overrides).
    defaultCourier?: string | null;
    defaultTracking?: string | null;
};

const LEGACY_LABELS: Partial<Record<ShopOrderStatus, string>> = {
    PAID: "Mark paid",
    PACKED: "Mark packed",
    SHIPPED: "Mark shipped",
    DELIVERED: "Mark delivered",
    REFUNDED: "Refund",
    CANCELLED: "Cancel order",
};

export default function OrderStatusActions({
    orderId,
    onUpdated,
    statusId,
    nextStatuses,
    status,
    defaultCourier,
    defaultTracking,
}: Props) {
    const [busy, setBusy] = useState(false);
    const [courier, setCourier] = useState(defaultCourier ?? "");
    const [trackingNumber, setTrackingNumber] = useState(defaultTracking ?? "");

    // Auto-booking may stamp the AWB after mount (page refetch) — flow the new
    // defaults into untouched fields so "Mark Dispatched" carries them.
    useEffect(() => {
        if (defaultCourier && !courier) setCourier(defaultCourier);
        if (defaultTracking && !trackingNumber) setTrackingNumber(defaultTracking);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only on default changes
    }, [defaultCourier, defaultTracking]);

    // ── Pipeline mode ───────────────────────────────────────────────────────────
    if (statusId && nextStatuses !== undefined) {
        if (nextStatuses.length === 0) {
            return <p className="text-sm text-muted-foreground">No further actions available.</p>;
        }

        const needsDispatchFields = nextStatuses.some((s) => s.label === "Dispatched");

        const go = async (toStatus: NextPipelineStatus) => {
            setBusy(true);
            try {
                await axios.post(`/api/ecommerce/orders/${orderId}/status`, {
                    toStatusId: toStatus.id,
                    ...(toStatus.label === "Dispatched"
                        ? {
                              courier: courier.trim() || null,
                              trackingNumber: trackingNumber.trim() || null,
                          }
                        : {}),
                });
                toast.success(`Order moved to ${toStatus.label}`);
                onUpdated();
            } catch (e: unknown) {
                toast.error(extractApiError(e, "Update failed"));
            } finally {
                setBusy(false);
            }
        };

        return (
            <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-foreground">Move order to</p>

                {needsDispatchFields && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label htmlFor="courier">Courier</Label>
                            <Input
                                id="courier"
                                value={courier}
                                onChange={(e) => setCourier(e.target.value)}
                                placeholder="e.g. BlueDart"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="track">Tracking number</Label>
                            <Input
                                id="track"
                                value={trackingNumber}
                                onChange={(e) => setTrackingNumber(e.target.value)}
                                placeholder="AWB / tracking id"
                            />
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    {nextStatuses.map((s) => (
                        <Button
                            key={s.id}
                            type="button"
                            variant={s.label === "Cancelled" || s.label === "Returned" ? "destructive" : "default"}
                            disabled={busy}
                            onClick={() => void go(s)}
                            size="sm"
                        >
                            {busy && <Loader2 size={12} className="animate-spin" />}
                            {s.actionLabel ?? s.label}
                        </Button>
                    ))}
                </div>
            </div>
        );
    }

    // ── Legacy enum fallback ────────────────────────────────────────────────────
    if (!status) return null;

    const next = ORDER_STATUS_TRANSITIONS[status] ?? [];
    if (next.length === 0) {
        return <p className="text-sm text-muted-foreground">No further actions for this status.</p>;
    }

    const goLegacy = async (to: ShopOrderStatus) => {
        setBusy(true);
        try {
            await axios.post(`/api/ecommerce/orders/${orderId}/status`, {
                to,
                ...(to === "SHIPPED"
                    ? {
                          courier: courier.trim() || null,
                          trackingNumber: trackingNumber.trim() || null,
                      }
                    : {}),
            });
            toast.success("Order updated");
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Update failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Change status</p>
            {(next.includes("SHIPPED" as ShopOrderStatus) || status === "PACKED") && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="courier">Courier</Label>
                        <Input
                            id="courier"
                            value={courier}
                            onChange={(e) => setCourier(e.target.value)}
                            placeholder="e.g. BlueDart"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="track">Tracking number</Label>
                        <Input
                            id="track"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            placeholder="AWB / tracking id"
                        />
                    </div>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                {next.map((s) => (
                    <Button
                        key={s}
                        type="button"
                        variant={s === "REFUNDED" || s === "CANCELLED" ? "destructive" : "default"}
                        disabled={busy}
                        onClick={() => void goLegacy(s)}
                        size="sm"
                    >
                        {LEGACY_LABELS[s] ?? s}
                    </Button>
                ))}
            </div>
        </div>
    );
}
