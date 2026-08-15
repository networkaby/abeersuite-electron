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
    MoreVertical, RefreshCw, Lock, ArrowRightLeft, Monitor,
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

    // ── Shift ⋮ menu ────────────────────────────────────────────────────────
    activeShift: ActiveShift | null;
    shiftLoaded: boolean;
    /** Opened-at clock label (mirrors ActiveShiftBar). */
    shiftOpenedAt: string;
    onRefreshShift: () => void;
    onDropToSafe: () => void;
    onCloseShift: () => void;
    onOpenShift: () => void;
};

export function PosTopBar({
    headerClass, active,
    partySearchRef, onPartyPicked, locked, onDialogOpenChange,
    showClear, onClear, onNewCustomer, missingParty, changeMode,
    onReturn,
    activeShift, shiftLoaded, shiftOpenedAt,
    onRefreshShift, onDropToSafe, onCloseShift, onOpenShift,
}: PosTopBarProps) {
    return (
        <header className={`flex shrink-0 items-center gap-3 border-b-2 px-4 py-3 ${headerClass}`}>
            <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                <ArrowLeft size={16} />
            </Link>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
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
            >
                <UserPlus size={14} />
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/vouchers/pos/new", "_blank", "noopener")}
                title="Open a new POS tab — start another bill while this one waits"
            >
                <ExternalLink size={14} /> New POS
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={onReturn}
                title="Process a sale return — by invoice number, customer, or lost invoice"
            >
                <RotateCcw size={14} /> Return
            </Button>
            {/* Exp + Rcv + Help now live in the right-edge PosActionRail. */}

            {/* Shift status + actions — folds the old full-width shift bar into
                the header. Also carries the nav link to the /vouchers/pos register
                where the live shift overview lives. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        title="Shift status & actions"
                        className={activeShift ? "border-emerald-300/70" : "border-amber-300/70"}
                    >
                        <span className={`h-2 w-2 rounded-full ${!shiftLoaded ? "bg-muted-foreground/40" : activeShift ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {!shiftLoaded ? "Shift…" : activeShift ? `Shift #${activeShift.id}` : "No shift"}
                        <MoreVertical size={13} className="opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                    {activeShift?.status === "OPEN" ? (
                        <>
                            <DropdownMenuLabel className="font-normal text-muted-foreground">
                                {activeShift.counter.name} · since {shiftOpenedAt}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onRefreshShift}>
                                <RefreshCw size={12} /> Refresh
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onDropToSafe}>
                                <Lock size={12} /> Drop to safe
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={onCloseShift}
                                className="text-amber-700 focus:text-amber-700 dark:text-amber-400"
                            >
                                <ArrowRightLeft size={12} /> Close shift
                            </DropdownMenuItem>
                        </>
                    ) : activeShift?.status === "AWAITING_HANDOVER" ? (
                        <DropdownMenuLabel className="font-normal text-amber-700 dark:text-amber-400">
                            Awaiting handover — see the bar above
                        </DropdownMenuLabel>
                    ) : (
                        <DropdownMenuItem onClick={onOpenShift}>
                            <Lock size={12} /> Open shift
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                        <Link href="/vouchers/pos">
                            <Monitor size={12} /> POS sales register
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
