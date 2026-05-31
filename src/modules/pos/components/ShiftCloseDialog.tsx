"use client";

// ── ShiftCloseDialog ─────────────────────────────────────────────────────────
// Two close modes:
//   1. "Close to vault"  — standard end-of-day. Declares physical count,
//      sets overnight carry-over, posts variance JE + Contra to vault.
//   2. "Hand to cashier" — two-step handover. A declares count, picks B.
//      No GL yet; shift → AWAITING_HANDOVER. B logs in and accepts.
//
// After a successful vault close, the form swaps to a closing report that
// shows the full cash reconciliation summary and GL references.

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, ArrowRightLeft, TrendingUp, TrendingDown,
    CheckCheck, Users, Vault, Printer, CircleCheck,
} from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";

// ── Types ─────────────────────────────────────────────────────────────────────

// One line of the "Payments collected this shift" tally (cash + digital).
type TenderRow = { method: string; label: string; amountPaise: string };

type ShiftDetail = {
    id: number;
    openingFloatPaise: string;
    cashSalesPaise: string;
    dropsPaise: string;
    runningExpectedPaise: string;
    tenderBreakdown?: TenderRow[];
    counter: { id: number; name: string; tillAccount: { name: string } };
    branch:  { name: string };
};

type ClosedReport = {
    id: number;
    openedAt: string;
    closedAt: string;
    notes: string | null;
    openingFloatPaise:   string;
    cashSalesPaise:      string;
    dropsPaise:          string;
    expectedCashPaise:   string | null;
    declaredCashPaise:   string | null;
    variancePaise:       string | null;
    carryOverNextPaise:  string | null;
    toVaultPaise:        string | null;
    tenderBreakdown?:    TenderRow[];
    counter: { id: number; name: string; tillAccount: { id: number; name: string } };
    branch:  { id: string; name: string };
    closingContraVoucher: { id: number; reference: string } | null;
    varianceJournalEntry: { id: number; reference: string } | null;
};

