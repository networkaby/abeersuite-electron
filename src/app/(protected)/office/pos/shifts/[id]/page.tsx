"use client";

// /office/pos/shifts/[id] — Shift detail / audit view
//
// Header summary, drops timeline, linked opening + closing Contras, and
// the variance JE (if any). Read-only.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ArrowDownUp, Lock, ExternalLink, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";

type ShiftDetail = {
    id: number;
    status: "OPEN" | "CLOSED";
    user:        { id: number; name: string; email: string };
    branch:      { id: string; name: string };
    tillAccount: { id: number; name: string; balance: string | number };
    openedBy:    { id: number; name: string };
    closedBy:    { id: number; name: string } | null;
    openedAt: string;
    closedAt: string | null;
    openingFloatPaise: string;
    declaredCashPaise: string | null;
    expectedCashPaise: string | null;
    variancePaise:     string | null;
    cashSalesPaise:    string;
    dropsPaise:        string;
    runningExpectedPaise: string;
    notes: string | null;
    openingContraVoucher: { id: number; reference: string; date: string } | null;
    closingContraVoucher: { id: number; reference: string; date: string } | null;
    varianceJournalEntry: { id: number; reference: string; date: string } | null;
    drops: { id: number; amountPaise: string; droppedAt: string; notes: string | null; droppedBy: { id: number; name: string } }[];
};

export default function ShiftDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [shift, setShift] = useState<ShiftDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get<ShiftDetail>(`/api/pos/shifts/${id}`)
            .then((r) => setShift(r.data))
            .catch(() => toast.error("Failed to load shift"))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    if (!shift) return <div className="py-20 text-center text-muted-foreground">Shift not found.</div>;

    const variance = shift.variancePaise != null ? Number(shift.variancePaise) / 100 : null;

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon-sm" onClick={() => router.push("/office/pos/shifts")} aria-label="Back">
                    <ArrowLeft size={16} />
                </Button>
                <div>
                    <h1 className="text-xl font-bold">Shift #{shift.id}</h1>
                    <p className="text-sm text-muted-foreground">{shift.user.name} · {shift.branch.name} · {shift.tillAccount.name}</p>
                </div>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${shift.status === "OPEN" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                    {shift.status}
                </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <StatBox label="Opening float"     value={`₹${fmt(Number(shift.openingFloatPaise) / 100)}`} />
                <StatBox label="Cash sales"        value={`₹${fmt(Number(shift.cashSalesPaise) / 100)}`} />
                <StatBox label="Cash dropped"      value={`₹${fmt(Number(shift.dropsPaise) / 100)}`} />
                <StatBox label="Expected / Declared"
                    value={
                        shift.declaredCashPaise != null
                            ? `₹${fmt(Number(shift.declaredCashPaise) / 100)} / ₹${fmt(Number(shift.expectedCashPaise) / 100)}`
                            : `₹${fmt(Number(shift.runningExpectedPaise) / 100)} (live)`
                    }
                />
            </div>

            {variance != null && variance !== 0 && (
                <div className={`rounded-lg border p-3 text-sm ${variance > 0 ? "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/30" : "border-red-400/40 bg-red-50 dark:bg-red-950/30"}`}>
                    <ArrowDownUp size={14} className="inline mr-1" />
                    Variance: <span className="font-mono font-semibold">{variance > 0 ? "+" : "−"}₹{fmt(Math.abs(variance))}</span> — posted as {variance > 0 ? "Cash Over (income)" : "Cash Short (expense)"}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                {shift.openingContraVoucher && (
                    <Card label="Opening Contra">
                        <Link href={`/office/accountancy/vouchers/${shift.openingContraVoucher.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.openingContraVoucher.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
                {shift.closingContraVoucher && (
                    <Card label="Closing Contra (handover)">
                        <Link href={`/office/accountancy/vouchers/${shift.closingContraVoucher.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.closingContraVoucher.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
                {shift.varianceJournalEntry && (
                    <Card label="Variance JE">
                        <Link href={`/office/accountancy/journal-entries/${shift.varianceJournalEntry.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.varianceJournalEntry.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
            </div>

            <div>
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Lock size={14} className="text-muted-foreground" /> Cash drops to safe ({shift.drops.length})
                </h2>
                {shift.drops.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">No mid-shift drops recorded.</div>
                ) : (
                    <div className="rounded-lg border border-border bg-card overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium">Time</th>
                                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                                    <th className="px-4 py-2 text-left font-medium">By</th>
                                    <th className="px-4 py-2 text-left font-medium">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shift.drops.map((d) => (
                                    <tr key={d.id} className="border-b last:border-0">
                                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                            {formatDate(d.droppedAt)} · {new Date(d.droppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono">₹{fmt(Number(d.amountPaise) / 100)}</td>
                                        <td className="px-4 py-2 text-xs">{d.droppedBy.name}</td>
                                        <td className="px-4 py-2 text-xs text-muted-foreground">{d.notes ?? "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {shift.notes && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <div className="text-xs text-muted-foreground mb-1">Notes</div>
                    <div className="whitespace-pre-wrap">{shift.notes}</div>
                </div>
            )}

            <div className="text-xs text-muted-foreground space-y-0.5 pt-4 border-t border-border">
                <p><Wallet size={11} className="inline mr-1" /> Till: {shift.tillAccount.name}</p>
                <p>Opened by {shift.openedBy.name} on {formatDate(shift.openedAt)} at {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                {shift.closedAt && shift.closedBy && (
                    <p>Closed by {shift.closedBy.name} on {formatDate(shift.closedAt)} at {new Date(shift.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                )}
            </div>
        </div>
    );
}

function StatBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="font-medium font-mono text-sm">{value}</p>
        </div>
    );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
            <p className="text-muted-foreground text-xs">{label}</p>
            <div className="font-medium">{children}</div>
        </div>
    );
}
