"use client";

// /office/pos/shifts — Shift report page (manager / admin view)
//
// Lists shifts in the active branch by default. Filters: status, counter,
// date range, branch scope (admin). Variance column color-coded.

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight, ArrowDownUp, Clock, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";

type ShiftRow = {
    id: number;
    user:    { id: number; name: string; email: string };
    branch:  { id: string; name: string };
    counter: { id: number; name: string; tillAccount: { id: number; name: string } };
    status: "OPEN" | "AWAITING_HANDOVER" | "CLOSED";
    openedAt: string;
    closedAt: string | null;
    openingFloatPaise: string;
    declaredCashPaise: string | null;
    variancePaise:     string | null;
    toVaultPaise:      string | null;
    _count: { drops: number };
};

export default function ShiftsReportPage() {
    const [rows, setRows]           = useState<ShiftRow[]>([]);
    const [loading, setLoading]     = useState(true);
    const [status, setStatus]       = useState<"" | "OPEN" | "AWAITING_HANDOVER" | "CLOSED">("");
    const [branchScope, setBranchScope] = useState<"active" | "all">("active");
    const [from, setFrom] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
    });
    const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

    useEffect(() => {
        setLoading(true);
        const q = new URLSearchParams();
        if (status) q.set("status", status);
        if (branchScope === "all") q.set("branchId", "all");
        if (from) q.set("from", from);
        if (to)   q.set("to",   to);
        axios.get<ShiftRow[]>(`/api/pos/shifts?${q}`)
            .then((r) => setRows(r.data))
            .catch((e) => {
                const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
                toast.error(msg ?? "Failed to load shifts");
            })
            .finally(() => setLoading(false));
    }, [status, branchScope, from, to]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">POS Shifts</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Counter sessions, mid-shift drops, and cashier handovers.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
                <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v as typeof status)}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All statuses</SelectItem>
                        <SelectItem value="OPEN">Open</SelectItem>
                        <SelectItem value="AWAITING_HANDOVER">Awaiting handover</SelectItem>
                        <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={branchScope} onValueChange={(v) => setBranchScope(v as "active" | "all")}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="Branch" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="active">Active branch</SelectItem>
                        <SelectItem value="all">All branches</SelectItem>
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    From
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" />
                    To
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 text-xs" />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                    No shifts in this period.
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Opened</th>
                                <th className="px-4 py-3 text-left font-medium">User</th>
                                <th className="px-4 py-3 text-left font-medium">Counter</th>
                                <th className="px-4 py-3 text-right font-medium">Opening</th>
                                <th className="px-4 py-3 text-right font-medium">Declared</th>
                                <th className="px-4 py-3 text-right font-medium">→ Vault</th>
                                <th className="px-4 py-3 text-right font-medium">Variance</th>
                                <th className="px-4 py-3 text-center font-medium">Drops</th>
                                <th className="px-4 py-3 text-center font-medium">Status</th>
                                <th className="px-4 py-3 text-right" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const variance = r.variancePaise ? Number(r.variancePaise) / 100 : null;
                                return (
                                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            {formatDate(r.openedAt)} · {new Date(r.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-3">{r.user.name}</td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs">
                                            <span>{r.counter.name}</span>
                                            <span className="ml-1 text-muted-foreground/60">· {r.branch.name}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">₹{fmt(Number(r.openingFloatPaise) / 100)}</td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {r.declaredCashPaise != null ? `₹${fmt(Number(r.declaredCashPaise) / 100)}` : <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                            {r.toVaultPaise != null ? `₹${fmt(Number(r.toVaultPaise) / 100)}` : <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {variance == null ? <span className="text-muted-foreground/40">—</span> : <VarianceCell amount={variance} />}
                                        </td>
                                        <td className="px-4 py-3 text-center text-muted-foreground">{r._count.drops}</td>
                                        <td className="px-4 py-3 text-center">
                                            <StatusBadge status={r.status} />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link href={`/office/pos/shifts/${r.id}`} className="text-muted-foreground/40 hover:text-primary">
                                                <ChevronRight size={16} />
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    if (status === "OPEN") return (
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 inline-flex items-center gap-1">
            <Clock size={11} /> Open
        </span>
    );
    if (status === "AWAITING_HANDOVER") return (
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center gap-1">
            <Users size={11} /> Handover
        </span>
    );
    return <span className="text-xs px-2 py-0.5 rounded font-medium bg-muted text-muted-foreground">Closed</span>;
}

function VarianceCell({ amount }: { amount: number }) {
    if (amount === 0) return <span className="text-emerald-700 dark:text-emerald-400">₹0</span>;
    const abs = Math.abs(amount);
    const colorClass = abs > 50 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
    return (
        <span className={`inline-flex items-center gap-1 ${colorClass}`}>
            {abs > 50 && <AlertTriangle size={11} />}
            <ArrowDownUp size={11} />
            {amount > 0 ? "+" : "−"}₹{fmt(abs)}
        </span>
    );
}
