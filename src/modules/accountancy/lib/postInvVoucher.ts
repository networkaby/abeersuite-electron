// GL auto-posting for InvVoucher (SALE, PURCHASE).
// Builds a balanced JournalEntry from the voucher and runs Account.balance updates.
// NB: COGS / closing-stock is not posted per voucher — closing stock is computed
// live at report time via getClosingStockValue (matches Tally).
//
// Posting rules:
//   SALE   →  Dr <Party | Cash>  total
//             Cr Sales A/c       subtotal + shippingAmt
//             Cr <Tax ledgers>   taxAmount        (split CGST+SGST or IGST)
//             Dr/Cr Round Off    |roundOff|       (if non-zero)
//   PURCH  →  Dr Purchase A/c    subtotal + shippingAmt
//             Dr <Tax ledgers>   taxAmount        (split CGST+SGST or IGST)
//             Cr <Party | Cash>  total
//             Dr/Cr Round Off    |roundOff|       (if non-zero)
//
// GST routing (added 2026-05-23):
//   • Caller passes resolved `sellerStateCode` + `buyerStateCode` (place of
//     supply) on PostVoucherInput. We compute the split via computeGstSplit:
//       seller == buyer  → CGST + SGST (each = taxAmount / 2)
//       seller != buyer  → IGST (full taxAmount)
//   • Caller may also pass `placeOfSupply` directly (already-resolved 2-char
//     code); it short-circuits the resolution chain.
//   • Missing buyer state (legacy callers) falls back to seller state →
//     intra-state, matching pre-refactor behaviour.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { balanceDelta, nextRefFromSeries, toNumber } from "./balance";
import { defaultNormalBalanceForGroupType } from "./groupNature";
import { computeGstSplit } from "@/shared/lib/gst/computeGstSplit";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

type Tx = Prisma.TransactionClient | PrismaClient;

type LedgerLite = {
    id: number;
    name: string;
    normalBalance: "DEBIT" | "CREDIT" | null;
    groupType: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null;
};

type JeLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number;
    description?: string;
};

const NAMES = {
    SALES:            ["Sales A/c", "Sales", "Sales Account"],
    PURCHASE:         ["Purchase A/c", "Purchase", "Purchase Account"],
    SALES_RETURNS:    ["Sales Return A/c", "Sales Returns", "Returns Inward", "Sales Return"],
    PURCHASE_RETURNS: ["Purchase Return A/c", "Purchase Returns", "Returns Outward", "Purchase Return"],
    CASH:             ["Cash", "Cash-in-Hand", "Cash A/c"],
    // Per-direction tax ledger name lookups for the CGST/SGST/IGST split.
    // The final IGST fallbacks keep the legacy single-ledger behaviour for
    // installs whose CoA only seeded one combined "GST Output / IGST" row.
    GST_OUTPUT_CGST:  ["CGST Output", "Output CGST", "CGST"],
    GST_OUTPUT_SGST:  ["SGST Output", "Output SGST", "SGST"],
    GST_OUTPUT_IGST:  ["IGST Output", "Output IGST", "IGST", "GST Output", "Output GST", "Output Tax"],
    GST_INPUT_CGST:   ["CGST Input", "Input CGST", "CGST"],
    GST_INPUT_SGST:   ["SGST Input", "Input SGST", "SGST"],
    GST_INPUT_IGST:   ["IGST Input", "Input IGST", "IGST", "GST Input", "Input GST", "Input Tax"],
    ROUND_OFF:        ["Round Off", "Rounded Off", "Round-Off"],
    // Outward freight on a sale invoice → Cr Shipping Income.
    // Inward freight on a purchase invoice → Dr Freight Charges.
    SHIPPING_INCOME:  ["Shipping Income", "Freight Income", "Carriage Outward", "Delivery Charges Income"],
    SHIPPING_EXPENSE: ["Freight Charges", "Carriage Inward", "Inward Freight"],
    // Voucher-level (overall) discount given on a sale → Dr Discount Allowed.
    // Voucher-level discount received on a purchase → Cr Discount Received.
    DISCOUNT_ALLOWED:  ["Discount Allowed", "Discount Given", "Trade Discount Allowed"],
    DISCOUNT_RECEIVED: ["Discount Received", "Trade Discount Received"],
    SUNDRY_DEB:       [ACCOUNT_GROUPS.SUNDRY_DEBTORS],   // ledger fallback (rare)
    SUNDRY_CRED:      [ACCOUNT_GROUPS.SUNDRY_CREDITORS], // ledger fallback (rare)
} as const;

