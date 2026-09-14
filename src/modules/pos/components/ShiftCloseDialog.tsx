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

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, ArrowRightLeft, TrendingUp, TrendingDown,
    CheckCheck, Users, Vault,
    Banknote, Calculator, ShieldCheck, CreditCard, Receipt,
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
import { FooterToggle } from "@/modules/accountancy/components/FooterToggle";

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

const PRINT_AFTER_SAVE_KEY = "pos_shift_print_after_save";
const THERMAL_KEY          = "pos_shift_print_thermal";

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

    // Print after save + Thermal toggles (persisted in localStorage)
    const [printAfterSave, setPrintAfterSave] = useState(() => {
        if (typeof window === "undefined") return true;
        try {
            const stored = window.localStorage.getItem(PRINT_AFTER_SAVE_KEY);
            return stored !== null ? stored === "true" : true;
        } catch {
            return true;
        }
    });

    const [thermal, setThermal] = useState(() => {
        if (typeof window === "undefined") return true;
        try {
            const stored = window.localStorage.getItem(THERMAL_KEY);
            return stored !== null ? stored === "true" : true;
        } catch {
            return true;
        }
    });

    const updatePrintAfterSave = (val: boolean) => {
        setPrintAfterSave(val);
        try { window.localStorage.setItem(PRINT_AFTER_SAVE_KEY, String(val)); } catch { /* ignore */ }
    };

    const updateThermal = (val: boolean) => {
        setThermal(val);
        try { window.localStorage.setItem(THERMAL_KEY, String(val)); } catch { /* ignore */ }
    };

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setMode("vault");
        setSelectedUserId(null);
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
            toast.success(`Shift #${shiftId} closed successfully`);
            if (printAfterSave) {
                printShiftCloseReport(data, thermal);
            }
            onClosed();
            onOpenChange(false);
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
                            <div className="flex-1 overflow-y-auto space-y-3 py-1 pr-1">
                                {/* Mode tabs — hidden on admin force-close (no cashier to hand to). */}
                                {allowHandover && (
                                    <div className="flex rounded-lg border border-border overflow-hidden text-sm shadow-sm">
                                        <button
                                            type="button"
                                            onClick={() => setMode("vault")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors ${mode === "vault" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                                        >
                                            <Vault size={13} /> Close to vault
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setMode("handover")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors border-l border-border ${mode === "handover" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                                        >
                                            <Users size={13} /> Hand to cashier
                                        </button>
                                    </div>
                                )}

                                <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
                                    {/* ── Column 1: Denomination counter + Notes ── */}
                                    <div className="space-y-2">
                                        <DenominationCounter
                                            denoms={denoms}
                                            onChange={setDenom}
                                            otherCash={otherCash}
                                            onOtherCashChange={handleOtherCashChange}
                                            total={countedTotal}
                                            list={denomList}
                                        />

                                        <Textarea
                                            id="close-notes"
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            placeholder="Notes (optional): e.g. Safe drop or handover notes…"
                                            rows={1}
                                            className="resize-none overflow-y-auto text-xs min-h-[34px] max-h-20 bg-white dark:bg-zinc-900 border border-border focus-visible:ring-emerald-500 shadow-sm"
                                        />
                                    </div>

                                    {/* ── Column 2: Reconciliation Summary & Inputs ── */}
                                    <div className="space-y-2">
                                        {/* Vault mode Contra alert */}
                                        {mode === "vault" && declared && (
                                            <div className="rounded-md bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 px-3 py-1.5 text-xs text-indigo-950 dark:text-indigo-200 space-y-0.5 shadow-sm">
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
                                            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                                                ⚠ Handover to {candidates.find((c) => c.id === selectedUserId)?.name ?? "cashier"}.
                                                Declared ₹{fmt(declaredNum)} · Carry-over ₹{fmt(carryOverNum)} · GL posts on acceptance.
                                            </div>
                                        )}

                                        {/* Cash Drawer Position */}
                                        <div className="rounded-md border border-sky-300/60 bg-sky-50/30 dark:border-sky-500/30 dark:bg-sky-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <Calculator size={13} className="text-sky-600 dark:text-sky-400" /> Cash Drawer Position
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                                                    System Ledger
                                                </span>
                                            </div>
                                            <Row label="Counter opening cash" value={fmt(Number(detail.openingFloatPaise) / 100)} />
                                            <Row
                                                label="Counter cash flow"
                                                value={signed(Number(detail.tillMovementPaise) / 100)}
                                            />
                                            <Row label="Dropped to safe" value={`− ₹${fmt(Number(detail.dropsPaise) / 100)}`} />
                                            <div className="border-t border-sky-200/70 dark:border-sky-800/50 pt-1 mt-0.5 flex justify-between items-center bg-sky-100/50 dark:bg-sky-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                                                <span className="text-sky-950 dark:text-sky-200">Expected in drawer</span>
                                                <span className="font-mono text-sm text-sky-900 dark:text-sky-100 font-bold">₹{fmt(expected)}</span>
                                            </div>
                                        </div>

                                        {/* Reconciliation & Closing Inputs Card */}
                                        <div className="rounded-md border border-amber-300/60 bg-amber-50/20 dark:border-amber-500/30 dark:bg-amber-950/20 p-2.5 text-xs sm:text-sm space-y-2 shadow-sm">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <ShieldCheck size={13} className="text-amber-600 dark:text-amber-400" /> Physical Count & Reconciliation
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                                                    Reconciliation
                                                </span>
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="flex justify-between items-baseline">
                                                    <Label htmlFor="declared-amt" className="text-xs font-medium text-foreground">Physical count (₹)</Label>
                                                    {declared && <VarianceChip variance={variance} />}
                                                </div>
                                                <Input
                                                    id="declared-amt"
                                                    value={declared || "0.00"}
                                                    readOnly
                                                    tabIndex={-1}
                                                    className="h-8 font-mono font-bold bg-muted/60 text-foreground cursor-not-allowed select-none border border-border text-sm"
                                                />
                                                <p className="text-[10px] text-muted-foreground">
                                                    Locked to denomination count on the left.
                                                </p>
                                            </div>

                                            {mode === "vault" ? (
                                                <div className="space-y-0.5">
                                                    <Label htmlFor="carry-over" className="text-xs font-medium text-foreground">Keep in counter overnight (₹)</Label>
                                                    <Input
                                                        id="carry-over"
                                                        value={carryOver}
                                                        onChange={(e) => setCarryOver(parseDecimalInput(e.target.value))}
                                                        onFocus={(e) => e.target.select()}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        placeholder="0 (sweeps all to vault)"
                                                        className="h-8 font-mono bg-white dark:bg-zinc-900 border border-input focus-visible:ring-amber-500"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="space-y-0.5">
                                                    <Label htmlFor="carry-over-ho" className="text-xs font-medium text-foreground">Carry-over float (₹)</Label>
                                                    <Input
                                                        id="carry-over-ho"
                                                        value={carryOver}
                                                        onChange={(e) => setCarryOver(parseDecimalInput(e.target.value))}
                                                        onFocus={(e) => e.target.select()}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        placeholder="0"
                                                        className="h-8 font-mono bg-white dark:bg-zinc-900 border border-input focus-visible:ring-amber-500"
                                                    />
                                                </div>
                                            )}

                                            {mode === "vault" && initialClosedAt !== undefined && (
                                                <div className="space-y-0.5">
                                                    <Label className="text-xs font-medium text-foreground">Closed on</Label>
                                                    <TallyDateTimeInput value={closedAt} onValueChange={setClosedAt} />
                                                </div>
                                            )}

                                            {/* Handover mode cashier selector */}
                                            {mode === "handover" && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs font-medium text-foreground">Hand over to</Label>
                                                    {loadingCandidates ? (
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <Loader2 size={13} className="animate-spin" /> Loading eligible cashiers…
                                                        </div>
                                                    ) : candidates.length === 0 ? (
                                                        <div className="text-xs text-muted-foreground rounded-md border border-border p-2 bg-background">
                                                            No eligible cashiers available (all on shift or no permission).
                                                        </div>
                                                    ) : (
                                                        <Select
                                                            value={selectedUserId?.toString() ?? ""}
                                                            onValueChange={(v) => setSelectedUserId(Number(v))}
                                                        >
                                                            <SelectTrigger className="h-8 bg-white dark:bg-zinc-900 border border-input focus-visible:ring-amber-500">
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
                                    <div className="space-y-2">
                                        {/* Dedicated Till Movement Breakdown Card */}
                                        <div className="rounded-md border border-violet-300/60 bg-violet-50/30 dark:border-violet-500/30 dark:bg-violet-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-300 uppercase tracking-wide flex items-center gap-1.5">
                                                    <TrendingUp size={13} className="text-violet-600 dark:text-violet-400" /> Counter Cash Flow Breakdown
                                                </p>
                                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300">
                                                    Cash Flows
                                                </span>
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="flex justify-between text-muted-foreground text-xs">
                                                    <span>Cash sales</span>
                                                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                                        {Number(detail.movementBreakdown?.cashSalesPaise || 0) > 0 ? `+ ₹${fmt(Number(detail.movementBreakdown?.cashSalesPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground text-xs">
                                                    <span>Customer receipts (Rcv)</span>
                                                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                                        {Number(detail.movementBreakdown?.receiptsPaise || 0) > 0 ? `+ ₹${fmt(Number(detail.movementBreakdown?.receiptsPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground text-xs">
                                                    <span>Counter expenses (Exp)</span>
                                                    <span className={`font-mono ${Number(detail.movementBreakdown?.expendituresPaise || 0) > 0 ? "text-rose-700 dark:text-rose-400 font-medium" : "text-foreground"}`}>
                                                        {Number(detail.movementBreakdown?.expendituresPaise || 0) > 0 ? `− ₹${fmt(Number(detail.movementBreakdown?.expendituresPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground text-xs">
                                                    <span>Cash refunds / returns</span>
                                                    <span className={`font-mono ${Number(detail.movementBreakdown?.refundsPaise || 0) > 0 ? "text-rose-700 dark:text-rose-400 font-medium" : "text-foreground"}`}>
                                                        {Number(detail.movementBreakdown?.refundsPaise || 0) > 0 ? `− ₹${fmt(Number(detail.movementBreakdown?.refundsPaise || 0) / 100)}` : "₹0.00"}
                                                    </span>
                                                </div>
                                                {detail.movementBreakdown?.otherPaise !== undefined && Number(detail.movementBreakdown.otherPaise) !== 0 && (
                                                    <div className="flex justify-between text-muted-foreground text-xs">
                                                        <span>Other adjustments</span>
                                                        <span className="font-mono text-foreground font-medium">
                                                            {signed(Number(detail.movementBreakdown.otherPaise) / 100)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border-t border-violet-200/70 dark:border-violet-800/50 pt-1 mt-0.5 flex justify-between items-center bg-violet-100/50 dark:bg-violet-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                                                <span className="text-violet-950 dark:text-violet-200">Net counter cash flow</span>
                                                <span className="font-mono text-sm text-violet-900 dark:text-violet-100 font-bold">{signed(Number(detail.tillMovementPaise) / 100)}</span>
                                            </div>
                                        </div>

                                        {/* All payment methods collected this shift (cash + digital).
                                            Informational — only cash is physically reconciled below. */}
                                        {detail.tenderBreakdown && detail.tenderBreakdown.length > 0 && (
                                            <div className="rounded-md border border-indigo-300/60 bg-indigo-50/30 dark:border-indigo-500/30 dark:bg-indigo-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <p className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                                                        <CreditCard size={13} className="text-indigo-600 dark:text-indigo-400" /> Payments collected this shift
                                                    </p>
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                                        All Modes
                                                    </span>
                                                </div>
                                                <div className="space-y-0.5">
                                                    {detail.tenderBreakdown.map((t) => (
                                                        <Row key={t.method} label={t.label} value={fmt(Number(t.amountPaise) / 100)} />
                                                    ))}
                                                </div>
                                                <div className="border-t border-indigo-200/70 dark:border-indigo-800/50 pt-1 mt-0.5 flex justify-between items-center bg-indigo-100/50 dark:bg-indigo-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                                                    <span className="text-indigo-950 dark:text-indigo-200">Total collected</span>
                                                    <span className="font-mono text-sm text-indigo-900 dark:text-indigo-100 font-bold">₹{fmt(tenderTotal)}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Total Collected Breakdown — justifies total collections across all tender modes */}
                                        {detail.collectionsBreakdown && (
                                            <div className="rounded-md border border-teal-300/60 bg-teal-50/30 dark:border-teal-500/30 dark:bg-teal-950/20 p-2.5 text-xs sm:text-sm space-y-1 shadow-sm">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <p className="text-[11px] font-semibold text-teal-800 dark:text-teal-300 uppercase tracking-wide flex items-center gap-1.5">
                                                        <Receipt size={13} className="text-teal-600 dark:text-teal-400" /> Total Collected Breakdown
                                                    </p>
                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300">
                                                        By Type
                                                    </span>
                                                </div>
                                                <div className="space-y-0.5">
                                                    <div className="flex justify-between text-muted-foreground text-xs">
                                                        <span>
                                                            POS Sales
                                                            {detail.collectionsBreakdown.salesCount > 0 && (
                                                                <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                                    {detail.collectionsBreakdown.salesCount} {detail.collectionsBreakdown.salesCount === 1 ? "bill" : "bills"}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">
                                                            + ₹{fmt(Number(detail.collectionsBreakdown.salesPaise) / 100)}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between text-muted-foreground text-xs">
                                                        <span>
                                                            Customer receipts (Rcv)
                                                            {detail.collectionsBreakdown.receiptsCount > 0 && (
                                                                <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                                                                    {detail.collectionsBreakdown.receiptsCount} {detail.collectionsBreakdown.receiptsCount === 1 ? "rcv" : "rcvs"}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="font-mono text-teal-700 dark:text-teal-300 font-medium">
                                                            + ₹{fmt(Number(detail.collectionsBreakdown.receiptsPaise) / 100)}
                                                        </span>
                                                    </div>
                                                    {Number(detail.collectionsBreakdown.refundsPaise) > 0 && (
                                                        <div className="flex justify-between text-muted-foreground text-xs">
                                                            <span>
                                                                Sales returns / refunds
                                                                {detail.collectionsBreakdown.refundsCount > 0 && (
                                                                    <span className="text-[10px] font-medium ml-1.5 px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
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
                                                <div className="border-t border-teal-200/70 dark:border-teal-800/50 pt-1 mt-0.5 flex justify-between items-center bg-teal-100/50 dark:bg-teal-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                                                    <span className="text-teal-950 dark:text-teal-200">Net total collected</span>
                                                    <span className="font-mono text-sm text-teal-900 dark:text-teal-100 font-bold">₹{fmt(tenderTotal)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>{/* ── end three-column grid ── */}
                            </div>
                        )}

                        <DialogFooter className="pt-2 border-t border-border flex items-center justify-end gap-2 flex-wrap">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                            <FooterToggle
                                label="Print after save"
                                checked={printAfterSave}
                                onChange={updatePrintAfterSave}
                                disabled={submitting}
                            />
                            {printAfterSave && (
                                <FooterToggle
                                    label="Thermal"
                                    checked={thermal}
                                    onChange={updateThermal}
                                    disabled={submitting}
                                />
                            )}
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
            </DialogContent>
        </Dialog>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

// "+ ₹1,234.00" / "− ₹1,234.00" — the till movement carries a sign of its own.
function signed(n: number): string {
    return `${n < 0 ? "−" : "+"} ₹${fmt(Math.abs(n))}`;
}

// ── Shift Close Print ─────────────────────────────────────────────────────────

function printShiftCloseReport(report: ClosedReport, isThermal: boolean) {
    const win = window.open("", "_blank", isThermal ? "width=380,height=650" : "width=440,height=700");
    if (!win) {
        toast.error("Popup blocked. Please allow popups to print shift report.");
        return;
    }

    const openedAt = new Date(report.openedAt);
    const closedAt = new Date(report.closedAt);
    const durationMs = closedAt.getTime() - openedAt.getTime();
    const durationH = Math.floor(durationMs / 3_600_000);
    const durationM = Math.floor((durationMs % 3_600_000) / 60_000);
    const durationStr = `${durationH}h ${durationM}m`;
    const fmtTime = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const fmtDateStr = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const opening = Number(report.openingFloatPaise) / 100;
    const movement = Number(report.tillMovementPaise) / 100;
    const drops = Number(report.dropsPaise) / 100;
    const expected = Number(report.expectedCashPaise ?? "0") / 100;
    const declared = report.declaredCashPaise != null ? Number(report.declaredCashPaise) / 100 : null;
    const varianceVal = report.variancePaise != null ? Number(report.variancePaise) / 100 : null;
    const carryOver = report.carryOverNextPaise != null ? Number(report.carryOverNextPaise) / 100 : null;
    const toVault = report.toVaultPaise != null ? Number(report.toVaultPaise) / 100 : null;
    const tenderTotal = (report.tenderBreakdown ?? []).reduce((s, t) => s + Number(t.amountPaise) / 100, 0);

    const tenderRowsHtml = (report.tenderBreakdown ?? [])
        .map((t) => `<div class="row"><span class="label">${t.label}</span><span class="val font-mono">₹${fmt(Number(t.amountPaise) / 100)}</span></div>`)
        .join("");

    const vouchersHtml = [
        report.closingContraVoucher ? `<div class="row text-xs"><span class="label">Closing Contra</span><span class="val font-mono">${report.closingContraVoucher.reference}</span></div>` : "",
        report.varianceJournalEntry ? `<div class="row text-xs"><span class="label">Variance JE</span><span class="val font-mono">${report.varianceJournalEntry.reference}</span></div>` : "",
    ].filter(Boolean).join("");

    const pageStyles = isThermal
        ? `
            @page { size: 80mm auto; margin: 3mm; }
            body {
                font-family: 'Courier New', Courier, monospace, system-ui;
                font-size: 11px;
                line-height: 1.3;
                color: #000;
                padding: 4px;
                max-width: 74mm;
                margin: 0 auto;
            }
        `
        : `
            @page { margin: 8mm; }
            body {
                font-family: 'Courier New', Courier, monospace, system-ui;
                font-size: 12px;
                line-height: 1.35;
                color: #111;
                padding: 14px;
                max-width: 420px;
                margin: 0 auto;
            }
        `;

    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Shift #${report.id} Closing Report</title>
            <style>
                ${pageStyles}
                .center { text-align: center; }
                .header-title { font-size: ${isThermal ? "13px" : "15px"}; font-weight: bold; margin-bottom: 2px; }
                .header-sub { font-size: 10px; color: #444; margin-bottom: 4px; }
                hr { border: none; border-top: 1px dashed #666; margin: 6px 0; }
                .row { display: flex; justify-content: space-between; margin: 2px 0; }
                .row.bold { font-weight: bold; }
                .sec-title { font-size: 10px; font-weight: bold; text-transform: uppercase; margin: 6px 0 2px; color: #333; }
                .sub-row { display: flex; justify-content: space-between; padding-left: 8px; font-size: 10px; color: #555; }
                .label { flex: 1; }
                .val { text-align: right; min-width: 70px; }
                .font-mono { font-family: monospace; }
                .over { color: #166534; }
                .short { color: #991b1b; }
                .text-xs { font-size: 10px; }
                .footer { margin-top: 10px; padding-top: 4px; border-top: 1px solid #ccc; font-size: 9px; color: #666; text-align: center; }
                .sig-block { display: flex; justify-content: space-between; margin-top: 18px; padding-top: 4px; }
                .sig-line { border-top: 1px solid #444; width: 45%; text-align: center; font-size: 9px; padding-top: 3px; }
                @media print {
                    body { padding: 0; max-width: 100%; }
                }
            </style>
        </head>
        <body>
            <div class="center">
                <div class="header-title">${report.branch.name}</div>
                <div class="header-sub">SHIFT CLOSING &amp; CASH RECONCILIATION</div>
                <div class="row bold">
                    <span>Shift #${report.id} (CLOSED)</span>
                    <span>${fmtDateStr(openedAt)}</span>
                </div>
                <div class="row" style="font-size: 10px;">
                    <span>${report.counter.name} (${report.counter.tillAccount.name})</span>
                </div>
                <div class="row" style="font-size: 10px;">
                    <span>Duration: ${durationStr}</span>
                </div>
                <div class="row" style="font-size: 10px;">
                    <span>Opened: ${fmtTime(openedAt)}</span>
                    <span>Closed: ${fmtTime(closedAt)}</span>
                </div>
            </div>

            <hr />

            <div class="sec-title">CASH RECONCILIATION</div>
            <div class="row">
                <span class="label">Counter opening cash</span>
                <span class="val font-mono bold">₹${fmt(opening)}</span>
            </div>

            <div class="row">
                <span class="label">Counter cash flow</span>
                <span class="val font-mono bold">${signed(movement)}</span>
            </div>
            ${report.movementBreakdown ? `
                ${Number(report.movementBreakdown.cashSalesPaise) > 0 ? `
                    <div class="sub-row">
                        <span>· Cash sales</span>
                        <span class="font-mono">+ ₹${fmt(Number(report.movementBreakdown.cashSalesPaise) / 100)}</span>
                    </div>
                ` : ""}
                ${Number(report.movementBreakdown.receiptsPaise) > 0 ? `
                    <div class="sub-row">
                        <span>· Customer receipts (Rcv)</span>
                        <span class="font-mono">+ ₹${fmt(Number(report.movementBreakdown.receiptsPaise) / 100)}</span>
                    </div>
                ` : ""}
                ${Number(report.movementBreakdown.expendituresPaise) > 0 ? `
                    <div class="sub-row">
                        <span>· Counter expenses (Exp)</span>
                        <span class="font-mono">− ₹${fmt(Number(report.movementBreakdown.expendituresPaise) / 100)}</span>
                    </div>
                ` : ""}
                ${Number(report.movementBreakdown.refundsPaise) > 0 ? `
                    <div class="sub-row">
                        <span>· Cash refunds / returns</span>
                        <span class="font-mono">− ₹${fmt(Number(report.movementBreakdown.refundsPaise) / 100)}</span>
                    </div>
                ` : ""}
                ${report.movementBreakdown.otherPaise !== undefined && Number(report.movementBreakdown.otherPaise) !== 0 ? `
                    <div class="sub-row">
                        <span>· Other adjustments</span>
                        <span class="font-mono">${signed(Number(report.movementBreakdown.otherPaise) / 100)}</span>
                    </div>
                ` : ""}
            ` : ""}

            ${drops > 0 ? `
                <div class="row">
                    <span class="label">Dropped to safe</span>
                    <span class="val font-mono">− ₹${fmt(drops)}</span>
                </div>
            ` : ""}

            <div class="row bold" style="margin-top: 4px;">
                <span class="label">Expected in drawer</span>
                <span class="val font-mono">₹${fmt(expected)}</span>
            </div>
            ${declared != null ? `
                <div class="row bold">
                    <span class="label">Physical count (Declared)</span>
                    <span class="val font-mono">₹${fmt(declared)}</span>
                </div>
                <div class="row bold ${varianceVal === 0 ? "" : (varianceVal ?? 0) > 0 ? "over" : "short"}">
                    <span class="label">Variance</span>
                    <span class="val font-mono">${varianceVal === 0 ? "₹0.00 (Balanced)" : `${(varianceVal ?? 0) > 0 ? "+" : "−"}₹${fmt(Math.abs(varianceVal ?? 0))} (${(varianceVal ?? 0) > 0 ? "Over" : "Short"})`}</span>
                </div>
            ` : ""}

            ${carryOver != null || toVault != null ? `
                <hr />
                <div class="sec-title">CLOSING DISTRIBUTION</div>
                ${carryOver != null ? `
                    <div class="row">
                        <span class="label">Kept in counter</span>
                        <span class="val font-mono">₹${fmt(carryOver)}</span>
                    </div>
                ` : ""}
                ${toVault != null ? `
                    <div class="row">
                        <span class="label">Swept to vault</span>
                        <span class="val font-mono">₹${fmt(toVault)}</span>
                    </div>
                ` : ""}
            ` : ""}

            ${tenderRowsHtml ? `
                <hr />
                <div class="sec-title">PAYMENTS COLLECTED</div>
                ${tenderRowsHtml}
                <div class="row bold" style="border-top: 1px solid #bbb; padding-top: 2px; margin-top: 2px;">
                    <span class="label">Total Collected</span>
                    <span class="val font-mono">₹${fmt(tenderTotal)}</span>
                </div>
            ` : ""}

            ${report.collectionsBreakdown ? `
                <hr />
                <div class="sec-title">COLLECTIONS BY ACTIVITY</div>
                <div class="row">
                    <span class="label">POS Sales (${report.collectionsBreakdown.salesCount} bills)</span>
                    <span class="val font-mono">+ ₹${fmt(Number(report.collectionsBreakdown.salesPaise) / 100)}</span>
                </div>
                ${report.collectionsBreakdown.receiptsCount > 0 ? `
                    <div class="row">
                        <span class="label">Customer receipts (${report.collectionsBreakdown.receiptsCount} rcv)</span>
                        <span class="val font-mono">+ ₹${fmt(Number(report.collectionsBreakdown.receiptsPaise) / 100)}</span>
                    </div>
                ` : ""}
                ${report.collectionsBreakdown.refundsCount > 0 ? `
                    <div class="row">
                        <span class="label">Refunds / returns (${report.collectionsBreakdown.refundsCount})</span>
                        <span class="val font-mono">− ₹${fmt(Number(report.collectionsBreakdown.refundsPaise) / 100)}</span>
                    </div>
                ` : ""}
                <div class="row bold" style="border-top: 1px solid #bbb; padding-top: 2px; margin-top: 2px;">
                    <span class="label">Net Total</span>
                    <span class="val font-mono">₹${fmt(Number(report.collectionsBreakdown.netCollectedPaise) / 100)}</span>
                </div>
            ` : ""}

            ${vouchersHtml ? `
                <hr />
                <div class="sec-title">LINKED VOUCHERS</div>
                ${vouchersHtml}
            ` : ""}

            ${report.notes ? `
                <hr />
                <div class="sec-title">NOTES</div>
                <div style="font-size: 10px; white-space: pre-wrap;">${report.notes}</div>
            ` : ""}

            <div class="sig-block">
                <div class="sig-line">Cashier Signature</div>
                <div class="sig-line">Manager Signature</div>
            </div>

            <div class="footer">
                Printed on ${new Date().toLocaleString("en-IN")} · AbeerSuite POS
            </div>
        </body>
        </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
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
        <div className="rounded-md border border-emerald-300/60 bg-emerald-50/20 dark:border-emerald-500/30 dark:bg-emerald-950/20 p-2.5 self-start shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" /> Count by denomination
                </p>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                    Cash Drawer
                </span>
            </div>
            <div className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 gap-y-1 items-center text-[11px] font-medium text-emerald-800/80 dark:text-emerald-300/80 bg-emerald-100/40 dark:bg-emerald-950/40 rounded px-1.5 py-0.5 mb-1">
                <span>Denomination</span>
                <span className="text-right">Count</span>
                <span className="text-right">Amount</span>
            </div>
            <div className="space-y-0.5">
                {list.map((d) => {
                    const count = parseInt(denoms[d] || "0", 10) || 0;
                    return (
                        <div key={d} className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 items-center">
                            <span className="font-mono text-xs font-medium text-foreground">₹{d.toLocaleString("en-IN")}</span>
                            <Input
                                value={denoms[d] ?? ""}
                                onChange={(e) => onChange(d, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                onClick={(e) => e.currentTarget.select()}
                                placeholder="0"
                                className="h-7 text-right font-mono text-xs bg-white dark:bg-zinc-900 border border-input focus-visible:ring-emerald-500"
                            />
                            <span className={`text-right font-mono text-xs ${count > 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/60"}`}>
                                {count > 0 ? `₹${fmt(d * count)}` : "—"}
                            </span>
                        </div>
                    );
                })}
                {/* Other row below ₹1 for mixed bundles / already counted cash */}
                <div className="grid grid-cols-[1fr_5rem_6rem] gap-x-2 items-center pt-1 border-t border-emerald-200/50 dark:border-emerald-800/40">
                    <span className="font-mono text-xs font-medium text-foreground">Other</span>
                    <div className="col-span-2 flex items-center gap-1">
                        <span className="text-xs font-mono text-muted-foreground ml-auto">₹</span>
                        <Input
                            value={otherCash}
                            onChange={(e) => onOtherCashChange(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.currentTarget.select()}
                            placeholder="0.00"
                            className="h-7 text-right font-mono text-xs w-full bg-white dark:bg-zinc-900 border border-input focus-visible:ring-emerald-500"
                        />
                    </div>
                </div>
            </div>
            <div className="border-t border-emerald-200/60 dark:border-emerald-800/40 mt-1.5 pt-1.5 flex justify-between items-center bg-emerald-100/50 dark:bg-emerald-950/50 -mx-1 px-2.5 py-1 rounded font-semibold text-xs">
                <span className="text-emerald-900 dark:text-emerald-200">Counted total</span>
                <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">₹{fmt(total)}</span>
            </div>
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
