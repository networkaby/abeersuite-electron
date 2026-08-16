"use client";

// Shared POS "party bar" — the top header used by the Sale screen (PosScreen)
// and the Order / Estimate screen (PosQuoteScreen). The two were byte-identical
// apart from the header colour + the active mode, so they now live here once.
//
// Colour comes in via `headerClass` so each screen keeps its own tint (Sale =
// emerald, Order = indigo, Estimate = amber). Button labels are the pos/new
// (Sale) ones: new-customer is icon-only and the parallel-tab button reads "New".

import Link from "next/link";
import {
    ArrowLeft, X, UserPlus, ExternalLink, RotateCcw,
    MoreVertical, RefreshCw, LayoutDashboard, Monitor,
    ShoppingCart, ClipboardList, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";

// Soft pastel tints for the header action buttons — muted so they're easy on
// the eye (no saturated rainbows), with dark-mode pairs so the bar stays calm
// in both themes. Each action gets one hue so the cashier can find it by colour.
const tint = {
    emerald: "border-emerald-300/60 bg-emerald-50/40 text-emerald-800 hover:bg-emerald-100/70 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50",
    amber:   "border-amber-300/60 bg-amber-50/40 text-amber-800 hover:bg-amber-100/70 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
    indigo:  "border-indigo-300/60 bg-indigo-50/40 text-indigo-800 hover:bg-indigo-100/70 dark:border-indigo-500/40 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50",
    sky:     "border-sky-300/60 bg-sky-50/40 text-sky-800 hover:bg-sky-100/70 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-950/50",
    violet:  "border-violet-300/60 bg-violet-50/40 text-violet-800 hover:bg-violet-100/70 dark:border-violet-500/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50",
} as const;

export type PosTopBarProps = {
    /** Colour tint for the bar — each screen passes its own (emerald/indigo/amber). */
    headerClass: string;
    /** Which mode is active (shown in the mode dropdown). */
    active: "sale" | "order" | "estimate";

    // ── Party search ────────────────────────────────────────────────────────
    partySearchRef: React.Ref<PartySearchAndCreateHandle>;
    onPartyPicked: (p: PickedParty) => void;
    /** Search is locked once a customer is picked. */
    locked: boolean;
    onDialogOpenChange: (open: boolean) => void;
    /** Show the Clear button (a customer is selected) + its handler. */
    showClear: boolean;
    onClear: () => void;
    /** Open the on-the-fly new-customer dialog (partySearchRef.openNew). */
    onNewCustomer: () => void;
    /** No party selected yet — show a warning ring to draw attention. */
    missingParty?: boolean;
    /** F2 was pressed while a party was selected — we're in "change customer"
        mode: the picker is unlocked, and Esc will restore the original party. */
    changeMode?: boolean;

    // ── Action buttons ──────────────────────────────────────────────────────
    onReturn: () => void;

    // ── Shift pill (refresh / open) ────────────────────────────────────────
    activeShift: ActiveShift | null;
    shiftLoaded: boolean;
    /** Refresh the current shift; with no shift open, tapping the pill opens one. */
    onRefreshShift: () => void;
    onOpenShift: () => void;
};

export function PosTopBar({
    headerClass, active,
    partySearchRef, onPartyPicked, locked, onDialogOpenChange,
    showClear, onClear, onNewCustomer, missingParty, changeMode,
    onReturn,
    activeShift, shiftLoaded,
    onRefreshShift, onOpenShift,
}: PosTopBarProps) {
    return (
        <header className={`flex shrink-0 items-center gap-3 border-b-2 px-4 py-3 ${headerClass}`}>
            <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                <ArrowLeft size={16} />
            </Link>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className={`gap-1.5 ${active === "sale" ? tint.emerald : active === "order" ? tint.indigo : tint.amber}`}>
                        {active === "sale" && <ShoppingCart size={14} />}
                        {active === "order" && <ClipboardList size={14} />}
                        {active === "estimate" && <FileText size={14} />}
                        {active === "sale" ? "Sale" : active === "order" ? "Order" : "Estimate"}
                        <MoreVertical size={13} className="opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="text-xs">
                    <DropdownMenuLabel>Voucher type</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                        <Link href="/vouchers/pos/new" className={active === "sale" ? "font-semibold" : ""}>
                            <ShoppingCart size={12} /> Sale
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/vouchers/pos/order" className={active === "order" ? "font-semibold" : ""}>
                            <ClipboardList size={12} /> Order
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/vouchers/pos/estimate" className={active === "estimate" ? "font-semibold" : ""}>
                            <FileText size={12} /> Estimate
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <div className={`flex-1 max-w-2xl rounded-md transition-all ${
                changeMode
                    ? "ring-2 ring-blue-500/60 focus-within:ring-blue-400"
                    : missingParty
                        ? "ring-2 ring-red-500/60 focus-within:ring-red-400"
                        : "ring-2 ring-primary/20 focus-within:ring-primary/50"
            }`}>
                <PartySearchAndCreate
                    ref={partySearchRef}
                    onPicked={onPartyPicked}
                    locked={!changeMode && locked}
                    onDialogOpenChange={onDialogOpenChange}
                    placeholder={changeMode
                        ? "Type to replace current customer · Esc to cancel"
                        : "Customer name / phone · F2 to focus · ↵ to pick"
                    }
                    partyGroup="Sundry Debtors"
                />
            </div>
            {showClear && (
                <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
                    <X size={14} /> Clear
                </Button>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={onNewCustomer}
                title="Walk-in customer not in the system yet — create on the fly"
                className={tint.violet}
            >
                <UserPlus size={14} />
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/vouchers/pos/new", "_blank", "noopener")}
                title="Open a new POS tab — start another bill while this one waits"
                className={tint.emerald}
            >
                <ExternalLink size={14} /> New POS
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={onReturn}
                title="Process a sale return — by invoice number, customer, or lost invoice"
                className={tint.amber}
            >
                <RotateCcw size={14} /> Return
            </Button>
            {/* Exp + Rcv + Help now live in the right-edge PosActionRail. */}

            {/* Office + POS register — both open in a new tab so the bill in
                progress is never left behind (same pattern as "New POS"). */}
            <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/office", "_blank", "noopener")}
                title="Open the office in a new tab"
                className={tint.indigo}
            >
                <LayoutDashboard size={14} /> Office<ExternalLink size={12} className="ml-1 opacity-70" />
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/vouchers/pos", "_blank", "noopener")}
                title="POS sales register — live shift overview in a new tab"
                className={tint.sky}
            >
                <Monitor size={14} /> Register<ExternalLink size={12} className="ml-1 opacity-70" />
            </Button>

            {/* Shift status + refresh — the old ⋮ dropdown is gone: the pill is
                now a direct refresh button (the cashier's most-used action).
                Drop-to-safe / close-shift / the sales register live on the POS
                sales register page (/vouchers/pos), which keeps its own full
                shift bar. With no shift open, tapping the pill opens one. */}
            <Button
                variant="outline"
                size="sm"
                onClick={activeShift ? onRefreshShift : onOpenShift}
                title={activeShift
                    ? `Shift #${activeShift.id} — tap to refresh`
                    : "No shift — tap to open one"}
                className={activeShift ? tint.emerald : tint.amber}
            >
                <span className={`h-2 w-2 rounded-full ${!shiftLoaded ? "bg-muted-foreground/40" : activeShift ? "bg-emerald-500" : "bg-amber-500"}`} />
                {!shiftLoaded ? "Shift…" : activeShift ? `Shift #${activeShift.id}` : "No shift"}
                <RefreshCw size={13} className="opacity-70" />
            </Button>
        </header>
    );
}
