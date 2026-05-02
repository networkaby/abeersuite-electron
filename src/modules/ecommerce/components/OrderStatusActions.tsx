"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORDER_STATUS_TRANSITIONS } from "@/modules/ecommerce/lib/order-status-transitions";
import type { ShopOrderStatus } from "@/generated/prisma/enums";

const LABELS: Partial<Record<ShopOrderStatus, string>> = {
    PAID: "Mark paid",
    PACKED: "Mark packed",
    SHIPPED: "Mark shipped",
    DELIVERED: "Mark delivered",
    REFUNDED: "Refund",
    CANCELLED: "Cancel order",
};

export default function OrderStatusActions({
    orderId,
    status,
    onUpdated,
}: {
    orderId: number;
    status: ShopOrderStatus;
    onUpdated: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [courier, setCourier] = useState("");
    const [trackingNumber, setTrackingNumber] = useState("");

    const next = ORDER_STATUS_TRANSITIONS[status] ?? [];

    const go = async (to: ShopOrderStatus) => {
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
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Update failed";
            toast.error(msg ?? "Update failed");
        } finally {
            setBusy(false);
        }
    };

    if (next.length === 0) {
        return <p className="text-sm text-muted-foreground">No further actions for this status.</p>;
    }

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
                        onClick={() => void go(s)}
                    >
                        {LABELS[s] ?? s}
                    </Button>
                ))}
            </div>
        </div>
    );
}
