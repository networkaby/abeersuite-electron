"use client";

// ── ShiftCloseDialog ─────────────────────────────────────────────────────────
// Two close modes:
//   1. "Close to vault"  — standard end-of-day. Declares physical count,
//      sets overnight carry-over, posts variance JE + Contra to vault.
//   2. "Hand to cashier" — the whole drawer passes to whoever signs in next at
//      this counter. A counts it and is signed out; nobody is named and nothing
//      goes to the vault. No GL yet — shift → AWAITING_HANDOVER; it all posts
//      when the next cashier takes over (ShiftTakeoverDialog).
//
// After a successful vault close, the form swaps to a closing report that
// shows the full cash reconciliation summary and GL references.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, ArrowRightLeft, TrendingUp, TrendingDown,
    CheckCheck, Users, Vault,
    Banknote, ShieldCheck,
} from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
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
import { captureMyDay } from "@/shared/lib/hr/myDay";
import { getPriorInputAt } from "@/shared/components/ActivityPulse";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import type { HandoverDenominations } from "@/modules/pos/lib/handoverDenominations";
import {
    CashDrawerPositionCard, CashFlowCard, PaymentsCollectedCard, CollectionsCard,
    type ShiftSummary,
} from "@/modules/pos/components/ShiftSummaryCards";

// ── Types ─────────────────────────────────────────────────────────────────────

type ShiftDetail = ShiftSummary & {
    id: number;
    counter: { id: number; name: string; tillAccount: { name: string } };
    branch:  { name: string };
};

type Mode = "vault" | "handover";

// Fallback note/coin denominations (high → low) used until the org's configured
// list loads. The live list is OrgDefaults.cashDenominationsJson (country-specific,
// edited in Settings → Org Defaults).
const DEFAULT_DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

