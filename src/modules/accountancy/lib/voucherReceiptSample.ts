import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import type {
    ThermalReceiptSample,
} from "@/shared/components/print/ThermalReceiptPreview";
import {
    isVoucherTemplateKind,
    type VoucherTemplateKind,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadEstimateDiscountVisibility } from "@/shared/lib/pos/estimateDiscountVisibility";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// ── Cross-source receipt sample builder ─────────────────────────────────────
//
// Turns ANY Day-Book voucher (inventory · GL · journal-entry) into the single
// `ThermalReceiptSample` shape that the template-driven renderer
// (`ReceiptPreview` → A4 / Thermal) consumes. This is what lets the Day Book
// 3-dot menu print every voucher kind — not just POS sales — through one path.
//
// The POS counter flow keeps its own rich pages (/receipt/invoice?kind=POS with
// the price ladder, /receipt/payment with the relay). This builder powers the
// generic /receipt/voucher/[source]/[id] route used by the register menus.

export type VoucherReceiptSource = "inv" | "gl" | "je";

export interface VoucherReceiptData {
    kind:     VoucherTemplateKind;
    sample:   ThermalReceiptSample;
    docTitle: string;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Resolve a party display name from an Account's linked Person/Company. */
function partyFromAccount(account: {
    name:    string;
    person?:  { name: string; gstin: string | null; phones: { phone: string }[] } | null;
    company?: { name: string; gstin: string | null; phones: { phone: string }[] } | null;
} | null): { name: string | null; phone: string | null; gstin: string | null } {
    if (!account) return { name: null, phone: null, gstin: null };
    const owner = account.person ?? account.company ?? null;
    return {
        name:  owner?.name ?? account.name ?? null,
        phone: owner?.phones[0]?.phone ?? null,
        gstin: owner?.gstin ?? null,
    };
}

// Shared party-account select shape (Account → linked Person/Company).
const partyAccountSelect = {
    name:    true,
    person:  { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
    company: { select: { name: true, gstin: true, phones: { take: 1, orderBy: [{ isPrimary: "desc" }] } } },
} satisfies Prisma.AccountSelect;

// ── Inventory voucher (SALE / PURCHASE / returns / GRN / CHALLAN / …) ────────
async function buildInvSample(id: number): Promise<VoucherReceiptData> {
    const v = await prisma.invVoucher.findUnique({
        where: { id },
        include: {
            lines:   { include: { product: { select: { sku: true, name: true } } } },
            account: { select: partyAccountSelect },
        },
    });
    if (!v) return notFoundData();

    const party = partyFromAccount(v.account);
    // Strip the POS "<sku> — <name>" prefix so the printed line reads cleanly.
    const lineName = (l: (typeof v.lines)[number]): string => {
        const desc = (l.description ?? "").trim();
        const sku  = l.product?.sku;
        if (sku && desc.startsWith(`${sku} — `)) return desc.slice(sku.length + 3);
        return desc || l.product?.name || "";
    };

    let subtotal  = toNumber(v.subtotal);
    let taxAmount = toNumber(v.taxAmount);
    let total     = toNumber(v.totalAmount);
    let lines = v.lines.map((l) => ({
        description: lineName(l),
        quantity:    toNumber(l.quantity),
        amount:      toNumber(l.amount),
    }));

    // POS_ESTIMATE price-privacy: the customer copy prints the TAG/list price and
    // hides discounts by default (cashier negotiates from the discounted price on
    // screen). When the org turns ANY discount on (Settings → Org Defaults), the
    // real discounted price is revealed instead. POS_ORDER always prints the real
    // (discounted) price. (Per-line discount itemisation needs the rich POS ladder
    // — the generic slip only toggles tag-vs-net.)
    if (v.type === "POS_ESTIMATE") {
        const vis = await loadEstimateDiscountVisibility();
        const revealDiscounts = vis.tier || vis.loyalty || vis.coupon || vis.manual;
        if (!revealDiscounts) {
            lines = v.lines.map((l) => {
                const qty = toNumber(l.quantity);
                const tagUnit = l.savedSalePricePaise != null ? l.savedSalePricePaise / 100 : toNumber(l.rate);
                return { description: lineName(l), quantity: qty, amount: tagUnit * qty };
            });
            total = lines.reduce((s, l) => s + l.amount, 0);
            subtotal = total;
            taxAmount = 0; // tag price is shown all-in; no separate tax line
        }
    }

    const sample: ThermalReceiptSample = {
        reference:  v.reference,
        date:       isoDate(v.date),
        partyName:  party.name ?? readPartyName(v.partyJson) ?? "Walk-in",
        partyPhone: party.phone,
        partyGstin: party.gstin,
        lines,
        subtotal:  subtotal || null,
        taxAmount: taxAmount || null,
        total,
        notes:     v.description?.trim() || null,
    };

    const kind = isVoucherTemplateKind(v.type) ? v.type : "SALE";
    return { kind, sample, docTitle: `${v.type} ${v.reference}` };
}

// ── GL voucher (PAYMENT / RECEIPT / CONTRA / CREDIT_NOTE / DEBIT_NOTE / JOURNAL) ──
async function buildGlSample(id: number): Promise<VoucherReceiptData> {
    const v = await prisma.voucher.findUnique({
        where: { id },
        include: {
            lines:        { include: { account: { select: { name: true } } } },
            partyAccount: { select: partyAccountSelect },
        },
    });
    if (!v) return notFoundData();

    const party = partyFromAccount(v.partyAccount);
    const total = toNumber(v.totalAmount);

    // GL vouchers have no qty×rate goods — render each ledger line as
    // "<Account> (Dr|Cr)" with its amount so the slip reads as a journal.
    const sample: ThermalReceiptSample = {
        reference:  v.reference,
        date:       isoDate(v.date),
        partyName:  party.name,
        partyPhone: party.phone,
        partyGstin: party.gstin,
        lines: v.lines.map((l) => ({
            description: `${l.account.name} (${l.type === "DEBIT" ? "Dr" : "Cr"})`,
            quantity:    1,
            amount:      toNumber(l.amount),
        })),
        subtotal:  null,
        taxAmount: null,
        total,
        notes:     v.narration?.trim() || null,
    };

    const kind = isVoucherTemplateKind(v.type) ? v.type : "JOURNAL";
    return { kind, sample, docTitle: `${v.type} ${v.reference}` };
}

// ── Journal entry (standalone / engine-output JE) ───────────────────────────
async function buildJeSample(id: number): Promise<VoucherReceiptData> {
    const v = await prisma.journalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: { select: { name: true } } } } },
    });
    if (!v) return notFoundData();

    // Total = Σ debits (== Σ credits for a balanced entry).
    const total = v.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + toNumber(l.amount), 0);

    const sample: ThermalReceiptSample = {
        reference:  v.reference,
        date:       isoDate(v.date),
        partyName:  null,
        partyPhone: null,
        lines: v.lines.map((l) => ({
            description: `${l.account.name} (${l.type === "DEBIT" ? "Dr" : "Cr"})`,
            quantity:    1,
            amount:      toNumber(l.amount),
        })),
        subtotal:  null,
        taxAmount: null,
        total,
        notes:     v.description?.trim() || null,
    };

    return { kind: "JOURNAL", sample, docTitle: `JOURNAL ${v.reference}` };
}

/** Sentinel returned when a voucher id doesn't resolve — the route maps it to notFound(). */
function notFoundData(): VoucherReceiptData {
    return { kind: "SALE", sample: null as unknown as ThermalReceiptSample, docTitle: "" };
}

/**
 * Build the print-ready sample for any Day-Book voucher. Returns `null` for the
 * sample when the id doesn't resolve so the caller can `notFound()`.
 */
export async function buildVoucherReceiptSample(
    source: VoucherReceiptSource,
    id: number,
): Promise<VoucherReceiptData | null> {
    if (!Number.isFinite(id)) return null;
    const data =
        source === "inv" ? await buildInvSample(id)
      : source === "gl"  ? await buildGlSample(id)
      : await buildJeSample(id);
    if (data.sample == null) return null;
    return data;
}
