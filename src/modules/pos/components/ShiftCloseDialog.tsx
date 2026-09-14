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
    Banknote, Calculator, ShieldCheck, CreditCard, Receipt, FileText,
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
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { extractApiError } from "@/shared/lib/api";
import { parseDigitsInput, parseDecimalInput } from "@/shared/lib/format";
import { toDateTimeLocalInput } from "@/shared/lib/format/dateInput";
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";

// ── Types ─────────────────────────────────────────────────────────────────────

// One line of the "Payments collected this shift" tally (cash + digital).
type TenderRow = { method: string; label: string; amountPaise: string };

type MovementBreakdown = {
    cashSalesPaise:    string;
    receiptsPaise:     string;
    expendituresPaise: string;
    refundsPaise:      string;
    otherPaise:        string;
    netMovementPaise:  string;
};

type CollectionsBreakdown = {
    salesPaise:        string;
    salesCount:        number;
    receiptsPaise:     string;
    receiptsCount:     number;
    refundsPaise:      string;
    refundsCount:      number;
    netCollectedPaise: string;
};

type ShiftDetail = {
    id: number;
    openingFloatPaise: string;
    // Net movement on the till ledger since open (sales + receipts − refunds −
    // expenditures − anything else posted there). Signed.
    tillMovementPaise:   string;
    dropsPaise:          string;
    expendituresPaise:   string;
    movementBreakdown?:  MovementBreakdown;
    collectionsBreakdown?: CollectionsBreakdown;
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
    tillMovementPaise:   string;
    dropsPaise:          string;
    expendituresPaise:   string;
    movementBreakdown?:  MovementBreakdown;
    collectionsBreakdown?: CollectionsBreakdown;
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

// Fallback note/coin denominations (high → low) used until the org's configured
// list loads. The live list is OrgDefaults.cashDenominationsJson (country-specific,
// edited in Settings → Org Defaults).
const DEFAULT_DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftCloseDialog({
    open, onOpenChange, shiftId, onClosed, allowHandover = true, forCashierName, initialClosedAt,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    onClosed: () => void;
    // Admin force-close (from the counter board) hides the "hand to cashier"
    // tab — the operator is absent, so there's no one to hand to — and labels
    // the dialog as closing on that cashier's behalf.
    allowHandover?: boolean;
    forCashierName?: string;
    // Re-close after a reopen (shift detail page): shows an editable "Closed on"
    // date-time, prefilled with the ORIGINAL close moment so the corrected close
    // lands on the same day in the books. Manager-only server-side. Absent →
    // the field is hidden and the close is stamped "now".
    initialClosedAt?: string | null;
}) {
    const [detail, setDetail]     = useState<ShiftDetail | null>(null);
    const [loading, setLoading]   = useState(false);
    const [mode, setMode]         = useState<Mode>("vault");

    // Shared fields
    const [declared, setDeclared] = useState("");
    const [notes, setNotes]       = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Denomination counter — count of notes/coins per denomination plus optional other/bundle cash.
    // The summed value drives the physical count (declared) so the cashier doesn't add by
    // hand. Editing the Physical count field directly still overrides it.
    // denomList is the org's configured denominations (loaded on open).
    const [denomList, setDenomList] = useState<number[]>(DEFAULT_DENOMS);
    const [denoms, setDenoms]       = useState<Record<number, string>>({});
    const [otherCash, setOtherCash] = useState("");

    const denomTotal   = denomList.reduce((s, d) => s + d * (parseInt(denoms[d] || "0", 10) || 0), 0);
    const otherTotal   = parseFloat(otherCash) || 0;
    const countedTotal = +(denomTotal + otherTotal).toFixed(2);

    const setDenom = (d: number, raw: string) => {
        const v = parseDigitsInput(raw);
        const next = { ...denoms, [d]: v };
        setDenoms(next);
        const dTot = denomList.reduce((s, dd) => s + dd * (parseInt(next[dd] || "0", 10) || 0), 0);
        const total = +(dTot + (parseFloat(otherCash) || 0)).toFixed(2);
        setDeclared(total.toFixed(2));
    };

    const handleOtherCashChange = (raw: string) => {
        const sanitized = parseDecimalInput(raw);
        setOtherCash(sanitized);
        const oTot = parseFloat(sanitized) || 0;
        const total = +(denomTotal + oTot).toFixed(2);
        setDeclared(total.toFixed(2));
    };

    // Vault mode — carry-over
    const [carryOver, setCarryOver] = useState("");
    // Back-dated close (re-close flow only) — `yyyy-MM-ddTHH:mm` local.
    const [closedAt, setClosedAt]   = useState("");

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
        setDenoms({});
        setOtherCash("");
        // null = open shift closed from the detail page: default to now, still editable.
        setClosedAt(initialClosedAt !== undefined ? toDateTimeLocalInput(initialClosedAt ?? new Date().toISOString()) : "");
        // Load the org's configured cash denominations (country-specific). Falls
        // back to DEFAULT_DENOMS if unset or the call fails.
        getOrgDefaults()
            .then((od) => setDenomList(od.cashDenominationsJson?.length ? od.cashDenominationsJson : DEFAULT_DENOMS))
            .catch(() => setDenomList(DEFAULT_DENOMS));
        axios.get<ShiftDetail>(`/api/pos/shifts/${shiftId}`)
            .then((r) => {
                setDetail(r.data);
                setDeclared("0.00");
                setCarryOver("0");
            })
            .catch(() => toast.error("Failed to load shift summary"))
            .finally(() => setLoading(false));
    }, [open, shiftId, initialClosedAt]);

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
    const dropsNum     = detail ? Number(detail.dropsPaise) / 100 : 0;
    const expNum       = detail ? Number(detail.expendituresPaise) / 100 : 0;
    const tenderTotal  = (detail?.tenderBreakdown ?? []).reduce((s, t) => s + Number(t.amountPaise) / 100, 0);
    const declaredNum  = parseFloat(declared) || 0;
    const carryOverNum = parseFloat(carryOver) || 0;
    // Sweep the drawer surplus PLUS the cash dropped to the safe — both leave the
    // counter for the vault, so the till closes at the carry-over. Mirrors the
    // server (close route): toVault = declared + drops − carryOver.
    const toVault      = Math.max(0, declaredNum + dropsNum - carryOverNum);
    const variance     = +(declaredNum - expected).toFixed(2);

    const submitVault = async () => {
        if (!detail) return;
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        if (carryOverNum > declaredNum) { toast.error("Carry-over cannot exceed declared count"); return; }
        if (initialClosedAt !== undefined && !closedAt) { toast.error("Enter the close date and time"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.patch<ClosedReport>(`/api/pos/shifts/${shiftId}/close`, {
                declaredCashPaise:  Math.round(declaredNum * 100),
                carryOverNextPaise: Math.round(carryOverNum * 100),
                notes:              notes.trim() || undefined,
                // Local wall-clock → ISO instant, so the server stores the exact moment.
                closedAt:           initialClosedAt !== undefined ? new Date(closedAt).toISOString() : undefined,
            });
            onClosed();          // refresh parent (clears ActiveShiftBar)
            setReport(data);     // swap form → report
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to close shift"));
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
            toast.error(extractApiError(e, "Failed to initiate handover"));
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
            <DialogContent
                className="flex flex-col w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[94vh] max-h-[94vh]"
                // Closing a shift posts GL — don't let a stray click/Escape abort
                // it. Only the explicit Cancel / Done / ✕ buttons dismiss it.
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >

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
                        <DialogHeader className="pb-1">
                            <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center justify-center shrink-0 shadow-sm border border-emerald-300/40">
                                    <Vault size={18} />
                                </div>
                                <div>
                                    <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
                                        {allowHandover ? "Close shift" : "Force close shift"}
                                    </DialogTitle>
                                    <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                                        {forCashierName
                                            ? `Count the physical cash and close ${forCashierName}'s shift on their behalf.`
                                            : "Count the physical cash in the drawer and choose how to close."}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        {loading || !detail ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="animate-spin text-muted-foreground" size={24} />
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                                {/* Mode tabs — hidden on admin force-close (no cashier to hand to). */}
                                {allowHandover && (
                                    <div className="flex rounded-lg border border-border overflow-hidden text-sm shadow-sm">
                                        <button
                                            type="button"
                                            onClick={() => setMode("vault")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${mode === "vault" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                                        >
                                            <Vault size={13} /> Close to vault
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMode("handover")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors border-l border-border ${mode === "handover" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                                        >
                                            <Users size={13} /> Hand to cashier
                                        </button>
                                    </div>
                                )}

                                <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
                                    {/* ── Column 1: Denomination counter + Notes ── */}
                                    <div className="space-y-3">
                                        <DenominationCounter
                                            denoms={denoms}
                                            onChange={setDenom}
                                            otherCash={otherCash}
                                            onOtherCashChange={handleOtherCashChange}
                                            total={countedTotal}
                                            list={denomList}
                                        />

                                        <div className="rounded-md border border-border bg-card p-3 shadow-sm space-y-1.5">
                                            <Label htmlFor="close-notes" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                                <FileText size={13} className="text-muted-foreground" /> Notes <span className="text-muted-foreground/70 lowercase font-normal">(optional)</span>
                                            </Label>
                                            <Textarea
                                                id="close-notes"
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="e.g. Safe drop already done or handover notes"
                                                rows={3}
                                                className="resize-none overflow-y-auto text-sm bg-background focus-visible:ring-emerald-500"
                                            />
                                        </div>
                                    </div>

                                    {/* ── Column 2: Reconciliation Summary & Inputs ── */}
                                    <div className="space-y-3">
                                        {/* Vault mode Contra alert */}
                                        {mode === "vault" && declared && (
                                            <div className="rounded-md bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 px-3 py-2 text-xs text-indigo-950 dark:text-indigo-200 space-y-1 shadow-sm">
                                                <div className="flex items-center gap-1.5 font-medium text-indigo-900 dark:text-indigo-300">
                                                    <ArrowRightLeft size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                    <span>Posts Contra: <strong className="text-indigo-950 dark:text-indigo-100">{detail.counter.tillAccount.name}</strong> → <strong className="text-indigo-950 dark:text-indigo-100">Vault</strong></span>
                                                </div>
                                                <div className="text-[11px] text-indigo-800 dark:text-indigo-300 pl-4">
                                                    Transfer amount: <span className="font-mono font-bold text-indigo-950 dark:text-indigo-100">₹{fmt(toVault)}</span>
                                                    {dropsNum > 0 && <> (incl. <span className="font-mono font-semibold">₹{fmt(dropsNum)}</span> dropped to safe)</>}.
                                                    Counter keeps <span className="font-mono font-semibold">₹{fmt(carryOverNum)}</span> overnight.
                                                </div>
                                            </div>
                                        )}

                                        {/* Handover mode acceptance notice */}
                                        {mode === "handover" && selectedUserId && (
                                            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                                                ⚠ Handover to {candidates.find((c) => c.id === selectedUserId)?.name ?? "cashier"}.
                                                Declared ₹{fmt(declaredNum)} · Carry-over ₹{fmt(carryOverNum)} · GL posts on acceptance.
                                            </div>
                                        )}

                                        {/* Cash Drawer Position */}
                                        <div className="rounded-md border border-sky-300/60 bg-sky-50/30 dark:border-sky-500/30 dark:bg-sky-950/20 p-3 text-xs sm:text-sm space-y-1.5 shadow-sm">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <Calculator size={13} className="text-sky-600 dark:text-sky-400" /> Cash Drawer Position
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                                                    System Ledger
                                                </span>
                                            </div>
                                            <Row label="Opening float" value={fmt(Number(detail.openingFloatPaise) / 100)} />
                                            <Row
                                                label="Till movement this shift"
                                                value={signed(Number(detail.tillMovementPaise) / 100)}
                                            />
                                            <Row label="Dropped to safe" value={`− ₹${fmt(Number(detail.dropsPaise) / 100)}`} />
                                            <div className="border-t border-sky-200/70 dark:border-sky-800/50 pt-1.5 mt-1 flex justify-between items-center bg-sky-100/50 dark:bg-sky-950/50 -mx-1 px-2 py-1 rounded font-semibold">
                                                <span className="text-sky-950 dark:text-sky-200">Expected in drawer</span>
                                                <span className="font-mono text-sm text-sky-900 dark:text-sky-100 font-bold">₹{fmt(expected)}</span>
                                            </div>
                                        </div>

                                        {/* Reconciliation & Closing Inputs Card */}
                                        <div className="rounded-md border border-amber-300/60 bg-amber-50/20 dark:border-amber-500/30 dark:bg-amber-950/20 p-3 text-xs sm:text-sm space-y-3 shadow-sm">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <ShieldCheck size={13} className="text-amber-600 dark:text-amber-400" /> Physical Count & Reconciliation
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                                                    Reconciliation
                                                </span>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between items-baseline">
                                                    <Label htmlFor="declared-amt" className="text-xs font-medium text-foreground">Physical count (₹)</Label>
                                                    {declared && <VarianceChip variance={variance} />}
                                                </div>
                                                <Input
                                                    id="declared-amt"
                                                    value={declared || "0.00"}
                                                    readOnly
                                                    tabIndex={-1}
                                                    className="h-9 font-mono font-bold bg-background text-foreground cursor-not-allowed select-none border-amber-300/70 dark:border-amber-700/50 text-base"
                                                />
                                                <p className="text-[11px] text-muted-foreground">
                                                    Locked to denomination count on the left.
                                                </p>
                                            </div>

                                            {mode === "vault" ? (
                                                <div className="space-y-1">
                                                    <Label htmlFor="carry-over" className="text-xs font-medium text-foreground">Keep in counter overnight (₹)</Label>
                                                    <Input
                                                        id="carry-over"
                                                        value={carryOver}
                                                        onChange={(e) => setCarryOver(parseDecimalInput(e.target.value))}
                                                        onFocus={(e) => e.target.select()}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        placeholder="0 (sweeps all to vault)"
                                                        className="h-9 font-mono bg-background focus-visible:ring-amber-500"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <Label htmlFor="carry-over-ho" className="text-xs font-medium text-foreground">Carry-over float (₹)</Label>
                                                    <Input
                                                        id="carry-over-ho"
                                                        value={carryOver}
                                                        onChange={(e) => setCarryOver(parseDecimalInput(e.target.value))}
                                                        onFocus={(e) => e.target.select()}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        placeholder="0"
                                                        className="h-9 font-mono bg-background focus-visible:ring-amber-500"
                                                    />
                                                </div>
                                            )}

                                            {mode === "vault" && initialClosedAt !== undefined && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs font-medium text-foreground">Closed on</Label>
                                                    <TallyDateTimeInput value={closedAt} onValueChange={setClosedAt} />
                                                </div>
                                            )}

                                            {/* Handover mode cashier selector */}
                                            {mode === "handover" && (
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-medium text-foreground">Hand over to</Label>
                                                    {loadingCandidates ? (
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <Loader2 size={13} className="animate-spin" /> Loading eligible cashiers…
                                                        </div>
                                                    ) : candidates.length === 0 ? (
                                                        <div className="text-xs text-muted-foreground rounded-md border border-border p-2.5 bg-background">
                                                            No eligible cashiers available (all on shift or no permission).
                                                        </div>
                                                    ) : (
                                                        <Select
                                                            value={selectedUserId?.toString() ?? ""}
                                                            onValueChange={(v) => setSelectedUserId(Number(v))}
                                                        >
                                                            <SelectTrigger className="h-9 bg-background focus-visible:ring-amber-500">
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
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Column 3: Breakdowns & Contra Action Preview ── */}
                                    <div className="space-y-3">
                                        {/* Dedicated Till Movement Breakdown Card */}
                                        <div className="rounded-md border border-violet-300/60 bg-violet-50/30 dark:border-violet-500/30 dark:bg-violet-950/20 p-3 text-xs sm:text-sm space-y-1.5 shadow-sm">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <TrendingUp size={13} className="text-violet-600 dark:text-violet-400" /> Till Movement Breakdown
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300">
                                                    Cash Flows
                                                </span>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-muted-foreground">
                                                    <span>Cash sales</span>
                                                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                                        {Number(detail.movementBreakdown?.cashSalesPaise || 0) > 0 ? `+ ₹${fmt(Number(detail.movementBreakdown?.cashSalesPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground">
                                                    <span>Customer receipts (Rcv)</span>
                                                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                                        {Number(detail.movementBreakdown?.receiptsPaise || 0) > 0 ? `+ ₹${fmt(Number(detail.movementBreakdown?.receiptsPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground">
                                                    <span>Counter expenses (Exp)</span>
                                                    <span className={`font-mono ${Number(detail.movementBreakdown?.expendituresPaise || 0) > 0 ? "text-rose-700 dark:text-rose-400 font-medium" : "text-foreground"}`}>
                                                        {Number(detail.movementBreakdown?.expendituresPaise || 0) > 0 ? `− ₹${fmt(Number(detail.movementBreakdown?.expendituresPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground">
                                                    <span>Cash refunds / returns</span>
                                                    <span className={`font-mono ${Number(detail.movementBreakdown?.refundsPaise || 0) > 0 ? "text-rose-700 dark:text-rose-400 font-medium" : "text-foreground"}`}>
                                                        {Number(detail.movementBreakdown?.refundsPaise || 0) > 0 ? `− ₹${fmt(Number(detail.movementBreakdown?.refundsPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                {detail.movementBreakdown?.otherPaise !== undefined && Number(detail.movementBreakdown.otherPaise) !== 0 && (
                                                    <div className="flex justify-between text-muted-foreground">
                                                        <span>Other adjustments</span>
                                                        <span className="font-mono text-foreground font-medium">
                                                            {signed(Number(detail.movementBreakdown.otherPaise) / 100)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border-t border-violet-200/70 dark:border-violet-800/50 pt-1.5 mt-1 flex justify-between items-center bg-violet-100/50 dark:bg-violet-950/50 -mx-1 px-2 py-1 rounded font-semibold">
                                                <span className="text-violet-950 dark:text-violet-200">Net till movement</span>
                                                <span className="font-mono text-violet-900 dark:text-violet-100 font-bold">{signed(Number(detail.tillMovementPaise) / 100)}</span>
                                            </div>
                                        </div>

                                        {/* All payment methods collected this shift (cash + digital).
                                            Informational — only cash is physically reconciled below. */}
                                        {detail.tenderBreakdown && detail.tenderBreakdown.length > 0 && (
                                            <div className="rounded-md border border-indigo-300/60 bg-indigo-50/30 dark:border-indigo-500/30 dark:bg-indigo-950/20 p-3 text-xs sm:text-sm space-y-1.5 shadow-sm">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                                                        <CreditCard size={13} className="text-indigo-600 dark:text-indigo-400" /> Payments collected this shift
                                                    </p>
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                                        All Modes
                                                    </span>
                                                </div>
                                                {detail.tenderBreakdown.map((t) => (
                                                    <Row key={t.method} label={t.label} value={fmt(Number(t.amountPaise) / 100)} />
                                                ))}
                                                <div className="border-t border-indigo-200/70 dark:border-indigo-800/50 pt-1.5 mt-1 flex justify-between items-center bg-indigo-100/50 dark:bg-indigo-950/50 -mx-1 px-2 py-1 rounded font-semibold">
                                                    <span className="text-indigo-950 dark:text-indigo-200">Total collected</span>
                                                    <span className="font-mono text-indigo-900 dark:text-indigo-100 font-bold">₹{fmt(tenderTotal)}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Total Collected Breakdown — justifies total collections across all tender modes */}
                                        {detail.collectionsBreakdown && (
                                            <div className="rounded-md border border-teal-300/60 bg-teal-50/30 dark:border-teal-500/30 dark:bg-teal-950/20 p-3 text-xs sm:text-sm space-y-1.5 shadow-sm">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-[11px] font-semibold text-teal-800 dark:text-teal-300 uppercase tracking-wide flex items-center gap-1.5">
                                                        <Receipt size={13} className="text-teal-600 dark:text-teal-400" /> Total Collected Breakdown
                                                    </p>
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300">
                                                        By Type
                                                    </span>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-muted-foreground">
                                                        <span>
                                                            POS Sales
                                                            {detail.collectionsBreakdown.salesCount > 0 && (
                                                                <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                                    {detail.collectionsBreakdown.salesCount} {detail.collectionsBreakdown.salesCount === 1 ? "bill" : "bills"}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">
                                                            + ₹{fmt(Number(detail.collectionsBreakdown.salesPaise) / 100)}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between text-muted-foreground">
                                                        <span>
                                                            Customer receipts (Rcv)
                                                            {detail.collectionsBreakdown.receiptsCount > 0 && (
                                                                <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                                    {detail.collectionsBreakdown.receiptsCount} {detail.collectionsBreakdown.receiptsCount === 1 ? "rcv" : "rcvs"}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">
                                                            + ₹{fmt(Number(detail.collectionsBreakdown.receiptsPaise) / 100)}
                                                        </span>
                                                    </div>
                                                    {Number(detail.collectionsBreakdown.refundsPaise) > 0 && (
                                                        <div className="flex justify-between text-muted-foreground">
                                                            <span>
                                                                Sales returns / refunds
                                                                {detail.collectionsBreakdown.refundsCount > 0 && (
                                                                    <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                                                                        {detail.collectionsBreakdown.refundsCount}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="font-mono text-rose-700 dark:text-rose-400 font-medium">
                                                                − ₹{fmt(Number(detail.collectionsBreakdown.refundsPaise) / 100)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="border-t border-teal-200/70 dark:border-teal-800/50 pt-1.5 mt-1 flex justify-between items-center bg-teal-100/50 dark:bg-teal-950/50 -mx-1 px-2 py-1 rounded font-semibold">
                                                    <span className="text-teal-950 dark:text-teal-200">Net total collected</span>
                                                    <span className="font-mono text-teal-900 dark:text-teal-100 font-bold">₹{fmt(tenderTotal)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>{/* ── end three-column grid ── */}
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
        const movement = Number(report.tillMovementPaise)  / 100;
        const drops    = Number(report.dropsPaise)         / 100;
        const expenses = Number(report.expendituresPaise)  / 100;
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
                    <ReportRow label="Opening float"            value={`₹${fmt(opening)}`} />
                    <ReportRow
                        label="Till movement this shift"
                        value={signed(movement)}
                    />
                    {report.movementBreakdown && (
                        <div className="pl-3 py-1 space-y-0.5 text-[11px] text-muted-foreground border-l-2 border-primary/30 my-0.5 font-normal">
                            {Number(report.movementBreakdown.cashSalesPaise) > 0 && (
                                <div className="flex justify-between">
                                    <span>Cash sales</span>
                                    <span className="font-mono text-foreground">+ ₹{fmt(Number(report.movementBreakdown.cashSalesPaise) / 100)}</span>
                                </div>
                            )}
                            {Number(report.movementBreakdown.receiptsPaise) > 0 && (
                                <div className="flex justify-between">
                                    <span>Customer receipts (Rcv)</span>
                                    <span className="font-mono text-foreground">+ ₹{fmt(Number(report.movementBreakdown.receiptsPaise) / 100)}</span>
                                </div>
                            )}
                            {Number(report.movementBreakdown.expendituresPaise) > 0 && (
                                <div className="flex justify-between text-amber-700 dark:text-amber-400">
                                    <span>Counter expenses (Exp)</span>
                                    <span className="font-mono">− ₹{fmt(Number(report.movementBreakdown.expendituresPaise) / 100)}</span>
                                </div>
                            )}
                            {Number(report.movementBreakdown.refundsPaise) > 0 && (
                                <div className="flex justify-between text-amber-700 dark:text-amber-400">
                                    <span>Cash refunds / returns</span>
                                    <span className="font-mono">− ₹{fmt(Number(report.movementBreakdown.refundsPaise) / 100)}</span>
                                </div>
                            )}
                            {Number(report.movementBreakdown.otherPaise) !== 0 && (
                                <div className="flex justify-between">
                                    <span>Other adjustments</span>
                                    <span className="font-mono text-foreground">{signed(Number(report.movementBreakdown.otherPaise) / 100)}</span>
                                </div>
                            )}
                        </div>
                    )}
                    <ReportRow label="Dropped to safe"          value={`− ₹${fmt(drops)}`} />
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

                {/* Total collected breakdown — justifies total collected across all methods */}
                {report.collectionsBreakdown && (
                    <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Total collected breakdown</p>
                        <ReportRow
                            label={`POS Sales${report.collectionsBreakdown.salesCount > 0 ? ` (${report.collectionsBreakdown.salesCount} ${report.collectionsBreakdown.salesCount === 1 ? "bill" : "bills"})` : ""}`}
                            value={`+ ₹${fmt(Number(report.collectionsBreakdown.salesPaise) / 100)}`}
                        />
                        <ReportRow
                            label={`Customer receipts (Rcv)${report.collectionsBreakdown.receiptsCount > 0 ? ` (${report.collectionsBreakdown.receiptsCount} ${report.collectionsBreakdown.receiptsCount === 1 ? "rcv" : "rcvs"})` : ""}`}
                            value={`+ ₹${fmt(Number(report.collectionsBreakdown.receiptsPaise) / 100)}`}
                        />
                        {Number(report.collectionsBreakdown.refundsPaise) > 0 && (
                            <ReportRow
                                label={`Sales returns / refunds${report.collectionsBreakdown.refundsCount > 0 ? ` (${report.collectionsBreakdown.refundsCount})` : ""}`}
                                value={`− ₹${fmt(Number(report.collectionsBreakdown.refundsPaise) / 100)}`}
                            />
                        )}
                        <div className="border-t border-border pt-1.5">
                            <ReportRow
                                label="Net total collected"
                                value={`₹${fmt(Number(report.collectionsBreakdown.netCollectedPaise) / 100)}`}
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

// "+ ₹1,234.00" / "− ₹1,234.00" — the till movement carries a sign of its own.
function signed(n: number): string {
    return `${n < 0 ? "−" : "+"} ₹${fmt(Math.abs(n))}`;
}

function Row({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
    const displayValue = value.includes("₹") ? value : `₹${value}`;
    return (
        <div className={`flex justify-between text-muted-foreground ${className ?? ""}`}>
            <span>
                {label}
                {sub && <span className="block text-[10px] leading-tight opacity-60">{sub}</span>}
            </span>
            <span className="font-mono text-foreground">{displayValue}</span>
        </div>
    );
}

// Note/coin tally — counts per denomination, summed into the physical count.
// `list` is the org's configured denominations (high → low).
function DenominationCounter({
    denoms, onChange, otherCash, onOtherCashChange, total, list,
}: {
    denoms: Record<number, string>;
    onChange: (denom: number, value: string) => void;
    otherCash: string;
    onOtherCashChange: (value: string) => void;
    total: number;
    list: number[];
}) {
    return (
        <div className="rounded-md border border-emerald-300/60 bg-emerald-50/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 p-3 self-start shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" /> Count by denomination
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                    Cash Drawer
                </span>
            </div>
            <div className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 gap-y-1 items-center text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80 bg-emerald-100/40 dark:bg-emerald-950/40 rounded px-1.5 py-1 mb-1.5">
                <span>Denomination</span>
                <span className="text-right">Count</span>
                <span className="text-right">Amount</span>
            </div>
            <div className="space-y-1">
                {list.map((d) => {
                    const count = parseInt(denoms[d] || "0", 10) || 0;
                    return (
                        <div key={d} className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 items-center">
                            <span className="font-mono text-sm font-medium text-foreground">₹{d.toLocaleString("en-IN")}</span>
                            <Input
                                value={denoms[d] ?? ""}
                                onChange={(e) => onChange(d, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                onClick={(e) => e.currentTarget.select()}
                                placeholder="0"
                                className="h-8 text-right font-mono bg-background focus-visible:ring-emerald-500"
                            />
                            <span className={`text-right font-mono text-sm ${count > 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/60"}`}>
                                {count > 0 ? `₹${fmt(d * count)}` : "—"}
                            </span>
                        </div>
                    );
                })}
                {/* Other row below ₹1 for mixed bundles / already counted cash */}
                <div className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 items-center pt-1.5 border-t border-emerald-200/50 dark:border-emerald-800/40">
                    <span className="font-mono text-sm font-medium text-foreground">Other</span>
                    <div className="col-span-2 flex items-center gap-1">
                        <span className="text-xs font-mono text-muted-foreground ml-auto">₹</span>
                        <Input
                            value={otherCash}
                            onChange={(e) => onOtherCashChange(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.currentTarget.select()}
                            placeholder="0.00"
                            className="h-8 text-right font-mono w-full bg-background focus-visible:ring-emerald-500"
                        />
                    </div>
                </div>
            </div>
            <div className="border-t border-emerald-200/60 dark:border-emerald-800/40 mt-2.5 pt-2 flex justify-between items-center bg-emerald-100/50 dark:bg-emerald-950/50 -mx-1 px-2.5 py-1.5 rounded font-semibold text-sm">
                <span className="text-emerald-900 dark:text-emerald-200">Counted total</span>
                <span className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-300">₹{fmt(total)}</span>
            </div>
        </div>
    );
}

function ReportRow({ label, value, bold, mono, sub }: { label: string; value: string; bold?: boolean; mono?: boolean; sub?: string }) {
    return (
        <div className={`flex justify-between gap-4 ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <span className="flex-1">
                {label}
                {sub && <span className="block text-[10px] leading-tight opacity-60 font-normal">{sub}</span>}
            </span>
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
