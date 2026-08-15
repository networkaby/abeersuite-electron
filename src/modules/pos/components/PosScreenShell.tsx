"use client";

// ── PosScreenShell ────────────────────────────────────────────────────────────
// The shared render tree of the POS screens — extracted verbatim from
// PosScreen / PosQuoteScreen, which had it in duplicate. Everything here is
// mode-agnostic: shift lifecycle dialogs, the top bar, the product search +
// cart column, the bill summary, and the customer panel. Each screen supplies
// its header colour, active-tab key, checkout button (`checkoutSlot`) and its
// own dialogs (checkout / payment-link) as `children`.

import { useState } from "react";
import { toast } from "sonner";
import { Search, ShoppingCart, Plus, Minus, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ActiveShiftBar } from "@/modules/pos/components/ActiveShiftBar";
import { ShiftOpenDialog } from "@/modules/pos/components/ShiftOpenDialog";
import { HandoverAcceptDialog } from "@/modules/pos/components/HandoverAcceptDialog";
import { CashDropDialog } from "@/modules/pos/components/CashDropDialog";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";
import { PosReturnDialog } from "@/modules/pos/components/PosReturnDialog";
import { PosExpenditureDialog } from "@/modules/pos/components/PosExpenditureDialog";
import { PosReceiptDialog } from "@/modules/pos/components/PosReceiptDialog";
import { PosTopBar } from "@/modules/pos/components/PosTopBar";
import { PosActionRail } from "@/modules/pos/components/PosActionRail";
import { PosCustomerPanel } from "@/modules/pos/components/PosCustomerPanel";
import QuickTicketButton from "@/shared/components/QuickTicketButton";
import HelpQuickForm from "@/modules/help/components/HelpQuickForm";
import { TaskFormDialog } from "@/modules/administration/components";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { PosBillSummary } from "@/modules/pos/components/PosBillSummary";
import { formatInr } from "@/shared/lib/format";
import { useApiResource } from "@/shared/hooks";
import type { TaskPositionOption } from "@/modules/administration/lib/types";
import type { PosBilling } from "@/modules/pos/hooks/usePosBilling";
import type { PartySearchAndCreateHandle } from "@/shared/components/PartySearchAndCreate";

