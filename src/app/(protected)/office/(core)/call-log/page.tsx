import { headers } from "next/headers";
import { PhoneCall, Clock3 } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import CallLogFilters from "./CallLogFilters";

type CallLogItem = {
    id: number;
    customerName: string;
    phone: string;
    direction: "INBOUND" | "OUTBOUND";
    status: "CONNECTED" | "MISSED" | "FAILED" | "VOICEMAIL";
    durationSec: number;
    followUpAmount: number;
    updatedAt: string;
};

type CallLogQuery = {
    search?: string;
    status?: string;
    direction?: string;
};

const STATUS_OPTIONS = ["CONNECTED", "MISSED", "FAILED", "VOICEMAIL"] as const;
const DIRECTION_OPTIONS = ["INBOUND", "OUTBOUND"] as const;

function formatDuration(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds || 0);
    const mins = Math.floor(safe / 60).toString().padStart(2, "0");
    const secs = Math.floor(safe % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
}

function formatDirection(value: CallLogItem["direction"]) {
    return value === "INBOUND" ? "Inbound" : "Outbound";
}

function formatStatus(value: CallLogItem["status"]) {
    return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatUpdatedAt(value: string) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

async function getCallLogs(query: CallLogQuery) {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    if (!host) return [];

    const params = new URLSearchParams({ page: "1", pageSize: "50" });
    if (query.search) params.set("search", query.search);
    if (query.status) params.set("status", query.status);
    if (query.direction) params.set("direction", query.direction);

    const res = await fetch(`${proto}://${host}/api/call-logs?${params.toString()}`, {
        cache: "no-store",
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { items?: CallLogItem[] };
    return data.items ?? [];
}

export default async function CallLogPage({
    searchParams,
}: {
    searchParams: Promise<{ search?: string; status?: string; direction?: string }>;
}) {
    const query = await searchParams;
    const selectedStatus = STATUS_OPTIONS.includes((query.status ?? "") as (typeof STATUS_OPTIONS)[number])
        ? (query.status as (typeof STATUS_OPTIONS)[number])
        : "";
    const selectedDirection = DIRECTION_OPTIONS.includes((query.direction ?? "") as (typeof DIRECTION_OPTIONS)[number])
        ? (query.direction as (typeof DIRECTION_OPTIONS)[number])
        : "";
    const search = (query.search ?? "").trim();

    const callLogs = await getCallLogs({
        search: search || undefined,
        status: selectedStatus || undefined,
        direction: selectedDirection || undefined,
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <PhoneCall size={24} className="text-primary" />
                    <div>
                        <h1 className="text-3xl font-bold">Call Log</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Track all recent inbound and outbound calls.
                        </p>
                    </div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
                    <Clock3 size={14} />
                    Last sync: just now
                </div>
            </div>

            <CallLogFilters
                search={search}
                selectedStatus={selectedStatus}
                selectedDirection={selectedDirection}
                statusOptions={STATUS_OPTIONS}
                directionOptions={DIRECTION_OPTIONS}
            />

            <div className="rounded-lg border border-border bg-card shadow">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Call ID</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Direction</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Follow-up</TableHead>
                            <TableHead>Updated</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {callLogs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                                    No call logs found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            callLogs.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell className="font-medium">CL-{log.id}</TableCell>
                                    <TableCell>{log.customerName}</TableCell>
                                    <TableCell>{log.phone || "-"}</TableCell>
                                    <TableCell>{formatDirection(log.direction)}</TableCell>
                                    <TableCell>{formatStatus(log.status)}</TableCell>
                                    <TableCell>{formatDuration(log.durationSec)}</TableCell>
                                    <TableCell>{formatCurrency(log.followUpAmount)}</TableCell>
                                    <TableCell className="text-muted-foreground">{formatUpdatedAt(log.updatedAt)}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