async function findLedgerByNames(tx: Tx, names: readonly string[]): Promise<LedgerLite | null> {
    for (const n of names) {
        const a = await tx.account.findFirst({
            where: {
                name: { equals: n, mode: "insensitive" },
                personId: null, companyId: null, isActive: true,
            },
            select: {
                id: true, name: true, normalBalance: true,
                group: { select: { type: true } },
            },
        });
        if (a) {
            return { id: a.id, name: a.name, normalBalance: a.normalBalance, groupType: a.group?.type ?? null };
        }
    }
    return null;
}

function effectiveNormalBalance(led: LedgerLite): "DEBIT" | "CREDIT" {
    if (led.normalBalance) return led.normalBalance;
    if (led.groupType)     return defaultNormalBalanceForGroupType(led.groupType);
    // Last-resort default (shouldn't happen for properly grouped accounts)
    return "DEBIT";
}

export type PostVoucherInput = {
    voucherId: number;
    voucher: {
        id: number;
        type: string;
        reference: string;
        date: Date;
        description: string;
        /// Frozen party snapshot — name used for JE descriptions (read via readPartyName).
        partyJson: Prisma.JsonValue | null;
        subtotal:    Prisma.Decimal | number;
        taxAmount:   Prisma.Decimal | number;
        shippingAmt: Prisma.Decimal | number;
        roundOff:    Prisma.Decimal | number;
        totalAmount: Prisma.Decimal | number;
        /// Voucher-level overall discount (₹). Posts to "Discount Allowed"
        /// on sale-side (Dr) or "Discount Received" on purchase-side (Cr).
        /// Folds into the body ledger if the dedicated ledger isn't seeded.
        /// Per-line discount is already netted into line.amount and never
        /// reaches this helper as a separate field.
        discountAmt?: Prisma.Decimal | number | null;
        /// Seller's state code (place of business — branch.gstStateCode,
        /// falling back to org.gstStateCode). Drives the CGST/SGST vs IGST
        /// split. Optional for back-compat: when blank we treat the sale as
        /// intra-state (pre-refactor behaviour).
        sellerStateCode?: string | null;
        /// Buyer's state code (place of supply). Already resolved by the
        /// caller via resolveBuyerStateCode(party, sellerState, deliveryMode).
        /// Defaults to sellerStateCode → intra-state when blank.
        buyerStateCode?:  string | null;
        /// Multi-tender rows — when present, one JE leg per row replaces the
        /// legacy single `paymentAccount` + `amountReceived` shape. Direction
        /// is the voucher type's counter side (Dr on sale, Cr on purchase).
        /// The customer-AR portion is just another tender row whose
        /// `accountId` points at the party's ledger account; no implicit
        /// "remainder" math here — the caller computes it.
        tenders?: Array<{
            accountId: number;
            amount:    Prisma.Decimal | number;
            account?: {
                normalBalance: "DEBIT" | "CREDIT" | null;
                group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
            } | null;
        }>;
        /// Additional GL legs (the "+ Add Account" rows below the items
        /// table). One JE leg per row. Direction = body's direction
        /// (Cr on sale, Dr on purchase) when amount > 0; opposite when
        /// amount < 0. Line amount is always |amount|. Contributes to
        /// totalAmount via calcVoucherTotals(chargesNet = Σ amount).
        charges?: Array<{
            accountId:   number;
            amount:      Prisma.Decimal | number;
            description?: string | null;
            account?: {
                normalBalance: "DEBIT" | "CREDIT" | null;
                group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
            } | null;
        }>;
    };
    userId: number;
};

export type PostVoucherResult = {
    journalEntryId: number | null;
    /** Diagnostic notes — non-blocking warnings (e.g. "tax ledger not found"). */
    notes: string[];
};

