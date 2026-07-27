"use client";

/**
 * Full-page Sale Voucher — fresh implementation at /sale that matches the
 * reference Indian-SMB layout (Vyapar / Marg style):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Sale Voucher  [CASH | CREDIT]                              [X]   │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Party search          Phone display     Invoice # SV-2026-…      │
 *   │ Narration                                Invoice Date  …         │
 *   │                                          Payment Terms  …(CRED)  │
 *   │                                          Due Date       …(CRED)  │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ # ITEM     MRP QTY FREE UNIT PRICE DISC %/₹ TAX %/₹ AMOUNT       │
 *   │ ─────────────────────────────────────────────────────────────────│
 *   │ + Add Item                                                       │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Add Description    Add Image    Add Document │  Subtotal         │
 *   │ Payment Type [Cash ▾]                        │  Discount         │
 *   │                                              │  Shipping         │
 *   │                                              │  Round Off Total  │
 *   │                                              │  Received Balance │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │            Cancel  Show Profit  Save Draft  Save & Print  Save   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Reuses calc + payload machinery from TradingVoucherFullScreenForm but
 * dropped the Dialog wrapper, picked a wider table grid, and split the
 * header into label-value rows on the right to match the reference.
 */
/* dont use number input type use text input type and validate to allow only numbers */

import { Fragment, useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { toast } from "sonner";
import {
    Trash2, Plus, StickyNote, Settings2,
    Image as ImageIcon, FileText, ScanLine, Link2,
    CopyPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useFormKeyboardNav } from "@/shared/hooks/useFormKeyboardNav";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { consumeDuplicate } from "@/modules/accountancy/lib/duplicate";
import { ParentVoucherPicker } from "@/modules/inventory/components/ParentVoucherPicker";
import { Switch } from "@/components/ui/switch";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput, round2 } from "@/shared/lib/format";
import { fmt } from "@/utils/constants";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherActionBar } from "@/modules/accountancy/components/VoucherActionBar";
import { printAfterSaveDefault, thermalDefault } from "@/shared/lib/print/voucherTemplateDefaults";
import { voucherPrintPageHref } from "@/modules/accountancy/lib/voucherUrls";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";

// Per-kind config + pure line math — extracted to lib/tradingVoucherKinds.ts.
import {
    type LineState, newLine, nextLineId, calcLine, numSigned,
    type TradingKind, PER_KIND,
} from "@/modules/accountancy/lib/tradingVoucherKinds";

// Re-export so existing importers of the page keep working.
export type { TradingKind } from "@/modules/accountancy/lib/tradingVoucherKinds";


// ── Component ──────────────────────────────────────────────────────────────