const PRINT_AFTER_SAVE_KEY = "pos_shift_print_after_save";
const THERMAL_KEY          = "pos_shift_print_thermal";

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftCloseDialog({
    open, onOpenChange, shiftId, onClosed, mode = "vault", forCashierName, initialClosedAt,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    shiftId: number;
    onClosed: () => void;
    // Which job the dialog does — fixed by the button that opened it. The shift
    // bar has separate "Hand over" and "Close shift" buttons; office callers
    // only ever close to the vault.
    mode?: Mode;
    // Admin force-close: labels the dialog as closing on that cashier's behalf.
    forCashierName?: string;
    // Re-close after a reopen (shift detail page): shows an editable "Closed on"
    // date-time, prefilled with the ORIGINAL close moment so the corrected close
    // lands on the same day in the books. Manager-only server-side. Absent →
    // the field is hidden and the close is stamped "now".
    initialClosedAt?: string | null;
}) {
    const [detail, setDetail]     = useState<ShiftDetail | null>(null);
    const [loading, setLoading]   = useState(false);

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

    // Vault mode — the counted cash splits in two: what goes to the vault now
    // and what stays in the till overnight. The cashier counts out ONE pile and
    // types it; whichever box is typed becomes the anchor and the other one is
    // derived, so the two always add up to the physical count.
    const [carryOver, setCarryOver] = useState("");
    const [toVaultInput, setToVaultInput] = useState("");
    const [anchor, setAnchor] = useState<"keep" | "sweep">("keep");
    // Back-dated close (re-close flow only) — `yyyy-MM-ddTHH:mm` local.
    const [closedAt, setClosedAt]   = useState("");

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
                setCarryOver("0.00");
                setToVaultInput("0.00");
                setAnchor("keep");
            })
            .catch(() => toast.error("Failed to load shift summary"))
            .finally(() => setLoading(false));
    }, [open, shiftId, initialClosedAt]);

    const expected     = detail ? Number(detail.runningExpectedPaise) / 100 : 0;
    const dropsNum     = detail ? Number(detail.dropsPaise) / 100 : 0;
    const declaredNum  = parseFloat(declared) || 0;
    const carryOverNum = parseFloat(carryOver) || 0;
    // Sweep the drawer surplus PLUS the cash dropped to the safe — both leave the
    // counter for the vault, so the till closes at the carry-over. Mirrors the
    // server (close route): toVault = declared + drops − carryOver.
    const toVault      = Math.max(0, declaredNum + dropsNum - carryOverNum);
    // Cash physically carried to the vault right now. The day's safe drops left
    // the drawer earlier, so they can't be counted out again — they only ride
    // along in the Contra figure.
    const sweepNum     = parseFloat(toVaultInput) || 0;
    const handOverNow  = Math.max(0, declaredNum - carryOverNum);
    const overCounted  = (anchor === "keep" ? carryOverNum : sweepNum) > declaredNum + 0.001;
    const variance     = +(declaredNum - expected).toFixed(2);

    const splitFmt = (n: number) => Math.max(0, +n.toFixed(2)).toFixed(2);
    const editKeep = (raw: string) => {
        const v = parseDecimalInput(raw);
        setAnchor("keep");
        setCarryOver(v);
        setToVaultInput(splitFmt(declaredNum - (parseFloat(v) || 0)));
    };
    const editSweep = (raw: string) => {
        const v = parseDecimalInput(raw);
        setAnchor("sweep");
        setToVaultInput(v);
        setCarryOver(splitFmt(declaredNum - (parseFloat(v) || 0)));
    };

    // Counting more notes moves the physical total: the box the cashier last
    // typed holds its figure, the other one follows.
    useEffect(() => {
        if (mode !== "vault") return;
        if (anchor === "keep") setToVaultInput(splitFmt(declaredNum - carryOverNum));
        else                   setCarryOver(splitFmt(declaredNum - sweepNum));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [declaredNum, mode]);

    const submitVault = async () => {
        if (!detail) return;
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        if (carryOverNum > declaredNum) { toast.error("Carry-over cannot exceed declared count"); return; }
        if (initialClosedAt !== undefined && !closedAt) { toast.error("Enter the close date and time"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.patch<{ id: number }>(`/api/pos/shifts/${shiftId}/close`, {
                declaredCashPaise:  Math.round(declaredNum * 100),
                carryOverNextPaise: Math.round(carryOverNum * 100),
                notes:              notes.trim() || undefined,
                // Local wall-clock → ISO instant, so the server stores the exact moment.
                closedAt:           initialClosedAt !== undefined ? new Date(closedAt).toISOString() : undefined,
            });
            toast.success(`Shift #${shiftId} closed successfully`);
            if (printAfterSave) {
                const paper = thermal ? "THERMAL_80MM" : "A4";
                window.open(`/receipt/shift/${data.id}?paper=${paper}&autoprint=1`, "_blank", "noopener");
            }
            onClosed();
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to close shift"));
        } finally {
            setSubmitting(false);
        }
    };

    // The whole drawer, counted, to whoever signs in next — then A is signed out
    // the ordinary way (the day card is captured first, as the Sign Out button does).
    const submitHandover = async () => {
        if (!detail) return;
        if (declaredNum < 0) { toast.error("Declared count can't be negative"); return; }
        const denominations: HandoverDenominations = {
            lines: denomList
                .map((d) => ({ denom: d, count: parseInt(denoms[d] || "0", 10) || 0 }))
                .filter((l) => l.count > 0),
            otherPaise: Math.round((parseFloat(otherCash) || 0) * 100),
        };
        setSubmitting(true);
        try {
            await axios.post(`/api/pos/shifts/${shiftId}/handover`, {
                declaredCashPaise: Math.round(declaredNum * 100),
                denominations,
                notes:             notes.trim() || undefined,
            });
            toast.success("Handed over. Signing you out — the next cashier takes the drawer.");
            await captureMyDay({ lastInputAt: getPriorInputAt() });
            await signOutTo("/staff/login");
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to hand over"));
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
                                {mode === "handover" ? "Hand over drawer" : forCashierName ? "Force close shift" : "Close shift"}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                                {mode === "handover"
                                    ? "Count the drawer and hand it to the next cashier."
                                    : forCashierName
                                    ? `Count the physical cash and close ${forCashierName}'s shift on their behalf.`
                                    : "Count the physical cash in the drawer and close to the vault."}
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
                                            </div>
                                        )}

                                        <CashDrawerPositionCard s={detail} />

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
                                                <div className="space-y-1.5">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="space-y-0.5">
                                                            <Label htmlFor="to-vault" className="text-xs font-medium text-foreground">Hand over to vault (₹)</Label>
                                                            <Input
                                                                id="to-vault"
                                                                value={toVaultInput}
                                                                onChange={(e) => editSweep(e.target.value)}
                                                                onFocus={(e) => e.target.select()}
                                                                onClick={(e) => e.currentTarget.select()}
                                                                placeholder="0"
                                                                className="h-8 font-mono font-bold bg-white dark:bg-zinc-900 border border-input focus-visible:ring-amber-500"
                                                            />
                                                        </div>
                                                        <div className="space-y-0.5">
                                                            <Label htmlFor="carry-over" className="text-xs font-medium text-foreground">Keep in counter (₹)</Label>
                                                            <Input
                                                                id="carry-over"
                                                                value={carryOver}
                                                                onChange={(e) => editKeep(e.target.value)}
                                                                onFocus={(e) => e.target.select()}
                                                                onClick={(e) => e.currentTarget.select()}
                                                                placeholder="0"
                                                                className="h-8 font-mono font-bold bg-white dark:bg-zinc-900 border border-input focus-visible:ring-amber-500"
                                                            />
                                                        </div>
                                                    </div>
                                                    <p className={`text-[10px] ${overCounted ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                                        {overCounted
                                                            ? `More than the ₹${fmt(declaredNum)} counted — reduce it.`
                                                            : `Count out either pile — the other box fills itself. Both add up to ₹${fmt(declaredNum)}.`}
                                                    </p>
                                                    <div className="border-t border-amber-200/70 dark:border-amber-800/50 pt-1 mt-0.5 flex justify-between items-center bg-amber-100/50 dark:bg-amber-950/50 -mx-1 px-2 py-0.5 rounded font-semibold">
                                                        <span className="text-amber-950 dark:text-amber-200">Contra to vault</span>
                                                        <span className="font-mono text-sm text-amber-900 dark:text-amber-100 font-bold">₹{fmt(toVault)}</span>
                                                    </div>
                                                    {dropsNum > 0 && (
                                                        <p className="text-[10px] text-muted-foreground">
                                                            ₹{fmt(handOverNow)} handed over now + ₹{fmt(dropsNum)} dropped to the safe during the day.
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                // The whole drawer passes — no float, no vault, nobody named.
                                                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                                                    <p className="font-medium flex items-center gap-1.5">
                                                        <Users size={13} className="shrink-0" /> The whole drawer goes to the next cashier
                                                    </p>
                                                    <p className="text-amber-800/90 dark:text-amber-300/90">
                                                        You will be signed out. Whoever signs in next at {detail.counter.name} sees
                                                        your count of ₹{fmt(declaredNum)} and takes the drawer over. Any short or
                                                        excess against the books posts to your shift when they accept.
                                                    </p>
                                                </div>
                                            )}

                                            {mode === "vault" && initialClosedAt !== undefined && (
                                                <div className="space-y-0.5">
                                                    <Label className="text-xs font-medium text-foreground">Closed on</Label>
                                                    <TallyDateTimeInput value={closedAt} onValueChange={setClosedAt} />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Column 3: Breakdowns ── */}
                                    <div className="space-y-2">
                                        <CashFlowCard s={detail} />
                                        <PaymentsCollectedCard s={detail} />
                                        <CollectionsCard s={detail} />
                                    </div>
                                </div>{/* ── end three-column grid ── */}
                            </div>
                        )}

                        <DialogFooter className="pt-2 border-t border-border flex items-center justify-end gap-2 flex-wrap">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                            {/* A handover prints nothing — the report prints on the close. */}
                            {mode === "vault" && (
                                <FooterToggle
                                    label="Print after save"
                                    checked={printAfterSave}
                                    onChange={updatePrintAfterSave}
                                    disabled={submitting}
                                />
                            )}
                            {mode === "vault" && printAfterSave && (
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
                                <Button onClick={submitHandover} disabled={submitting || loading} className="bg-amber-600 hover:bg-amber-700 text-white">
                                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                                    Hand over &amp; sign out
                                </Button>
                            )}
                        </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

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
