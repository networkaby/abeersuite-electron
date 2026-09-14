"use client";

// /office/pos/shifts/[id] — Shift detail / audit view
//
// Header summary, drops timeline, linked Contras, variance JE,
// and handover chain (received from / handed to).
//
// Managers holding `pos:shift:force-close` (or admin) can correct a wrong
// close from here: "Reopen & re-close" voids the closing vouchers and runs the
// ordinary close dialog again; "Delete" removes an empty shift. Both ask for a
// reason, saved on the cancelled vouchers.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ArrowDownUp, Lock, ExternalLink, Monitor, Users, RotateCcw, Trash2 } from "lucide-react";
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
};

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
    // What stops a delete — mirrors the delete route's own refusal. A digital
    // receipt never touches the till, so the till can sit still while the shift
    // still carries receipts.
    const attached = [
        shift._count.receipts > 0            ? `${shift._count.receipts} receipt(s)`         : null,
        shift.drops.length > 0               ? `${shift.drops.length} cash drop(s)`          : null,
        shift.expenditures.length > 0        ? `${shift.expenditures.length} expenditure(s)` : null,
        Number(shift.tillMovementPaise) !== 0 ? "till movement"                              : null,
    ].filter((x): x is string => x !== null);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 max-w-4xl px-6 pt-3 pb-6">
            <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon-sm" onClick={() => router.push("/office/pos/shifts")} aria-label="Back">
                    <ArrowLeft size={16} />
                </Button>
                <div>
                    <h1 className="text-xl font-bold">Shift #{shift.id}</h1>
                    <p className="text-sm text-muted-foreground">{shift.user.name} · {shift.counter.name} · {shift.branch.name}</p>
                </div>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${
                    isOpen      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" :
                    isHandover  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
                                  "bg-muted text-muted-foreground"
                }`}>
                    {isHandover ? "AWAITING HANDOVER" : shift.status}
                </span>
            </div>

            {/* Manager corrections — a closed shift can be reopened and closed
                again; an empty shift (no sales/drops) can be removed. */}
            {canManage && !isHandover && (
                <div className="flex flex-wrap items-center gap-2">
                    {isClosed && (
                        <Button variant="outline" size="sm" onClick={() => { setReason(""); setAsking("reopen"); }}>
                            <RotateCcw size={13} /> Reopen &amp; re-close
                        </Button>
                    )}
                    {isOpen && (
                        <Button variant="outline" size="sm" onClick={() => setReclosing(true)}>
                            <RotateCcw size={13} /> Close shift
                        </Button>
                    )}
                    {/* Same emptiness test as the delete route: nothing logged on the shift. */}
                    {attached.length === 0 ? (
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setReason(""); setAsking("delete"); }}>
                            <Trash2 size={13} /> Delete shift
                        </Button>
                    ) : (
                        <span className="text-xs text-muted-foreground">
                            Cannot delete: {attached.join(", ")} on this shift. Reopen and re-close to correct it.
                        </span>
                    )}
                </div>
            )}

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
                            {busy && <Loader2 size={14} className="animate-spin" />}
                            {asking === "delete" ? "Delete shift" : "Reopen"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Re-close — the ordinary close dialog, in force-close form (the
                manager closes on the cashier's behalf; closedBy = the manager). */}
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

            {/* Handover chain */}
            {shift.receivedHandover && (
                <div className="rounded-lg border border-border bg-blue-50 dark:bg-blue-950/20 px-4 py-2.5 text-sm flex items-center gap-2">
                    <Users size={14} className="text-blue-600 dark:text-blue-400" />
                    <span className="text-muted-foreground">Received handover from</span>
                    <Link href={`/office/pos/shifts/${shift.receivedHandover.fromShift.id}`} className="font-medium text-primary hover:underline">
                        Shift #{shift.receivedHandover.fromShift.id} ({shift.receivedHandover.fromShift.user.name})
                    </Link>
                    <span className="text-muted-foreground text-xs">
                        · {shift.receivedHandover.fromShift.user.name} declared ₹{fmt(Number(shift.receivedHandover.declaredByAPaise) / 100)},
                        this shift counted ₹{fmt(Number(shift.receivedHandover.countedByBPaise ?? shift.receivedHandover.declaredByAPaise) / 100)}
                    </span>
                </div>
            )}
            {shift.handover && (
                <div className={`rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2 ${
                    shift.handover.status === "PENDING"
                        ? "border-amber-300/40 bg-amber-50 dark:bg-amber-950/20"
                        : "border-border bg-muted/40"
                }`}>
                    <Users size={14} className="text-amber-600 dark:text-amber-400" />
                    <span className="text-muted-foreground">
                        {shift.handover.status === "PENDING" ? "Handover pending →" : "Handed over →"}
                    </span>
                    {shift.handover.toShift ? (
                        <Link href={`/office/pos/shifts/${shift.handover.toShift.id}`} className="font-medium text-primary hover:underline">
                            Shift #{shift.handover.toShift.id} ({shift.handover.toUser.name})
                        </Link>
                    ) : (
                        <span className="font-medium">{shift.handover.toUser.name} (not yet accepted)</span>
                    )}
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <StatBox label="Carry-over (start)"   value={`₹${fmt(Number(shift.carryOverFloatPaise) / 100)}`} />
                <StatBox label="Vault top-up"          value={`₹${fmt(Number(shift.vaultTopUpPaise) / 100)}`} />
                <StatBox label="Till movement"         value={`${Number(shift.tillMovementPaise) < 0 ? "−" : "+"}₹${fmt(Math.abs(Number(shift.tillMovementPaise)) / 100)}`} />
                <StatBox label="Declared / Expected"
                    value={
                        shift.declaredCashPaise != null
                            ? `₹${fmt(Number(shift.declaredCashPaise) / 100)} / ₹${fmt(Number(shift.expectedCashPaise) / 100)}`
                            : `₹${fmt(Number(shift.runningExpectedPaise) / 100)} (live)`
                    }
                />
            </div>

            {/* Close summary */}
            {shift.status === "CLOSED" && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <StatBox label="Kept in counter (carry-over)" value={`₹${fmt(Number(shift.carryOverNextPaise ?? 0) / 100)}`} />
                    <StatBox label="Swept to vault"               value={`₹${fmt(Number(shift.toVaultPaise ?? 0) / 100)}`} />
                </div>
            )}

            {/* Variance banner */}
            {variance != null && variance !== 0 && (
                <div className={`rounded-lg border p-3 text-sm ${variance > 0 ? "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/30" : "border-red-400/40 bg-red-50 dark:bg-red-950/30"}`}>
                    <ArrowDownUp size={14} className="inline mr-1" />
                    Variance: <span className="font-mono font-semibold">{variance > 0 ? "+" : "−"}₹{fmt(Math.abs(variance))}</span> — {variance > 0 ? "Cash Over (income)" : "Cash Short (expense)"}
                </div>
            )}

            {/* Linked vouchers */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                {shift.openingContraVoucher && (
                    <Card label="Opening Contra (vault top-up)">
                        <Link href={`/vouchers/contras/${shift.openingContraVoucher.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.openingContraVoucher.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
                {shift.closingContraVoucher && (
                    <Card label="Closing Contra (vault sweep)">
                        <Link href={`/vouchers/contras/${shift.closingContraVoucher.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.closingContraVoucher.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
                {shift.varianceJournalEntry && (
                    <Card label="Variance JE">
                        <Link href={`/vouchers/journal-entries/${shift.varianceJournalEntry.id}`} className="text-primary font-mono hover:underline flex items-center gap-1">
                            {shift.varianceJournalEntry.reference} <ExternalLink size={11} />
                        </Link>
                    </Card>
                )}
            </div>

            {/* Drops */}
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
                <p><Monitor size={11} className="inline mr-1" /> Counter: {shift.counter.name} · Till: {shift.counter.tillAccount.name}</p>
                <p>Opened by {shift.openedBy.name} on {formatDate(shift.openedAt)} at {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                {shift.closedAt && shift.closedBy && (
                    <p>Closed by {shift.closedBy.name} on {formatDate(shift.closedAt)} at {new Date(shift.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                )}
            </div>
        </div>
        </ScrollArea>
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
