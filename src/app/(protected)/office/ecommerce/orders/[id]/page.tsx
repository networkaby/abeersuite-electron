"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import OrderStatusActions from "@/modules/ecommerce/components/OrderStatusActions";
import { OrderSourceBadge } from "@/modules/ecommerce/components/OrderSourceBadge";
import type { OrderSource, ShopOrderStatus } from "@/generated/prisma/enums";
import { toast } from "sonner";
import { FileText, ExternalLink } from "lucide-react";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";

type NextPipelineStatus = {
    id: string;
    label: string;
    color: string;
    isTerminal: boolean;
    actionLabel: string | null;
};

type OrderDetail = {
    id: number;
    orderSource: OrderSource;
    // Legacy enum status (Razorpay / old orders)
    status: ShopOrderStatus;
    // Pipeline status
    statusId: string | null;
    pipelineId: string | null;
    orderStatus: {
        id: string;
        label: string;
        color: string;
        isTerminal: boolean;
        toTransitions: { to: NextPipelineStatus }[];
    } | null;
    totalPaise: number;
    shippingName: string | null;
    courier: string | null;
    trackingNumber: string | null;
    createdAt: string;
    paidAt: string | null;
    shippedAt: string | null;
    customerId: number | null;
    customer: {
        id: number;
        name: string;
        email: string | null;
        phone: string | null;
    } | null;
    account: {
        id: number;
        customer: { id: number; name: string; phone: string | null } | null;
        company: { id: number; name: string } | null;
    } | null;
    lines: {
        id: number;
        quantity: number;
        unitPricePaise: number;
        product: { id: number; name: string; imageUrl: string | null };
    }[];
    tickets: { id: number; status: string; createdAt: string }[];
    // Renamed `invoice` → `invVoucher` on 2026-05-24 (Invoice → InvVoucher
    // consolidation, Layer 4a). Reference is `voucher.reference`; status
    // is the InvVoucher status enum (DRAFT / POSTED / CANCELLED).
    invVoucher: {
        id: number;
        reference: string;
        type: string;
        status: string;
        totalAmount: string;
    } | null;
};

function partyLabel(order: OrderDetail): string {
    if (order.account?.customer?.name) return order.account.customer.name;
    if (order.account?.company?.name) return order.account.company.name;
    if (order.customer?.name) return order.customer.name;
    return "—";
}