export function PosScreenShell({
    b,
    headerClass,
    active,
    partySearchRef,
    productSearchRef,
    checkoutSlot,
    children,
}: {
    /** The shared billing engine (usePosBilling) driving this screen. */
    b: PosBilling;
    /** Header tint for the mode (emerald = Sale, indigo = Order, amber = Estimate). */
    headerClass: string;
    active: "sale" | "order" | "estimate";
    /** The same refs handed to usePosBilling — owned by the screen. */
    partySearchRef: React.RefObject<PartySearchAndCreateHandle | null>;
    productSearchRef: React.RefObject<HTMLInputElement | null>;
    /** The mode's checkout / save button, rendered under the bill summary. */
    checkoutSlot: React.ReactNode;
    /** Mode-specific dialogs (checkout, payment link). */
    children?: React.ReactNode;
}) {
    // "+ Add service charge" dropdown (Sale mode) — pick a catalogue service.
    const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
    // Counter "Enquiry" — log a front-desk help ticket (reuses the office form).
    const [enquiryOpen, setEnquiryOpen] = useState(false);
    // Counter "Task" — add an internal work item (reuses the office form).
    const [taskOpen, setTaskOpen] = useState(false);
    const { data: taskPositions = [] } = useApiResource<TaskPositionOption[]>("/api/positions");
    return (
        <div className="flex h-full w-full flex-row">
            {/* Main column — everything except the far-right action rail. */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Awaiting-handover keeps the dedicated bar — its billing-disabled
                messaging is safety-critical and must stay loud. A normal OPEN
                shift no longer shows a full-width strip; its status + actions
                live in the header ⋮ menu below, and the "no shift" state is
                surfaced by the amber menu trigger. */}
                {b.activeShift?.status === "AWAITING_HANDOVER" && (
                    <ActiveShiftBar
                        shift={b.activeShift}
                        onClosed={() => { b.setActiveShift(null); b.refreshActiveShift(); }}
                        onHandoverCancelled={b.refreshActiveShift}
                    />
                )}

                {/* ShiftOpenDialog — fresh start (no handover waiting) */}
                <ShiftOpenDialog
                    open={b.shiftOpenDialogOpen}
                    onOpenChange={b.setShiftOpenDialogOpen}
                    onOpened={() => {
                        // Re-fetch via /api/pos/shifts/current so we get the full
                        // counter info including per-method payment mappings (the
                        // dialog's payload only carries id/name/tillAccount).
                        b.setShiftOpenDialogOpen(false);
                        b.refreshActiveShift();
                    }}
                />

                {/* HandoverAcceptDialog — shown when B has a pending handover */}
                {b.pendingHandover && (
                    <HandoverAcceptDialog
                        open={true}
                        handover={b.pendingHandover}
                        onAccepted={(shiftId, openingFloat) => {
                            b.setPendingHandover(null);
                            b.refreshActiveShift();
                            void shiftId;
                            void openingFloat;
                        }}
                        onDismiss={() => {
                            // User chose to log out instead.
                            window.location.href = "/api/auth/signout";
                        }}
                    />
                )}

                {/* Top bar — customer search + actions (shared PosTopBar) */}
                <PosTopBar
                    headerClass={headerClass}
                    active={active}
                    partySearchRef={partySearchRef}
                    onPartyPicked={b.onPartyPicked}
                    locked={!!b.snapshot}
                    onDialogOpenChange={b.setCreateDialogOpen}
                    showClear={!!b.snapshot}
                    onClear={b.clearCustomer}
                    onNewCustomer={() => partySearchRef.current?.openNew()}
                    onReturn={() => b.setReturnDialogOpen(true)}
                    activeShift={b.activeShift}
                    shiftLoaded={b.shiftLoaded}
                    shiftOpenedAt={b.shiftOpenedAt}
                    onRefreshShift={b.refreshActiveShift}
                    onDropToSafe={() => b.setShiftDropOpen(true)}
                    onCloseShift={() => b.setShiftCloseOpen(true)}
                    onOpenShift={() => b.setShiftOpenDialogOpen(true)}
                />

                {/* Sale Return dialog */}
                <PosReturnDialog
                    open={b.returnDialogOpen}
                    onOpenChange={b.setReturnDialogOpen}
                    onDone={() => { /* no cart refresh needed — return is a standalone action */ }}
                />

                {/* Counter expenditure dialog — needs an open shift (till to pay from) */}
                {b.activeShift && (
                    <PosExpenditureDialog
                        open={b.expenditureDialogOpen}
                        onOpenChange={b.setExpenditureDialogOpen}
                        shiftId={b.activeShift.id}
                        counterName={b.activeShift.counter.tillAccount.name}
                        onDone={b.refreshActiveShift}
                    />
                )}

                {/* Receipt dialog — collect a party payment into the counter till */}
                {b.activeShift && (
                    <PosReceiptDialog
                        open={b.receiptDialogOpen}
                        onOpenChange={b.setReceiptDialogOpen}
                        shiftId={b.activeShift.id}
                        paymentAccounts={b.activeShift.counter.paymentAccounts}
                        onDone={b.refreshActiveShift}
                    />
                )}

                {/* Shift drop / close — launched from the header ⋮ menu (OPEN shifts).
                Awaiting-handover uses ActiveShiftBar's own copies instead. */}
                {b.activeShift?.status === "OPEN" && (
                    <>
                        <CashDropDialog
                            open={b.shiftDropOpen}
                            onOpenChange={b.setShiftDropOpen}
                            shiftId={b.activeShift.id}
                            onDropped={b.refreshActiveShift}
                        />
                        <ShiftCloseDialog
                            open={b.shiftCloseOpen}
                            onOpenChange={b.setShiftCloseOpen}
                            shiftId={b.activeShift.id}
                            onClosed={() => { b.setActiveShift(null); b.refreshActiveShift(); }}
                        />
                    </>
                )}

                {/* Main grid */}
                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                    {/* Left column — product picker + cart */}
                    <main className="flex min-h-0 flex-col border-r border-border">
                        <div className="shrink-0 border-b border-border p-4">
                            <div className="flex items-center gap-3">
                                <div className="relative flex-1">
                                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                    <Input
                                        ref={productSearchRef}
                                        value={b.productQuery}
                                        onChange={(e) => { b.setProductQuery(e.target.value); b.setProductHighlight(0); }}
                                        onKeyDown={b.onProductKeyDown}
                                        placeholder="Scan / type · ↑↓ to highlight · ↵ to add"
                                        className="h-11 rounded-lg pl-11 text-base shadow-sm focus-visible:ring-2"
                                    />
                                    {b.filteredProducts.length > 0 && (
                                        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                            {b.filteredProducts.map((p, i) => (
                                                <li key={p.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => b.addToCart(p)}
                                                        onMouseEnter={() => b.setProductHighlight(i)}
                                                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === b.productHighlight ? "bg-muted" : "hover:bg-muted"}`}
                                                    >
                                                        <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                                        <span className="flex-1 px-3 truncate">{p.name}</span>
                                                        <span className="text-xs text-muted-foreground">{p.effectiveSalePricePaise ? `₹${(p.effectiveSalePricePaise / 100).toLocaleString("en-IN")}` : "—"}</span>
                                                        <Plus size={14} className="ml-2 text-muted-foreground" />
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                {/* Cart count — relocated off its own strip onto the search row to save a row */}
                                <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground">
                                    <ShoppingCart size={16} /> Cart ({b.cart.length})
                                </div>
                            </div>
                        </div>

                        {/* Cart */}
                        <div className="flex min-h-0 flex-1 flex-col">
                            <div className="flex-1 overflow-y-auto">
                                {b.cart.length === 0 ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                                        <div className="rounded-full bg-muted p-3 text-muted-foreground">
                                            <ShoppingCart size={24} className="opacity-70" />
                                        </div>
                                        <p className="text-sm font-medium text-foreground/80">Cart is empty</p>
                                        <p className="text-xs text-muted-foreground">Scan a barcode or search above to add items.</p>
                                    </div>
                                ) : (
                                    <ul className="divide-y divide-border">
                                        {/* Display order: product lines first, service lines after —
                                        render-only sort; the underlying cart array is untouched
                                        so the productId-keyed setters keep working. */}
                                        {[...b.cart.filter((l) => l.kind !== "service"), ...b.cart.filter((l) => l.kind === "service")].map((l) => {
                                            // Enter on any cart-line input → refocus the product search so the
                                            // cashier can scan the next item without reaching for the mouse.
                                            const enterToNextProduct = (e: React.KeyboardEvent) => {
                                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); productSearchRef.current?.focus(); }
                                            };
                                            const mrp = l.mrpPaise ? l.mrpPaise / 100 : null;
                                            // Printed barcode/tag price (read-only). Shown so the cashier
                                            // sees the same figure the customer's print/display shows, and
                                            // can spot products missing barcode/MRP data at a glance.
                                            const barcode = l.barcodePaise ? l.barcodePaise / 100 : null;
                                            const isService = l.kind === "service";
                                            // Line total the customer pays for this row — qty × tax-inclusive price.
                                            const unitInclusive = l.unitPrice * (1 + (l.taxRate ?? 0) / 100);
                                            const lineTotal = l.qty * unitInclusive;
                                            return (
                                                <li key={l.productId} className={`px-4 py-2.5 ${isService ? "border-l-2 border-l-sky-400 bg-sky-50/60 dark:bg-sky-950/20" : ""}`}>
                                                    {/* Wide layout: name | warranty | note | mrp | qty | price | total | trash all on one line.
                                                    Narrow (<lg) stacks name above and the rest below. */}
                                                    <div className="grid items-center gap-2 lg:grid-cols-[minmax(180px,1.4fr)_70px_minmax(160px,1fr)_130px_auto_110px_minmax(90px,auto)_auto]">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-medium">{l.name}</div>
                                                            {isService ? (
                                                                <Badge className="mt-0.5 border-transparent bg-sky-100 text-[10px] text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
                                                                    <Wrench size={9} className="mr-0.5" /> Service
                                                                </Badge>
                                                            ) : (
                                                                <div className="font-mono text-[10px] text-muted-foreground">{l.sku}</div>
                                                            )}
                                                        </div>
                                                        <div className="hidden lg:flex justify-center">
                                                            {l.warrantyLabel ? (
                                                                <Badge variant="secondary" className="text-[10px]">⛨ {l.warrantyLabel}</Badge>
                                                            ) : (
                                                                <span className="text-[10px] text-muted-foreground/60">—</span>
                                                            )}
                                                        </div>
                                                        {(() => {
                                                            // Items flagged "require note on sale" must carry a note
                                                            // (serial / colour / config) — highlight red until filled.
                                                            const noteMissing = !!l.requireSaleNote && !l.description.trim();
                                                            return (
                                                                <Input
                                                                    value={l.description}
                                                                    onChange={(e) => b.setLineDescription(l.productId, e.target.value)}
                                                                    onKeyDown={enterToNextProduct}
                                                                    placeholder={l.requireSaleNote ? "Note required — serial / colour / config…" : "Note — colour, config…"}
                                                                    aria-invalid={noteMissing}
                                                                    className={`h-8 text-sm ${noteMissing ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                                                />
                                                            );
                                                        })()}
                                                        {isService ? (
                                                            <div className="hidden lg:flex flex-col items-end text-[10px] leading-tight text-muted-foreground">
                                                                <span className="uppercase tracking-wider">{l.taxRate > 0 ? `GST ${l.taxRate}%` : "No tax"}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="hidden lg:flex flex-col items-end gap-0.5 text-[10px] leading-tight text-muted-foreground">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="uppercase tracking-wider">MRP</span>
                                                                    <span className={mrp != null && mrp !== l.unitPrice ? "line-through" : ""}>{mrp != null ? formatInr(mrp) : "—"}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="uppercase tracking-wider">Barcode</span>
                                                                    <span>{barcode != null ? formatInr(barcode) : "—"}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="flex items-center gap-1">
                                                            <Button variant="ghost" size="icon-sm" onClick={() => b.setQty(l.productId, l.qty - 1)}><Minus size={12} /></Button>
                                                            <Input
                                                                value={l.qty}
                                                                onChange={(e) => b.setQty(l.productId, Number(e.target.value) || 0)}
                                                                onKeyDown={enterToNextProduct}
                                                                className="h-8 w-12 text-center"
                                                                inputMode="decimal"
                                                            />
                                                            <Button variant="ghost" size="icon-sm" onClick={() => b.setQty(l.productId, l.qty + 1)}><Plus size={12} /></Button>
                                                        </div>
                                                        {/* Price column shows the TAX-INCLUSIVE price (matches the
                                                        price tag). Storage stays pre-tax — we back-calculate on
                                                        every edit so calcLineTotals keeps receiving an exclusive
                                                        rate. For tax-free items (taxRate=0) the two values match. */}
                                                        <PriceInput
                                                            inclusive={unitInclusive}
                                                            onCommit={(inc) => b.setPrice(l.productId, inc / (1 + (l.taxRate ?? 0) / 100))}
                                                            onKeyDown={enterToNextProduct}
                                                        />
                                                        {/* Line total — qty × inclusive price. */}
                                                        <div className="text-right text-sm font-semibold tabular-nums">{formatInr(lineTotal)}</div>
                                                        <Button variant="ghost" size="icon-sm" onClick={() => b.setQty(l.productId, 0)} title="Remove">
                                                            <Trash2 size={12} className="text-destructive" />
                                                        </Button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            {/* Add service charge — pick a service from the catalogue
                            (Settings → POS Services). Products come from the scan box
                            above; services come from here (they have no barcode). Adds a
                            GL-only service line (income ledger + GST). Sale mode only —
                            Order / Estimate don't carry service lines yet. */}
                            {active === "sale" && (
                                <div className="relative shrink-0 border-t border-border px-4 py-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setServiceMenuOpen((o) => !o)}
                                        className="h-7 gap-1 px-1.5 text-primary hover:text-primary"
                                    >
                                        <Wrench size={14} /> Add service charge
                                    </Button>
                                    {serviceMenuOpen && (
                                        <>
                                            {/* click-away backdrop */}
                                            <div className="fixed inset-0 z-10" onClick={() => setServiceMenuOpen(false)} />
                                            <ul className="absolute left-4 top-full z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                                {b.allServices.length === 0 ? (
                                                    <li className="px-3 py-2 text-xs text-muted-foreground">
                                                        No services yet — add them in Settings → POS Services.
                                                    </li>
                                                ) : (
                                                    b.allServices.map((s) => (
                                                        <li key={s.id}>
                                                            <button
                                                                type="button"
                                                                onClick={() => { b.addServiceToCart(s); setServiceMenuOpen(false); }}
                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                                                            >
                                                                <Wrench size={12} className="shrink-0 text-sky-600 dark:text-sky-400" />
                                                                <span className="flex-1 truncate">{s.name}</span>
                                                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.taxRate > 0 ? `GST ${s.taxRate}%` : "No tax"}</span>
                                                                <span className="w-14 text-right text-xs text-muted-foreground">
                                                                    {s.defaultPricePaise != null ? `₹${(s.defaultPricePaise / 100).toLocaleString("en-IN")}` : "—"}
                                                                </span>
                                                            </button>
                                                        </li>
                                                    ))
                                                )}
                                            </ul>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Totals + checkout — shared PosBillSummary. Checkout button is
                            injected per mode via checkoutSlot. */}
                            <PosBillSummary
                                subtotal={b.subtotal}
                                tax={b.tax}
                                total={b.total}
                                totalDiscount={b.totalDiscount}
                                discountPct={b.discountPct}
                                synthDiscountPct={b.synthDiscountPct}
                                discountAmount={b.discountAmount}
                                tier={b.tier}
                                snapshot={b.snapshot}
                                rates={b.rates}
                                canRedeem={b.canRedeem}
                                loyaltyBalance={b.loyaltyBalance}
                                redeemBlocked={b.redeemBlocked}
                                maxRedeemablePts={b.maxRedeemablePts}
                                redeemOn={b.redeemOn}
                                setRedeemOn={b.setRedeemOn}
                                redeemPointsStr={b.redeemPointsStr}
                                setRedeemPointsStr={b.setRedeemPointsStr}
                                effRedemptionRupees={b.effRedemptionRupees}
                                appliedCoupon={b.appliedCoupon}
                                setAppliedCoupon={b.setAppliedCoupon}
                                autoCoupon={b.autoCoupon}
                                couponRupees={b.couponRupees}
                                couponDroppedTier={b.couponDroppedTier}
                                couponBlockedLoyalty={b.couponBlockedLoyalty}
                                couponCodeStr={b.couponCodeStr}
                                setCouponCodeStr={b.setCouponCodeStr}
                                applyCoupon={b.applyCoupon}
                                couponBusy={b.couponBusy}
                                giftCard={b.giftCard}
                                setGiftCard={b.setGiftCard}
                                giftCardCodeStr={b.giftCardCodeStr}
                                setGiftCardCodeStr={b.setGiftCardCodeStr}
                                applyGiftCard={b.applyGiftCard}
                                gcBusy={b.gcBusy}
                                giftCardApplied={b.giftCardApplied}
                                payableTotal={b.payableTotal}
                                shippingAmt={b.shippingAmt}
                                shippingAmtStr={b.shippingAmtStr}
                                setShippingAmtStr={b.setShippingAmtStr}
                                shippingGstRate={b.shippingGstRate}
                                shippingTaxAmt={b.shippingTaxAmt}
                                roundOff={b.roundOff}
                                autoRoundOff={b.autoRoundOff}
                                roundOffStr={b.roundOffStr}
                                setRoundOffStr={b.setRoundOffStr}
                                roundOffManuallyEdited={b.roundOffManuallyEdited}
                                setRoundOffManuallyEdited={b.setRoundOffManuallyEdited}
                                cart={b.cart}
                                checkoutSlot={checkoutSlot}
                            />
                        </div>
                    </main>

                    {/* Right column — customer "we know you" panel (shared) */}
                    <PosCustomerPanel snapshot={b.snapshot} loading={b.loadingSnapshot} tier={b.tier} counterNo={b.activeShift?.counter.name ?? null} />
                </div>

                {/* Mode-specific dialogs (checkout / payment link) */}
                {children}
            </div>

            {/* Far-right action rail (full height) — Rcv + Exp + placeholders. */}
            <PosActionRail
                onExp={() => b.activeShift ? b.setExpenditureDialogOpen(true) : toast.error("Open a shift first to record an expenditure")}
                onRcv={() => b.activeShift ? b.setReceiptDialogOpen(true) : toast.error("Open a shift first to collect a payment")}
                onHelp={() => toast.info("POS help — coming soon")}
                onTicket={() => { useQuickTicketStore.getState().reset(); useQuickTicketStore.getState().setOpen(true); }}
                onEnquiry={() => setEnquiryOpen(true)}
                onTask={() => setTaskOpen(true)}
                canExp={b.posAccess.canExp}
                canRcv={b.posAccess.canRcv}
            />

            {/* Quick-ticket dialog (opened from the rail's Ticket button). */}
            <QuickTicketButton />

            {/* Help / enquiry ticket dialog (opened from the rail's Enquiry button).
              Quick contact-first entry; no position list at the counter — it lands
              unassigned for the office to pick up. */}
            <HelpQuickForm open={enquiryOpen} onOpenChange={setEnquiryOpen} onSaved={() => { /* counter has no list to refresh */ }} />

            {/* Task dialog (opened from the rail's Task button). */}
            <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} positions={taskPositions} task={null} onSaved={() => { /* counter has no list to refresh */ }} />
        </div>
    );
}

// Tax-inclusive price cell. Holds a local DRAFT string so the cashier can type
// freely (e.g. clear it, type "1", "15", "150.5") without the controlled value
// snapping back to `toFixed(2)` on every keystroke. It commits the parsed amount
// up on each change, but only re-syncs the formatted display from `inclusive`
// when the field is NOT focused (external change / blur) — so typing is never
// fought. Input stays type=text (digits + one dot sanitized) per the repo rule.
function PriceInput({
    inclusive,
    onCommit,
    onKeyDown,
}: {
    inclusive: number;
    onCommit: (inclusive: number) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
    const fmt = (n: number) => (n ? n.toFixed(2) : "");
    const [draft, setDraft] = useState(() => fmt(inclusive));
    const [prevInclusive, setPrevInclusive] = useState(inclusive);
    const [focused, setFocused] = useState(false);

    // Keep the display in sync with external changes (qty/price reset, new line)
    // but never while the cashier is mid-edit. Adjusting state during render (vs.
    // an effect) avoids the extra commit/cascading render and the set-state-in-effect rule.
    if (inclusive !== prevInclusive) {
        setPrevInclusive(inclusive);
        if (!focused) setDraft(fmt(inclusive));
    }

    return (
        <Input
            value={draft}
            inputMode="decimal"
            placeholder="₹ price"
            className="h-8 text-right"
            onFocus={() => { setFocused(true); }}
            onBlur={() => { setFocused(false); setDraft(fmt(inclusive)); }}
            onKeyDown={onKeyDown}
            onChange={(e) => {
                // Allow digits + a single decimal point only.
                let raw = e.target.value.replace(/[^\d.]/g, "");
                const dot = raw.indexOf(".");
                if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "");
                setDraft(raw);
                onCommit(parseFloat(raw) || 0);
            }}
        />
    );
}
