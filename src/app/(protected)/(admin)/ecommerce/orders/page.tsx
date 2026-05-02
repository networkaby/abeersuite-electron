"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { formatRupeesFromPaise } from "@/lib/money-inr";

type OrderRow = {
    id: number;
    status: string;
    totalPaise: number;
    guestEmail: string | null;
    guestPhone: string | null;
    createdAt: string;
    customer: { id: number; name: string; email: string | null; phone: string | null } | null;
    lines: { id: number; quantity: number; unitPricePaise: number; product: { name: string } }[];
};

export default function EcommerceOrdersAdminPage() {
    const [orders, setOrders] = useState<OrderRow[]>([]);

    useEffect(() => {
        axios
            .get<OrderRow[]>("/api/ecommerce/orders")
            .then((r) => setOrders(r.data))
            .catch(() => setOrders([]));
    }, []);

    return (
        <div className="space-y-6 max-w-4xl">
            <h1 className="text-2xl font-semibold">Shop orders</h1>
            <ul className="space-y-3">
                {orders.map((o) => (
                    <li key={o.id} className="border border-border rounded-lg p-4 text-sm space-y-2">
                        <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">Order #{o.id}</span>
                            <span>{formatRupeesFromPaise(o.totalPaise)}</span>
                        </div>
                        <p className="text-muted-foreground">
                            {o.status} ·{" "}
                            {o.customer
                                ? `Customer: ${o.customer.name}`
                                : `Guest ${o.guestEmail ?? ""} ${o.guestPhone ?? ""}`}
                        </p>
                        <ul className="list-disc pl-4">
                            {o.lines.map((l) => (
                                <li key={l.id}>
                                    {l.product.name} × {l.quantity} — {formatRupeesFromPaise(l.unitPricePaise * l.quantity)}
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
            {orders.length === 0 ? <p className="text-muted-foreground">No orders yet.</p> : null}
        </div>
    );
}
