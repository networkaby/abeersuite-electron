"use client";

// /office/pos/shifts/[id] — Shift detail / audit view
//
// Comprehensive audit page displaying full shift details:
// - Header timeline & audit stats (cashier, counter, branch, duration)
// - Cash position, physical reconciliation & variance
// - 3 financial breakdown cards: Till Movement (cash flows), Payments Collected (all tenders),
//   and Total Collections Breakdown (sales/receipts/refunds)
// - Cash drops to safe table
// - Linked vouchers (Opening Contra, Closing Contra, Variance JE)
// - Handover chain and manager corrections ("Reopen & re-close", "Delete")

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, ArrowLeft, ArrowDownUp, Lock, ExternalLink, Monitor, Users,
    RotateCcw, Trash2, Clock, Calendar, TrendingUp, CreditCard, Receipt,
    ShieldCheck, Calculator, ArrowRightLeft, CheckCircle2, AlertTriangle, User, Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";

type MovementBreakdown = {
    cashSalesPaise: string;
    receiptsPaise: string;
    expendituresPaise: string;
    refundsPaise: string;
    otherPaise: string;
    netMovementPaise: string;
};

type CollectionsBreakdown = {
    salesPaise: string;
    salesCount: number;
    receiptsPaise: string;
    receiptsCount: number;
    refundsPaise: string;
    refundsCount: number;
    netCollectedPaise: string;
};

type TenderRow = {
    method: string;
    label: string;
    amountPaise: string;
};

type ShiftDetail = {
    id: number;
    status: "OPEN" | "AWAITING_HANDOVER" | "CLOSED";
    user:     { id: number; name: string; email: string };
    branch:   { id: string; name: string };
    counter:  { id: number; name: string; tillAccount: { id: number; name: string; balance: string } };
    openedBy: { id: number; name: string };
    closedBy: { id: number; name: string } | null;
    openedAt: string;
    closedAt: string | null;
    openingFloatPaise:   string;
    carryOverFloatPaise: string;
    vaultTopUpPaise:     string;
    declaredCashPaise:   string | null;
    expectedCashPaise:   string | null;
    variancePaise:       string | null;
    carryOverNextPaise:  string | null;
    toVaultPaise:        string | null;
    tillMovementPaise:   string;
    dropsPaise:          string;
    runningExpectedPaise: string;
    notes: string | null;
    openingContraVoucher: { id: number; reference: string; date: string } | null;
    closingContraVoucher: { id: number; reference: string; date: string } | null;
    varianceJournalEntry: { id: number; reference: string; date: string } | null;
    handover: {
        id: number; status: string;
        declaredByAPaise: string; countedByBPaise: string | null; carryOverPaise: string;
        toUser: { id: number; name: string };
        toShift: { id: number } | null;
    } | null;
    receivedHandover: {
        id: number;
        fromShift: { id: number; user: { name: string } };
        declaredByAPaise: string; countedByBPaise: string | null;
    } | null;
    drops: { id: number; amountPaise: string; droppedAt: string; notes: string | null; droppedBy: { id: number; name: string } }[];
    expenditures: { id: number }[];
    _count: { receipts: number };
    movementBreakdown?: MovementBreakdown;
    collectionsBreakdown?: CollectionsBreakdown;
    tenderBreakdown?: TenderRow[];
};

function formatDuration(openedAt: string, closedAt: string | null): string {
    const start = new Date(openedAt).getTime();
    const end = closedAt ? new Date(closedAt).getTime() : Date.now();
    const diffMs = Math.max(0, end - start);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours === 0) return `${diffMins} min${diffMins !== 1 ? "s" : ""}`;
    return `${hours} hr${hours > 1 ? "s" : ""} ${mins} min${mins !== 1 ? "s" : ""}`;
}

function signed(n: number) {
    if (n > 0) return `+₹${fmt(n)}`;
    if (n < 0) return `−₹${fmt(Math.abs(n))}`;
    return `₹${fmt(0)}`;
}

