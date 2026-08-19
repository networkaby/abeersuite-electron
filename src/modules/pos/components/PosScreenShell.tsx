"use client";

// ── PosScreenShell ────────────────────────────────────────────────────────────
// The shared render tree of the POS screens — extracted verbatim from
// PosScreen / PosQuoteScreen, which had it in duplicate. Everything here is
// mode-agnostic: shift lifecycle dialogs, the top bar, the product search +
// cart column, the bill summary, and the customer panel. Each screen supplies
// its header colour, active-tab key, checkout button (`checkoutSlot`) and its
// own dialogs (checkout / payment-link) as `children`.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { openPosHelpTab, POS_HELP_URL } from "@/modules/pos/lib/posHelp";
import { useInboxUnread } from "@/shared/hooks/useNavCounts";
import { PosInboxDrawer } from "@/modules/pos/components/PosInboxDrawer";
import { ScanLine, ShoppingCart, Plus, Minus, Trash2, Wrench, Gift } from "lucide-react";
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
import { PosUpsellDrawer } from "@/modules/pos/components/PosUpsellDrawer";
import QuickTicketButton from "@/shared/components/QuickTicketButton";
import HelpQuickForm from "@/modules/help/components/HelpQuickForm";
import { DealFormDialog } from "@/modules/deals/components";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
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
    // Hoisted so narrowing survives into the JSX callbacks below. The effective
    // free grant = a manually applied free code (appliedFree) or the best
    // auto-apply free offer (autoFree) — both render as FREE rows in the item list.
    // A money-grant (rule 3: a fully-free non-independent coupon that won the
    // money slot) carries its free lines on the COUPON hit instead — rendered
    // the same way (appliedCoupon beats autoCoupon).
    const appliedFree = b.appliedFree;
    const autoFree = b.autoFree;
    const effectiveFree = appliedFree ?? autoFree;
    const effectiveMoneyGrant =
        b.appliedCoupon?.freeLines?.length ? b.appliedCoupon
        : b.autoCoupon?.freeLines?.length ? b.autoCoupon
        : null;

    // Router for the help-page fallback when the browser blocks the new tab.
    const router = useRouter();
    // "+ Add service charge" dropdown (Sale mode) — pick a catalogue service.
    const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
    // Upsell & Cross-sell drawer — opened from the customer panel's offer box;
    // slides left over the cart with live offers + add-on suggestions.
    const [upsellOpen, setUpsellOpen] = useState(false);
    // Counter "Enquiry" — log a front-desk help ticket (reuses the office form).
    const [enquiryOpen, setEnquiryOpen] = useState(false);
    // Counter "Task" — add an internal work item (reuses the office form).
    const [taskOpen, setTaskOpen] = useState(false);
    // Counter "Deal" — log a CRM sales opportunity (reuses the office form).
    const [dealOpen, setDealOpen] = useState(false);
    // Counter "Lead" — capture a new contact on the fly (reuses the office form).
    const [leadOpen, setLeadOpen] = useState(false);
    // Counter "Chat" — team inbox (groups/DMs/system), right from the register.
    const [chatOpen, setChatOpen] = useState(false);
    const { data: taskPositions = [] } = useApiResource<TaskPositionOption[]>("/api/positions");
    const { data: session } = useSession();
    const sessionUser = session?.user as { id?: string | null; name?: string | null } | undefined;
    const currentUserId = sessionUser?.id ? parseInt(sessionUser.id, 10) : undefined;
    const chatUnread = useInboxUnread();

    // Auto-focus the party picker on mount so the cashier can start typing
    // the customer name immediately.
    useEffect(() => {
        const t = setTimeout(() => partySearchRef.current?.focus(), 120);
        return () => clearTimeout(t);
    }, [partySearchRef]);

    // Keep the keyboard-selected cart line visible (ArrowUp/Down selection).
    useEffect(() => {
        if (b.cartSelectedId == null) return;
        document.querySelector("[data-pos-selected]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [b.cartSelectedId]);
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
                    missingParty={!b.snapshot}
                    changeMode={b.changingParty}
                    activeShift={b.activeShift}
                    shiftLoaded={b.shiftLoaded}
                    onRefreshShift={b.refreshActiveShift}
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
                <div className="grid min-h-0 flex-1 min-w-0 grid-cols-1 lg:grid-cols-[1fr_minmax(260px,300px)]">
                    {/* Left column — product picker + cart */}
                    <main className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
                        <div className="shrink-0 border-b border-border p-3">
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    {/* The scan bar is THE primary control — emerald-tinted so it's
                                        unmistakable even when it loses focus (after a coupon, a cart
                                        edit, etc.), matching the sale header's palette. */}
                                    <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-emerald-600 dark:text-emerald-400" />
                                    <Input
                                        ref={productSearchRef}
                                        value={b.productQuery}
                                        onChange={(e) => { b.setProductQuery(e.target.value); b.setProductHighlight(0); }}
                                        onKeyDown={b.onProductKeyDown}
                                        placeholder="Scan barcode or search · ↵ add · F2 = customer"
                                        className="h-10 rounded-md border-2 border-emerald-300/70 bg-emerald-50/40 pl-9 pr-12 text-sm shadow-sm outline-none placeholder:text-emerald-900/45 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:placeholder:text-emerald-100/40"
                                    />
                                    {/* "/" focuses the scan box from anywhere — a visible key chip so
                                        the cashier can always find the way back after a coupon, etc. */}
                                    <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-emerald-300/60 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
                                        /
                                    </kbd>
                                    {b.filteredProducts.length > 0 && (
                                        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                            {b.filteredProducts.map((p, i) => (
                                                <li key={p.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => b.addToCart(p)}
                                                        onMouseEnter={() => b.setProductHighlight(i)}
                                                        className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm ${i === b.productHighlight ? "bg-muted" : "hover:bg-muted"}`}
                                                    >
                                                        <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                                        <span className="flex-1 px-2 truncate">{p.name}</span>
                                                        <span className="text-xs text-muted-foreground">{p.effectiveSalePricePaise ? `₹${(p.effectiveSalePricePaise / 100).toLocaleString("en-IN")}` : "—"}</span>
                                                        <Plus size={14} className="ml-2 text-muted-foreground" />
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                {/* Cart count — relocated off its own strip onto the search row to save a row */}
                                <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground">
                                    <ShoppingCart size={14} /> Cart ({b.cart.length})
                                </div>
                            </div>
                        </div>

                        {/* Cart */}
                        <div className="flex min-h-0 flex-1 flex-col">
                            <div className="flex-1 overflow-y-auto">
                                {b.cart.length === 0 ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                                        <div className="rounded-full bg-emerald-100/70 p-3 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            <ShoppingCart size={24} />
                                        </div>
                                        <p className="text-sm font-medium text-foreground/80">Cart is empty</p>
                                        <p className="text-xs text-muted-foreground">Scan a barcode or search above to add items.</p>
                                    </div>
                                ) : (
                                    <ul className="divide-y divide-border">
                                        {/* Display order: product lines first, service lines after —
                                        render-only sort; the underlying cart array is untouched
                                        so the productId-keyed setters keep working. */}
                                        {b.renderCart.map((l) => {
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
                                            // Selected line — the "+"/"-" quantity keys act on it.
                                            // Click anywhere on the row to select it directly.
                                            // Highlight is a slightly stronger background tint ONLY —
                                            // no ring / border change, since every line already carries
                                            // the same tinted border treatment.
                                            const selected = l.productId === b.cartSelectedId;
                                            const rowBg = isService
                                                ? selected
                                                    ? "border-l-2 border-l-sky-400 bg-sky-100/80 dark:bg-sky-900/40"
                                                    : "border-l-2 border-l-sky-400 bg-sky-50/60 dark:bg-sky-950/20"
                                                : selected
                                                    ? "border-l-2 border-l-emerald-300/60 bg-gradient-to-r from-emerald-100/80 to-emerald-50/30 dark:from-emerald-900/40"
                                                    : "border-l-2 border-l-emerald-300/60 bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/20";
                                            return (
                                                <li
                                                    key={l.productId}
                                                    data-pos-selected={selected ? "true" : undefined}
                                                    onClick={() => b.setCartSelectedId(l.productId)}
                                                    className={`cursor-pointer px-3 py-1.5 ${rowBg}`}
                                                >
                                                    {/* Wide layout: name | warranty | note | mrp | qty | price | total | trash all on one line.
                                                    Narrow (<lg) stacks name above and the rest below. */}
                                                    <div className="grid items-center gap-1.5 lg:grid-cols-[minmax(140px,1.4fr)_60px_minmax(140px,1fr)_110px_auto_100px_minmax(80px,auto)_auto]">
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
                                                                    placeholder={l.requireSaleNote ? "Note required" : "Note…"}
                                                                    aria-invalid={noteMissing}
                                                                    className={`h-7 text-xs ${noteMissing ? "border-red-500 focus-visible:ring-red-500" : ""}`}
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
                                                                    <span className="uppercase tracking-wider text-rose-500/70">MRP</span>
                                                                    <span className={mrp != null && mrp !== l.unitPrice ? "line-through text-muted-foreground" : ""}>{mrp != null ? formatInr(mrp) : "—"}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="uppercase tracking-wider text-emerald-600/80 dark:text-emerald-400/80">Barcode</span>
                                                                    <span className="font-medium text-emerald-700 dark:text-emerald-300">{barcode != null ? formatInr(barcode) : "—"}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="flex items-center gap-0.5">
                                                            <Button variant="outline" size="icon-xs" className="border-emerald-300/50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-950/40" onClick={() => b.setQty(l.productId, l.qty - 1)}><Minus size={12} /></Button>
                                                            <Input
                                                                value={l.qty}
                                                                onChange={(e) => b.setQty(l.productId, Number(e.target.value) || 0)}
                                                                onKeyDown={enterToNextProduct}
                                                                className="h-7 w-10 text-center text-xs"
                                                                inputMode="decimal"
                                                            />
                                                            <Button variant="outline" size="icon-xs" className="border-emerald-300/50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-950/40" onClick={() => b.setQty(l.productId, l.qty + 1)}><Plus size={12} /></Button>
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
                                                        <div className="text-right text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">{formatInr(lineTotal)}</div>
                                                        <Button variant="ghost" size="icon-xs" onClick={() => b.setQty(l.productId, 0)} title="Remove">
                                                            <Trash2 size={12} className="text-destructive" />
                                                        </Button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                {/* FREE-grant items (independent FREE_ITEM / BOGO
                                coupon, rule 1 — or a money-grant that won the
                                money slot, rule 3) — rendered as rows INSIDE the
                                item list so the cashier sees the free item right
                                where the paid items are (auto-applied offers land
                                here the moment the cart qualifies). Zero price by
                                design; the server re-derives the line at checkout
                                from the coupon, so these rows are display-only. */}
                                {(() => {
                                    const rows: Array<{ key: string; freeQty: number; productName: string; label: string }> = [
                                        ...(effectiveFree?.freeLines ?? []).map((f) => ({
                                            key: `free-${f.productId}`, freeQty: f.freeQty, productName: f.productName,
                                            label: effectiveFree?.code ?? effectiveFree?.name ?? "FREE",
                                        })),
                                        ...(effectiveMoneyGrant?.freeLines ?? []).map((f) => ({
                                            key: `mg-${f.productId}`, freeQty: f.freeQty, productName: f.productName,
                                            label: effectiveMoneyGrant?.code ?? effectiveMoneyGrant?.name ?? "FREE",
                                        })),
                                    ];
                                    if (rows.length === 0 || b.cart.length === 0) return null;
                                    return (
                                        <ul className="divide-y divide-border border-t border-emerald-300/40 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-950/10">
                                            {rows.map((f) => (
                                                <li key={f.key} className="flex items-center gap-2 border-l-2 border-l-emerald-400/70 px-3 py-1.5 text-xs">
                                                    <Gift size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium">{f.freeQty} × {f.productName}</div>
                                                        <div className="font-mono text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                                                            {f.label} · ₹0.00
                                                        </div>
                                                    </div>
                                                    <Badge className="shrink-0 border-0 bg-emerald-600 text-[9px] font-bold text-white">FREE</Badge>
                                                    <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">₹0.00</span>
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                })()}
                            </div>

                            {/* Add service charge — pick a service from the catalogue
                            (Settings → POS Services). Products come from the scan box
                            above; services come from here (they have no barcode). Adds a
                            GL-only service line (income ledger + GST). Sale mode only —
                            Order / Estimate don't carry service lines yet. */}
                            {active === "sale" && (
                                <div className="relative shrink-0 border-t border-border px-3 ">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setServiceMenuOpen((o) => !o)}
                                        className="h-6 gap-1 border border-sky-300/50 bg-sky-50/50 px-1.5 text-xs text-sky-700 hover:bg-sky-100/70 dark:border-sky-500/30 dark:bg-sky-950/20 dark:text-sky-300 dark:hover:bg-sky-950/40"
                                    >
                                        <Wrench size={12} /> Add service
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
                                appliedFree={b.appliedFree}
                                autoFree={b.autoFree}
                                clearFreeCoupon={b.clearFreeCoupon}
                                applyFreeCoupon={b.applyFreeCoupon}
                                freeBusy={b.freeBusy}
                                giftCard={b.giftCard}
                                setGiftCard={b.setGiftCard}
                                giftCardCodeStr={b.giftCardCodeStr}
                                setGiftCardCodeStr={b.setGiftCardCodeStr}
                                applyGiftCard={b.applyGiftCard}
                                gcBusy={b.gcBusy}
                                giftCardApplied={b.giftCardApplied}
                                payableTotal={b.payableTotal}
                                shippingAmtStr={b.shippingAmtStr}
                                setShippingAmtStr={b.setShippingAmtStr}
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
                    <PosCustomerPanel
                        snapshot={b.snapshot}
                        loading={b.loadingSnapshot}
                        tier={b.tier}
                        counterNo={b.activeShift?.counter.name ?? null}
                        onOpenUpsell={() => setUpsellOpen(true)}
                        offersReadyCount={b.offers?.filter((o) => o.status === "ready").length ?? 0}
                    />
                </div>

                {/* Mode-specific dialogs (checkout / payment link) */}
                {children}
            </div>

            {/* Far-right action rail (full height) — Rcv + Exp + placeholders. */}
            <PosActionRail
                onExp={() => b.activeShift ? b.setExpenditureDialogOpen(true) : toast.error("Open a shift first to record an expenditure")}
                onRcv={() => b.activeShift ? b.setReceiptDialogOpen(true) : toast.error("Open a shift first to collect a payment")}
                onHelp={() => { if (!openPosHelpTab()) router.push(POS_HELP_URL); }}
                onTicket={() => { useQuickTicketStore.getState().reset(); useQuickTicketStore.getState().setOpen(true); }}
                onEnquiry={() => setEnquiryOpen(true)}
                onTask={() => setTaskOpen(true)}
                onDeal={() => setDealOpen(true)}
                onLead={() => setLeadOpen(true)}
                onChat={() => setChatOpen(true)}
                canExp={b.posAccess.canExp}
                canRcv={b.posAccess.canRcv}
                chatUnread={chatUnread}
            />

            {/* Quick-ticket dialog (opened from the rail's Ticket button). */}
            <QuickTicketButton />

            {/* Help / enquiry ticket dialog (opened from the rail's Enquiry button).
              Quick contact-first entry; no position list at the counter — it lands
              unassigned for the office to pick up. */}
            <HelpQuickForm open={enquiryOpen} onOpenChange={setEnquiryOpen} onSaved={() => { /* counter has no list to refresh */ }} />

            {/* Task dialog (opened from the rail's Task button). */}
            <TaskFormDialog open={taskOpen} onOpenChange={setTaskOpen} positions={taskPositions} task={null} onSaved={() => { /* counter has no list to refresh */ }} />

            {/* Deal dialog (opened from the rail's Deal button) — log a CRM sales
                opportunity at the counter. Same positions source as tasks. */}
            <DealFormDialog open={dealOpen} onOpenChange={setDealOpen} positions={taskPositions} deal={null} onSaved={() => { /* counter has no board to refresh */ }} />

            {/* Lead dialog (opened from the rail's Lead button) — capture a new
                contact on the fly, same quick-entry form the call log uses. */}
            <CreatePersonDialog open={leadOpen} onOpenChange={setLeadOpen} />

            {/* Upsell & Cross-sell drawer — opens left over the cart from the
            customer panel trigger. Live qualification offers + one-tap add-ons. */}
            <PosUpsellDrawer
                open={upsellOpen}
                onClose={() => setUpsellOpen(false)}
                offers={b.offers}
                appliedCoupon={b.appliedCoupon}
                autoCoupon={b.autoCoupon}
                appliedFree={b.appliedFree}
                autoFree={b.autoFree}
                applyOffer={b.applyOffer}
                applyOfferById={b.applyOfferById}
                crossSell={b.crossSell}
                addToCart={b.addToCart}
            />

            {/* Team chat drawer — opens from the rail's Chat button. */}
            <PosInboxDrawer
                open={chatOpen}
                onClose={() => setChatOpen(false)}
                currentUserId={currentUserId}
                currentUserName={sessionUser?.name ?? undefined}
            />
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
            placeholder="₹"
            className="h-7 w-16 text-right text-xs"
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