function TradingVoucherPageInner({ kind = "SALE" }: { kind?: TradingKind } = {}) {
    const copy = PER_KIND[kind];
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);
    const today = new Date().toISOString().slice(0, 10);

    // Close / Cancel / Back — go back if there's tab history, otherwise fall
    // Close / back behaviour:
    //   • Same-tab navigation (e.g. Day Book → form): router.back() returns
    //     to the caller without disturbing any other view.
    //   • New-tab open (ButtonBar uses window.open("…", "_blank")):
    //     history.length === 1, so router.back() is a silent no-op.
    //     window.close() closes the script-opened tab in Chrome/Firefox.
    //   • Manually-typed URL: window.close() silently fails — acceptable.
    const closeForm = () => {
        if (typeof window === "undefined") return;
        if (window.history.length > 1) {
            router.back();
        } else {
            window.close();
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            // Skip only when the user is editing rich text (contentEditable);
            // plain inputs and textareas SHOULD respond to Esc so the dirty
            // confirmation dialog can fire from anywhere in the form.
            if (t && t.isContentEditable) return;
            // If the unsaved-changes confirm dialog is open, let it own Esc
            // (Radix closes the dialog natively). Read React state via a ref
            // — the DOM `data-state` attribute races with the window listener
            // and can read "closed" before React's re-render, causing this
            // handler to mistakenly re-open the dialog.
            if (dialogOpenRef.current) return;
            // Also defer to any other open Radix dialog (Create Party / Create
            // Product / etc.) so their native Esc closes them, not our page.
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (isDirtyRef.current) {
                e.preventDefault();
                setCloseDialogOpen(true);
                return;
            }
            if (typeof window !== "undefined") {
                if (window.history.length > 1) router.back(); else window.close();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router]);

    // Browser-level guard for tab close / refresh / external navigations.
    // Triggers the OS-native "leave site?" prompt when the form is dirty.
    // Our in-app close paths (Cancel button, top-bar X / back arrow, Esc)
    // continue to use the friendlier Stay / Save Draft / Discard dialog.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirtyRef.current) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

    // Dirty tracking via native `input` + `change` events on the container.
    // React's onChange on a <div> isn't reliable — synthetic onChange is
    // designed for form elements, not arbitrary ancestors. A native listener
    // on the form root catches every descendant input/textarea/select edit
    // via DOM bubbling and flips the dirty flag once.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const markDirty = () => { isDirtyRef.current = true; };
        el.addEventListener("input", markDirty);
        el.addEventListener("change", markDirty);
        return () => {
            el.removeEventListener("input", markDirty);
            el.removeEventListener("change", markDirty);
        };
        // Mount-once native listener on the stable form-root ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    // Mirror of closeDialogOpen for the window-level Esc handler. The DOM
    // query for `[data-state="open"]` races with Radix's own Esc handler —
    // by the time the window handler runs (bubble phase, after Radix's
    // React-tree listener), data-state may have flipped to "closed" and the
    // handler would mistakenly re-open the dialog. Reading React state via
    // a ref is consistent: dialogOpenRef stays true until React commits the
    // setCloseDialogOpen(false) from Radix.
    const dialogOpenRef = useRef(false);
    useEffect(() => { dialogOpenRef.current = closeDialogOpen; }, [closeDialogOpen]);
    const handleClose = () => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    };

    // Edit mode: /sale?voucherId=4 → fetch the voucher, prefill the form,
    // PATCH on save. Set once on mount and locked in; subsequent param
    // changes do not retrigger the fetch (would discard user edits).
    const voucherIdParam = searchParams.get("voucherId");
    // parentId → deep-link "convert from parent" (Settle Challan → + Sale Invoice):
    // the parent picker auto-selects it on mount and copies its lines + party.
    const parentIdParam = searchParams.get("parentId");
    const editVoucherId = voucherIdParam ? Number(voucherIdParam) : null;
    const isEditing = editVoucherId != null && Number.isFinite(editVoucherId);
    const [editLoading, setEditLoading] = useState(isEditing);
    const [editingRef, setEditingRef] = useState<string | null>(null);
    // Whether the voucher being edited is already POSTED — drives the
    // "saving will reverse + re-post" warning and skips the explicit POST
    // /post step on Save (server's PATCH already re-posts atomically).
    const [editingWasPosted, setEditingWasPosted] = useState(false);
    // Loaded voucher's lifecycle fields — handed to the inline LifecycleActions
    // bar in the footer when editing a posted voucher.
    const [loadedLifecycle, setLoadedLifecycle] = useState<{ status: string; deletedAt: string | null; cancelledAt: string | null } | null>(null);

    // Inline lifecycle bar permissions — same rules as the row 3-dot menu.
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const holds = (id: string | null) => id != null && hasPermissionWithScope(permissions, id);
    const canCancel     = holds(requiredVoucherPermission(kind, "cancel"));
    const canDelete     = holds(requiredVoucherPermission(kind, "delete"));
    const canHardDelete = canDelete;
    // Posting is a separate permission — a create-but-not-post user keeps only Save
    // Draft. Matches the route's per-kind post check exactly.
    const canPost = holds(requiredVoucherPermission(kind, "post"));
    // Voucher's saved paymentAccountId — paired with cashBankAccounts via a
    // dedicated effect so the picker resolves once both have loaded.
    const [pendingPaymentAccountId, setPendingPaymentAccountId] = useState<number | null>(null);

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // After addLine() (button click or Enter on last-row Amount) this holds
    // the new row's id. React's `autoFocus` only fires on mount, which is
    // exactly when the new InvProductCombobox renders — so we just thread the
    // id into its autoFocus prop. No clear-after-focus needed.
    const [lastFocusRowId, setLastFocusRowId] = useState<number | null>(null);
    // CREDIT is the default — most sales need a party on file so the
    // outstanding can be tracked. CASH is the walk-in / counter mode.
    // Non-GL kinds (orders, GRN, challan, rejections) keep CREDIT — they don't
    // render the CASH pill, so payMode never toggles for them.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CREDIT");
    // Parent voucher linkage (GRN→PO, Challan→SO, etc.) — saved as
    // refVoucherId on the InvVoucher row. Picker only renders when
    // copy.linkParentType is set.
    const [parentLink, setParentLink] = useState<{ id: number; reference: string } | null>(null);
    // Challan-only print toggle. Persisted as InvVoucher.showPrices and read
    // back by the print job (deferred — see plan TODO).
    const [showPricesOnPrint, setShowPricesOnPrint] = useState(true);
    const [party, setParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    // Auto-focus the party picker on first mount so the user lands keyboard-
    // first on Party (Tally-style). No-op on CASH mode (component isn't
    // rendered) and on edit mode (party already populated; the picker locks).
    useEffect(() => {
        partyPickerRef.current?.focus();
         
    }, []);
    // CASH walk-in fields — free-form name + phone. Stored on the voucher as
    // partyName / partyPhone strings only; no Person / Account row is created.
    const [walkInName, setWalkInName] = useState("");
    const [walkInPhone, setWalkInPhone] = useState("");
    // Picked-party snapshot — outstanding balance + address fetched on pick.
    const [partySnapshot, setPartySnapshot] = useState<{ balance: number; address: string | null }>({ balance: 0, address: null });
    // Cash / Bank ledger picker — which Account row receives the payment.
    // null = backend falls back to the legacy name-based "Cash-in-Hand" lookup.
    // After Layer 7d this is just the default account suggested when the
    // operator clicks "+ More payment option"; actual tender rows live in
    // the `tenders` state below. Removed in Layer 7g.
    const [paymentAccount, setPaymentAccount] = useState<GlAccount | null>(null);
    const [cashBankAccounts, setCashBankAccounts] = useState<GlAccount[]>([]);
    // Remembers the last "Received In" account the operator picked on this
    // voucher kind (e.g. switched Cash → a specific Bank), so the next new
    // voucher opens with that same account instead of always resetting to
    // Cash-in-Hand. Scoped per kind — a Sale's bank pick shouldn't leak into
    // Purchase's tender default.
    const LAST_PAYMENT_KEY = `voucherPage.lastPaymentAccountId.${kind}`;

    // Multi-tender state. Each row = one Dr (sale) / one Cr (purchase) on
    // the counter side of the JE. Customer-AR portion is auto-computed as
    // (totalAmount − Σ tenders) and rendered as a read-only "Balance" row;
    // on save it's appended as a real tender pointing at the party's
    // ledger account so every JE debit is backed by an explicit row.
    type TenderRow = {
        id:        string;                                                 // stable local id
        accountId: number | null;
        account:   GlAccount | null;
        amount:    string;                                                 // freeform input
        method:    "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER" | "";
        reference: string;
    };
    const newTender = (account: GlAccount | null = null, amount = ""): TenderRow => ({
        id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        accountId: account?.id ?? null,
        account,
        amount,
        method: "",
        reference: "",
    });
    const [tenders, setTenders] = useState<TenderRow[]>([]);

    // Additional GL legs ("+ Add Account" rows below the items table).
    // Each row = one extra JE leg (e.g. Cr Packing Income, Dr Insurance
    // Expense). Amount is signed at submit time: positive value uses the
    // voucher type's body direction (Cr on sale, Dr on purchase),
    // negative flips. The signed sum (`chargesNet`) is added to the
    // voucher total via calcVoucherTotals.
    type ChargeRow = {
        id:          string;
        accountId:   number | null;
        account:     GlAccount | null;
        description: string;
        amount:      string;  // freeform, allows leading minus
    };
    const newCharge = (): ChargeRow => ({
        id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        accountId:   null,
        account:     null,
        description: "",
        amount:      "",
    });
    const [charges, setCharges] = useState<ChargeRow[]>([]);
    // All non-cash/bank ledgers operators might want to pick — Income /
    // Expense / Liability ledgers (Packing Income, Service Charges,
    // Insurance, Bank Charges, etc.). Loaded lazily on mount.
    const [chargeAccounts, setChargeAccounts] = useState<GlAccount[]>([]);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",
        // Blank by default — user fills as needed. Pre-zeroes were noisy.
        discountPct: "",
        discountAmt: "",
        creditPeriodDays: "",
        // Bill / original-invoice reference — used by PURCHASE, SALE_RETURN,
        // PURCHASE_RETURN. SALE doesn't render the field, leaves these blank.
        refNumber: "",
        refDate: "",
    });

    // Invoice number preview (race-safe ±1 at concurrent save). In edit
    // mode the voucher's own reference is shown instead — see editingRef.
    const [nextRef, setNextRef] = useState("");
    useEffect(() => {
        if (isEditing) return;
        axios.get<{ reference: string }>(`/api/inventory/vouchers/next-ref?type=${copy.nextRefType}`)
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // ── Duplicate hydration ────────────────────────────────────────────────
    // ⋮ → Duplicate on a sibling voucher stashes the source's data in
    // sessionStorage and navigates here.  We consume + clear it on mount so a
    // refresh starts blank.  Reference is allocated only when the user
    // explicitly Saves; abandoning the form leaves zero side effects.
    useEffect(() => {
        if (isEditing) return;
        const dup = consumeDuplicate(kind);
        if (!dup) return;

        // Header: date + description.  Other header fields keep their defaults.
        setHeader((h) => ({
            ...h,
            date:        dup.date,
            description: dup.narration ?? "",
        }));

        // Lines: map the source's rich line records into LineState.
        type SrcLine = {
            productId?:   number;
            quantity?:    number | string;
            rate?:        number | string;
            freeQty?:     number | string | null;
            discountPct?: number | string;
            discountAmt?: number | string;
            taxRate?:     number | string;
            taxAmount?:   number | string;
            description?: string | null;
            product?:     { id: number; sku: string; name: string; unit?: { code: string; label: string } };
        };
        const srcLines = dup.lines as SrcLine[];
        const fmtNum = (x: number | string | null | undefined): string => {
            if (x == null) return "";
            const n = typeof x === "string" ? parseFloat(x) : x;
            if (!Number.isFinite(n) || n === 0) return "";
            return String(n);
        };
        if (srcLines.length > 0) {
            setLines(srcLines
                .filter((l) => l.product != null)
                .map((l) => ({
                    id: nextLineId(),
                    product: {
                        id:       l.product!.id,
                        sku:      l.product!.sku,
                        name:     l.product!.name,
                        unitCode: l.product!.unit?.code ?? "",
                        stock:     null,
                        salePrice: null,
                        costPrice: null,
                        mrp:       null,
                    },
                    quantity:        l.quantity != null ? String(typeof l.quantity === "string" ? parseFloat(l.quantity) : l.quantity) : "1",
                    freeQty:         fmtNum(l.freeQty ?? null),
                    rate:            l.rate != null ? String(typeof l.rate === "string" ? parseFloat(l.rate) : l.rate) : "",
                    mrpRupees:       "",
                    discountPct:     fmtNum(l.discountPct),
                    discountAmt:     fmtNum(l.discountAmt),
                    taxRate:         fmtNum(l.taxRate),
                    taxAmount:       fmtNum(l.taxAmount),
                    amountInput:     "",
                    description:     l.description ?? "",
                    showDescription: !!l.description,
                })));
        }

        // Party: leave the picker empty so the user re-confirms — pre-fill the
        // walk-in name field as a hint if the source had a free-form party.
        const stashedParty = dup.party;
        if (stashedParty?.name) {
            setWalkInName(stashedParty.name);
            if (stashedParty.phone) setWalkInPhone(stashedParty.phone);
        }

        toast.success("Duplicated — review and Save to create a new voucher");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Pre-fill credit period from OrgDefaults on new vouchers (create mode only).
    useEffect(() => {
        if (isEditing || !copy.showPaymentTerms) return;
        getOrgDefaults()
            .then((d) => {
                const days = kind === "PURCHASE"
                    ? d.defaultPurchaseCreditPeriod
                    : d.defaultSaleCreditPeriod;
                if (days == null) return;
                setHeader((h) => ({ ...h, creditPeriodDays: String(days) }));
            })
            .catch(() => {/* silent — defaults are optional */});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // ── Edit mode: fetch the voucher and prefill all form state ──────────
    // Run once on mount when `?voucherId=` is set. The fetch payload is the
    // standard GET /api/inventory/vouchers/[id] response (header + lines +
    // product info). Anything we can't fully reconstruct (party-table
    // snapshot, product cost / sale prices for line rate auto-fill) is
    // stubbed with null — the user can still hand-edit any cell.
    useEffect(() => {
        if (!isEditing || editVoucherId == null) return;
        let cancelled = false;
        axios.get<{
            id: number;
            reference: string;
            date: string;
            status: string;
            type: string;
            description: string;
            partyName: string | null;
            partyType: string | null;
            partyId: number | null;
            partyPhone: string | null;
            partyAddress: string | null;
            paymentMode?: string | null;
            paymentAccountId?: number | null;
            creditPeriodDays: number | null;
            refNumber: string | null;
            refDate: string | null;
            refVoucherId: number | null;
            refVoucher?: { id: number; reference: string } | null;
            shippingAmt: string | number;
            roundOff: string | number;
            discountPct: string | number | null;
            discountAmt: string | number | null;
            amountReceived?: string | number;
            showPrices?: boolean;
            lines: {
                id: number;
                productId: number;
                description: string | null;
                quantity: string | number;
                freeQty: string | number | null;
                rate: string | number;
                discountPct: string | number;
                discountAmt: string | number;
                taxRate: string | number;
                taxAmount: string | number;
                amount: string | number;
                product: { id: number; sku: string; name: string; unit: { code: string; label: string } };
            }[];
            tenders?: {
                id: number;
                accountId: number;
                amount: string | number;
                method: string | null;
                reference: string | null;
                account: { id: number; name: string; code: string | null };
            }[];
            charges?: {
                id: number;
                accountId: number;
                amount: string | number;
                description: string | null;
                account: { id: number; name: string; code: string | null };
            }[];
        }>(`/api/inventory/vouchers/${editVoucherId}`)
            .then((r) => {
                if (cancelled) return;
                const v = r.data;
                if (v.type === "POS") {
                    // POS sales edit in the POS screen — it preserves the POS-specific
                    // loyalty / coupon / gift-card charge rows the office form would drop
                    // (which corrupted the Balance Sheet). Send the user there.
                    router.replace(`/vouchers/pos/new?voucherId=${editVoucherId}`);
                    return;
                }
                if (v.status === "CANCELLED") {
                    toast.error("This voucher is cancelled. Use Duplicate to create a fresh copy.");
                    router.push("/office/inventory/inventory-details");
                    return;
                }
                setEditingRef(v.reference);
                setEditingWasPosted(v.status === "POSTED");
                setLoadedLifecycle({ status: v.status, deletedAt: (v as { deletedAt?: string | null }).deletedAt ?? null, cancelledAt: (v as { cancelledAt?: string | null }).cancelledAt ?? null });

                // Lines → LineState mapping. Stub salePrice / costPrice as
                // null on the SelectedProduct stub; rate auto-fill only
                // triggers on fresh product selects, so this is safe.
                const fmtNum = (x: string | number | null | undefined): string => {
                    if (x == null) return "";
                    const n = typeof x === "string" ? parseFloat(x) : x;
                    if (!Number.isFinite(n) || n === 0) return "";
                    return String(n);
                };
                setLines(v.lines.length === 0 ? [newLine()] : v.lines.map((l) => ({
                    id: nextLineId(),
                    product: {
                        id: l.product.id,
                        sku: l.product.sku,
                        name: l.product.name,
                        unitCode: l.product.unit.code,
                        stock: null,
                        salePrice: null,
                        costPrice: null,
                        mrp: null,
                    },
                    quantity: String(typeof l.quantity === "string" ? parseFloat(l.quantity) : l.quantity),
                    freeQty: fmtNum(l.freeQty),
                    // DB stores the EXCLUSIVE rate. When the form displays tax-inclusive
                    // prices, re-show the inclusive value (excl x (1+tax)) so the total
                    // round-trips — save back-divides by (1+tax). Mirrors the parent-pick copy.
                    rate: String((() => {
                        const excl = typeof l.rate === "string" ? parseFloat(l.rate) : l.rate;
                        const tr = typeof l.taxRate === "string" ? parseFloat(l.taxRate) : (l.taxRate ?? 0);
                        // Round the inclusive display rate to 2dp so the client's per-line
                        // total matches the server's recompute (avoids a 1-paise tender mismatch).
                        return prefs.rateInclTax && tr > 0 ? Math.round(excl * (1 + tr / 100) * 100) / 100 : excl;
                    })()),
                    // Restore MRP from the saved line (mrpPaise → ₹).
                    mrpRupees: (l as { mrpPaise?: number | null }).mrpPaise != null
                        ? String(((l as { mrpPaise?: number | null }).mrpPaise as number) / 100)
                        : "",
                    discountPct: fmtNum(l.discountPct),
                    discountAmt: fmtNum(l.discountAmt),
                    taxRate: fmtNum(l.taxRate),
                    taxAmount: fmtNum(l.taxAmount),
                    amountInput: "",
                    description: l.description ?? "",
                    showDescription: !!l.description,
                })));

                setPayMode(v.paymentMode === "CASH" ? "CASH" : "CREDIT");
                if (v.paymentAccountId != null) setPendingPaymentAccountId(v.paymentAccountId);

                // Party prefill — for CREDIT we set the picker via its handle;
                // for CASH the walk-in fields take it. We populate both sides
                // so the form re-renders without a re-fetch.
                if (v.paymentMode === "CASH") {
                    setWalkInName(v.partyName ?? "");
                    setWalkInPhone(v.partyPhone ?? "");
                } else if (v.partyId != null && v.partyType) {
                    setParty({
                        id: v.partyId,
                        kind: (v.partyType === "customer" || v.partyType === "supplier" || v.partyType === "company")
                            ? v.partyType
                            : "customer",
                        name: v.partyName ?? "",
                        phone: v.partyPhone ?? null,
                    } as PickedParty);
                }

                const overallDiscAmt = v.discountAmt != null ? Number(v.discountAmt) : 0;
                const overallDiscPct = v.discountPct != null ? Number(v.discountPct) : 0;
                const roundOff = Number(v.roundOff ?? 0);
                setEnableRoundOff(Math.abs(roundOff) > 0.005);
                setRoundOffManuallyEdited(Math.abs(roundOff) > 0.005);
                setHeader({
                    date: v.date ? v.date.slice(0, 10) : today,
                    description: v.description ?? "",
                    shippingAmt: Number(v.shippingAmt ?? 0) > 0 ? String(Number(v.shippingAmt)) : "",
                    roundOff: Math.abs(roundOff) > 0.005 ? roundOff.toFixed(2) : "",
                    received: Number(v.amountReceived ?? 0) > 0 ? String(Number(v.amountReceived)) : "",
                    discountPct: overallDiscPct > 0 ? String(overallDiscPct) : "",
                    discountAmt: overallDiscAmt > 0 ? String(overallDiscAmt) : "",
                    creditPeriodDays: v.creditPeriodDays != null ? String(v.creditPeriodDays) : "",
                    refNumber: v.refNumber ?? "",
                    refDate: v.refDate ? v.refDate.slice(0, 10) : "",
                });
                if (v.refVoucherId && v.refVoucher) {
                    setParentLink({ id: v.refVoucherId, reference: v.refVoucher.reference });
                }
                if (typeof v.showPrices === "boolean") setShowPricesOnPrint(v.showPrices);

                // Hydrate tender rows. Each saved tender carries the
                // resolved Account (name + code) so the picker labels render
                // immediately without a second lookup. Filter out the
                // party-AR row (auto-recomputed below from the Balance);
                // operator-edited tender rows persist as typed.
                const partyAccountId = v.partyId != null && v.partyType === "customer"
                    ? null  // resolved through person→account dance; skip for now
                    : null;
                if (v.tenders && v.tenders.length > 0) {
                    setTenders(v.tenders
                        .filter((t) => partyAccountId == null || t.accountId !== partyAccountId)
                        .map((t) => ({
                            id:        `tdb${t.id}`,
                            accountId: t.accountId,
                            account:   { id: t.account.id, name: t.account.name, code: t.account.code ?? "" } as GlAccount,
                            amount:    String(Number(t.amount)),
                            method:    (t.method as TenderRow["method"]) ?? "",
                            reference: t.reference ?? "",
                        })));
                }

                // Hydrate additional-ledger rows from voucher.charges[].
                // Amount is stored signed in the DB; the form keeps it
                // signed (operator types positive or "-50" directly).
                if (v.charges && v.charges.length > 0) {
                    setCharges(v.charges.map((c) => ({
                        id:          `cdb${c.id}`,
                        accountId:   c.accountId,
                        account:     { id: c.account.id, name: c.account.name, code: c.account.code ?? "" } as GlAccount,
                        description: c.description ?? "",
                        amount:      String(Number(c.amount)),
                    })));
                }
            })
            .catch(() => {
                if (cancelled) return;
                toast.error("Failed to load voucher for editing");
                router.push("/office/inventory/inventory-details");
            })
            .finally(() => { if (!cancelled) setEditLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editVoucherId, isEditing]);

    // Load cash + bank ledgers once and pre-select "Cash-in-Hand" if present.
    // Account rows are enriched with their group so we can filter by
    // ACCOUNT_GROUPS.CASH_IN_HAND / BANK_ACCOUNTS.
    // In edit mode the default is skipped — a separate effect matches the
    // voucher's saved paymentAccountId once both fetches resolve.
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => {
                const cb = r.data.filter((a) =>
                    a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND ||
                    a.group?.name === ACCOUNT_GROUPS.BANK_ACCOUNTS,
                );
                setCashBankAccounts(cb);
                // chargeAccounts = every non-party ledger that ISN'T a
                // cash/bank til (those are tender accounts, picked above).
                // Operators see Packing Income / Discount Allowed /
                // Service Charges / Insurance etc. in the "+ Add Account"
                // picker — anything they might want to surface as a
                // separate JE leg on the voucher.
                setChargeAccounts(r.data.filter((a) =>
                    a.group?.name !== ACCOUNT_GROUPS.CASH_IN_HAND &&
                    a.group?.name !== ACCOUNT_GROUPS.BANK_ACCOUNTS,
                ));
                if (isEditing) return;
                // Prefer the account the operator last picked as "Received In"
                // on this voucher kind; fall back to Cash-in-Hand, then the
                // first available cash/bank ledger.
                let lastId: number | null = null;
                try {
                    const raw = window.localStorage.getItem(LAST_PAYMENT_KEY);
                    lastId = raw ? Number(raw) : null;
                } catch { /* ignore */ }
                const cash = (lastId != null ? cb.find((a) => a.id === lastId) : undefined)
                    ?? cb.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND)
                    ?? cb[0] ?? null;
                if (!paymentAccount) {
                    setPaymentAccount(cash);
                }
                // Seed one ready-to-fill Cash tender row so the operator
                // doesn't have to click "+ More payment option" for the
                // common single-tender path. Empty amount — the auto
                // Balance row picks up the remainder until they type.
                setTenders((rows) => rows.length === 0 ? [newTender(cash)] : rows);
            })
            .catch(() => { setCashBankAccounts([]); setChargeAccounts([]); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Edit-mode payment-account resolver: when both the loaded voucher's
    // paymentAccountId and the cash/bank list are available, pick the match.
    useEffect(() => {
        if (!isEditing) return;
        if (pendingPaymentAccountId == null) return;
        if (cashBankAccounts.length === 0) return;
        const match = cashBankAccounts.find((a) => a.id === pendingPaymentAccountId);
        if (match) setPaymentAccount(match);
    }, [isEditing, pendingPaymentAccountId, cashBankAccounts]);

    // Fetch the picked party's outstanding balance + address so we can show
    // them in the compact info card. accountId / id come straight off
    // PickedParty; we don't need to refetch the name / phone.
    useEffect(() => {
        if (!party) { setPartySnapshot({ balance: 0, address: null }); return; }
        if (party.kind !== "customer") {
            // Companies (B2B) — skip the call for now; could be wired later.
            setPartySnapshot({ balance: 0, address: null });
            return;
        }
        let cancelled = false;
        axios.get<{ address: string | null; account?: { balance: number | string | null } }>(`/api/person/${party.id}`)
            .then((r) => {
                if (cancelled) return;
                const raw = r.data.account?.balance;
                const balance = typeof raw === "string" ? parseFloat(raw) : (raw ?? 0);
                setPartySnapshot({ balance: balance || 0, address: r.data.address ?? null });
            })
            .catch(() => { if (!cancelled) setPartySnapshot({ balance: 0, address: null }); });
        return () => { cancelled = true; };
    }, [party]);

    const [showProfit, setShowProfit] = useState(false);
    // "Print after save" + "Thermal" toggles — seeded from the central per-kind
    // soft switches.
    const [printAfterSave, setPrintAfterSave] = useState(() => printAfterSaveDefault(kind));
    const [thermal, setThermal] = useState(() => thermalDefault(kind));
    const [showDescription, setShowDescription] = useState(false);
    // Round Off is optional (Vyapar pattern): unchecked → hidden + treated as 0.
    // When the checkbox is ticked, the value AUTO-computes to whatever brings
    // Total to the nearest whole rupee (Math.round(preRound) - preRound). If
    // the user types into the input directly, we flip `roundOffManuallyEdited`
    // and stop auto-recomputing so the manual override sticks.
    const [enableRoundOff, setEnableRoundOff] = useState(false);
    const [roundOffManuallyEdited, setRoundOffManuallyEdited] = useState(false);

    // ── Column / feature visibility (persisted) ───────────────────────────
    type ColumnPrefs = {
        freeQty: boolean;
        mrpHint: boolean;
        lineDiscount: boolean;
        lineTax: boolean;
        lineDescription: boolean;
        overallDiscount: boolean;
        /// true = PRICE column shows/accepts tax-inclusive rate;
        /// false (default) = exclusive. On PURCHASE the MRP column is always
        /// editable regardless of this toggle.
        rateInclTax: boolean;
    };
    const DEFAULT_PREFS: ColumnPrefs = {
        freeQty: true,
        mrpHint: true,
        lineDiscount: true,
        lineTax: true,
        lineDescription: true,
        overallDiscount: true,
        // Retail-style default: product MRP is treated as tax-inclusive.
        // Operator can flip via the column-prefs menu and the choice persists.
        rateInclTax: true,
    };
    // v3: rateInclTax flipped to true by default (2026-05-25).
    const PREFS_KEY = "saleVoucherPage.columnPrefs.v3";
    const [prefs, setPrefs] = useState<ColumnPrefs>(DEFAULT_PREFS);
    const prefsRef = useRef<ColumnPrefs>(DEFAULT_PREFS);
    useEffect(() => { prefsRef.current = prefs; });
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(PREFS_KEY);
            if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const togglePref = (k: keyof ColumnPrefs) => {
        setPrefs((p) => {
            const next = { ...p, [k]: !p[k] };
            try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
            catch { /* ignore */ }
            return next;
        });
    };

    // Toggling rateInclTax flips how the entered PRICE is interpreted: the
    // user's typed number stays as-is, but the AMOUNT column re-derives.
    // Without resyncing taxAmount, calcLine would keep the previous mode's
    // stale value and the total would drift.
    const toggleRateInclTax = () => {
        const willBeInclusive = !prefs.rateInclTax;
        setPrefs((p) => {
            const next = { ...p, rateInclTax: !p.rateInclTax };
            try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
            catch { /* ignore */ }
            return next;
        });
        setLines((ls) => ls.map((l) => {
            const rawRate = parseFloat(l.rate) || 0;
            if (rawRate === 0) return l;
            const tRate = parseFloat(l.taxRate) || 0;
            if (tRate === 0) return l; // tax-free — taxAmount stays ""
            const factor = 1 + tRate / 100;
            const exclusiveRate = willBeInclusive ? rawRate / factor : rawRate;
            const qty = parseFloat(l.quantity) || 0;
            const discAmt = parseFloat(l.discountAmt) || 0;
            const taxable = qty * exclusiveRate - discAmt;
            const newTaxAmt = taxable * (tRate / 100);
            return {
                ...l,
                taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "",
            };
        }));
    };

    // ── Line edit helpers (paired %/₹) ────────────────────────────────────
    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));
    const addLine = () => {
        const fresh = newLine();
        setLines((ls) => [...ls, fresh]);
        setLastFocusRowId(fresh.id);
    };

    // Recompute helpers — when the derived value is zero we write "" so the
    // cell stays blank (no noisy "0.00" prefills). The other recompute
    // functions delegate to this for tax.
    const withTaxFromRate = (l: LineState): LineState => {
        const rawRate = parseFloat(l.rate) || 0;
        const tRate = parseFloat(l.taxRate) || 0;
        // Derive the exclusive rate when operating in inclusive-rate mode.
        const rate = prefs.rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
        const gross = (parseFloat(l.quantity) || 0) * rate;
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const newTaxAmt = taxable * (tRate / 100);
        return { ...l, taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "" };
    };
    const setLineDiscountPct = (id: number, pct: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const p = parseFloat(pct) || 0;
        const amt = gross * (p / 100);
        return withTaxFromRate({ ...l, discountPct: pct, discountAmt: amt > 0 ? amt.toFixed(2) : "" });
    }));
    const setLineDiscountAmt = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const a = parseFloat(amt) || 0;
        const pct = gross > 0 ? (a / gross) * 100 : 0;
        return withTaxFromRate({ ...l, discountAmt: amt, discountPct: pct > 0 ? pct.toFixed(2) : "" });
    }));
    const setLineTaxRate = (id: number, rate: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        return withTaxFromRate({ ...l, taxRate: rate });
    }));
    const setLineTaxAmount = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const a = parseFloat(amt) || 0;
        const r = taxable > 0 ? (a / taxable) * 100 : 0;
        return { ...l, taxAmount: amt, taxRate: r > 0 ? r.toFixed(2) : "" };
    }));
    const setLineAmount = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const a = parseFloat(amt) || 0;
        const qty = parseFloat(l.quantity) || 1;
        const tRate = parseFloat(l.taxRate) || 0;
        // exclusive: amount = qty * rate * (1 + tax/100) → rate = amount / (qty * (1 + tax/100))
        // inclusive: amount = qty * inclusiveRate → inclusiveRate = amount / qty
        const newRate = prefs.rateInclTax && tRate > 0
            ? a / qty
            : (tRate > 0 ? a / (qty * (1 + tRate / 100)) : a / qty);
        return withTaxFromRate({ ...l, rate: newRate > 0 ? String(Number(newRate.toFixed(6))) : "", amountInput: amt });
    }));
    const setLineQtyOrRate = (id: number, patch: { quantity?: string; rate?: string }) =>
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            const rawRate = parseFloat(next.rate) || 0;
            const tRate = parseFloat(next.taxRate) || 0;
            // Use exclusive rate for discount computation regardless of display mode.
            const rate = prefs.rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
            const gross = (parseFloat(next.quantity) || 0) * rate;
            const dPct = parseFloat(next.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            return withTaxFromRate({
                ...next,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
            });
        }));

    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => {
            const updated = ls.map((l) => {
                if (l.id !== lineId_) return l;
                const fillRate = product ? copy.ratePick(product) : null;
                const nextRate = fillRate != null ? String(fillRate) : l.rate;
                // MRP: auto-fill from product master (in ₹). Preserved if product has no MRP.
                const nextMrp = product?.mrp != null && product.mrp > 0
                    ? String(product.mrp)
                    : l.mrpRupees;
                const tRate = parseFloat(l.taxRate) || 0;
                const rateInclTax = prefsRef.current.rateInclTax;
                const parsedRate = parseFloat(nextRate) || 0;
                const exclusiveRate = rateInclTax && tRate > 0 ? parsedRate / (1 + tRate / 100) : parsedRate;
                const gross = (parseFloat(l.quantity) || 0) * exclusiveRate;
                const dPct = parseFloat(l.discountPct) || 0;
                const newDiscAmt = gross * (dPct / 100);
                const taxable = gross - newDiscAmt;
                const newTaxAmt = taxable * (tRate / 100);
                return {
                    ...l, product, rate: nextRate, mrpRupees: nextMrp,
                    discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
                    taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "",
                };
            });
            // Auto-append a blank row when a product is picked on the last line,
            // so the user can keep adding items without clicking "Add Row".
            // Guard: only when a product is set (not cleared) and it's truly the last row.
            if (product && ls[ls.length - 1]?.id === lineId_) {
                return [...updated, newLine()];
            }
            return updated;
        });
        // Cascade GST prefill: resolve effective tax from product → group → org-default,
        // then snapshot onto the line's taxRate. User can override after.
        if (product) {
            axios
                .get<{ gstRate: number | null }>(`/api/inventory/products/${product.id}/resolved-tax`)
                .then(({ data }) => {
                    if (data.gstRate == null) return;
                    const resolvedRate = String(data.gstRate);
                    setLines((ls) => ls.map((l) => {
                        if (l.id !== lineId_) return l;
                        // Only apply if the user hasn't manually typed a rate already.
                        const existing = l.taxRate.trim();
                        if (existing !== "" && existing !== "0") return l;
                        const newTaxRate = resolvedRate;
                        const rateInclTax = prefsRef.current.rateInclTax;
                        const rawRate = parseFloat(l.rate) || 0;
                        const tRate = parseFloat(newTaxRate) || 0;
                        const exclusiveRate = rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
                        const gross = (parseFloat(l.quantity) || 0) * exclusiveRate;
                        const discAmt = parseFloat(l.discountAmt) || 0;
                        const taxable = gross - discAmt;
                        const newTaxAmt = taxable * (tRate / 100);
                        return { ...l, taxRate: newTaxRate, taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "" };
                    }));
                })
                .catch(() => {/* non-fatal — user can set taxRate manually */});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Totals ────────────────────────────────────────────────────────────
    const computed = lines.map((l) => calcLine(l, {
        applyDiscount: prefs.lineDiscount,
        applyTax: prefs.lineTax,
        rateInclTax: prefs.rateInclTax,
    }));
    const lineSubtotal = computed.reduce((s, c) => s + c.amount, 0);
    const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
    const totalFreeQty = lines.reduce((s, l) => s + (parseFloat(l.freeQty) || 0), 0);
    const totalDisc = computed.reduce((s, c) => s + c.discAmt, 0);
    const totalTax = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping = parseFloat(header.shippingAmt) || 0;
    const overallDiscount = prefs.overallDiscount ? (parseFloat(header.discountAmt) || 0) : 0;
    const roundOff = enableRoundOff ? (parseFloat(header.roundOff) || 0) : 0;
    // Signed sum of additional GL legs. Positive on a sale-side voucher
    // means body-direction (Cr Income → bill UP); negative means opposite
    // (Dr Expense → bill DOWN). See InvVoucherCharge in inventory.prisma.
    const chargesNet = charges.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    // Rounded to 2dp — matches the server's calcVoucherTotals so this form's
    // own "does it foot?" check (and the tenders auto-fill below) never
    // drifts a paisa from what /api/inventory/vouchers recomputes and
    // validates against.
    const grandTotal = round2(lineSubtotal - overallDiscount + shipping + roundOff + chargesNet);
    // Sum of operator-typed tender rows. `received` (legacy single field)
    // is also tallied so the form keeps working until UI fully migrates.
    const tendersSum = tenders.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const received = tendersSum > 0 ? tendersSum : (parseFloat(header.received) || 0);
    const balance = grandTotal - received;

    // Auto round-off: when the checkbox is ticked and the user hasn't typed
    // a manual override, derive header.roundOff so Total lands on a whole
    // rupee. `preRound` excludes the round-off itself to avoid feedback.
    useEffect(() => {
        if (!enableRoundOff || roundOffManuallyEdited) return;
        const preRound = lineSubtotal - overallDiscount + shipping;
        const target = Math.round(preRound);
        const auto = target - preRound;
        // Only write when the result actually changes — prevents update churn.
        const formatted = Math.abs(auto) < 0.005 ? "0" : auto.toFixed(2);
        if (formatted !== header.roundOff) {
            setHeader((h) => ({ ...h, roundOff: formatted }));
        }
    }, [enableRoundOff, roundOffManuallyEdited, lineSubtotal, overallDiscount, shipping, header.roundOff]);

    const handleDiscountPctChange = (pct: string) => {
        const p = parseFloat(pct) || 0;
        const amt = (lineSubtotal * p) / 100;
        setHeader((h) => ({ ...h, discountPct: pct, discountAmt: amt > 0 ? amt.toFixed(2) : "" }));
    };
    const handleDiscountAmtChange = (amt: string) => {
        const a = parseFloat(amt) || 0;
        const pct = lineSubtotal > 0 ? (a / lineSubtotal) * 100 : 0;
        setHeader((h) => ({ ...h, discountAmt: amt, discountPct: pct > 0 ? pct.toFixed(2) : "" }));
    };

    // Live profit — revenue must be tax-EXCLUSIVE (cost basis never includes
    // GST), so this reuses `computed[i].gross/discAmt` from calcLine above
    // instead of re-reading l.rate directly. l.rate is the *displayed* rate,
    // which under the "Price incl. tax" preference is GST-inclusive; reading
    // it raw here previously counted the GST portion as profit.
    const lineProfits = lines.map((l, i) => {
        const qty = parseFloat(l.quantity) || 0;
        const cost = l.product?.costPrice ?? 0;
        const revenue = round2(computed[i].gross - computed[i].discAmt);
        const costTotal = round2(qty * cost);
        return { id: l.id, name: l.product?.name ?? "—", qty, cost, revenue, profit: round2(revenue - costTotal) };
    });
    const totalLineProfit = round2(lineProfits.reduce((s, p) => s + p.profit, 0));
    const estimatedProfit = round2(totalLineProfit - overallDiscount);
    const margin = grandTotal > 0 ? (estimatedProfit / grandTotal) * 100 : 0;

    const reset = () => {
        setLines([newLine()]);
        setPayMode("CREDIT");
        setParty(null);
        setWalkInName("");
        setWalkInPhone("");
        setPartySnapshot({ balance: 0, address: null });
        // Re-select "Cash-in-Hand" default so the picker is ready for the next sale.
        const cash = cashBankAccounts.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND) ?? cashBankAccounts[0] ?? null;
        setPaymentAccount(cash);
        setTenders([newTender(cash)]);
        partyPickerRef.current?.clear();
        partyPickerRef.current?.focus();
        const t = new Date().toISOString().slice(0, 10);
        setHeader({
            date: t, description: "", shippingAmt: "", roundOff: "", received: "",
            discountPct: "", discountAmt: "",
            creditPeriodDays: "",
            refNumber: "", refDate: "",
        });
        setShowProfit(false);
        setShowDescription(false);
        setEnableRoundOff(false);
        setRoundOffManuallyEdited(false);
        setParentLink(null);
        setShowPricesOnPrint(true);
    };

    const submit = async (andPost = false, andPrint = false) => {
        // CREDIT mode: party is required so the receivable lands on a real ledger.
        // CASH mode: party optional — walk-in name / phone are recorded as free
        //            text on the voucher only, no Person / Account is created.
        if (payMode === "CREDIT" && !party) {
            toast.error("Pick or create a party for a credit sale");
            return;
        }
        const validLines = lines.filter((l) => l.product && parseFloat(l.quantity) > 0);
        if (!validLines.length) {
            toast.error("Add at least one item with a product and quantity");
            return;
        }
        if (copy.refLabel && !copy.refOptional) {
            if (!header.refNumber.trim()) {
                toast.error(`${copy.refLabel} is required`);
                return;
            }
            if (!header.refDate) {
                toast.error(`${copy.refDateLabel} is required`);
                return;
            }
        }
        const displayName = payMode === "CREDIT" ? party?.name : (walkInName.trim() || undefined);
        const description = header.description.trim() || copy.narrationFallback(displayName);

        setSaving(true);
        try {
            // Purchase hides the Invoice Date input; the Bill Date (refDate)
                // is the user-facing date and drives voucher.date on save.
                // Falls back to today's date if neither is set.
            const voucherDate = copy.showVoucherDate
                ? header.date
                : (header.refDate || header.date);
            const payload = {
                type: kind,
                branchId: activeBranchId ?? undefined,
                date: voucherDate,
                description,
                partyName: payMode === "CREDIT" ? (party?.name || undefined)
                    : (walkInName.trim() || undefined),
                partyPhone: payMode === "CREDIT" ? (party?.phone || undefined)
                    : (walkInPhone.trim() || undefined),
                // partyType / partyId only carried in CREDIT mode — CASH stays
                // free-text so the ledger isn't accidentally cluttered.
                partyType: payMode === "CREDIT" ? party?.kind : undefined,
                partyId: payMode === "CREDIT" ? party?.id : undefined,
                ...(copy.showPaymentTerms && payMode === "CREDIT" ? {
                    creditPeriodDays: header.creditPeriodDays ? Number(header.creditPeriodDays) : undefined,
                } : {}),
                // Bill / original-invoice ref (only rendered for kinds with refLabel
                // — Purchase, Sale Return, Purchase Return).
                ...(copy.refLabel ? {
                    refNumber: header.refNumber.trim() || undefined,
                    refDate:   header.refDate || undefined,
                } : {}),
                // Parent voucher link (GRN→PO, Challan→SO, Rejection→Sale/GRN).
                ...(parentLink ? { refVoucherId: parentLink.id } : {}),
                // Challan-only print toggle.
                ...(copy.showShowPricesToggle ? { showPrices: showPricesOnPrint } : {}),
                shippingAmt: shipping,
                roundOff,
                discountPct: prefs.overallDiscount ? (parseFloat(header.discountPct) || 0) : 0,
                discountAmt: overallDiscount,
                lines: validLines.map((l) => {
                    const rawRate = parseFloat(l.rate) || 0;
                    const tRate = prefs.lineTax ? (parseFloat(l.taxRate) || 0) : 0;
                    // DB always stores the exclusive rate. When the form is in
                    // tax-inclusive mode, back-calculate before saving.
                    const exclusiveRate = prefs.rateInclTax && tRate > 0
                        ? rawRate / (1 + tRate / 100)
                        : rawRate;
                    // MRP in paise — only sent when the user has entered a value.
                    const mrpPaiseVal = l.mrpRupees.trim()
                        ? Math.round((parseFloat(l.mrpRupees) || 0) * 100)
                        : undefined;
                    return {
                        productId: l.product!.id,
                        description: prefs.lineDescription ? (l.description.trim() || undefined) : undefined,
                        quantity: parseFloat(l.quantity) || 1,
                        freeQty: prefs.freeQty ? (parseFloat(l.freeQty) || 0) : 0,
                        rate: exclusiveRate,
                        mrpPaise: mrpPaiseVal,
                        discountPct: prefs.lineDiscount ? (parseFloat(l.discountPct) || 0) : 0,
                        discountAmt: prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0,
                        taxRate: tRate,
                    };
                }),
                // Additional GL legs (Layer 7e). The signed amount carries
                // direction — postInvVoucherToGl uses positive = body
                // direction (Cr on sale / Dr on purchase), negative = the
                // opposite side with |amount|. Empty / invalid rows are
                // filtered before send.
                ...(() => {
                    const validCharges = charges
                        .filter((c) => c.accountId != null && Math.abs(parseFloat(c.amount) || 0) > 0.005)
                        .map((c) => ({
                            accountId:   c.accountId as number,
                            amount:      parseFloat(c.amount),
                            ...(c.description.trim() ? { description: c.description.trim() } : {}),
                        }));
                    return validCharges.length > 0 ? { charges: validCharges } : {};
                })(),
                // Multi-tender payload (Layer 7d). Built from the operator-
                // typed rows plus an auto-appended Customer-AR row for any
                // unsettled balance (only when a party is picked — walk-in
                // CASH-mode vouchers must be fully tendered with explicit
                // cash/bank rows). Sum must equal totalAmount; the API
                // validates and rejects mismatches.
                ...(() => {
                    type TenderPayload = {
                        accountId: number;
                        amount:    number;
                        method?:   "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "MOBILE_PAYMENT" | "OTHER";
                        reference?: string;
                    };
                    const rows: TenderPayload[] = [];
                    for (const t of tenders) {
                        const amt = parseFloat(t.amount) || 0;
                        if (!t.accountId || amt <= 0) continue;
                        rows.push({
                            accountId: t.accountId,
                            amount:    amt,
                            ...(t.method ? { method: t.method } : {}),
                            ...(t.reference.trim() ? { reference: t.reference.trim() } : {}),
                        });
                    }
                    const partyAccountId = party?.accountId ?? null;
                    const settledSoFar = rows.reduce((s, r) => s + r.amount, 0);
                    const arRemainder = grandTotal - settledSoFar;
                    if (arRemainder > 0.005 && partyAccountId != null) {
                        // Auto-fill AR balance row — every Dr on the JE is
                        // backed by an explicit tender row.
                        rows.push({ accountId: partyAccountId, amount: arRemainder });
                    }
                    return rows.length > 0 ? { tenders: rows } : {};
                })(),
            };

            // Edit mode → PATCH the same voucher in place; create mode → POST.
            // The server's PATCH handles both DRAFT (simple update) and POSTED
            // (reverse + apply + re-post in a single transaction) so the
            // reference number is preserved across edits. Save & Print / Save
            // only need the explicit POST /post step when the voucher was a
            // DRAFT (or a fresh create) — POSTED-on-arrival edits are already
            // re-posted atomically by PATCH.
            let savedId: number;
            const skipExplicitPost = isEditing && editingWasPosted;
            if (isEditing && editVoucherId != null) {
                await axios.patch(`/api/inventory/vouchers/${editVoucherId}`, payload);
                savedId = editVoucherId;
            } else {
                const res = await axios.post<{ id: number }>("/api/inventory/vouchers", payload);
                savedId = res.data.id;
            }

            if (andPost && !skipExplicitPost) {
                await axios.post(`/api/inventory/vouchers/${savedId}/post`);
                toast.success(copy.successPostedMsg);
            } else if (andPost) {
                // PATCH already re-posted — surface the same success copy.
                toast.success(copy.successPostedMsg);
            } else {
                toast.success(copy.successDraftMsg);
            }
            if (andPrint) {
                // Thermal auto-fire (like POS) or the browser print page, per the
                // Thermal toggle. The generic /receipt/voucher route resolves the
                // correct per-kind template from the saved voucher itself.
                window.open(voucherPrintPageHref("inv", savedId, { thermal }), "_blank", "noopener");
            }

            if (isEditing) {
                // Edit done — leave the form and let the user verify the row
                // updated wherever they came from.
                router.push("/office/inventory/inventory-details");
                return;
            }

            // Reset for the next transaction instead of navigating away —
            // the cashier can punch in the next sale without leaving /sale.
            // Cancel / Close X are the explicit exits to the list page.
            reset();
            // Re-fetch the invoice-number preview so the next sale shows
            // the freshly-incremented reference (otherwise nextRef would
            // stay stale until the next page mount).
            axios.get<{ reference: string }>(`/api/inventory/vouchers/next-ref?type=${copy.nextRefType}`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => { /* keep last value */ });
            router.refresh();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    const cell = "bg-transparent border-0 outline-none text-sm text-right w-full focus:bg-accent/40 rounded px-1 tabular-nums";

    // Tally-style keyboard nav: Enter advances focus through input/select
    // tour; Ctrl+Enter / Ctrl+A trigger primary Save (full post).
    const { containerRef, onKeyDown: onFormKeyDown } = useFormKeyboardNav({
        onSave: () => { void submit(true); },
    });

    return (
        <div
            ref={containerRef}
            onKeyDown={onFormKeyDown}
            className="flex flex-col flex-1 min-h-0 bg-background"
        >
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title={copy.title}
                onClose={handleClose}
                editingRef={isEditing && editingRef ? editingRef : undefined}
                postedWarning={isEditing && editingWasPosted}
                leftExtras={<>
                    {copy.showPaymentBlock && (
                        <div className="flex rounded-md border border-border overflow-hidden text-xs font-semibold">
                            {(["CASH", "CREDIT"] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setPayMode(m)}
                                    className={`px-3 py-1 transition-colors ${payMode === m
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-card text-muted-foreground hover:bg-muted"
                                        }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(window.location.pathname, "_blank", "noopener")}
                        title={copy.closeRouteLabel}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                        <CopyPlus size={14} /> {copy.newButtonLabel}
                    </Button>
                </>}
            />

            {/* One page-wide ScrollArea wraps the form header, the item table
                and the totals footer so they scroll together — the title bar
                above and the action bar below stay pinned. Matches the
                reference Vyapar-style invoice page. */}
            <ScrollArea className="flex-1 min-h-0">

                {/* ── Form header: party (left) + invoice meta (right) ──────── */}
                <section className="border-b border-border bg-card px-6 py-4 grid grid-cols-[1fr_auto] gap-12">
                    {/* Left: party picker / walk-in inputs — depends on payMode.
                    CREDIT requires a ledgered party (Sundry Debtors); CASH
                    accepts a free-text name + phone for the printed receipt
                    without touching the Person / Account tables. */}
                    <div className="max-w-xl">
                        {payMode === "CREDIT" ? (
                            <>
                                <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                    Party <span className="text-destructive">*</span>
                                </label>
                                <div className="mt-1">
                                    <PartySearchAndCreate
                                        ref={partyPickerRef}
                                        onPicked={setParty}
                                        locked={!!party}
                                        placeholder={copy.partyPlaceholder}
                                        partyGroup={copy.party}
                                        allowIncludeOther
                                        defaultToCompany={copy.party === "Sundry Creditors"}
                                    />
                                </div>
                                {/* Picked-party compact info card — name, mobile, outstanding,
                                address. Address truncates with ellipsis to fit the area. */}
                                {party && (
                                    <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 max-w-full">
                                        <div className="font-medium truncate">{party.name}</div>
                                        <button
                                            type="button"
                                            onClick={() => { setParty(null); partyPickerRef.current?.clear(); partyPickerRef.current?.focus(); }}
                                            className="text-muted-foreground hover:text-foreground shrink-0 underline-offset-2 hover:underline"
                                            title="Clear party"
                                        >
                                            Clear &times;
                                        </button>
                                        <div className="text-muted-foreground tabular-nums truncate">
                                            {party.phone || "—"}
                                        </div>
                                        <div className={`tabular-nums font-semibold text-right shrink-0 ${partySnapshot.balance > 0 ? "text-destructive" : partySnapshot.balance < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                            {partySnapshot.balance !== 0
                                                ? `${partySnapshot.balance > 0 ? "Due" : "Credit"} ₹${fmt(Math.abs(partySnapshot.balance))}`
                                                : "No balance"}
                                        </div>
                                        {partySnapshot.address && (
                                            <div className="col-span-2 text-muted-foreground truncate" title={partySnapshot.address}>
                                                {partySnapshot.address}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        Customer name <span className="text-muted-foreground/60 normal-case">(optional)</span>
                                    </label>
                                    <Input
                                        value={walkInName}
                                        onChange={(e) => setWalkInName(e.target.value)}
                                        placeholder="Walk-in"
                                        className="h-9 mt-1"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        Mobile <span className="text-muted-foreground/60 normal-case">(optional)</span>
                                    </label>
                                    <Input
                                        value={walkInPhone}
                                        onChange={(e) => setWalkInPhone(e.target.value)}
                                        placeholder="—"
                                        inputMode="tel"
                                        className="h-9 mt-1 tabular-nums"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: invoice meta — label / value grid */}
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm min-w-[340px] items-center">
                        {copy.showVoucherRef && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">{copy.voucherRefLabel}</label>
                                {isEditing ? (
                                    <div className="border-0 outline-none focus:bg-accent/40 rounded px-2 py-1.5 text-sm font-mono tabular-nums w-44 bg-muted/50">
                                        {editingRef || (editLoading ? "Loading…" : "—")}
                                    </div>
                                ) : (
                                    <div className="font-mono text-xs tabular-nums px-2 py-1.5 rounded-md bg-muted/40 border border-border min-h-9 flex items-center">
                                        {nextRef || "Generating…"}
                                    </div>
                                )}
                            </>
                        )}

                        {copy.showVoucherDate && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">{copy.voucherDateLabel}</label>
                                <TallyDateInput
                                    value={header.date}
                                    onValueChange={(iso) => setHeader((h) => ({ ...h, date: iso }))}
                                    className="h-9 text-xs"
                                    tabIndex={-1}
                                />
                            </>
                        )}

                        {/* Bill / Original-Invoice reference — Purchase has the
                            supplier's bill number; Sale Return / Purchase Return
                            point back to the original invoice / bill being
                            returned against. SALE skips this field entirely. */}
                        {copy.refLabel && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">
                                    {copy.refLabel}{!copy.refOptional && <span className="text-destructive"> *</span>}
                                </label>
                                <Input
                                    value={header.refNumber}
                                    onChange={(e) => setHeader((h) => ({ ...h, refNumber: e.target.value }))}
                                    placeholder="—"
                                    className="h-9 text-xs"
                                />
                                <label className="text-xs text-muted-foreground text-right">
                                    {copy.refDateLabel}{!copy.refOptional && <span className="text-destructive"> *</span>}
                                </label>
                                <TallyDateInput
                                    value={header.refDate}
                                    onValueChange={(iso) => setHeader((h) => ({ ...h, refDate: iso }))}
                                    className="h-9 text-xs"
                                />
                            </>
                        )}

                        {copy.showPaymentTerms && payMode === "CREDIT" && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">Credit Period (days)</label>
                                <Input
                                    type="text"
                                    className="h-9 text-xs w-24"
                                    placeholder="e.g. 30"
                                    value={header.creditPeriodDays}
                                    onChange={(e) => setHeader((h) => ({ ...h, creditPeriodDays: e.target.value.replace(/\D/g, "") }))}
                                    tabIndex={-1}
                                />
                            </>
                        )}
                    </div>
                </section>

                {/* ── Item table ───────────────────────────────────────────── */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0 z-10 bg-muted border-b border-border text-xs text-muted-foreground">
                            <tr>
                                <th rowSpan={2} className="w-8 px-1 py-2 text-center font-medium align-bottom">
                                    <ScanLine size={13} className="text-muted-foreground/60 mx-auto" />
                                </th>
                                <th rowSpan={2} className="px-2 py-2 text-left font-medium min-w-[180px] align-bottom">ITEM</th>
                                {prefs.lineDescription && (
                                    <th rowSpan={2} className="px-1 py-2 text-left font-medium w-52 align-bottom">
                                        <span className="hidden sm:inline">Note</span>
                                    </th>
                                )}
                                {prefs.mrpHint && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-16 align-bottom">MRP</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom">QTY</th>
                                {prefs.freeQty && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom" title="Free / complimentary quantity">FREE</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-center font-medium w-10 text-muted-foreground/60 align-bottom">UNIT</th>
                                <th rowSpan={2} className="px-2 py-2 text-right font-medium w-20 align-bottom">
                                    {/* Toggle: price column treats entered rate as excl. or incl. tax */}
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        title={prefs.rateInclTax ? "Prices are entered inclusive of tax — click to switch to exclusive" : "Prices are entered exclusive of tax — click to switch to inclusive"}
                                        onClick={() => toggleRateInclTax()}
                                        className={`text-[10px] leading-tight font-semibold uppercase tracking-wide px-1 py-0.5 rounded transition-colors ${prefs.rateInclTax ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "hover:bg-muted text-muted-foreground"}`}
                                    >
                                        PRICE<br />{prefs.rateInclTax ? "(incl)" : "(excl)"}
                                    </button>
                                </th>
                                {prefs.lineDiscount && (
                                    <th colSpan={2} className="px-1 pt-2 pb-0 text-center font-medium border-l border-border/40">DISCOUNT</th>
                                )}
                                {prefs.lineTax && (
                                    <th colSpan={2} className="px-1 pt-2 pb-0 text-center font-medium border-l border-border/40">TAX</th>
                                )}
                                <th rowSpan={2} className="px-2 py-2 text-right font-medium w-24 align-bottom border-l border-border/40">AMOUNT</th>
                                <th rowSpan={2} className="w-10 px-1 py-2 text-right align-bottom">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon-xs" tabIndex={-1} className="text-muted-foreground hover:text-foreground" title="Column settings">
                                                <Settings2 size={13} />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56">
                                            <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.freeQty} onCheckedChange={() => togglePref("freeQty")}>Free Qty</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineDiscount} onCheckedChange={() => togglePref("lineDiscount")}>Discount</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineTax} onCheckedChange={() => togglePref("lineTax")}>Tax</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Per-line extras</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.mrpHint} onCheckedChange={() => togglePref("mrpHint")}>MRP column</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineDescription} onCheckedChange={() => togglePref("lineDescription")}>Description (note)</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Price entry</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.rateInclTax} onCheckedChange={() => toggleRateInclTax()}>Price includes tax (GST-inclusive)</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Footer fields</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.overallDiscount} onCheckedChange={() => togglePref("overallDiscount")}>Overall Discount</DropdownMenuCheckboxItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </th>
                            </tr>
                            {(prefs.lineDiscount || prefs.lineTax) && (
                                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                    {prefs.lineDiscount && (
                                        <>
                                            <th className="px-1 pb-1 text-right font-medium w-12 border-l border-border/40">%</th>
                                            <th className="px-1 pb-1 text-right font-medium w-16">AMT</th>
                                        </>
                                    )}
                                    {prefs.lineTax && (
                                        <>
                                            <th className="px-1 pb-1 text-right font-medium w-12 border-l border-border/40">%</th>
                                            <th className="px-1 pb-1 text-right font-medium w-16">AMT</th>
                                        </>
                                    )}
                                </tr>
                            )}
                        </thead>
                        <tbody>
                            {lines.map((line, i) => {
                                const c = computed[i];
                                const mrp = line.product?.mrp;
                                return (
                                    <Fragment key={line.id}>
                                        <tr className="border-b border-border/50 hover:bg-muted/20 group">
                                            <td className="px-1 py-1 text-muted-foreground text-xs">
                                                {/* Row number + delete button on the LEFT — Vyapar layout.
                                                    Delete only shows on group-hover so the column stays narrow
                                                    when not in use; click is always available though. */}
                                                <div className="flex items-center justify-center gap-0.5">
                                                    <span className="tabular-nums w-4 text-center">{i + 1}</span>
                                                    {lines.length > 1 ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            className="text-destructive/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4"
                                                            onClick={() => removeLine(line.id)}
                                                            title="Delete row"
                                                        >
                                                            <Trash2 size={10} />
                                                        </Button>
                                                    ) : (
                                                        <span className="w-4" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-1">
                                                <InvProductCombobox
                                                    value={line.product?.id ?? null}
                                                    onChange={(p) => handleProductSelect(line.id, p)}
                                                    autoFocus={(i === 0 && !line.product) || line.id === lastFocusRowId}
                                                />
                                            </td>
                                            {prefs.lineDescription && (
                                                <td className="px-1 py-1">
                                                    {/* Desktop: note sits open next to the item, out of tab order
                                                        so rapid Item→Qty→Price entry doesn't stop here. */}
                                                    <Input
                                                        value={line.description}
                                                        onChange={(e) => updateLine(line.id, { description: e.target.value })}
                                                        placeholder="Note"
                                                        tabIndex={-1}
                                                        className="hidden sm:block h-7 text-xs"
                                                    />
                                                    {/* Small screen: unchanged toggle behaviour, just moved up front. */}
                                                    <Button
                                                        variant="ghost" size="icon-xs"
                                                        className={`sm:hidden ${line.showDescription ? "text-primary" : "text-muted-foreground/60 hover:text-foreground"}`}
                                                        onClick={() => updateLine(line.id, { showDescription: !line.showDescription })}
                                                        title="Toggle note"
                                                    >
                                                        <StickyNote size={12} />
                                                    </Button>
                                                </td>
                                            )}
                                            {prefs.mrpHint && (
                                                <td className="px-1 py-1 text-right text-xs tabular-nums">
                                                    {/* PURCHASE: editable MRP so the product master stays current.
                                                        Other kinds: read-only hint from the product lookup. */}
                                                    {kind === "PURCHASE" ? (
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.mrpRupees}
                                                            onChange={(e) => updateLine(line.id, { mrpRupees: parseDecimalInput(e.target.value) })}
                                                            placeholder="—"
                                                            className={cell}
                                                            tabIndex={-1}
                                                        />
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            {line.mrpRupees || (mrp != null && mrp > 0 ? fmt(mrp) : "")}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="px-1 py-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.quantity}
                                                    onChange={(e) => setLineQtyOrRate(line.id, { quantity: parseDecimalInput(e.target.value) })}
                                                    className={cell}
                                                />
                                            </td>
                                            {prefs.freeQty && (
                                                <td className="px-1 py-1">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={line.freeQty}
                                                        onChange={(e) => updateLine(line.id, { freeQty: parseDecimalInput(e.target.value) })}
                                                        className={cell}
                                                        tabIndex={-1}
                                                    />
                                                </td>
                                            )}
                                            <td className="px-1 py-1 text-center text-xs text-muted-foreground">
                                                {line.product?.unitCode ?? "—"}
                                            </td>
                                            <td className="px-2 py-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.rate}
                                                    onChange={(e) => setLineQtyOrRate(line.id, { rate: parseDecimalInput(e.target.value) })}
                                                    className={cell}
                                                />
                                            </td>
                                            {prefs.lineDiscount && (
                                                <>
                                                    <td className="px-1 py-1 border-l border-border/40">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.discountPct}
                                                            onChange={(e) => setLineDiscountPct(line.id, parseDecimalInput(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.discountAmt}
                                                            onChange={(e) => setLineDiscountAmt(line.id, parseDecimalInput(e.target.value))}
                                                            className={cell}
                                                            tabIndex={-1}
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            {prefs.lineTax && (
                                                <>
                                                    <td className="px-1 py-1 border-l border-border/40">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.taxRate}
                                                            onChange={(e) => setLineTaxRate(line.id, parseDecimalInput(e.target.value))}
                                                            className={cell}
                                                            tabIndex={line.taxRate ? -1 : 0}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.taxAmount}
                                                            onChange={(e) => setLineTaxAmount(line.id, parseDecimalInput(e.target.value))}
                                                            className={cell}
                                                            tabIndex={-1}
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-2 py-1 border-l border-border/40">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.amountInput !== "" ? line.amountInput : (c.amount > 0 ? c.amount.toFixed(2) : "")}
                                                    onFocus={(e) => {
                                                        updateLine(line.id, { amountInput: c.amount > 0 ? c.amount.toFixed(2) : "" });
                                                        e.target.select();
                                                    }}
                                                    onChange={(e) => setLineAmount(line.id, parseDecimalInput(e.target.value))}
                                                    onBlur={() => updateLine(line.id, { amountInput: "" })}
                                                    onKeyDown={(e) => {
                                                        // Tally-style rapid entry: Enter on the LAST row's Amount
                                                        // spawns a new line and focuses its Item picker. stopPropagation
                                                        // keeps the form-level Enter→next-focusable from also advancing
                                                        // into the footer (Discount/Shipping/Received) before the new
                                                        // row mounts.
                                                        if (e.key === "Enter" && i === lines.length - 1) {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            addLine();
                                                        }
                                                    }}
                                                    className={`${cell} text-right font-mono font-medium`}
                                                />
                                            </td>
                                            <td className="px-1 py-1 text-center" />
                                        </tr>
                                        {prefs.lineDescription && line.showDescription && (
                                            <tr className="border-b border-border/50 bg-muted/10 sm:hidden">
                                                <td />
                                                <td colSpan={15} className="px-3 py-1.5">
                                                    <Input
                                                        value={line.description}
                                                        onChange={(e) => updateLine(line.id, { description: e.target.value })}
                                                        placeholder="Note / description for this line (printed on invoice)"
                                                        className="h-7 text-xs"
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            <tr>
                                <td colSpan={15} className="px-5 py-2 border-b border-border/50">
                                    <Button variant="ghost" size="sm" className="text-primary h-auto py-1 text-xs" onClick={addLine}>
                                        <Plus size={12} className="mr-1" /> Add Row
                                    </Button>
                                </td>
                            </tr>
                            {/* Column totals — read-only summary row matching the reference */}
                            <tr className="bg-muted/40 text-xs font-semibold tabular-nums">
                                <td />
                                <td className="px-2 py-1.5 text-muted-foreground uppercase">Total</td>
                                {prefs.lineDescription && <td />}
                                {prefs.mrpHint && <td />}
                                <td className="px-1 py-1.5 text-right">{totalQty || ""}</td>
                                {prefs.freeQty && <td className="px-1 py-1.5 text-right">{totalFreeQty || ""}</td>}
                                <td />
                                <td />
                                {prefs.lineDiscount && (
                                    <>
                                        <td />
                                        <td className="px-1 py-1.5 text-right font-mono">{totalDisc > 0 ? fmt(totalDisc) : ""}</td>
                                    </>
                                )}
                                {prefs.lineTax && (
                                    <>
                                        <td />
                                        <td className="px-1 py-1.5 text-right font-mono">{totalTax > 0 ? fmt(totalTax) : ""}</td>
                                    </>
                                )}
                                <td className="px-2 py-1.5 text-right font-mono border-l border-border/40">{lineSubtotal > 0 ? fmt(lineSubtotal) : ""}</td>
                                <td />
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* ── Footer: actions + totals ─────────────────────────────── */}
                <div className="relative border-t border-border bg-card">
                    {showProfit && (
                        <div className="absolute inset-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-6 py-3 overflow-auto">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold">Estimated Profit (live)</h3>
                                <button type="button" onClick={() => setShowProfit(false)} className="text-xs text-muted-foreground hover:text-foreground">
                                    Close &times;
                                </button>
                            </div>
                            <table className="w-full text-xs">
                                <thead className="text-muted-foreground border-b border-border">
                                    <tr>
                                        <th className="text-left py-1 font-medium">Item</th>
                                        <th className="text-right py-1 font-medium">Qty</th>
                                        <th className="text-right py-1 font-medium">Cost ₹</th>
                                        <th className="text-right py-1 font-medium">Sale (net) ₹</th>
                                        <th className="text-right py-1 font-medium">Profit ₹</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono tabular-nums">
                                    {lineProfits.map((lp) => (
                                        <tr key={lp.id} className="border-b border-border/50">
                                            <td className="py-1 font-sans">{lp.name}</td>
                                            <td className="text-right py-1">{lp.qty}</td>
                                            <td className="text-right py-1">{fmt(lp.cost * lp.qty)}</td>
                                            <td className="text-right py-1">{fmt(lp.revenue)}</td>
                                            <td className={`text-right py-1 font-semibold ${lp.profit < 0 ? "text-destructive" : ""}`}>
                                                {fmt(lp.profit)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t border-border">
                                        <td colSpan={4} className="py-1 text-right text-muted-foreground">Σ Line Profit</td>
                                        <td className="py-1 text-right font-mono font-semibold">{fmt(totalLineProfit)}</td>
                                    </tr>
                                    {overallDiscount > 0 && (
                                        <tr>
                                            <td colSpan={4} className="py-1 text-right text-muted-foreground">Less: Overall Discount</td>
                                            <td className="py-1 text-right font-mono">−{fmt(overallDiscount)}</td>
                                        </tr>
                                    )}
                                    <tr className="border-t border-border">
                                        <td colSpan={4} className="py-1.5 text-right text-sm font-semibold">Estimated Profit</td>
                                        <td className={`py-1.5 text-right font-mono font-bold text-sm ${estimatedProfit < 0 ? "text-destructive" : "text-green-600"}`}>
                                            ₹ {fmt(estimatedProfit)}
                                            <span className="ml-2 text-[10px] text-muted-foreground">({margin.toFixed(1)}%)</span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {/* ── Additional ledger rows ("+ Add Account") ─────────────
                        SALE / PURCHASE only. Each row is one extra JE leg —
                        positive amount = body direction (Cr on sale / Dr on
                        purchase, e.g. Packing Income); negative amount =
                        opposite direction (e.g. -50 on Discount Allowed =
                        Dr Discount Allowed 50, reducing the bill). The
                        signed sum flows into Total via chargesNet. */}
                    {copy.showPaymentBlock && (
                        <div className="px-6 py-3 border-t border-border space-y-1.5">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Additional charges / income</p>
                            {charges.map((c, idx) => (
                                <div key={c.id} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-center">
                                    <GlAccountCombobox
                                        value={c.accountId}
                                        onChange={(acc) => setCharges((rows) => rows.map((r, i) => i === idx ? { ...r, account: acc, accountId: acc?.id ?? null } : r))}
                                        accounts={chargeAccounts}
                                        placeholder="Ledger (e.g. Packing Income)"
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        type="text"
                                        value={c.description}
                                        onChange={(e) => setCharges((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                                        placeholder="Description (optional)"
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={c.amount}
                                        onChange={(e) => setCharges((rows) => rows.map((r, i) => i === idx ? { ...r, amount: numSigned(e.target.value) } : r))}
                                        className="h-8 w-28 text-xs text-right"
                                        placeholder="0 (− for opposite)"
                                        title="Positive = body direction (Cr on sale / Dr on purchase). Negative = opposite side."
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setCharges((rows) => rows.filter((_, i) => i !== idx))}
                                        aria-label="Remove charge row"
                                        className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => setCharges((rows) => [...rows, newCharge()])}
                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                                + Add Account
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-[1fr_1fr] gap-8 px-6 py-4">
                        {/* Left: voucher-level actions */}
                        <div className="space-y-3 max-w-md">
                            {/* Parent voucher link — GRN→PO, Challan→SO, etc.
                                On pick, the lines auto-copy into the form (user
                                can edit qty for partial fulfilment). */}
                            {copy.linkParentType && (
                                <ParentVoucherPicker
                                    parentType={copy.linkParentType}
                                    pickedRef={parentLink?.reference ?? null}
                                    onClear={() => setParentLink(null)}
                                    label={copy.linkParentLabel ?? "Link to parent"}
                                    autoPickId={!voucherIdParam && parentIdParam ? Number(parentIdParam) : undefined}
                                    onPick={(parent) => {
                                        setParentLink({ id: parent.id, reference: parent.reference });
                                        // Carry over the parent's party so the user doesn't re-pick.
                                        if (parent.partyId != null && parent.partyType) {
                                            setParty({
                                                id: parent.partyId,
                                                kind: (parent.partyType === "customer" || parent.partyType === "supplier" || parent.partyType === "company")
                                                    ? parent.partyType
                                                    : (copy.party === "Sundry Debtors" ? "customer" : "supplier"),
                                                name: parent.partyName ?? "",
                                                phone: parent.partyPhone ?? null,
                                                accountId: parent.accountId ?? null,
                                            } as PickedParty);
                                        }
                                        // Save the parent's reference + date for downstream printing /
                                        // tracking — the form already reuses these for supplier-bill.
                                        setHeader((h) => ({
                                            ...h,
                                            refNumber: parent.reference,
                                            refDate:   parent.date ? parent.date.slice(0, 10) : h.refDate,
                                        }));
                                        // Verbatim line copy — user can edit qty for partial fulfilment.
                                        setLines(parent.lines.length === 0 ? [newLine()] : parent.lines.map((l) => ({
                                            id: nextLineId(),
                                            product: {
                                                id: l.product.id,
                                                sku: l.product.sku,
                                                name: l.product.name,
                                                unitCode: l.product.unit.code,
                                                stock: null,
                                                salePrice: null,
                                                costPrice: null,
                                                mrp: null,
                                            },
                                            quantity:    String(Number(l.quantity) || 0),
                                            freeQty:     l.freeQty != null && Number(l.freeQty) > 0 ? String(Number(l.freeQty)) : "",
                                            // Stored rate is EXCLUSIVE → show inclusive when the form is in
                                            // tax-inclusive mode, so the derived voucher's total matches the source.
                                            rate:        String((() => {
                                                const excl = Number(l.rate) || 0;
                                                const tr = Number(l.taxRate) || 0;
                                                // Round to 2dp so client + server totals agree (no 1-paise tender mismatch).
                                                return prefs.rateInclTax && tr > 0 ? Math.round(excl * (1 + tr / 100) * 100) / 100 : excl;
                                            })()),
                                            mrpRupees:   "",
                                            discountPct: Number(l.discountPct) > 0 ? String(Number(l.discountPct)) : "",
                                            discountAmt: Number(l.discountAmt) > 0 ? String(Number(l.discountAmt)) : "",
                                            taxRate:     Number(l.taxRate)     > 0 ? String(Number(l.taxRate))     : "",
                                            taxAmount:   Number(l.taxAmount)   > 0 ? String(Number(l.taxAmount))   : "",
                                            amountInput: "",
                                            description: l.description ?? "",
                                            showDescription: !!l.description,
                                        })));
                                    }}
                                />
                            )}

                            {/* Challan-only: persist printable price visibility on the voucher. */}
                            {copy.showShowPricesToggle && (
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                                    <div>
                                        <p className="font-medium text-foreground">Show prices on printed challan</p>
                                        <p className="text-muted-foreground">Off → print shows quantities only. Useful for confidential B2B delivery.</p>
                                    </div>
                                    <Switch
                                        checked={showPricesOnPrint}
                                        onCheckedChange={(v) => setShowPricesOnPrint(v)}
                                    />
                                </div>
                            )}

                            <div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowDescription((s) => !s)}
                                    className="gap-1.5"
                                >
                                    <StickyNote size={13} />
                                    {showDescription ? "Hide" : "Add"} Description
                                </Button>
                                {showDescription && (
                                    <Input
                                        value={header.description}
                                        onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))}
                                        placeholder={party ? `Narration (default: ${copy.narrationFallback(party.name)})` : "Narration (optional — invoice no auto-generated)"}
                                        className="mt-2 h-9"
                                    />
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    title="Attachments coming soon"
                                    className="gap-1.5 text-muted-foreground"
                                >
                                    <ImageIcon size={13} /> Add Image
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    title="Attachments coming soon"
                                    className="gap-1.5 text-muted-foreground"
                                >
                                    <FileText size={13} /> Add Document
                                </Button>
                            </div>
                        </div>

                        {/* Right: totals + payment */}
                        <div className="space-y-2 max-w-md ml-auto w-full">
                            {/* Subtotal — sum of line amounts before voucher-level adjustments. */}
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                <span className="text-muted-foreground text-right">Subtotal</span>
                                <span className="w-20" />
                                <span className="w-28 text-right font-mono tabular-nums text-sm">{fmt(lineSubtotal)}</span>
                            </div>
                            {prefs.overallDiscount && (
                                <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                    <span className="text-muted-foreground text-right">Discount</span>
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.discountPct}
                                        onChange={(e) => handleDiscountPctChange(parseDecimalInput(e.target.value))}
                                        className="h-8 w-20 text-xs text-right"
                                        placeholder="%"
                                    />
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.discountAmt}
                                        onChange={(e) => handleDiscountAmtChange(parseDecimalInput(e.target.value))}
                                        className="h-8 w-28 text-xs text-right"
                                        placeholder="₹"
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                <span className="text-muted-foreground text-right">Shipping</span>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={header.shippingAmt}
                                    onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: parseDecimalInput(e.target.value) }))}
                                    className="h-8 w-20 text-xs text-right"
                                    placeholder="0"
                                />
                                <span className="w-28 text-right font-mono tabular-nums text-sm">{fmt(shipping)}</span>
                            </div>
                            {/* Total + inline Round Off — Vyapar-style merged row.
                                Checkbox + ₹ input sit to the LEFT of the bold Total
                                label, saving one row of vertical space vs a separate
                                Round Off line. The auto-compute / manual-override
                                logic is unchanged — only the layout was flattened. */}
                            <div className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center text-base font-bold border-t border-border pt-2">
                                <label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer">
                                    <Checkbox
                                        checked={enableRoundOff}
                                        onCheckedChange={(v) => {
                                            const next = v === true;
                                            setEnableRoundOff(next);
                                            // Re-arm auto-compute on toggle: untick clears the value,
                                            // re-tick re-derives from the current pre-round total.
                                            setRoundOffManuallyEdited(false);
                                            if (!next) setHeader((h) => ({ ...h, roundOff: "" }));
                                        }}
                                    />
                                    Round Off
                                </label>
                                {enableRoundOff ? (
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.roundOff}
                                        onChange={(e) => {
                                            // Once the user types here, stop auto-recomputing.
                                            setRoundOffManuallyEdited(true);
                                            setHeader((h) => ({ ...h, roundOff: numSigned(e.target.value) }));
                                        }}
                                        className="h-7 w-20 text-xs text-right font-normal"
                                        placeholder="0"
                                        title="Auto-computed; edit to override"
                                    />
                                ) : (
                                    <span />
                                )}
                                <span className="text-right">Total</span>
                                <span className="w-28 text-right font-mono tabular-nums">₹ {fmt(grandTotal)}</span>
                            </div>
                            {copy.showPaymentBlock && (
                                <div className="pt-2 border-t border-border space-y-1.5">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Received In</p>

                                    {/* Multi-tender rows. Each row = one Dr leg on the sale's JE.
                                        Operator picks any cash / bank / wallet ledger; the system
                                        auto-fills the AR Balance row below for the remainder. */}
                                    {tenders.map((t, idx) => (
                                        <div key={t.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center">
                                            {/* Full-payment tick — fills this tender to cover the whole balance. */}
                                            <Checkbox
                                                checked={Math.abs(balance) < 0.005}
                                                title="Received in full via this method"
                                                onCheckedChange={(v) => {
                                                    if (v === true) {
                                                        setTenders((rows) => {
                                                            const others = rows.reduce((s, r, i) => i === idx ? s : s + (parseFloat(r.amount) || 0), 0);
                                                            return rows.map((r, i) => i === idx ? { ...r, amount: Math.max(0, grandTotal - others).toFixed(2) } : r);
                                                        });
                                                    } else {
                                                        setTenders((rows) => rows.map((r, i) => i === idx ? { ...r, amount: "" } : r));
                                                    }
                                                }}
                                            />
                                            <GlAccountCombobox
                                                value={t.accountId}
                                                onChange={(acc) => {
                                                    setTenders((rows) => rows.map((r, i) => i === idx ? { ...r, account: acc, accountId: acc?.id ?? null } : r));
                                                    // Remember the primary "Received In" pick for next time.
                                                    if (idx === 0 && acc?.id != null) {
                                                        try { window.localStorage.setItem(LAST_PAYMENT_KEY, String(acc.id)); }
                                                        catch { /* ignore */ }
                                                    }
                                                }}
                                                accounts={cashBankAccounts}
                                                placeholder="Cash / Bank"
                                                className="h-8 text-xs"
                                            />
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                value={t.amount}
                                                onChange={(e) => setTenders((rows) => rows.map((r, i) => i === idx ? { ...r, amount: parseDecimalInput(e.target.value) } : r))}
                                                className="h-8 w-24 text-xs text-right"
                                                placeholder="0"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setTenders((rows) => rows.filter((_, i) => i !== idx))}
                                                aria-label="Remove tender row"
                                                className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}

                                    {/* + More payment option — appends a blank tender row defaulted
                                        to the cash/bank account already picked on the left (paymentAccount)
                                        or the first cashBankAccount as a fallback. */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const seed = paymentAccount ?? cashBankAccounts[0] ?? null;
                                            // Suggest the remaining balance as the new row's amount.
                                            const suggest = balance > 0 ? balance.toFixed(2) : "";
                                            setTenders((rows) => [...rows, newTender(seed, suggest)]);
                                        }}
                                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                        + More payment option
                                    </button>

                                    {/* Auto Balance row — what's still owed by the customer after
                                        the explicit tenders above. On save, this gets appended as
                                        a real tender row pointing at the party's AR account so
                                        every JE Dr is backed by an explicit row. */}
                                    {balance > 0.005 && (
                                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-sm font-semibold pt-1">
                                            <span className="text-right text-muted-foreground">
                                                Balance → {party?.name ?? "Customer AR"}
                                            </span>
                                            <span className="w-24" />
                                            <span className="w-28 text-right font-mono tabular-nums text-destructive">
                                                ₹ {fmt(balance)}
                                            </span>
                                        </div>
                                    )}
                                    {balance < -0.005 && (
                                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-sm font-semibold pt-1">
                                            <span className="text-right text-muted-foreground">Overpaid</span>
                                            <span className="w-24" />
                                            <span className="w-28 text-right font-mono tabular-nums text-destructive">
                                                ₹ {fmt(Math.abs(balance))}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </ScrollArea>

            {/* ── Sticky action bar ────────────────────────────────────── */}
            <VoucherActionBar
                onCancel={handleClose}
                onSave={() => submit(true, printAfterSave)}
                onSaveDraft={() => submit(false, printAfterSave)}
                showSaveDraft
                showSave={isEditing || canPost}
                showPrintToggle
                printAfterSave={printAfterSave}
                onPrintAfterSaveChange={setPrintAfterSave}
                showThermalToggle
                thermal={thermal}
                onThermalChange={setThermal}
                saving={saving}
                leftContent={
                    <div className="mr-auto flex items-center gap-2">
                        {/* Bill-wise details / link-payment — placeholder for the Tally-style
                            "settle this bill against open receipts" flow. Real allocation
                            UI lands in a follow-up; the button confirms the location. */}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toast.info("Bill-wise details — coming soon. Will let you allocate this sale against the customer's open advance receipts.")}
                            className="gap-1.5 text-muted-foreground hover:text-foreground"
                            title="Link this sale to existing bills / advance receipts"
                        >
                            <Link2 size={14} /> Link Payment
                        </Button>
                        {isEditing && editVoucherId != null && loadedLifecycle && (
                            <div className="ml-2 flex items-center gap-3">
                                <LifecycleActions
                                    voucher={loadedLifecycle}
                                    apiBasePath={`/api/inventory/vouchers/${editVoucherId}`}
                                    listPath={copy.listPath}
                                    label={copy.title}
                                    canCancel={canCancel}
                                    canDelete={canDelete}
                                    canHardDelete={canHardDelete}
                                    onChanged={closeForm}
                                />
                                {editingWasPosted && (
                                    <span className="text-[11px] text-amber-600 italic">
                                        Will reverse + re-post on save (reference preserved)
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                }
                extraButtons={copy.showProfit ? (
                    <Button variant="outline" onClick={() => setShowProfit((s) => !s)} title="Show estimated profit (live)">
                        {showProfit ? "Hide" : "Show"} Profit
                    </Button>
                ) : undefined}
            />
            <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
                {/* Keyboard: Esc → Stay (handled natively by Radix Dialog).
                    Enter → Discard & Close (always, regardless of focused button). */}
                <DialogContent
                    showCloseButton={false}
                    // Esc → Discard (close the page). Semantic flip from Radix's
                    // native Esc-closes-dialog (Stay): pressing Esc on this
                    // dialog completes the "I want to leave" gesture instead
                    // of cancelling it. preventDefault stops Radix from also
                    // closing the dialog via its own listener — we drive the
                    // close + navigation explicitly. Enter is intentionally
                    // unhandled; Radix focuses the Stay button by default so
                    // Enter clicks it (keep editing).
                    onEscapeKeyDown={(e) => {
                        e.preventDefault();
                        isDirtyRef.current = false;
                        setCloseDialogOpen(false);
                        closeForm();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Unsaved changes</DialogTitle>
                        <DialogDescription>
                            You have unsaved changes that will be lost if you leave now.
                            <br />
                            <span className="text-xs text-muted-foreground">Press Esc to discard · Enter to stay.</span>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>Stay</Button>
                        <Button variant="outline" onClick={async () => { setCloseDialogOpen(false); isDirtyRef.current = false; await submit(false); }}>Save Draft</Button>
                        <Button variant="destructive" onClick={() => { isDirtyRef.current = false; setCloseDialogOpen(false); closeForm(); }}>Discard &amp; Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function TradingVoucherPage(props: { kind?: TradingKind }) {
    return (
        <Suspense fallback={<div>Loading…</div>}>
            <TradingVoucherPageInner {...props} />
        </Suspense>
    );
}