export default function ShiftDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router  = useRouter();
    const [shift, setShift]   = useState<ShiftDetail | null>(null);
    const [loading, setLoading] = useState(true);

    // Correcting a close is the same oversight tick as force-closing (the two
    // routes enforce the same pair server-side).
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManage = perms.includes(PERMISSIONS.ADMIN_BYPASS) || perms.includes(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);

    // Which correction is being asked for a reason; then the re-close dialog.
    const [asking, setAsking]     = useState<"reopen" | "delete" | null>(null);
    const [reason, setReason]     = useState("");
    const [busy, setBusy]         = useState(false);
    const [reclosing, setReclosing] = useState(false);
    // The close moment the shift had BEFORE reopen — the re-close dialog offers
    // it back as the default "Closed on", so the correction stays on that day.
    const [originalClosedAt, setOriginalClosedAt] = useState<string | null>(null);

    const load = useCallback(() => {
        axios.get<ShiftDetail>(`/api/pos/shifts/${id}`)
            .then((r) => setShift(r.data))
            .catch(() => toast.error("Failed to load shift"))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => { load(); }, [load]);
    // Drops, handovers and the close happen at the till — re-read when the books move.
    useRealtimeTopics(["ledger"], load);

    const submitCorrection = async () => {
        if (!asking || !reason.trim()) { toast.error("Please give a reason"); return; }
        setBusy(true);
        try {
            if (asking === "reopen") setOriginalClosedAt(shift?.closedAt ?? null);
            await axios.post(`/api/pos/shifts/${id}/${asking}`, { reason: reason.trim() });
            if (asking === "delete") {
                toast.success("Shift deleted");
                router.push("/office/pos/shifts");
                return;
            }
            toast.success("Shift reopened — now close it again with the correct figures");
            setAsking(null);
            setReason("");
            load();
            setReclosing(true);
        } catch (e: unknown) {
            toast.error(extractApiError(e, `Failed to ${asking} shift`));
        } finally {
            setBusy(false);
        }
    };

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    if (!shift)  return <div className="py-20 text-center text-muted-foreground">Shift not found.</div>;

    const variance = shift.variancePaise != null ? Number(shift.variancePaise) / 100 : null;
    const isOpen   = shift.status === "OPEN";
    const isHandover = shift.status === "AWAITING_HANDOVER";
    const isClosed = shift.status === "CLOSED";

    // Tender total
    const tenderTotal = (shift.tenderBreakdown ?? []).reduce((s, t) => s + Number(t.amountPaise) / 100, 0);

    const handlePrint = () => {
        if (!shift) return;
        window.open(`/receipt/shift/${shift.id}?autoprint=1`, "_blank", "noopener");
    };

    // What stops a delete — mirrors the delete route's own refusal.
    const attached = [
        shift._count.receipts > 0            ? `${shift._count.receipts} receipt(s)`         : null,
        shift.drops.length > 0               ? `${shift.drops.length} cash drop(s)`          : null,
        shift.expenditures.length > 0        ? `${shift.expenditures.length} expenditure(s)` : null,
        Number(shift.tillMovementPaise) !== 0 ? "till movement"                              : null,
    ].filter((x): x is string => x !== null);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 max-w-5xl px-6 pt-3 pb-8">
            {/* Header row */}
            <div className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-border">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon-sm" onClick={() => router.push("/office/pos/shifts")} aria-label="Back">
                        <ArrowLeft size={16} />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold tracking-tight">Shift #{shift.id}</h1>
                            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                                isOpen      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" :
                                isHandover  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
                                              "bg-muted text-muted-foreground border border-border"
                            }`}>
                                {isHandover ? "AWAITING HANDOVER" : shift.status}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <User size={12} className="text-muted-foreground" />
                            <span className="font-medium text-foreground">{shift.user.name}</span>
                            <span>·</span>
                            <Monitor size={12} className="text-muted-foreground" />
                            <span>{shift.counter.name}</span>
                            <span>·</span>
                            <span>{shift.branch.name}</span>
                        </p>
                    </div>
                </div>

                {/* Actions: Print and Manager corrections */}
                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={handlePrint}>
                        <Printer size={13} className="mr-1" /> Print
                    </Button>

                    {canManage && !isHandover && (
                        <>
                            {isClosed && (
                                <Button variant="outline" size="sm" onClick={() => { setReason(""); setAsking("reopen"); }}>
                                    <RotateCcw size={13} className="mr-1" /> Reopen &amp; re-close
                                </Button>
                            )}
                            {isOpen && (
                                <Button variant="outline" size="sm" onClick={() => setReclosing(true)}>
                                    <RotateCcw size={13} className="mr-1" /> Close shift
                                </Button>
                            )}
                            {attached.length === 0 ? (
                                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => { setReason(""); setAsking("delete"); }}>
                                    <Trash2 size={13} className="mr-1" /> Delete shift
                                </Button>
                            ) : (
                                <span className="text-xs text-muted-foreground italic">
                                    Cannot delete: {attached.join(", ")}.
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Reason prompt for reopen / delete */}
            <Dialog open={asking !== null} onOpenChange={(v) => { if (!v && !busy) setAsking(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{asking === "delete" ? "Delete this shift?" : "Reopen this shift?"}</DialogTitle>
                        <DialogDescription>
                            {asking === "delete"
                                ? "Only a shift with no sales, drops or expenditures can be deleted. Its opening and closing vouchers are cancelled."
                                : "The shift goes back to Open and its closing Contra and variance entry are held as drafts, keeping their voucher numbers. Close it again with the correct count and those same vouchers are rewritten — no cancelled entries pile up in the register."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="shift-reason">Reason</Label>
                        <Textarea id="shift-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong cash count entered" autoFocus />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAsking(null)} disabled={busy}>Cancel</Button>
                        <Button variant={asking === "delete" ? "destructive" : "default"} onClick={submitCorrection} disabled={busy || !reason.trim()}>
                            {busy && <Loader2 size={14} className="animate-spin mr-1" />}
                            {asking === "delete" ? "Delete shift" : "Reopen"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Re-close dialog */}
            {reclosing && (
                <ShiftCloseDialog
                    open={true}
                    onOpenChange={(v) => { if (!v) setReclosing(false); }}
                    shiftId={shift.id}
                    allowHandover={false}
                    forCashierName={shift.user.name}
                    initialClosedAt={originalClosedAt}
                    onClosed={load}
                />
            )}

            {/* Handover chain alerts */}
            {shift.receivedHandover && (
                <div className="rounded-lg border border-border bg-blue-50 dark:bg-blue-950/20 px-4 py-2.5 text-sm flex items-center gap-2 shadow-sm">
                    <Users size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-muted-foreground">Received handover from</span>
                    <Link href={`/office/pos/shifts/${shift.receivedHandover.fromShift.id}`} className="font-semibold text-primary hover:underline">
                        Shift #{shift.receivedHandover.fromShift.id} ({shift.receivedHandover.fromShift.user.name})
                    </Link>
                    <span className="text-muted-foreground text-xs ml-auto">
                        Declared: ₹{fmt(Number(shift.receivedHandover.declaredByAPaise) / 100)} · Counted: ₹{fmt(Number(shift.receivedHandover.countedByBPaise ?? shift.receivedHandover.declaredByAPaise) / 100)}
                    </span>
                </div>
            )}
            {shift.handover && (
                <div className={`rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2 shadow-sm ${
                    shift.handover.status === "PENDING"
                        ? "border-amber-300/60 bg-amber-50 dark:bg-amber-950/20"
                        : "border-border bg-muted/40"
                }`}>
                    <Users size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-muted-foreground">
                        {shift.handover.status === "PENDING" ? "Handover pending →" : "Handed over →"}
                    </span>
                    {shift.handover.toShift ? (
                        <Link href={`/office/pos/shifts/${shift.handover.toShift.id}`} className="font-semibold text-primary hover:underline">
                            Shift #{shift.handover.toShift.id} ({shift.handover.toUser.name})
                        </Link>
                    ) : (
                        <span className="font-medium">{shift.handover.toUser.name} (not yet accepted)</span>
                    )}
                    <span className="text-muted-foreground text-xs ml-auto">
                        Declared: ₹{fmt(Number(shift.handover.declaredByAPaise) / 100)} · Carry-over: ₹{fmt(Number(shift.handover.carryOverPaise) / 100)}
                    </span>
                </div>
            )}

            {/* Shift Timeline & Audit Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-card p-3 space-y-1 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar size={13} className="text-emerald-600 dark:text-emerald-400" />
                        <span>Shift Opened</span>
                    </div>
                    <div className="font-semibold text-sm">
                        {formatDate(shift.openedAt)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                        {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} by <span className="text-foreground font-medium">{shift.openedBy.name}</span>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3 space-y-1 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock size={13} className="text-blue-600 dark:text-blue-400" />
                        <span>Shift Closed</span>
                    </div>
                    <div className="font-semibold text-sm">
                        {shift.closedAt ? formatDate(shift.closedAt) : "Still active"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                        {shift.closedAt && shift.closedBy
                            ? `${new Date(shift.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} by ${shift.closedBy.name}`
                            : "Awaiting shift close"}
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3 space-y-1 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock size={13} className="text-violet-600 dark:text-violet-400" />
                        <span>Duration</span>
                    </div>
                    <div className="font-semibold text-sm font-mono">
                        {formatDuration(shift.openedAt, shift.closedAt)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                        {isClosed ? "Total shift time" : "Running duration"}
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3 space-y-1 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Monitor size={13} className="text-sky-600 dark:text-sky-400" />
                        <span>Counter &amp; Till</span>
                    </div>
                    <div className="font-semibold text-sm truncate" title={shift.counter.name}>
                        {shift.counter.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate" title={shift.counter.tillAccount.name}>
                        {shift.counter.tillAccount.name}
                    </div>
                </div>
            </div>

            {/* Cash Drawer Position & Reconciliation Cards */}
            <div className="rounded-lg border border-sky-300/60 bg-sky-50/20 dark:border-sky-800/50 dark:bg-sky-950/15 p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                            <Calculator size={16} />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-foreground">Cash Drawer Position &amp; Reconciliation</h2>
                            <p className="text-[11px] text-muted-foreground">Movement balance, physical count, and closing distribution</p>
                        </div>
                    </div>
                    {variance != null && (
                        <div className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 ${
                            variance === 0
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                : variance > 0
                                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300"
                                    : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-300"
                        }`}>
                            {variance === 0 ? (
                                <>
                                    <CheckCircle2 size={13} />
                                    <span>Balanced (₹0.00)</span>
                                </>
                            ) : (
                                <>
                                    <ArrowDownUp size={13} />
                                    <span>Variance: {variance > 0 ? "+" : "−"}₹{fmt(Math.abs(variance))} ({variance > 0 ? "Cash Over" : "Cash Short"})</span>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">Counter opening cash</span>
                        <div className="font-mono font-semibold text-base">₹{fmt(Number(shift.openingFloatPaise) / 100)}</div>
                        <div className="text-[10px] text-muted-foreground">
                            Start: ₹{fmt(Number(shift.carryOverFloatPaise) / 100)} · Top-up: ₹{fmt(Number(shift.vaultTopUpPaise) / 100)}
                        </div>
                    </div>

                    <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">Counter cash flow</span>
                        <div className="font-mono font-semibold text-base">
                            {signed(Number(shift.tillMovementPaise) / 100)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            Net cash flows this shift
                        </div>
                    </div>

                    <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">Dropped to safe</span>
                        <div className="font-mono font-semibold text-base text-amber-700 dark:text-amber-400">
                            − ₹{fmt(Number(shift.dropsPaise) / 100)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            {shift.drops.length} mid-shift drop(s)
                        </div>
                    </div>

                    <div className="rounded-md border border-sky-300 dark:border-sky-800 bg-sky-100/50 dark:bg-sky-900/30 p-2.5 space-y-0.5">
                        <span className="text-[11px] font-medium text-sky-800 dark:text-sky-300">Expected in drawer</span>
                        <div className="font-mono font-bold text-base text-sky-950 dark:text-sky-100">
                            ₹{fmt(Number(shift.expectedCashPaise ?? shift.runningExpectedPaise) / 100)}
                        </div>
                        <div className="text-[10px] text-sky-700 dark:text-sky-400">
                            {isClosed ? "Final drawer target" : "Live expected in drawer"}
                        </div>
                    </div>
                </div>

                {/* Closing reconciliation details */}
                {isClosed && (
                    <div className="pt-2 border-t border-sky-200/70 dark:border-sky-800/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                            <span className="text-[11px] text-muted-foreground">Physical count (Declared)</span>
                            <div className="font-mono font-semibold text-sm">
                                ₹{fmt(Number(shift.declaredCashPaise ?? 0) / 100)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">Counted at close</div>
                        </div>

                        <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                            <span className="text-[11px] text-muted-foreground">Reconciliation variance</span>
                            <div className={`font-mono font-semibold text-sm ${
                                (variance ?? 0) === 0 ? "text-emerald-600 dark:text-emerald-400" : (variance ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            }`}>
                                {variance === 0 ? "₹0.00" : signed(variance ?? 0)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                {(variance ?? 0) === 0 ? "Exact match" : (variance ?? 0) > 0 ? "Cash surplus" : "Cash shortage"}
                            </div>
                        </div>

                        <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                            <span className="text-[11px] text-muted-foreground">Kept in counter</span>
                            <div className="font-mono font-semibold text-sm">
                                ₹{fmt(Number(shift.carryOverNextPaise ?? 0) / 100)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">Next shift float</div>
                        </div>

                        <div className="rounded-md border border-border bg-card p-2.5 space-y-0.5">
                            <span className="text-[11px] text-muted-foreground">Swept to vault</span>
                            <div className="font-mono font-semibold text-sm text-indigo-600 dark:text-indigo-400">
                                ₹{fmt(Number(shift.toVaultPaise ?? 0) / 100)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">Bank / Safe contra</div>
                        </div>
                    </div>
                )}
            </div>

            {/* 3 Comprehensive Breakdown Cards (3-column responsive grid) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* ── 1. Till Movement Breakdown (Cash Flows) ── */}
                <div className="rounded-lg border border-violet-300/70 dark:border-violet-800/60 bg-violet-50/30 dark:bg-violet-950/20 p-3.5 space-y-2.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2 border-b border-violet-200/70 dark:border-violet-800/50">
                            <p className="text-xs font-bold text-violet-900 dark:text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
                                <TrendingUp size={14} className="text-violet-600 dark:text-violet-400" /> Counter Cash Flow
                            </p>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300">
                                Cash Flows
                            </span>
                        </div>

                        <div className="space-y-1.5 pt-2 text-xs">
                            <DetailRow
                                label="Cash sales"
                                value={Number(shift.movementBreakdown?.cashSalesPaise || 0) > 0 ? `+ ₹${fmt(Number(shift.movementBreakdown?.cashSalesPaise || 0) / 100)}` : "₹0.00"}
                                valueClass="text-emerald-600 dark:text-emerald-400"
                            />
                            <DetailRow
                                label="Customer receipts (Rcv)"
                                value={Number(shift.movementBreakdown?.receiptsPaise || 0) > 0 ? `+ ₹${fmt(Number(shift.movementBreakdown?.receiptsPaise || 0) / 100)}` : "₹0.00"}
                                valueClass="text-emerald-600 dark:text-emerald-400"
                            />
                            <DetailRow
                                label="Counter expenses (Exp)"
                                value={Number(shift.movementBreakdown?.expendituresPaise || 0) > 0 ? `− ₹${fmt(Number(shift.movementBreakdown?.expendituresPaise || 0) / 100)}` : "₹0.00"}
                                valueClass={Number(shift.movementBreakdown?.expendituresPaise || 0) > 0 ? "text-rose-600 dark:text-rose-400" : ""}
                            />
                            <DetailRow
                                label="Cash refunds / returns"
                                value={Number(shift.movementBreakdown?.refundsPaise || 0) > 0 ? `− ₹${fmt(Number(shift.movementBreakdown?.refundsPaise || 0) / 100)}` : "₹0.00"}
                                valueClass={Number(shift.movementBreakdown?.refundsPaise || 0) > 0 ? "text-rose-600 dark:text-rose-400" : ""}
                            />
                            {shift.movementBreakdown?.otherPaise !== undefined && Number(shift.movementBreakdown.otherPaise) !== 0 && (
                                <DetailRow
                                    label="Other adjustments"
                                    value={signed(Number(shift.movementBreakdown.otherPaise) / 100)}
                                />
                            )}
                        </div>
                    </div>

                    <div className="border-t border-violet-200/80 dark:border-violet-800/60 pt-2 mt-2 flex justify-between items-center bg-violet-100/60 dark:bg-violet-950/60 -mx-1.5 px-2.5 py-1.5 rounded-md font-semibold text-xs sm:text-sm">
                        <span className="text-violet-950 dark:text-violet-200">Net counter cash flow</span>
                        <span className="font-mono text-sm text-violet-900 dark:text-violet-100 font-bold">
                            {signed(Number(shift.tillMovementPaise) / 100)}
                        </span>
                    </div>
                </div>

                {/* ── 2. Payments Collected Breakdown (All Modes) ── */}
                <div className="rounded-lg border border-indigo-300/70 dark:border-indigo-800/60 bg-indigo-50/30 dark:bg-indigo-950/20 p-3.5 space-y-2.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2 border-b border-indigo-200/70 dark:border-indigo-800/50">
                            <p className="text-xs font-bold text-indigo-900 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                                <CreditCard size={14} className="text-indigo-600 dark:text-indigo-400" /> Payments Collected
                            </p>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                                All Modes
                            </span>
                        </div>

                        <div className="space-y-1.5 pt-2 text-xs">
                            {shift.tenderBreakdown && shift.tenderBreakdown.length > 0 ? (
                                shift.tenderBreakdown.map((t) => (
                                    <DetailRow
                                        key={t.method}
                                        label={t.label}
                                        value={`₹${fmt(Number(t.amountPaise) / 100)}`}
                                    />
                                ))
                            ) : (
                                <div className="text-xs text-muted-foreground italic py-2">No payments collected yet.</div>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-indigo-200/80 dark:border-indigo-800/60 pt-2 mt-2 flex justify-between items-center bg-indigo-100/60 dark:bg-indigo-950/60 -mx-1.5 px-2.5 py-1.5 rounded-md font-semibold text-xs sm:text-sm">
                        <span className="text-indigo-950 dark:text-indigo-200">Total collected</span>
                        <span className="font-mono text-sm text-indigo-900 dark:text-indigo-100 font-bold">
                            ₹{fmt(tenderTotal)}
                        </span>
                    </div>
                </div>

                {/* ── 3. Total Collected Breakdown (By Type) ── */}
                <div className="rounded-lg border border-teal-300/70 dark:border-teal-800/60 bg-teal-50/30 dark:bg-teal-950/20 p-3.5 space-y-2.5 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-2 border-b border-teal-200/70 dark:border-teal-800/50">
                            <p className="text-xs font-bold text-teal-900 dark:text-teal-300 uppercase tracking-wider flex items-center gap-1.5">
                                <Receipt size={14} className="text-teal-600 dark:text-teal-400" /> Collections By Type
                            </p>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                                Activity
                            </span>
                        </div>

                        <div className="space-y-1.5 pt-2 text-xs">
                            <DetailRow
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <span>POS Sales</span>
                                        {shift.collectionsBreakdown && shift.collectionsBreakdown.salesCount > 0 && (
                                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                {shift.collectionsBreakdown.salesCount} {shift.collectionsBreakdown.salesCount === 1 ? "bill" : "bills"}
                                            </span>
                                        )}
                                    </span>
                                }
                                value={`+ ₹${fmt(Number(shift.collectionsBreakdown?.salesPaise || 0) / 100)}`}
                                valueClass="text-teal-700 dark:text-teal-300"
                            />
                            <DetailRow
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <span>Customer receipts</span>
                                        {shift.collectionsBreakdown && shift.collectionsBreakdown.receiptsCount > 0 && (
                                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                {shift.collectionsBreakdown.receiptsCount} rcv
                                            </span>
                                        )}
                                    </span>
                                }
                                value={`+ ₹${fmt(Number(shift.collectionsBreakdown?.receiptsPaise || 0) / 100)}`}
                                valueClass="text-teal-700 dark:text-teal-300"
                            />
                            <DetailRow
                                label={
                                    <span className="inline-flex items-center gap-1.5">
                                        <span>Refunds / returns</span>
                                        {shift.collectionsBreakdown && shift.collectionsBreakdown.refundsCount > 0 && (
                                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                                                {shift.collectionsBreakdown.refundsCount} ref
                                            </span>
                                        )}
                                    </span>
                                }
                                value={Number(shift.collectionsBreakdown?.refundsPaise || 0) > 0 ? `− ₹${fmt(Number(shift.collectionsBreakdown?.refundsPaise || 0) / 100)}` : "₹0.00"}
                                valueClass={Number(shift.collectionsBreakdown?.refundsPaise || 0) > 0 ? "text-rose-600 dark:text-rose-400" : ""}
                            />
                        </div>
                    </div>

                    <div className="border-t border-teal-200/80 dark:border-teal-800/60 pt-2 mt-2 flex justify-between items-center bg-teal-100/60 dark:bg-teal-950/60 -mx-1.5 px-2.5 py-1.5 rounded-md font-semibold text-xs sm:text-sm">
                        <span className="text-teal-950 dark:text-teal-200">Net total collected</span>
                        <span className="font-mono text-sm text-teal-900 dark:text-teal-100 font-bold">
                            ₹{fmt(Number(shift.collectionsBreakdown?.netCollectedPaise || 0) / 100)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Linked vouchers */}
            {(shift.openingContraVoucher || shift.closingContraVoucher || shift.varianceJournalEntry) && (
                <div>
                    <h2 className="text-sm font-semibold mb-2.5 flex items-center gap-1.5 text-foreground">
                        <ArrowRightLeft size={14} className="text-muted-foreground" /> Linked Accounting Vouchers
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        {shift.openingContraVoucher && (
                            <VoucherCard
                                label="Opening Contra (vault top-up)"
                                date={shift.openingContraVoucher.date}
                                href={`/vouchers/contras/${shift.openingContraVoucher.id}`}
                                reference={shift.openingContraVoucher.reference}
                            />
                        )}
                        {shift.closingContraVoucher && (
                            <VoucherCard
                                label="Closing Contra (vault sweep)"
                                date={shift.closingContraVoucher.date}
                                href={`/vouchers/contras/${shift.closingContraVoucher.id}`}
                                reference={shift.closingContraVoucher.reference}
                            />
                        )}
                        {shift.varianceJournalEntry && (
                            <VoucherCard
                                label="Variance Journal Entry"
                                date={shift.varianceJournalEntry.date}
                                href={`/vouchers/journal-entries/${shift.varianceJournalEntry.id}`}
                                reference={shift.varianceJournalEntry.reference}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Cash Drops to Safe */}
            <div>
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-foreground">
                    <Lock size={14} className="text-muted-foreground" /> Cash drops to safe ({shift.drops.length})
                </h2>
                {shift.drops.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic rounded-lg border border-dashed border-border p-3 text-center">
                        No mid-shift cash drops recorded.
                    </div>
                ) : (
                    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/70 text-xs text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="px-4 py-2.5 text-left font-medium">Time</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Dropped By</th>
                                    <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {shift.drops.map((d) => (
                                    <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                            {formatDate(d.droppedAt)} · {new Date(d.droppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono font-semibold">₹{fmt(Number(d.amountPaise) / 100)}</td>
                                        <td className="px-4 py-2.5 text-xs font-medium">{d.droppedBy.name}</td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.notes || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Shift Notes */}
            {shift.notes && (
                <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-sm space-y-1 shadow-sm">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shift Notes</div>
                    <div className="whitespace-pre-wrap text-foreground text-xs leading-relaxed">{shift.notes}</div>
                </div>
            )}

            {/* Audit footer */}
            <div className="text-xs text-muted-foreground space-y-1 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <Monitor size={12} className="text-muted-foreground" />
                    <span>Counter: <strong className="text-foreground">{shift.counter.name}</strong></span>
                    <span>·</span>
                    <span>Till: <strong className="text-foreground">{shift.counter.tillAccount.name}</strong></span>
                </div>
                <div>
                    Branch: <strong className="text-foreground">{shift.branch.name}</strong>
                </div>
            </div>
        </div>
        </ScrollArea>
    );
}

function DetailRow({
    label,
    value,
    valueClass = "text-foreground",
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    valueClass?: string;
}) {
    return (
        <div className="flex items-center justify-between text-muted-foreground py-0.5">
            <span>{label}</span>
            <span className={`font-mono font-medium ${valueClass}`}>{value}</span>
        </div>
    );
}

function VoucherCard({
    label,
    date,
    href,
    reference,
}: {
    label: string;
    date: string;
    href: string;
    reference: string;
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1 shadow-sm">
            <p className="text-muted-foreground text-xs">{label}</p>
            <div className="flex items-center justify-between">
                <Link href={href} className="text-primary font-mono text-sm font-semibold hover:underline flex items-center gap-1">
                    {reference} <ExternalLink size={11} />
                </Link>
                <span className="text-[11px] text-muted-foreground">{formatDate(date)}</span>
            </div>
        </div>
    );
}
