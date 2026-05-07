"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";

const STATUS_COLORS: Record<string, string> = {
    DRAFT:  "bg-yellow-100 text-yellow-700",
    POSTED: "bg-green-100 text-green-700",
    CANCELLED: "bg-muted text-muted-foreground",
};

interface Voucher {
    id:          number;
    reference:   string;
    date:        string;
    description: string;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    partyName:   string | null;
    totalAmount: number;
    _count:      { lines: number };
    createdBy:   { name: string };
}

export default function PurchasesPage() {
    const [vouchers, setVouchers] = useState<Voucher[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [status,   setStatus]   = useState("");

    const load = () => {
        setLoading(true);
        const q = new URLSearchParams({ type: "PURCHASE", ...(status && { status }) });
        axios.get<Voucher[]>(`/api/inventory/vouchers?${q}`)
            .then((r) => setVouchers(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(load, [status]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Purchases</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Purchase vouchers — stock & GL ledger</p>
                </div>
                <Link href="/office/accountancy/purchases/new">
                    <Button><Plus size={16} /> New Purchase</Button>
                </Link>
            </div>

            {/* Status tabs */}
            <div className="flex gap-1">
                {(["", "DRAFT", "POSTED", "CANCELLED"] as const).map((s) => (
                    <Button
                        key={s}
                        onClick={() => setStatus(s)}
                        variant="outline"
                        size="xs"
                        className={`h-auto px-3 py-1.5 text-xs font-medium transition-colors ${
                            status === s
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {s || "All"}
                    </Button>
                ))}
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    {vouchers.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            No purchase vouchers yet.{" "}
                            <Link href="/office/accountancy/purchases/new" className="text-primary hover:underline">
                                Create one
                            </Link>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-3 text-left font-medium">Reference</th>
                                    <th className="px-5 py-3 text-left font-medium">Date</th>
                                    <th className="px-5 py-3 text-left font-medium">Supplier</th>
                                    <th className="px-5 py-3 text-left font-medium">Narration</th>
                                    <th className="px-5 py-3 text-center font-medium w-16">Items</th>
                                    <th className="px-5 py-3 text-right font-medium">Total</th>
                                    <th className="px-5 py-3 text-center font-medium">Status</th>
                                    <th className="px-5 py-3 text-left font-medium text-xs">By</th>
                                    <th className="px-3 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {vouchers.map((v) => (
                                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-5 py-3 font-mono text-primary text-xs">{v.reference}</td>
                                        <td className="px-5 py-3 text-muted-foreground text-xs">
                                            {new Date(v.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                        </td>
                                        <td className="px-5 py-3 text-foreground">{v.partyName ?? <span className="text-muted-foreground/50">—</span>}</td>
                                        <td className="px-5 py-3 text-muted-foreground max-w-[200px] truncate">{v.description}</td>
                                        <td className="px-5 py-3 text-center text-muted-foreground">{v._count.lines}</td>
                                        <td className="px-5 py-3 text-right font-mono font-medium">₹ {fmt(Number(v.totalAmount))}</td>
                                        <td className="px-5 py-3 text-center">
                                            <span className={`text-xs px-2 py-0.5 font-medium rounded-sm ${STATUS_COLORS[v.status]}`}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-muted-foreground text-xs">{v.createdBy.name}</td>
                                        <td className="px-3 py-3 text-right">
                                            <Link href={`/office/accountancy/purchases/${v.id}`} className="text-muted-foreground/40 hover:text-primary">
                                                <ChevronRight size={16} />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
