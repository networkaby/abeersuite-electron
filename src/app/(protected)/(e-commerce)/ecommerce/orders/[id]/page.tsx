"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatRupeesFromPaise } from "@/lib/money-inr";
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
import OrderInvoice from "@/modules/ecommerce/components/OrderInvoice";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import type { ShopOrderStatus } from "@/generated/prisma/enums";
import { toast } from "sonner";

type OrderDetail = {
    id: number;
    status: ShopOrderStatus;
    totalPaise: number;
    guestEmail: string | null;
    guestPhone: string | null;
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
    lines: {
        id: number;
        quantity: number;
        unitPricePaise: number;
        product: { id: number; name: string; imageUrl: string | null };
    }[];
    tickets: { id: number; status: string; createdAt: string }[];
};

type CustomerApi = {
    companies: { id: number; company: { id: number; name: string; phone: string | null } }[];
};

export default function EcommerceOrderDetailPage() {
    const params = useParams();
    const id = Number(params.id);
    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [customerLinks, setCustomerLinks] = useState<CustomerApi["companies"]>([]);
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

    useEffect(() => {
        const cid = order?.customerId;
        if (!cid) {
            startTransition(() => {
                setCustomerLinks([]);
            });
            return;
        }
        let cancelled = false;
        axios
            .get<CustomerApi>(`/api/customers/${cid}`)
            .then((r) => {
                if (!cancelled) setCustomerLinks(r.data.companies ?? []);
            })
            .catch(() => {
                if (!cancelled) setCustomerLinks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [order?.customerId]);

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

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
                        <Link href="/ecommerce/orders">← Orders</Link>
                    </Button>
                    <h1 className="text-2xl font-semibold tracking-tight">Order #{order.id}</h1>
                    <p className="text-muted-foreground text-sm">
                        {new Date(order.createdAt).toLocaleString("en-IN")} ·{" "}
                        <Badge variant="secondary">{order.status}</Badge>
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-lg font-semibold">{formatRupeesFromPaise(order.totalPaise)}</p>
                    {order.courier ? (
                        <p className="text-muted-foreground text-xs">
                            {order.courier} · {order.trackingNumber ?? "—"}
                        </p>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-6">
                    <OrderStatusActions orderId={order.id} status={order.status} onUpdated={load} />

                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-3 font-medium">Line items</h2>
                        <ul className="space-y-2 text-sm">
                            {order.lines.map((l) => (
                                <li key={l.id} className="flex justify-between gap-2 border-b border-border/60 pb-2">
                                    <span>{l.product.name}</span>
                                    <span className="text-muted-foreground">
                                        ×{l.quantity} · {formatRupeesFromPaise(l.unitPricePaise * l.quantity)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
                        <DialogTrigger asChild>
                            <Button type="button" variant="outline" disabled={order.status === "REFUNDED"}>
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

                    {order.tickets.length > 0 ? (
                        <div className="rounded-lg border border-border p-4 text-sm">
                            <h2 className="mb-2 font-medium">Linked tickets</h2>
                            <ul className="space-y-1">
                                {order.tickets.map((t) => (
                                    <li key={t.id}>
                                        <Link href={`/tickets/${t.id}`} className="text-primary hover:underline">
                                            Ticket #{t.id}
                                        </Link>{" "}
                                        · {t.status}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>

                <div className="space-y-6">
                    <div className="rounded-lg border border-border p-4">
                        <h2 className="mb-2 font-medium">Customer</h2>
                        {order.customer ? (
                            <>
                                <p className="font-medium">{order.customer.name}</p>
                                <p className="text-muted-foreground text-sm">{order.customer.email}</p>
                                <p className="text-muted-foreground text-sm">{order.customer.phone}</p>
                                <div className="mt-4">
                                    <CustomerLinkPanel
                                        customerId={order.customer.id}
                                        initialLinks={customerLinks.map((lc) => ({
                                            id: lc.id,
                                            company: lc.company,
                                        }))}
                                    />
                                </div>
                            </>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Guest · {order.guestEmail ?? "—"} · {order.guestPhone ?? "—"}
                            </p>
                        )}
                    </div>

                    <OrderInvoice
                        orderId={order.id}
                        createdAt={order.createdAt}
                        status={order.status}
                        lines={order.lines}
                        totalPaise={order.totalPaise}
                        guestEmail={order.guestEmail}
                        guestPhone={order.guestPhone}
                        customerName={order.customer?.name ?? null}
                    />
                </div>
            </div>
        </div>
    );
}