type Candidate = { id: number; name: string; email: string };
type Mode = "vault" | "handover";

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftCloseDialog({
    open, onOpenChange, shiftId, onClosed,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    onClosed: () => void;
}) {
    const [detail, setDetail]     = useState<ShiftDetail | null>(null);
    const [loading, setLoading]   = useState(false);
    const [mode, setMode]         = useState<Mode>("vault");

    // Shared fields
    const [declared, setDeclared] = useState("");
    const [notes, setNotes]       = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Vault mode — carry-over
    const [carryOver, setCarryOver] = useState("");

    // Handover mode
    const [candidates, setCandidates]               = useState<Candidate[]>([]);
    const [loadingCandidates, setLoadingCandidates] = useState(false);
    const [selectedUserId, setSelectedUserId]       = useState<number | null>(null);

    // After successful vault close — swap form for report.
    const [report, setReport] = useState<ClosedReport | null>(null);
    const reportRef           = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) { setReport(null); return; }
        setLoading(true);
        setMode("vault");
        setSelectedUserId(null);
        setReport(null);
        axios.get<ShiftDetail>(`/api/pos/shifts/${shiftId}`)
            .then((r) => {
                setDetail(r.data);
                setDeclared((Number(r.data.runningExpectedPaise) / 100).toFixed(2));
                setCarryOver("0");
            })
            .catch(() => toast.error("Failed to load shift summary"))
            .finally(() => setLoading(false));
    }, [open, shiftId]);

    // Load handover candidates when mode switches to "handover".
    useEffect(() => {
        if (mode !== "handover" || !detail) return;
        setLoadingCandidates(true);
        axios.get<Candidate[]>(`/api/pos/shifts/handover-candidates?counterId=${detail.counter.id}`)
            .then((r) => setCandidates(r.data))
            .catch(() => toast.error("Failed to load eligible cashiers"))
            .finally(() => setLoadingCandidates(false));
    }, [mode, detail]);

    const expected     = detail ? Number(detail.runningExpectedPaise) / 100 : 0;
    const tenderTotal  = (detail?.tenderBreakdown ?? []).reduce((s, t) => s + Number(t.amountPaise) / 100, 0);
    const declaredNum  = parseFloat(declared) || 0;
    const carryOverNum = parseFloat(carryOver) || 0;
    const toVault      = Math.max(0, declaredNum - carryOverNum);
    const variance     = +(declaredNum - expected).toFixed(2);

    const submitVault = async () => {
        if (!detail) return;
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        if (carryOverNum > declaredNum) { toast.error("Carry-over cannot exceed declared count"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.patch<ClosedReport>(`/api/pos/shifts/${shiftId}/close`, {
                declaredCashPaise:  Math.round(declaredNum * 100),
                carryOverNextPaise: Math.round(carryOverNum * 100),
                notes:              notes.trim() || undefined,
            });
            onClosed();          // refresh parent (clears ActiveShiftBar)
            setReport(data);     // swap form → report
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to close shift");
        } finally {
            setSubmitting(false);
        }
    };

    const submitHandover = async () => {
        if (!detail || !selectedUserId) { toast.error("Select the next cashier"); return; }
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        setSubmitting(true);
        try {
            await axios.post(`/api/pos/shifts/${shiftId}/handover`, {
                toUserId:          selectedUserId,
                declaredCashPaise: Math.round(declaredNum * 100),
                carryOverPaise:    Math.round(carryOverNum * 100),
                notes:             notes.trim() || undefined,
            });
            const cand = candidates.find((c) => c.id === selectedUserId);
            toast.success(`Handover requested to ${cand?.name ?? "cashier"}. Please log out.`);
            onClosed();
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to initiate handover");
        } finally {
            setSubmitting(false);
        }
    };

    const handlePrint = () => {
        const el = reportRef.current;
        if (!el) return;
        const win = window.open("", "_blank", "width=420,height=640");
        if (!win) return;
        win.document.write(`
            <html><head><title>Shift #${report?.id} Closing Report</title>
            <style>
                body { font-family: 'Courier New', monospace; font-size: 12px; padding: 16px; color: #000; }
                h2 { font-size: 15px; margin: 0 0 4px; }
                .sub { font-size: 11px; color: #555; margin-bottom: 12px; }
                hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
                .row { display: flex; justify-content: space-between; margin: 3px 0; }
                .row.bold { font-weight: bold; }
                .row.over  { color: #166534; }
                .row.short { color: #991b1b; }
                .row.zero  { color: #166534; }
                .label { flex: 1; }
                .val { text-align: right; min-width: 90px; }
                .ref { font-size: 10px; color: #555; margin-top: 2px; }
                @media print { body { padding: 0; } }
            </style></head><body>${el.innerHTML}</body></html>
        `);
        win.document.close();
        win.focus();
        win.print();
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
            <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">

                {/* ── Report view (post-close) ── */}
                {report ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
                                <CircleCheck size={18} /> Shift #{report.id} closed
                            </DialogTitle>
                            <DialogDescription>
                                {report.counter.name} · {report.branch.name}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto pr-1">
                            <CloseReport report={report} ref={reportRef} />
                        </div>

                        <DialogFooter className="pt-2 border-t border-border gap-2">
                            <Button variant="outline" size="sm" onClick={handlePrint}>
                                <Printer size={13} /> Print
                            </Button>
                            <Button onClick={() => onOpenChange(false)} className="bg-green-600 hover:bg-green-700 text-white">
                                Done
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    /* ── Close form ── */
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <ArrowRightLeft size={18} className="text-primary" /> Close shift
                            </DialogTitle>
                            <DialogDescription>
                                Count the physical cash in the drawer and choose how to close.
                            </DialogDescription>
                        </DialogHeader>

                        {loading || !detail ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="animate-spin text-muted-foreground" size={24} />
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                                {/* Mode tabs */}
                                <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                                    <button
                                        type="button"
                                        onClick={() => setMode("vault")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${mode === "vault" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                                    >
                                        <Vault size={13} /> Close to vault
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMode("handover")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors border-l border-border ${mode === "handover" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                                    >
                                        <Users size={13} /> Hand to cashier
                                    </button>
                                </div>

                                {/* Expected breakdown */}
                                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                                    <Row label="Opening float"   value={fmt(Number(detail.openingFloatPaise) / 100)} />
                                    <Row label="Cash sales"      value={`+ ${fmt(Number(detail.cashSalesPaise) / 100)}`} />
                                    <Row label="Dropped to safe" value={`− ${fmt(Number(detail.dropsPaise) / 100)}`} />
                                    <div className="border-t border-border pt-1.5 flex justify-between font-semibold">
                                        <span>Expected in drawer</span>
                                        <span className="font-mono">₹{fmt(expected)}</span>
                                    </div>
                                </div>

                                {/* All payment methods collected this shift (cash + digital).
                                    Informational — only cash is physically reconciled below. */}
                                {detail.tenderBreakdown && detail.tenderBreakdown.length > 0 && (
                                    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                            Payments collected this shift
                                        </p>
                                        {detail.tenderBreakdown.map((t) => (
                                            <Row key={t.method} label={t.label} value={fmt(Number(t.amountPaise) / 100)} />
                                        ))}
                                        <div className="border-t border-border pt-1.5 flex justify-between font-semibold">
                                            <span>Total collected</span>
                                            <span className="font-mono">₹{fmt(tenderTotal)}</span>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <Label htmlFor="declared-amt">Physical count (₹)</Label>
                                    <Input
                                        id="declared-amt"
                                        type="text"
                                        inputMode="decimal"
                                        value={declared}
                                        onChange={(e) => setDeclared(e.target.value.replace(/[^\d.]/g, ""))}
                                        placeholder={expected.toFixed(2)}
                                        autoFocus
                                    />
                                    {declared && <VarianceChip variance={variance} />}
                                </div>

                                {/* Vault mode */}
                                {mode === "vault" && (
                                    <>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="carry-over">Keep in counter overnight (₹)</Label>
                                            <Input
                                                id="carry-over"
                                                type="text"
                                                inputMode="decimal"
                                                value={carryOver}
                                                onChange={(e) => setCarryOver(e.target.value.replace(/[^\d.]/g, ""))}
                                                placeholder="0"
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Leave 0 to sweep everything to vault.
                                            </p>
                                        </div>
                                        {declared && (
                                            <div className="rounded-md bg-primary/5 border border-primary/30 px-3 py-2 text-xs text-muted-foreground">
                                                Posts Contra: <span className="font-medium text-foreground">{detail.counter.tillAccount.name}</span> → <span className="font-medium text-foreground">Vault</span> for{" "}
                                                <span className="font-mono font-semibold text-foreground">₹{fmt(toVault)}</span>.
                                                Counter keeps <span className="font-mono font-semibold text-foreground">₹{fmt(carryOverNum)}</span> overnight.
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Handover mode */}
                                {mode === "handover" && (
                                    <div className="space-y-1.5">
                                        <Label>Hand over to</Label>
                                        {loadingCandidates ? (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Loader2 size={13} className="animate-spin" /> Loading eligible cashiers…
                                            </div>
                                        ) : candidates.length === 0 ? (
                                            <div className="text-xs text-muted-foreground rounded-md border border-border p-3">
                                                No eligible cashiers available (all on shift or no permission).
                                            </div>
                                        ) : (
                                            <Select
                                                value={selectedUserId?.toString() ?? ""}
                                                onValueChange={(v) => setSelectedUserId(Number(v))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select cashier…" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {candidates.map((c) => (
                                                        <SelectItem key={c.id} value={c.id.toString()}>
                                                            {c.name}{" "}
                                                            <span className="text-muted-foreground text-xs ml-1">({c.email})</span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                        {selectedUserId && (
                                            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                                ⚠ After submitting: log out and hand the terminal to the next cashier.
                                                They will count the cash and accept the handover on login.
                                                <br />
                                                Declared ₹{fmt(declaredNum)} · Carry-over ₹{fmt(carryOverNum)} · GL posts only on acceptance.
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <Label htmlFor="close-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                                    <Textarea
                                        id="close-notes"
                                        rows={2}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="e.g. Safe drop already done"
                                    />
                                </div>
                            </div>
                        )}

                        <DialogFooter className="pt-2 border-t border-border">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                            {mode === "vault" ? (
                                <Button onClick={submitVault} disabled={submitting || loading} className="bg-green-600 hover:bg-green-700 text-white">
                                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                                    Close &amp; sweep to vault
                                </Button>
                            ) : (
                                <Button onClick={submitHandover} disabled={submitting || loading || !selectedUserId} className="bg-amber-600 hover:bg-amber-700 text-white">
                                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                                    Request handover
                                </Button>
                            )}
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ── Closing Report ────────────────────────────────────────────────────────────

import { forwardRef } from "react";

const CloseReport = forwardRef<HTMLDivElement, { report: ClosedReport }>(
    function CloseReport({ report }, ref) {
        const openedAt   = new Date(report.openedAt);
        const closedAt   = new Date(report.closedAt!);
        const durationMs = closedAt.getTime() - openedAt.getTime();
        const durationH  = Math.floor(durationMs / 3_600_000);
        const durationM  = Math.floor((durationMs % 3_600_000) / 60_000);
        const fmtTime    = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        const fmtDate    = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

        const opening  = Number(report.openingFloatPaise)  / 100;
        const sales    = Number(report.cashSalesPaise)     / 100;
        const drops    = Number(report.dropsPaise)         / 100;
        const expected = Number(report.expectedCashPaise)  / 100;
        const declared = Number(report.declaredCashPaise)  / 100;
        const variance = Number(report.variancePaise)      / 100;
        const keepAmt  = Number(report.carryOverNextPaise) / 100;
        const vaultAmt = Number(report.toVaultPaise)       / 100;

        const varColor = variance === 0
            ? "text-green-700 dark:text-green-400"
            : variance > 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-red-700 dark:text-red-400";

        return (
            <div ref={ref} className="space-y-3 text-sm py-2">
                {/* Header */}
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 space-y-0.5">
                    <p className="text-xs text-muted-foreground">{fmtDate(openedAt)}</p>
                    <p className="font-medium">{report.counter.name} · {report.branch.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {fmtTime(openedAt)} → {fmtTime(closedAt)}
                        <span className="ml-2 text-foreground font-medium">{durationH}h {durationM}m</span>
                    </p>
                </div>

                {/* Cash reconciliation */}
                <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cash reconciliation</p>
                    <ReportRow label="Opening float"    value={`₹${fmt(opening)}`} />
                    <ReportRow label="Cash sales"       value={`+ ₹${fmt(sales)}`} />
                    <ReportRow label="Dropped to safe"  value={`− ₹${fmt(drops)}`} />
                    <div className="border-t border-border pt-1.5">
                        <ReportRow label="Expected in drawer" value={`₹${fmt(expected)}`} bold />
                        <ReportRow label="Physical count"     value={`₹${fmt(declared)}`} bold />
                    </div>
                    <div className={`flex justify-between font-semibold pt-0.5 ${varColor}`}>
                        <span>
                            {variance === 0 ? "✓ No variance" : variance > 0 ? "Over" : "Short"}
                        </span>
                        <span className="font-mono">
                            {variance === 0 ? "—" : `${variance > 0 ? "+" : "−"} ₹${fmt(Math.abs(variance))}`}
                        </span>
                    </div>
                </div>

                {/* Payments collected this shift — all methods (cash + digital) */}
                {report.tenderBreakdown && report.tenderBreakdown.length > 0 && (
                    <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payments collected</p>
                        {report.tenderBreakdown.map((t) => (
                            <ReportRow key={t.method} label={t.label} value={`₹${fmt(Number(t.amountPaise) / 100)}`} />
                        ))}
                        <div className="border-t border-border pt-1.5">
                            <ReportRow
                                label="Total collected"
                                value={`₹${fmt(report.tenderBreakdown.reduce((s, t) => s + Number(t.amountPaise) / 100, 0))}`}
                                bold
                            />
                        </div>
                    </div>
                )}

                {/* Disposition */}
                <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Disposition</p>
                    <ReportRow label="Swept to vault"         value={`₹${fmt(vaultAmt)}`} bold />
                    <ReportRow label="Kept in counter"        value={`₹${fmt(keepAmt)}`} />
                </div>

                {/* GL references */}
                {(report.closingContraVoucher || report.varianceJournalEntry) && (
                    <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">GL references</p>
                        {report.closingContraVoucher && (
                            <ReportRow label="Closing Contra" value={report.closingContraVoucher.reference} mono />
                        )}
                        {report.varianceJournalEntry && (
                            <ReportRow label="Variance JE" value={report.varianceJournalEntry.reference} mono />
                        )}
                    </div>
                )}

                {/* Notes */}
                {report.notes && (
                    <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Notes: </span>{report.notes}
                    </div>
                )}
            </div>
        );
    }
);

// ── Small helpers ─────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono text-foreground">₹{value}</span>
        </div>
    );
}

function ReportRow({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
    return (
        <div className={`flex justify-between gap-4 ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <span className="flex-1">{label}</span>
            <span className={mono ? "font-mono text-foreground text-xs" : "font-mono"}>{value}</span>
        </div>
    );
}

function VarianceChip({ variance }: { variance: number }) {
    if (variance === 0) return <p className="text-xs text-green-700 dark:text-green-400">✓ Matches expected — no variance</p>;
    const abs = Math.abs(variance);
    if (variance > 0) return (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <TrendingUp size={12} /> Over by ₹{fmt(abs)} → posts to Cash Over (income)
        </p>
    );
    return (
        <p className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
            <TrendingDown size={12} /> Short by ₹{fmt(abs)} → posts to Cash Short (expense)
        </p>
    );
}
