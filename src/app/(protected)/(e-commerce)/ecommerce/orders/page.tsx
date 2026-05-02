"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { ShopOrderStatus } from "@/generated/prisma/enums";

type OrderRow = {
    id: number;
    status: ShopOrderStatus;
    totalPaise: number;
    createdAt: string;
    customer: { id: number; name: string; email: string | null; phone: string | null } | null;
    account: { id: number; company: { id: number; name: string } | null } | null;
    lines: { id: number; quantity: number; unitPricePaise: number; product: { id: number; name: string } }[];
};

const STATUSES: ShopOrderStatus[] = [
    "DRAFT",
    "PENDING_PAYMENT",
    "PAID",
    "PACKED",
    "SHIPPED",
    "DELIVERED",
    "REFUNDED",
    "CANCELLED",
];

export default function EcommerceOrdersPage() {
    const sp = useSearchParams();
    const statusInit = sp.get("status") as ShopOrderStatus | null;
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [status, setStatus] = useState<string>(statusInit ?? "");
    const [q, setQ] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    const query = useMemo(() => {
        const p = new URLSearchParams();
        if (status) p.set("status", status);
        if (q.trim()) p.set("q", q.trim());
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        return p.toString();
    }, [status, q, from, to]);

    const load = useCallback(() => {
        axios
            .get<OrderRow[]>(`/api/ecommerce/orders${query ? `?${query}` : ""}`)
            .then((r) => setOrders(r.data))
            .catch(() => setOrders([]));
    }, [query]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
                <p className="text-muted-foreground text-sm">Search and filter shop orders.</p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
                <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <select
                        className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                    >
                        <option value="">All</option>
                        {STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="grid min-w-[12rem] flex-1 gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Search</label>
                    <Input
                        placeholder="Order id, customer, company…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
                <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">From</label>
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">To</label>
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <Button type="button" variant="secondary" onClick={() => void load()}>
                    Refresh
                </Button>
            </div>

            <div className="rounded-md border border-border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Created</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders.map((o) => (
                            <TableRow key={o.id}>
                                <TableCell>
                                    <Link href={`/ecommerce/orders/${o.id}`} className="font-medium text-primary hover:underline">
                                        #{o.id}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline">{o.status}</Badge>
                                </TableCell>
                                <TableCell className="max-w-[14rem] truncate text-sm">
                                    {o.account?.company?.name ?? o.customer?.name ?? "—"}
                                </TableCell>
                                <TableCell className="text-right">{formatRupeesFromPaise(o.totalPaise)}</TableCell>
                                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                                    {new Date(o.createdAt).toLocaleString("en-IN")}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {orders.length === 0 ? (
                    <p className="text-muted-foreground p-6 text-center text-sm">No orders match.</p>
                ) : null}
            </div>
        </div>
    );
}