export async function postInvVoucherToGl(tx: Tx, input: PostVoucherInput): Promise<PostVoucherResult> {
    const { voucher, userId } = input;
    const notes: string[] = [];
    // Party name for JE descriptions comes from the frozen snapshot (partyJson).
    const partyName = readPartyName(voucher.partyJson);

    // Four GL-posting kinds, in two direction-shapes:
    //   "sale shape"     — counter (party/cash) Dr, body Cr, tax Cr
    //                      → SALE (body=Sales, tax=Output GST)
    //                      → PURCHASE_RETURN (body=Purchase Returns, tax=Input GST reversal)
    //   "purchase shape" — counter (party/cash) Cr, body Dr, tax Dr
    //                      → PURCHASE (body=Purchase, tax=Input GST)
    //                      → SALE_RETURN (body=Sales Returns, tax=Output GST reversal)
    // POS shares the sale shape (counter Dr / body Cr) — same GST split,
    // same body/tax resolution, and (since Layer 7g) the same tender
    // shape — every Dr leg is an explicit tender row on the InvVoucher.
    const isPositiveSale     = voucher.type === "SALE" || voucher.type === "POS";
    const isPositivePurchase = voucher.type === "PURCHASE";
    const isSaleReturn       = voucher.type === "SALE_RETURN";
    const isPurchaseReturn   = voucher.type === "PURCHASE_RETURN";
    if (!isPositiveSale && !isPositivePurchase && !isSaleReturn && !isPurchaseReturn) {
        return { journalEntryId: null, notes: ["voucher type does not post to GL"] };
    }
    // `isSale` (legacy name) reused below as a shorthand for the "sale shape"
    // direction — counter Dr, body Cr. SALE and PURCHASE_RETURN both share it.
    const isSale     = isPositiveSale || isPurchaseReturn;
    // `isDebtorParty` drives the no-party-linked fallback chain: SALE +
    // SALE_RETURN go against Sundry Debtors; PURCHASE + PURCHASE_RETURN
    // against Sundry Creditors.
    const isDebtorParty = isPositiveSale || isSaleReturn;

    const subtotal     = toNumber(voucher.subtotal);
    const taxAmount    = toNumber(voucher.taxAmount);
    const shippingAmt  = toNumber(voucher.shippingAmt);
    const discountAmt  = Math.max(0, toNumber(voucher.discountAmt ?? 0));
    const roundOff     = toNumber(voucher.roundOff);
    const totalAmount  = toNumber(voucher.totalAmount);
    // `voucher.subtotal` from calcVoucherTotals is tax-INCLUSIVE (sum of
    // line.amount, where line.amount = taxable + line tax). Pure goods =
    // subtotal − taxAmount. Shipping and voucher-level discount used to
    // be folded into the body (Sales/Purchase) credit/debit; since
    // 2026-05-24 they're posted as their own GL legs — see Shipping Income
    // / Discount Allowed / Discount Received resolution below.
    const goodsAmount  = subtotal - taxAmount;

    if (totalAmount <= 0) {
        return { journalEntryId: null, notes: ["voucher total is zero — skipping GL post"] };
    }

    // ── Resolve ledgers ────────────────────────────────────────────────
    // Body ledger — Sales / Purchase / Sales Returns / Purchase Returns per kind.
    // Returns fall back to the parent ledger (Sales / Purchase) when the
    // dedicated returns ledger isn't seeded, so old installs keep working.
    let bodyNames: readonly string[];
    let bodyFallbackNames: readonly string[] | null = null;
    let bodyKindLabel: string;
    if (isPositiveSale)            { bodyNames = NAMES.SALES;            bodyKindLabel = "Sales"; }
    else if (isPositivePurchase)   { bodyNames = NAMES.PURCHASE;         bodyKindLabel = "Purchase"; }
    else if (isSaleReturn)         { bodyNames = NAMES.SALES_RETURNS;    bodyFallbackNames = NAMES.SALES;    bodyKindLabel = "Sales Returns"; }
    else /* isPurchaseReturn */    { bodyNames = NAMES.PURCHASE_RETURNS; bodyFallbackNames = NAMES.PURCHASE; bodyKindLabel = "Purchase Returns"; }

    let bodyLedger = await findLedgerByNames(tx, bodyNames);
    if (!bodyLedger && bodyFallbackNames) {
        bodyLedger = await findLedgerByNames(tx, bodyFallbackNames);
        if (bodyLedger) notes.push(`no dedicated ${bodyKindLabel} ledger — folded into ${bodyLedger.name}`);
    }
    if (!bodyLedger) {
        return { journalEntryId: null, notes: [
            `no ledger found for ${bodyKindLabel} — skipping GL post`,
        ] };
    }

    // Counter side comes entirely from `voucher.tenders[]` — one Dr leg
    // per tender on a sale-shape voucher, one Cr leg on a purchase shape.
    // The customer-AR portion is just another tender row whose accountId
    // points at the party's ledger. Every Dr/Cr counter line is backed
    // by an explicit InvVoucherTender row — no implicit math, no
    // partyType+partyId resolution fallback.
    const tenderRows = (voucher.tenders ?? []).filter((t) => toNumber(t.amount) > 0.005);
    if (tenderRows.length === 0) {
        return { journalEntryId: null, notes: [
            ...notes,
            `no tender rows on voucher ${voucher.reference} — caller must supply at least one`,
        ] };
    }

    // Tax leg — split into CGST + SGST (intra-state) or IGST (inter-state)
    // based on the caller-supplied state codes. Output ledgers for sale-side
    // (SALE + SALE_RETURN), Input ledgers for purchase-side. Returns reverse
    // the direction via bodyType below.
    const isOutputTax = isPositiveSale || isSaleReturn;
    const sellerStateCode = (voucher.sellerStateCode ?? "").trim();
    // Default buyer = seller → intra-state (matches pre-refactor behaviour
    // for old callers that don't pass a buyer state yet).
    const buyerStateCode  = (voucher.buyerStateCode  ?? sellerStateCode).trim();

    type TaxLeg = { ledger: LedgerLite; amount: number; label: string };
    const taxLegs: TaxLeg[] = [];
    let unledgered = 0; // tax amount that couldn't find a ledger — folds into body

    if (taxAmount > 0) {
        const split = computeGstSplit({
            taxAmount,
            sellerStateCode,
            buyerStateCode,
        });

        if (split.kind === "INTRA") {
            const cgst = split.cgst;
            const sgst = split.sgst;
            const cgstLedger = await findLedgerByNames(
                tx, isOutputTax ? NAMES.GST_OUTPUT_CGST : NAMES.GST_INPUT_CGST,
            );
            const sgstLedger = await findLedgerByNames(
                tx, isOutputTax ? NAMES.GST_OUTPUT_SGST : NAMES.GST_INPUT_SGST,
            );
            if (cgstLedger && cgst > 0) {
                taxLegs.push({ ledger: cgstLedger, amount: cgst, label: `${isOutputTax ? "Output" : "Input"} CGST` });
            } else if (cgst > 0) {
                unledgered += cgst;
                notes.push(`no CGST ledger — ${cgst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
            if (sgstLedger && sgst > 0) {
                taxLegs.push({ ledger: sgstLedger, amount: sgst, label: `${isOutputTax ? "Output" : "Input"} SGST` });
            } else if (sgst > 0) {
                unledgered += sgst;
                notes.push(`no SGST ledger — ${sgst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
        } else {
            const igstLedger = await findLedgerByNames(
                tx, isOutputTax ? NAMES.GST_OUTPUT_IGST : NAMES.GST_INPUT_IGST,
            );
            if (igstLedger) {
                taxLegs.push({ ledger: igstLedger, amount: split.igst, label: `${isOutputTax ? "Output" : "Input"} IGST` });
            } else {
                unledgered += split.igst;
                notes.push(`no IGST ledger — ${split.igst.toFixed(2)} folded into ${bodyLedger.name}`);
            }
        }
    }

    // Round-off ledger (optional)
    let roundOffLedger: LedgerLite | null = null;
    if (Math.abs(roundOff) >= 0.005) {
        roundOffLedger = await findLedgerByNames(tx, NAMES.ROUND_OFF);
        if (!roundOffLedger) {
            notes.push(`no Round Off ledger — rounding of ${roundOff.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // Shipping leg ledger (optional). Outward shipping on a sale-side
    // voucher → Shipping Income. Inward freight on a purchase-side voucher
    // → Freight Charges. Falls back to folding into body when missing so
    // legacy installs that haven't seeded the ledger still post correctly.
    let shippingLedger: LedgerLite | null = null;
    if (shippingAmt > 0.005) {
        shippingLedger = await findLedgerByNames(
            tx, isDebtorParty ? NAMES.SHIPPING_INCOME : NAMES.SHIPPING_EXPENSE,
        );
        if (!shippingLedger) {
            notes.push(`no ${isDebtorParty ? "Shipping Income" : "Freight Charges"} ledger — shipping of ${shippingAmt.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // Voucher-level discount leg (optional). Discount given on a sale →
    // Discount Allowed (Dr — expense). Discount received on a purchase →
    // Discount Received (Cr — income). Falls back to reducing the body
    // line so the JE still balances on legacy installs.
    let discountLedger: LedgerLite | null = null;
    if (discountAmt > 0.005) {
        discountLedger = await findLedgerByNames(
            tx, isDebtorParty ? NAMES.DISCOUNT_ALLOWED : NAMES.DISCOUNT_RECEIVED,
        );
        if (!discountLedger) {
            notes.push(`no ${isDebtorParty ? "Discount Allowed" : "Discount Received"} ledger — discount of ${discountAmt.toFixed(2)} folded into ${bodyLedger.name}`);
        }
    }

    // ── Build balanced JE lines ──────────────────────────────────────────
    // For a SALE: counter side debits the party; body side credits sales/tax/round-off.
    // For a PURCHASE: counter side credits the party; body side debits purchase/tax/round-off.
    const counterType: "DEBIT" | "CREDIT" = isSale ? "DEBIT" : "CREDIT";
    const bodyType:    "DEBIT" | "CREDIT" = isSale ? "CREDIT" : "DEBIT";

    // Body-side amounts (split where possible). Tax / shipping / discount
    // each fall back to folding into body when their dedicated ledger
    // isn't seeded. Shipping is same direction as body (+); discount is
    // opposite direction (so it gets subtracted from body when folded).
    let bodyAmount = goodsAmount;
    let rndLineAmt = roundOff;
    if (unledgered > 0)     { bodyAmount += unledgered; }
    if (!shippingLedger)    { bodyAmount += shippingAmt; }
    if (!discountLedger)    { bodyAmount -= discountAmt; }
    if (!roundOffLedger)    { bodyAmount += rndLineAmt; rndLineAmt = 0; }

    // ── Counter side: one JE leg per tender row ─────────────────────────
    // Required since Layer 7g — every Dr (sale) / Cr (purchase) leg is
    // backed by an explicit InvVoucherTender row. The empty-tender guard
    // at the top of the function already rejected the no-tender case.
    const lines: JeLine[] = [];
    const extraLedgers: LedgerLite[] = [];

    for (const t of tenderRows) {
        const amt = toNumber(t.amount);
        lines.push({
            accountId:   t.accountId,
            type:        counterType,
            amount:      amt,
            description: partyName ?? voucher.description,
        });
        if (t.account) {
            extraLedgers.push({
                id:            t.accountId,
                name:          "", // resolved below if needed for balance delta
                normalBalance: t.account.normalBalance,
                groupType:     t.account.group?.type ?? null,
            });
        }
    }
    if (bodyAmount !== 0) {
        lines.push({
            accountId:   bodyLedger.id,
            type:        bodyType,
            amount:      bodyAmount,
            description: voucher.description,
        });
    }
    for (const leg of taxLegs) {
        lines.push({
            accountId:   leg.ledger.id,
            type:        bodyType, // for SALE: credit GST; for PURCHASE: debit GST
            amount:      leg.amount,
            description: leg.label,
        });
    }
    if (shippingLedger && shippingAmt > 0) {
        // Same direction as body — credits Shipping Income on sale,
        // debits Freight Charges on purchase. Returns flip via bodyType.
        lines.push({
            accountId:   shippingLedger.id,
            type:        bodyType,
            amount:      shippingAmt,
            description: shippingLedger.name,
        });
    }
    if (discountLedger && discountAmt > 0) {
        // Opposite direction to body — debits Discount Allowed on sale
        // (it's an expense that offsets revenue), credits Discount
        // Received on purchase. Returns flip via counterType.
        lines.push({
            accountId:   discountLedger.id,
            type:        counterType,
            amount:      discountAmt,
            description: discountLedger.name,
        });
    }
    if (roundOffLedger && rndLineAmt !== 0) {
        // Positive roundOff → income (Cr) on sale, expense (Dr) on purchase. Negative → mirror.
        const positiveSide = isSale ? "CREDIT" : "DEBIT";
        const negativeSide = isSale ? "DEBIT"  : "CREDIT";
        lines.push({
            accountId:   roundOffLedger.id,
            type:        rndLineAmt > 0 ? positiveSide : negativeSide,
            amount:      Math.abs(rndLineAmt),
            description: "Round Off",
        });
    }

    // ── Additional charge legs (the "+ Add Account" rows below items) ──
    // Each charge row posts one JE leg. Direction = body's direction
    // (Cr on sale, Dr on purchase) when amount > 0; opposite direction
    // when amount < 0. Line amount is always |amount|. These are
    // independent of shipping/discount/round-off — they extend the JE
    // with whatever the operator chose (Packing Income, Service Charges,
    // Insurance, …).
    for (const ch of voucher.charges ?? []) {
        const raw = toNumber(ch.amount);
        if (Math.abs(raw) < 0.005) continue;
        const dir: "DEBIT" | "CREDIT" = raw > 0 ? bodyType : counterType;
        lines.push({
            accountId:   ch.accountId,
            type:        dir,
            amount:      Math.abs(raw),
            description: ch.description ?? undefined,
        });
        if (ch.account) {
            extraLedgers.push({
                id:            ch.accountId,
                name:          "",
                normalBalance: ch.account.normalBalance,
                groupType:     ch.account.group?.type ?? null,
            });
        }
    }

    // Sanity: check balance
    const debSum = lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + l.amount, 0);
    const credSum = lines.filter((l) => l.type === "CREDIT").reduce((s, l) => s + l.amount, 0);
    if (Math.abs(debSum - credSum) > 0.01) {
        return { journalEntryId: null, notes: [
            ...notes,
            `JE not balanced (Dr ${debSum.toFixed(2)} vs Cr ${credSum.toFixed(2)}) — skipped`,
        ] };
    }

    // ── Create JournalEntry + JournalLines ───────────────────────────────
    // Engine output — uses the GL_POSTING series (prefix `GL-`) so it never
    // collides visually with the user's Journal Voucher (prefix `JV-`).
    const ref = await nextRefFromSeries(tx as Prisma.TransactionClient, "GL_POSTING", userId);
    const je = await tx.journalEntry.create({
        data: {
            date:        voucher.date,
            reference:   ref,
            description: `${voucher.type} ${voucher.reference}: ${partyName ?? voucher.description}`,
            status:      "POSTED",
            postedAt:    new Date(),
            createdById: userId,
            lines: { create: lines.map((l) => ({
                accountId:   l.accountId,
                type:        l.type,
                amount:      l.amount,
                description: l.description ?? null,
            })) },
        },
        select: { id: true },
    });

    // Update Account.balance for each line.
    //
    // Pre-resolved ledgers (with normalBalance + groupType): counterLedger,
    // bodyLedger, the optional shipping/discount/roundoff legs, and any
    // ledger the caller passed inline on a tender/charge row (collected
    // into `extraLedgers` while building the JE).
    //
    // For tender/charge rows where the caller didn't pre-resolve, we
    // batch-fetch the missing accounts so balance deltas hit the right
    // side. effectiveNormalBalance falls back to group type when the
    // ledger's own normalBalance column is null (identity ledgers).
    const ledgerById = new Map<number, LedgerLite>();
    for (const led of [bodyLedger, roundOffLedger, shippingLedger, discountLedger, ...extraLedgers]) {
        if (led) ledgerById.set(led.id, led);
    }
    for (const leg of taxLegs) {
        ledgerById.set(leg.ledger.id, leg.ledger);
    }
    const unresolvedIds = [...new Set(lines.map((l) => l.accountId).filter((id) => !ledgerById.has(id)))];
    if (unresolvedIds.length > 0) {
        const rows = await tx.account.findMany({
            where:  { id: { in: unresolvedIds } },
            select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } },
        });
        for (const r of rows) {
            ledgerById.set(r.id, {
                id:            r.id,
                name:          r.name,
                normalBalance: r.normalBalance,
                groupType:     r.group?.type ?? null,
            });
        }
    }
    for (const l of lines) {
        const led = ledgerById.get(l.accountId);
        const nb  = led ? effectiveNormalBalance(led) : "DEBIT";
        const delta = balanceDelta(nb, l.type, l.amount);
        await tx.account.update({
            where: { id: l.accountId },
            data:  { balance: { increment: delta } },
        });
    }

    return { journalEntryId: je.id, notes };
}
