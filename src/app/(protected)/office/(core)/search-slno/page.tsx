"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Search, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type SearchRow = {
    deviceId: number;
    slNo: string;
    customerName: string;
    deviceName: string;
    deviceType: string;
    problem: string;
    status: { label: string; color: string };
    updatedAt: string;
};

type DeviceTicketPayload = {
    device: {
        id: number;
        type: string;
        brand: string;
        model: string;
        problem: string;
        customerName: string;
        customerPhone: string | null;
        slNo: string;
        updatedAt: string;
    };
    tickets: Array<{
        id: number;
        externalRef?: string | null;
        warrantyRef?: string | null;
        createdAt: string;
        updatedAt: string;
        status: { label: string; color: string };
        subStatus?: { label: string; color: string } | null;
    }>;
};

export default function SearchSlNoPage() {
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<SearchRow[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
    const [detail, setDetail] = useState<DeviceTicketPayload | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            setLoadingList(true);
            try {
                const res = await axios.get<SearchRow[]>("/api/search-slno", {
                    params: query ? { q: query } : undefined,
                    signal: controller.signal,
                });
                setRows(res.data);
                setSelectedDeviceId((prev) => {
                    if (!res.data.length) return null;
                    if (!prev) return res.data[0].deviceId;
                    return res.data.some((row) => row.deviceId === prev) ? prev : res.data[0].deviceId;
                });
            } catch {
                toast.error("Failed to load search list");
            } finally {
                setLoadingList(false);
            }
        }, 250);
        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [query]);

    useEffect(() => {
        if (!selectedDeviceId) {
            setDetail(null);
            return;
        }
        setLoadingDetail(true);
        axios
            .get<DeviceTicketPayload>(`/api/search-slno/${selectedDeviceId}`)
            .then((res) => setDetail(res.data))
            .catch(() => toast.error("Failed to load device details"))
            .finally(() => setLoadingDetail(false));
    }, [selectedDeviceId]);

    const selectedRow = useMemo(
        () => rows.find((row) => row.deviceId === selectedDeviceId) ?? null,
        [rows, selectedDeviceId]
    );

    return (
        <div className="-m-8 flex h-screen">
            <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Search size={16} className="text-primary" />
                        <span className="text-sm font-semibold">Search SLno</span>
                        <Badge variant="outline">{rows.length}</Badge>
                    </div>
                </div>

                <div className="border-b p-3">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search device SL no, brand, model, type..."
                            className="pl-9"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loadingList ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <Loader2 size={18} className="animate-spin" />
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="py-8 text-center text-xs text-muted-foreground">No results found.</p>
                    ) : (
                        rows.map((row) => (
                            <Button
                                key={row.deviceId}
                                type="button"
                                variant="ghost"
                                className="h-auto w-full justify-start rounded-none border-b px-4 py-3"
                                onClick={() => setSelectedDeviceId(row.deviceId)}
                            >
                                <div className="w-full text-left">
                                    <p className="text-sm font-semibold">
                                        Device SL No: {row.slNo || "-"}
                                    </p>
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                        {row.deviceName} • {row.deviceType}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        Customer: {row.customerName}
                                    </p>
                                </div>
                            </Button>
                        ))
                    )}
                </div>
            </aside>

            <section className="flex flex-1 flex-col overflow-hidden bg-muted/30">
                {!selectedDeviceId && (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Select a device from the list to view details.
                    </div>
                )}

                {selectedDeviceId && loadingDetail && (
                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                )}

                {selectedDeviceId && detail && !loadingDetail && (
                    <>
                        <div className="border-b bg-card px-6 py-4">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h1 className="text-xl font-bold">
                                        {detail.device.brand} {detail.device.model}
                                    </h1>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {detail.device.customerName} • {detail.device.type}
                                    </p>
                                </div>
                                <Badge variant="outline">{detail.tickets.length} ticket{detail.tickets.length !== 1 ? "s" : ""}</Badge>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-3">
                                <p className="flex items-center gap-1">
                                    <Smartphone size={13} />
                                    Device SL No: {selectedRow?.slNo || detail.device.slNo || "-"}
                                </p>
                                <p className="flex items-center gap-1">
                                    Device: {detail.device.type} • {detail.device.brand} {detail.device.model}
                                </p>
                                <p>Last update: {formatDate(detail.device.updatedAt)}</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="rounded-md border bg-card p-4">
                                <h2 className="text-sm font-semibold">Tickets for this Device</h2>
                                <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                                    <div>
                                        <p className="text-xs text-muted-foreground">Customer</p>
                                        <p className="font-medium">{detail.device.customerName || "-"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Customer Phone</p>
                                        <p className="font-medium">{detail.device.customerPhone ?? "-"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Problem</p>
                                        <p className="font-medium">{detail.device.problem || "-"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Reference</p>
                                        <p className="font-medium">{selectedRow?.slNo || detail.device.slNo || "-"}</p>
                                    </div>
                                </div>

                                <div className="mt-4 rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Ticket #</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Sub-Status</TableHead>
                                                <TableHead>Created</TableHead>
                                                <TableHead>Updated</TableHead>
                                                <TableHead>Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {detail.tickets.map((ticket) => (
                                                <TableRow key={ticket.id}>
                                                    <TableCell className="font-medium">#{ticket.id}</TableCell>
                                                    <TableCell>
                                                        <Badge className={ticket.status.color}>{ticket.status.label}</Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {ticket.subStatus ? (
                                                            <Badge className={ticket.subStatus.color}>{ticket.subStatus.label}</Badge>
                                                        ) : (
                                                            "-"
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {formatDate(ticket.createdAt)}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {formatDate(ticket.updatedAt)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button asChild size="sm" variant="outline">
                                                            <Link href={`/office/tickets/${ticket.id}`}>Open</Link>
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
