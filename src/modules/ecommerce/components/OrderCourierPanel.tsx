"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Truck, ExternalLink, RefreshCw, Printer, ClipboardList } from "lucide-react";
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
    /** Courier kind snapshot ("SHIPROCKET" | "CUSTOM" | …) — gates the book-now button. */
    courierKind: string | null;
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
    courierKind,
    trackingNumber,
    delivery,
    onUpdated,
}: Props) {
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [booking, setBooking] = useState(false);
    const [options, setOptions] = useState<CourierOption[]>([]);
    const [currentOptionId, setCurrentOptionId] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const awb = delivery?.awb ?? trackingNumber;
    const canChange =
        !!statusId && COURIER_CHANGEABLE_STAGES.includes(statusId) && !delivery?.awb;
    // Manual retry for an API courier that wasn't auto-booked (e.g. the order hit
    // Packing before creds/config were in place). Past the change window only.
    const isApiCourier = courierKind === "SHIPROCKET" || courierKind === "SHIPWAY";
    const canBookNow = !canChange && !!delivery && !delivery.awb && isApiCourier;
    // Poll fallback for stage sync — works even when the carrier webhook isn't
    // configured (e.g. Shipway's Track module not enabled yet).
    const canRefresh = !!delivery?.awb && isApiCourier;
    const [refreshing, setRefreshing] = useState(false);
    // The courier's official label PDF (their barcode + routing) — fetched from
    // the aggregator and opened for printing.
    const [labelling, setLabelling] = useState(false);

    const printLabel = async () => {
        if (!delivery) return;
        setLabelling(true);
        try {
            const endpoint = courierKind === "SHIPWAY" ? "shipway" : "shiprocket";
            const res = await axios.post<{ labelUrl: string }>(
                `/api/deliveries/${delivery.id}/${endpoint}/label`,
            );
            window.open(res.data.labelUrl, "_blank", "noopener");
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to fetch the label"));
        } finally {
            setLabelling(false);
        }
    };

    // Manual tracking entry — our own couriers are booked OUTSIDE the system
    // (local boy / Standard courier counter), so staff paste the tracking number
    // here; the label barcode, header and Mark-Dispatched all pick it up.
    const [trackDraft, setTrackDraft] = useState(awb ?? "");
    const [savingTrack, setSavingTrack] = useState(false);

    const saveTracking = async () => {
        setSavingTrack(true);
        try {
            await axios.patch(`/api/ecommerce/orders/${orderId}/courier`, {
                trackingNumber: trackDraft.trim(),
            });
            toast.success(trackDraft.trim() ? "Tracking number saved" : "Tracking number cleared");
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to save the tracking number"));
        } finally {
            setSavingTrack(false);
        }
    };

    // Pickup manifest — the sheet the courier's agent signs at handover.
    // Shiprocket returns a printable PDF URL; Shipway only a manifest id (its
    // PDF downloads from the Shipway panel).
    const [manifesting, setManifesting] = useState(false);

    const printManifest = async () => {
        if (!delivery) return;
        setManifesting(true);
        try {
            if (courierKind === "SHIPWAY") {
                const res = await axios.post<{ manifestIds: string | null; message: string | null }>(
                    `/api/deliveries/${delivery.id}/shipway/manifest`,
                );
                toast.success(
                    res.data.manifestIds
                        ? `Manifest #${res.data.manifestIds} created — print it from the Shipway panel.`
                        : res.data.message ?? "Manifest created.",
                );
            } else {
                const res = await axios.post<{ manifestUrl: string }>(
                    `/api/deliveries/${delivery.id}/shiprocket/manifest`,
                );
                window.open(res.data.manifestUrl, "_blank", "noopener");
            }
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to fetch the manifest"));
        } finally {
            setManifesting(false);
        }
    };

    const refreshTracking = async () => {
        if (!delivery) return;
        setRefreshing(true);
        try {
            const endpoint = courierKind === "SHIPWAY" ? "shipway" : "shiprocket";
            const res = await axios.post<{ currentStatus: string | null }>(
                `/api/deliveries/${delivery.id}/${endpoint}/track`,
            );
            toast.success(`Courier says: ${res.data.currentStatus ?? "no update yet"}`);
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to refresh tracking"));
        } finally {
            setRefreshing(false);
        }
    };

    const bookNow = async () => {
        if (!delivery) return;
        setBooking(true);
        try {
            const endpoint = courierKind === "SHIPWAY" ? "shipway" : "shiprocket";
            const res = await axios.post<{ awb: string; courierName: string | null }>(
                `/api/deliveries/${delivery.id}/${endpoint}`,
            );
            toast.success(`Courier booked — AWB ${res.data.awb}`);
            onUpdated();
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Booking failed"));
        } finally {
            setBooking(false);
        }
    };

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
                {canChange && !picking && (
                    <Button variant="outline" size="sm" onClick={() => void openPicker()}>
                        <RefreshCw size={13} /> Change courier
                    </Button>
                )}
                {canBookNow && (
                    <Button size="sm" disabled={booking} onClick={() => void bookNow()}>
                        {booking ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />}
                        {booking ? "Booking…" : "Book courier now"}
                    </Button>
                )}
                {canRefresh && (
                    <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshTracking()}>
                        {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {refreshing ? "Checking…" : "Refresh tracking"}
                    </Button>
                )}
                {canRefresh && (
                    <Button size="sm" variant="outline" disabled={labelling} onClick={() => void printLabel()}>
                        {labelling ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                        {labelling ? "Fetching…" : "Print label"}
                    </Button>
                )}
                {canRefresh && (
                    <Button size="sm" variant="outline" disabled={manifesting} onClick={() => void printManifest()}>
                        {manifesting ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />}
                        {manifesting ? "Fetching…" : "Manifest"}
                    </Button>
                )}
                {/* Our own couriers (local / Standard) — OUR parcel label document
                    (DELIVERY_SHIPPING_LABEL template, per-size layouts). */}
                {!isApiCourier && !!delivery && (
                    <Button size="sm" variant="outline" asChild>
                        <a href={`/shipping-label/order/${orderId}`} target="_blank" rel="noreferrer">
                            <Printer size={13} /> Print label
                        </a>
                    </Button>
                )}
            </div>

            {/* Own couriers are booked manually — staff paste the courier's
                tracking number here (label barcode + Mark Dispatched use it). */}
            {!isApiCourier && (
                <div className="mt-3 flex items-end gap-2 border-t border-border/60 pt-3">
                    <div className="grid flex-1 gap-1">
                        <span className="text-xs text-muted-foreground">Tracking number (booked manually)</span>
                        <input
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                            value={trackDraft}
                            onChange={(e) => setTrackDraft(e.target.value)}
                            placeholder="Courier's tracking / consignment no."
                        />
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={savingTrack || (trackDraft.trim() === (awb ?? ""))}
                        onClick={() => void saveTracking()}
                    >
                        {savingTrack && <Loader2 size={12} className="animate-spin" />}
                        Save
                    </Button>
                </div>
            )}

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
