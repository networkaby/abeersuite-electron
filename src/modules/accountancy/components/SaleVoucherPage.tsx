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

import { Fragment, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, Trash2, Plus, StickyNote, Settings2, X,
    Image as ImageIcon, FileText, ScanLine, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { fmt } from "@/utils/constants";

// ── Per-line state ─────────────────────────────────────────────────────────

type LineState = {
    id: number;
    product: SelectedProduct | null;
    quantity: string;
    freeQty: string;
    rate: string;
    discountPct: string;
    discountAmt: string;
    taxRate: string;
    taxAmount: string;
    description: string;
    showDescription: boolean;
};

let lineSeq = 0;
const newLine = (): LineState => ({
    id: ++lineSeq,
    product: null,
    quantity: "1",
    // Leave optional numeric fields blank instead of pre-filling "0" —
    // empty inputs read cleaner in dense tables. calcLine handles the
    // empty case via parseFloat("") || 0.
    freeQty: "",
    rate: "",
    discountPct: "",
    discountAmt: "",
    taxRate: "",
    taxAmount: "",
    description: "",
    showDescription: false,
});

type CalcOpts = { applyDiscount?: boolean; applyTax?: boolean };
function calcLine(l: LineState, opts: CalcOpts = {}) {
    const { applyDiscount = true, applyTax = true } = opts;
    const qty = parseFloat(l.quantity) || 0;
    const rate = parseFloat(l.rate) || 0;
    const gross = qty * rate;
    const discAmt = applyDiscount ? (parseFloat(l.discountAmt) || 0) : 0;
    const taxable = gross - discAmt;
    const taxAmt = applyTax ? (parseFloat(l.taxAmount) || 0) : 0;
    return { gross, discAmt, taxAmt, amount: taxable + taxAmt };
}

const PAYMENT_TERMS: { label: string; days: number | null }[] = [
    { label: "Due on Receipt", days: 0 },
    { label: "Net 15", days: 15 },
    { label: "Net 30", days: 30 },
    { label: "Net 45", days: 45 },
    { label: "Net 60", days: 60 },
    { label: "Custom", days: null },
];
function addDays(isoDate: string, days: number): string {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// Numeric input sanitizers — type="text" lets us avoid the awful native
// number-spinner UI; we filter keystrokes to digits + a single decimal
// point. `numSigned` additionally permits a leading minus (used for
// round-off which can legitimately be negative).
function num(s: string): string {
    // Strip non-numeric, collapse multiple decimal points to one.
    return s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}
function numSigned(s: string): string {
    const sign = s.trimStart().startsWith("-") ? "-" : "";
    return sign + num(s);
}

// ── Component ──────────────────────────────────────────────────────────────

export function SaleVoucherPage() {
    const router = useRouter();
    const today = new Date().toISOString().slice(0, 10);

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // CREDIT is the default — most sales need a party on file so the
    // outstanding can be tracked. CASH is the walk-in / counter mode.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CREDIT");
    const [party, setParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    // CASH walk-in fields — free-form name + phone. Stored on the voucher as
    // partyName / partyPhone strings only; no Person / Account row is created.
    const [walkInName, setWalkInName] = useState("");
    const [walkInPhone, setWalkInPhone] = useState("");
    // Picked-party snapshot — outstanding balance + address fetched on pick.
    const [partySnapshot, setPartySnapshot] = useState<{ balance: number; address: string | null }>({ balance: 0, address: null });
    // Cash / Bank ledger picker — which Account row receives the payment.
    // null = backend falls back to the legacy name-based "Cash-in-Hand" lookup.
    const [paymentAccount, setPaymentAccount] = useState<GlAccount | null>(null);
    const [cashBankAccounts, setCashBankAccounts] = useState<GlAccount[]>([]);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",
        // Blank by default — user fills as needed. Pre-zeroes were noisy.
        discountPct: "",
        discountAmt: "",
        // Payment Terms / Due Date are unselected on open (CREDIT only); when
        // the user picks a term preset, the due date auto-fills from date+days.
        paymentTerms: "",
        dueDate: "",
    });

    // Invoice number preview (race-safe ±1 at concurrent save).
    const [nextRef, setNextRef] = useState("");
    useEffect(() => {
        axios.get<{ reference: string }>("/api/inventory/vouchers/next-ref?type=SALE")
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, []);

    // Load cash + bank ledgers once and pre-select "Cash-in-Hand" if present.
    // Same fetch as MoneyFlowDialog — Account rows enriched with their group
    // so we can filter by ACCOUNT_GROUPS.CASH_IN_HAND / BANK_ACCOUNTS.
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => {
                const cb = r.data.filter((a) =>
                    a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND ||
                    a.group?.name === ACCOUNT_GROUPS.BANK_ACCOUNTS,
                );
                setCashBankAccounts(cb);
                // Default to "Cash-in-Hand" if available, else first hit.
                if (!paymentAccount) {
                    const cash = cb.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND);
                    setPaymentAccount(cash ?? cb[0] ?? null);
                }
            })
            .catch(() => setCashBankAccounts([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        axios.get<{ address: string | null; account?: { balance: number | string | null } }>(`/api/people/${party.id}`)
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
    };
    const DEFAULT_PREFS: ColumnPrefs = {
        freeQty: true,
        mrpHint: true,
        lineDiscount: true,
        lineTax: true,
        lineDescription: true,
        overallDiscount: true,
    };
    const PREFS_KEY = "saleVoucherPage.columnPrefs.v1";
    const [prefs, setPrefs] = useState<ColumnPrefs>(DEFAULT_PREFS);
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

    // ── Line edit helpers (paired %/₹) ────────────────────────────────────
    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));
    const addLine = () => setLines((ls) => [...ls, newLine()]);

    // Recompute helpers — when the derived value is zero we write "" so the
    // cell stays blank (no noisy "0.00" prefills). The other recompute
    // functions delegate to this for tax.
    const withTaxFromRate = (l: LineState): LineState => {
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const tRate = parseFloat(l.taxRate) || 0;
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
    const setLineQtyOrRate = (id: number, patch: { quantity?: string; rate?: string }) =>
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            const gross = (parseFloat(next.quantity) || 0) * (parseFloat(next.rate) || 0);
            const dPct = parseFloat(next.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            return withTaxFromRate({
                ...next,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
            });
        }));

    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => ls.map((l) => {
            if (l.id !== lineId_) return l;
            const fillRate = product?.salePrice;
            const nextRate = fillRate != null ? String(fillRate) : l.rate;
            const gross = (parseFloat(l.quantity) || 0) * (parseFloat(nextRate) || 0);
            const dPct = parseFloat(l.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            const taxable = gross - newDiscAmt;
            const tRate = parseFloat(l.taxRate) || 0;
            const newTaxAmt = taxable * (tRate / 100);
            return {
                ...l, product, rate: nextRate,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
                taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "",
            };
        }));
    }, []);

    // ── Totals ────────────────────────────────────────────────────────────
    const computed = lines.map((l) => calcLine(l, {
        applyDiscount: prefs.lineDiscount,
        applyTax: prefs.lineTax,
    }));
    const lineSubtotal = computed.reduce((s, c) => s + c.amount, 0);
    const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
    const totalFreeQty = lines.reduce((s, l) => s + (parseFloat(l.freeQty) || 0), 0);
    const totalDisc = computed.reduce((s, c) => s + c.discAmt, 0);
    const totalTax = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping = parseFloat(header.shippingAmt) || 0;
    const overallDiscount = prefs.overallDiscount ? (parseFloat(header.discountAmt) || 0) : 0;
    const roundOff = enableRoundOff ? (parseFloat(header.roundOff) || 0) : 0;
    const grandTotal = lineSubtotal - overallDiscount + shipping + roundOff;
    const received = parseFloat(header.received) || 0;
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
    // Payment Terms is a dummy preset picker — when a Net-N preset is chosen
    // the due date auto-fills from header.date + N days. The "Custom" preset
    // (and the blank default) leaves the due date free for the user to set.
    const handlePaymentTermsChange = (term: string) => {
        const preset = PAYMENT_TERMS.find((t) => t.label === term);
        setHeader((h) => ({
            ...h, paymentTerms: term,
            dueDate: preset && preset.days != null ? addDays(h.date, preset.days) : h.dueDate,
        }));
    };

    // Live profit
    const lineProfits = lines.map((l) => {
        const qty = parseFloat(l.quantity) || 0;
        const rate = parseFloat(l.rate) || 0;
        const cost = l.product?.costPrice ?? 0;
        const disc = prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0;
        const gross = qty * rate;
        const revenue = gross - disc;
        const costTotal = qty * cost;
        return { id: l.id, name: l.product?.name ?? "—", qty, cost, revenue, profit: revenue - costTotal };
    });
    const totalLineProfit = lineProfits.reduce((s, p) => s + p.profit, 0);
    const estimatedProfit = totalLineProfit - overallDiscount;
    const margin = grandTotal > 0 ? (estimatedProfit / grandTotal) * 100 : 0;

    const reset = () => {
        setLines([newLine()]);
        setPayMode("CREDIT");
        setParty(null);
        setWalkInName("");
        setWalkInPhone("");
        setPartySnapshot({ balance: 0, address: null });
        // Re-select "Cash-in-Hand" default so the picker is ready for the next sale.
        const cash = cashBankAccounts.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND);
        setPaymentAccount(cash ?? cashBankAccounts[0] ?? null);
        partyPickerRef.current?.clear();
        const t = new Date().toISOString().slice(0, 10);
        setHeader({
            date: t, description: "", shippingAmt: "", roundOff: "", received: "",
            discountPct: "", discountAmt: "",
            paymentTerms: "", dueDate: "",
        });
        setShowProfit(false);
        setShowDescription(false);
        setEnableRoundOff(false);
        setRoundOffManuallyEdited(false);
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
        const displayName = payMode === "CREDIT" ? party?.name : (walkInName.trim() || undefined);
        const description = header.description.trim()
            || (displayName ? `Sale to ${displayName}` : "Cash sale");

        // CASH mode auto-pays in full (received = grand total). User can still
        // override via the Received field — but the default mirrors counter sales.
        const receivedForPayload = payMode === "CASH"
            ? ((parseFloat(header.received) || 0) > 0 ? (parseFloat(header.received) || 0) : grandTotal)
            : received;

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>("/api/inventory/vouchers", {
                type: "SALE",
                date: header.date,
                description,
                partyName: payMode === "CREDIT" ? (party?.name || undefined)
                    : (walkInName.trim() || undefined),
                partyPhone: payMode === "CREDIT" ? (party?.phone || undefined)
                    : (walkInPhone.trim() || undefined),
                // partyType / partyId only carried in CREDIT mode — CASH stays
                // free-text so the ledger isn't accidentally cluttered.
                partyType: payMode === "CREDIT" ? party?.kind : undefined,
                partyId: payMode === "CREDIT" ? party?.id : undefined,
                paymentMode: payMode,
                // Cash / bank ledger that the payment lands on. Only relevant
                // when money actually changes hands at the till: every CASH sale,
                // OR a CREDIT sale with an upfront Received amount.
                paymentAccountId: (payMode === "CASH" || receivedForPayload > 0)
                    ? paymentAccount?.id
                    : undefined,
                ...(payMode === "CREDIT" ? {
                    paymentTerms: header.paymentTerms || undefined,
                    dueDate: header.dueDate || undefined,
                } : {}),
                shippingAmt: shipping,
                roundOff,
                discountPct: prefs.overallDiscount ? (parseFloat(header.discountPct) || 0) : 0,
                discountAmt: overallDiscount,
                amountReceived: receivedForPayload,
                lines: validLines.map((l) => ({
                    productId: l.product!.id,
                    description: prefs.lineDescription ? (l.description.trim() || undefined) : undefined,
                    quantity: parseFloat(l.quantity) || 1,
                    freeQty: prefs.freeQty ? (parseFloat(l.freeQty) || 0) : 0,
                    rate: parseFloat(l.rate) || 0,
                    discountPct: prefs.lineDiscount ? (parseFloat(l.discountPct) || 0) : 0,
                    discountAmt: prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0,
                    taxRate: prefs.lineTax ? (parseFloat(l.taxRate) || 0) : 0,
                })),
            });

            if (andPost) {
                await axios.post(`/api/inventory/vouchers/${res.data.id}/post`);
                toast.success("Sale posted — stock & GL updated");
            } else {
                toast.success("Sale saved as draft");
            }
            if (andPrint) {
                window.open(`/receipt/invoice/${res.data.id}?autoprint=1`, "_blank", "noopener");
            }
            reset();
            router.refresh();
            router.push("/office/accountancy/sales");
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const cell = "bg-transparent border-0 outline-none text-sm text-right w-full focus:bg-accent/40 rounded px-1 tabular-nums";

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-background">
            {/* ── Title bar ─────────────────────────────────────────────── */}
            <header className="border-b border-border bg-card px-6 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="text-base font-semibold">Sale Invoice</h1>
                    {/* CASH / CREDIT pill — same shape as the dialog */}
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
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push("/office/accountancy/sales")}
                    title="Close"
                >
                    <X size={18} />
                </Button>
            </header>

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
                                        placeholder="Search by name or phone…"
                                        partyGroup={ACCOUNT_GROUPS.SUNDRY_DEBTORS}
                                        allowIncludeOther
                                    />
                                </div>
                                {/* Picked-party compact info card — name, mobile, outstanding,
                                address. Address truncates with ellipsis to fit the area. */}
                                {party && (
                                    <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 max-w-full">
                                        <div className="font-medium truncate">{party.name}</div>
                                        <button
                                            type="button"
                                            onClick={() => { setParty(null); partyPickerRef.current?.clear(); }}
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
                        <label className="text-xs text-muted-foreground text-right">Invoice Number</label>
                        <div className="font-mono text-xs tabular-nums px-2 py-1.5 rounded-md bg-muted/40 border border-border min-h-9 flex items-center">
                            {nextRef || "Generating…"}
                        </div>

                        <label className="text-xs text-muted-foreground text-right">Invoice Date</label>
                        <Input
                            type="date"
                            value={header.date}
                            onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
                            className="h-9 text-xs"
                        />

                        {payMode === "CREDIT" && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">Payment Terms</label>
                                <Select value={header.paymentTerms || undefined} onValueChange={handlePaymentTermsChange}>
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue placeholder="Select term…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAYMENT_TERMS.map((t) => (
                                            <SelectItem key={t.label} value={t.label} className="text-xs">
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <label className="text-xs text-muted-foreground text-right">Due Date</label>
                                <Input
                                    type="date"
                                    value={header.dueDate}
                                    onChange={(e) => setHeader((h) => ({ ...h, dueDate: e.target.value }))}
                                    className="h-9 text-xs"
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
                                {prefs.mrpHint && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-16 align-bottom">MRP</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom">QTY</th>
                                {prefs.freeQty && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom" title="Free / complimentary quantity">FREE</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-center font-medium w-10 text-muted-foreground/60 align-bottom">UNIT</th>
                                <th rowSpan={2} className="px-2 py-2 text-right font-medium w-20 align-bottom">PRICE</th>
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
                                            <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" title="Column settings">
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
                                                    autoFocus={i === 0 && !line.product}
                                                />
                                            </td>
                                            {prefs.mrpHint && (
                                                <td className="px-1 py-1 text-right text-xs tabular-nums text-muted-foreground">
                                                    {mrp != null && mrp > 0 ? fmt(mrp) : ""}
                                                </td>
                                            )}
                                            <td className="px-1 py-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.quantity}
                                                    onChange={(e) => setLineQtyOrRate(line.id, { quantity: num(e.target.value) })}
                                                    className={cell}
                                                />
                                            </td>
                                            {prefs.freeQty && (
                                                <td className="px-1 py-1">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={line.freeQty}
                                                        onChange={(e) => updateLine(line.id, { freeQty: num(e.target.value) })}
                                                        className={cell}
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
                                                    onChange={(e) => setLineQtyOrRate(line.id, { rate: num(e.target.value) })}
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
                                                            onChange={(e) => setLineDiscountPct(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.discountAmt}
                                                            onChange={(e) => setLineDiscountAmt(line.id, num(e.target.value))}
                                                            className={cell}
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
                                                            onChange={(e) => setLineTaxRate(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.taxAmount}
                                                            onChange={(e) => setLineTaxAmount(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-2 py-1 text-right font-mono font-medium border-l border-border/40">
                                                {c.amount > 0 ? fmt(c.amount) : ""}
                                            </td>
                                            <td className="px-1 py-1 text-center">
                                                {/* Right action cell now only holds the note toggle —
                                                    delete moved to the leftmost row-number cell. */}
                                                <div className="flex items-center justify-end gap-1">
                                                    {prefs.lineDescription && (
                                                        <Button
                                                            variant="ghost" size="icon-xs"
                                                            className={`${line.showDescription ? "text-primary" : "text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100"} transition-opacity`}
                                                            onClick={() => updateLine(line.id, { showDescription: !line.showDescription })}
                                                            title="Toggle note"
                                                        >
                                                            <StickyNote size={12} />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {prefs.lineDescription && line.showDescription && (
                                            <tr className="border-b border-border/50 bg-muted/10">
                                                <td />
                                                <td colSpan={14} className="px-3 py-1.5">
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
                                <td colSpan={14} className="px-5 py-2 border-b border-border/50">
                                    <Button variant="ghost" size="sm" className="text-primary h-auto py-1 text-xs" onClick={addLine}>
                                        <Plus size={12} className="mr-1" /> Add Row
                                    </Button>
                                </td>
                            </tr>
                            {/* Column totals — read-only summary row matching the reference */}
                            <tr className="bg-muted/40 text-xs font-semibold tabular-nums">
                                <td />
                                <td className="px-2 py-1.5 text-muted-foreground uppercase">Total</td>
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

                    <div className="grid grid-cols-[1fr_1fr] gap-8 px-6 py-4">
                        {/* Left: voucher-level actions */}
                        <div className="space-y-3 max-w-md">
                            {/* Cash / Bank ledger picker — Vyapar's "Payment Type"
                                slot. Always visible in CASH mode; in CREDIT mode,
                                only when the user has typed a Received amount > 0
                                (the upfront cash has to land somewhere). */}
                            {(payMode === "CASH" || received > 0) && cashBankAccounts.length > 0 && (
                                <div className="space-y-1">
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        Received in
                                    </label>
                                    <GlAccountCombobox
                                        value={paymentAccount?.id ?? null}
                                        onChange={setPaymentAccount}
                                        accounts={cashBankAccounts}
                                        placeholder="Cash in Hand"
                                        className="w-56"
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
                                        placeholder={party ? `Narration (default: Sale to ${party.name})` : "Narration (optional — invoice no auto-generated)"}
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
                                        onChange={(e) => handleDiscountPctChange(num(e.target.value))}
                                        className="h-8 w-20 text-xs text-right"
                                        placeholder="%"
                                    />
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.discountAmt}
                                        onChange={(e) => handleDiscountAmtChange(num(e.target.value))}
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
                                    onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: num(e.target.value) }))}
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
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm pt-2 border-t border-border">
                                <span className="text-muted-foreground text-right">Received</span>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={header.received}
                                    onChange={(e) => setHeader((h) => ({ ...h, received: num(e.target.value) }))}
                                    className="h-8 w-20 text-xs text-right"
                                    placeholder="0"
                                />
                                <span className="w-28 text-right font-mono tabular-nums">{fmt(received)}</span>
                            </div>
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm font-semibold">
                                <span className="text-right">Balance</span>
                                <span className="w-20" />
                                <span className={`w-28 text-right font-mono tabular-nums ${balance > 0 ? "text-destructive" : "text-green-600"}`}>
                                    ₹ {fmt(balance)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

            </ScrollArea>

            {/* ── Sticky action bar ────────────────────────────────────── */}
            <div className="border-t border-border bg-card px-6 py-3 flex items-center gap-2 shrink-0">
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
                <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={() => router.push("/office/accountancy/sales")}>
                    Cancel
                </Button>
                <Button variant="outline" onClick={() => setShowProfit((s) => !s)} title="Show estimated profit (live)">
                    {showProfit ? "Hide" : "Show"} Profit
                </Button>
                <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                    {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                </Button>
                <Button variant="outline" onClick={() => submit(true, true)} disabled={saving}>
                    {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save &amp; Print
                </Button>
                <Button onClick={() => submit(true)} disabled={saving}>
                    {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save
                </Button>
                </div>
            </div>
        </div>
    );
}
