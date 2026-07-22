"use client";

import { useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Truck, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { ORDER_STAGE } from "@/modules/order/lib/orderPipeline";

// Office order page → Delivery panel. Shows the chosen courier, the live P8
// delivery stage + AWB (auto-synced from the courier's webhook), and — while the
// order is still pre-Packing with no AWB — a "Change courier" picker for special
// causes. The customer's paid shipping charge never changes; the listed prices
// are OUR cost for each option.

type DeliverySummary = {
    id: number;
    carrier: string | null;
    awb: string | null;
    trackingUrl: string | null;
    stageId: string;
    stageLabel: string | null;
    stageColor: string | null;
};

type CourierOption = {
    optionId: string;
    kind: string;
    label: string;
    serviceName?: string;
    amountPaise: number;
    etaText: string | null;
};

type Props = {
    orderId: number;
    statusId: string | null;
    courierLabel: string | null;
    trackingNumber: string | null;
    delivery: DeliverySummary | null;
    onUpdated: () => void;
};

const COURIER_CHANGEABLE_STAGES: string[] = [
    ORDER_STAGE.NEW,
    ORDER_STAGE.UNDER_REVIEW,
    ORDER_STAGE.CONFIRMED,
];

export default function OrderCourierPanel({
    orderId,
    statusId,
    courierLabel,
    trackingNumber,
    delivery,
    onUpdated,
}: Props) {
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [options, setOptions] = useState<CourierOption[]>([]);
    const [currentOptionId, setCurrentOptionId] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const awb = delivery?.awb ?? trackingNumber;
    const canChange =
        !!statusId && COURIER_CHANGEABLE_STAGES.includes(statusId) && !delivery?.awb;

    const openPicker = async () => {
        setPicking(true);
        setLoading(true);
        try {
            const res = await axios.get<{
                options: CourierOption[];
                current: { optionId: string | null };
            }>(`/api/ecommerce/orders/${orderId}/courier`);
            setOptions(res.data.options);
            setCurrentOptionId(res.data.current.optionId);
            setSelected(res.data.current.optionId);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to load courier options"));
            setPicking(false);
        } finally {
            setLoading(false);
        }
    };

    const saveChange = async () => {
        if (!selected || selected === currentOptionId) {
            setPicking(false);
            return;
        }
        setSaving(true);
        try {
            const res = await axios.post<{ courier: { label: string } }>(
                `/api/ecommerce/orders/${orderId}/courier`,
                { optionId: selected },
            );
            toast.success(`Courier changed to ${res.data.courier.label}`);
            setPicking(false);
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to change the courier"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-lg border border-border p-4 text-sm">
            <h2 className="mb-2 font-medium flex items-center gap-2">
                <Truck size={15} className="text-muted-foreground" />
                Delivery
                {delivery?.stageLabel && (
                    <Badge
                        className={`text-xs font-medium ${delivery.stageColor ?? "bg-gray-100 text-gray-600"}`}
                        variant="outline"
                    >
                        {delivery.stageLabel}
                    </Badge>
                )}
            </h2>

            <div className="space-y-1">
                <p className="flex justify-between">
                    <span className="text-muted-foreground">Courier</span>
                    <span className="font-medium">{courierLabel ?? "—"}</span>
                </p>
                {awb && (
                    <p className="flex justify-between gap-2">
                        <span className="text-muted-foreground">AWB</span>
                        <span className="font-mono text-xs break-all text-right">{awb}</span>
                    </p>
                )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {delivery?.trackingUrl && (
                    <Button variant="outline" size="sm" asChild>
                        <a href={delivery.trackingUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} /> Track shipment
                        </a>
                    </Button>
                )}
                {delivery && (
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/office/orders/delivery">
                            <ExternalLink size={13} /> Delivery board
                        </Link>
                    </Button>
                )}
                {canChange && !picking && (
                    <Button variant="outline" size="sm" onClick={() => void openPicker()}>
                        <RefreshCw size={13} /> Change courier
                    </Button>
                )}
            </div>

            {canChange && (
                <p className="mt-2 text-xs text-muted-foreground">
                    The courier books automatically when packing starts. Change it before
                    then for special cases — the customer&apos;s shipping charge stays as paid.
                </p>
            )}

            {picking && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {loading ? (
                        <p className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 size={13} className="animate-spin" /> Quoting couriers…
                        </p>
                    ) : options.length === 0 ? (
                        <p className="text-muted-foreground">No courier options available for this address.</p>
                    ) : (
                        <div className="space-y-1.5">
                            {options.map((o) => (
                                <label
                                    key={o.optionId}
                                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 ${
                                        selected === o.optionId ? "border-primary bg-primary/5" : "border-border"
                                    }`}
                                >
                                    <span className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="courier-option"
                                            checked={selected === o.optionId}
                                            onChange={() => setSelected(o.optionId)}
                                        />
                                        <span>
                                            {o.serviceName ?? o.label}
                                            {o.optionId === currentOptionId && (
                                                <span className="ml-1 text-xs text-muted-foreground">(current)</span>
                                            )}
                                            {o.etaText && (
                                                <span className="block text-xs text-muted-foreground">{o.etaText}</span>
                                            )}
                                        </span>
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {o.amountPaise === 0 ? "FREE" : formatRupeesFromPaise(o.amountPaise)}
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 pt-1">
                        <Button
                            type="button"
                            size="sm"
                            disabled={saving || loading || !selected || selected === currentOptionId}
                            onClick={() => void saveChange()}
                        >
                            {saving && <Loader2 size={12} className="animate-spin" />}
                            Use this courier
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setPicking(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