export default function EcommerceOrderDetailPage() {
    const params = useParams();
    const id = Number(params.id);
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [returnOpen, setReturnOpen] = useState(false);
    const [rBrand, setRBrand] = useState("");
    const [rModel, setRModel] = useState("");
    const [rProblem, setRProblem] = useState("");

    const load = useCallback(() => {
        if (!Number.isFinite(id)) return;
        axios
            .get<OrderDetail>(`/api/ecommerce/orders/${id}`)
            .then((r) => setOrder(r.data))
            .catch(() => setOrder(null));
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    const spawnReturn = async () => {
        if (!rBrand.trim() || !rModel.trim() || !rProblem.trim()) {
            toast.error("Brand, model, and problem are required");
            return;
        }
        try {
            const res = await axios.post<{ id: number }>(`/api/ecommerce/orders/${id}/return-ticket`, {
                brand: rBrand.trim(),
                model: rModel.trim(),
                problem: rProblem.trim(),
            });
            toast.success(`Ticket #${res.data.id} created`);
            setReturnOpen(false);
            load();
        } catch (e: unknown) {
            const msg =
                axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object"
                    ? (e.response.data as { error?: string }).error
                    : "Failed";
            toast.error(msg ?? "Failed");
        }
    };

    if (!Number.isFinite(id)) {
        return <p className="text-destructive">Invalid order id.</p>;
    }

    if (!order) {
        return <p className="text-muted-foreground">Loading…</p>;
    }

    // Derive the display status label + color
    const statusLabel = order.orderStatus?.label ?? order.status;
    const statusColor = order.orderStatus?.color ?? "bg-gray-100 text-gray-600";

    // Next statuses for pipeline mode
    const nextStatuses: NextPipelineStatus[] | undefined = order.orderStatus
        ? order.orderStatus.toTransitions.map((t) => t.to)
        : undefined;

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
                        <Link href="/office/ecommerce/orders">← Orders</Link>
                    </Button>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl font-semibold tracking-tight">Order #{order.id}</h1>
                        <OrderSourceBadge source={order.orderSource} />
                        <Badge className={`text-xs font-medium ${statusColor}`} variant="outline">
                            {statusLabel}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm mt-1">
                        {new Date(order.createdAt).toLocaleString("en-IN")}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-lg font-semibold">{formatRupeesFromPaise(order.totalPaise)}</p>
                    {order.courier && (
                        <p className="text-muted-foreground text-xs">
                            {order.courier} · {order.trackingNumber ?? "—"}
                        </p>
                    )}
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-6">
                    {/* Status actions — pipeline mode if statusId set, legacy enum otherwise */}
                    <OrderStatusActions
                        orderId={order.id}
                        onUpdated={load}
                        statusId={order.statusId}
                        nextStatuses={nextStatuses}
                        status={order.statusId ? null : order.status}
                    />

                    {/* Line items */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-3 font-medium">Line items</h2>
                        <ul className="space-y-2 text-sm">
                            {order.lines.map((l) => (
                                <li key={l.id} className="flex justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                                    <span>{l.product.name}</span>
                                    <span className="text-muted-foreground">
                                        ×{l.quantity} · {formatRupeesFromPaise(l.unitPricePaise * l.quantity)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Return ticket */}
                    <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
                        <DialogTrigger asChild>
                            <Button type="button" variant="outline">
                                Spawn return ticket
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Return / RMA ticket</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-3 py-2">
                                <div className="grid gap-1.5">
                                    <Label>Device brand</Label>
                                    <Input value={rBrand} onChange={(e) => setRBrand(e.target.value)} />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label>Model</Label>
                                    <Input value={rModel} onChange={(e) => setRModel(e.target.value)} />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label>Problem</Label>
                                    <Input value={rProblem} onChange={(e) => setRProblem(e.target.value)} />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" onClick={() => void spawnReturn()}>
                                    Create ticket
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Linked repair tickets */}
                    {order.tickets.length > 0 && (
                        <div className="rounded-lg border border-border p-4 text-sm">
                            <h2 className="mb-2 font-medium">Linked tickets</h2>
                            <ul className="space-y-1">
                                {order.tickets.map((t) => (
                                    <li key={t.id}>
                                        <Link href={`/office/repairing/tickets/${t.id}`} className="text-primary hover:underline">
                                            Ticket #{t.id}
                                        </Link>{" "}
                                        · {t.status}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    {/* Party / customer panel */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-2 font-medium">Billed to</h2>
                        <p className="font-medium">{partyLabel(order)}</p>
                        {order.account?.customer?.phone && (
                            <p className="text-muted-foreground text-sm">{order.account.customer.phone}</p>
                        )}
                        {order.customer?.email && (
                            <p className="text-muted-foreground text-sm">{order.customer.email}</p>
                        )}
                        {order.account?.company && (
                            <p className="text-xs text-muted-foreground mt-1">Company: {order.account.company.name}</p>
                        )}
                        {!order.account && order.customer && (
                            <p className="text-xs text-muted-foreground mt-1">
                                {order.customer.email} · {order.customer.phone}
                            </p>
                        )}
                    </div>

                    {/* Invoice panel */}
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-3 font-medium flex items-center gap-2">
                            <FileText size={15} className="text-muted-foreground" />
                            Invoice
                        </h2>
                        {order.invVoucher ? (() => {
                            const v = order.invVoucher;
                            const href = editFormUrl(v.type, v.id) ?? "#";
                            return (
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-mono text-sm font-semibold text-primary">{v.reference}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {v.status} · {formatRupeesFromPaise(Math.round(Number(v.totalAmount) * 100))}
                                        </p>
                                    </div>
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href={href}>
                                            <ExternalLink size={13} /> Open voucher
                                        </Link>
                                    </Button>
                                </div>
                            );
                        })() : (
                            <p className="text-sm text-muted-foreground">
                                No invoice yet. Raise it <span className="font-medium">manually</span> from the
                                Sales voucher screen, then link it to this order.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
