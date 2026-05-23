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

async function findPartyAccount(
    tx: Tx,
    partyType: string | null | undefined,
    partyId: number | null | undefined,
): Promise<LedgerLite | null> {
    if (!partyType || !partyId) return null;
    let where: Record<string, number> | null = null;
    if (partyType === "customer") where = { personId: partyId };
    else if (partyType === "company") where = { companyId: partyId };
    else if (partyType === "account") where = { id: partyId };
    if (!where) return null;
    const a = await tx.account.findFirst({
        where: { ...where, isActive: true },
        select: {
            id: true, name: true, normalBalance: true,
            group: { select: { type: true } },
        },
    });
    if (!a) return null;
    return { id: a.id, name: a.name, normalBalance: a.normalBalance, groupType: a.group?.type ?? null };
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
        partyName: string | null;
        partyType: string | null;
        partyId:   number | null;
        paymentMode: string | null;
        subtotal:    Prisma.Decimal | number;
        taxAmount:   Prisma.Decimal | number;
        shippingAmt: Prisma.Decimal | number;
        roundOff:    Prisma.Decimal | number;
        totalAmount: Prisma.Decimal | number;
        /// User-picked cash/bank ledger (Cash-in-Hand, HDFC, SBI, …).
        /// When present, overrides the legacy name-based lookup so the
        /// GL JE lands on the explicit choice. Null = fall back to NAMES.CASH.
        paymentAccount?: {
            id: number;
            name: string;
            normalBalance: "DEBIT" | "CREDIT" | null;
            group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | null } | null;
        } | null;
        /// Seller's state code (place of business — branch.gstStateCode,
        /// falling back to org.gstStateCode). Drives the CGST/SGST vs IGST
        /// split. Optional for back-compat: when blank we treat the sale as
        /// intra-state (pre-refactor behaviour).
        sellerStateCode?: string | null;
        /// Buyer's state code (place of supply). Already resolved by the
        /// caller via resolveBuyerStateCode(party, sellerState, deliveryMode).
        /// Defaults to sellerStateCode → intra-state when blank.
        buyerStateCode?:  string | null;
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

    // Four GL-posting kinds, in two direction-shapes:
    //   "sale shape"     — counter (party/cash) Dr, body Cr, tax Cr
    //                      → SALE (body=Sales, tax=Output GST)
    //                      → PURCHASE_RETURN (body=Purchase Returns, tax=Input GST reversal)
    //   "purchase shape" — counter (party/cash) Cr, body Dr, tax Dr
    //                      → PURCHASE (body=Purchase, tax=Input GST)
    //                      → SALE_RETURN (body=Sales Returns, tax=Output GST reversal)
    const isPositiveSale     = voucher.type === "SALE";
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
    const roundOff     = toNumber(voucher.roundOff);
    const totalAmount  = toNumber(voucher.totalAmount);
    // `voucher.subtotal` from calcVoucherTotals is tax-INCLUSIVE (sum of
    // line.amount, where line.amount = taxable + line tax). The body ledger
    // takes goods only — strip the line-level tax out and add shipping so
    // body + tax + roundOff balances against totalAmount.
    const goodsAmount  = subtotal - taxAmount + shippingAmt;

    if (totalAmount <= 0) {
        return { journalEntryId: null, notes: ["voucher total is zero — skipping GL post"] };
    }

    // ── Resolve ledgers ────────────────────────────────────────────────
    const isCash = voucher.paymentMode === "CASH";

    // Prefer the explicit paymentAccount the cashier picked at save time —
    // this is how multi-bank-ledger users route receipts to the right bank
    // (HDFC vs SBI vs Cash-in-Hand). Fall back to the legacy name-based
    // lookup for older vouchers / API callers that don't pass it.
    let cashLedger: LedgerLite | null = null;
    if (isCash) {
        if (voucher.paymentAccount) {
            cashLedger = {
                id:            voucher.paymentAccount.id,
                name:          voucher.paymentAccount.name,
                normalBalance: voucher.paymentAccount.normalBalance,
                groupType:     voucher.paymentAccount.group?.type ?? null,
            };
        } else {
            cashLedger = await findLedgerByNames(tx, NAMES.CASH);
        }
    }
    const partyLedger   = !isCash ? await findPartyAccount(tx, voucher.partyType, voucher.partyId) : null;

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

    // Counter side: party (credit sale / credit purchase) or cash
    let counterLedger: LedgerLite | null = isCash ? cashLedger : partyLedger;

    // Fallback chain for credit side when no party linked
    if (!counterLedger && !isCash) {
        counterLedger = await findLedgerByNames(tx, isDebtorParty ? NAMES.SUNDRY_DEB : NAMES.SUNDRY_CRED);
        if (!counterLedger) counterLedger = await findLedgerByNames(tx, NAMES.CASH);
        if (counterLedger) notes.push(
            `no party account linked — posted ${isSale ? "Dr" : "Cr"} to ${counterLedger.name}`,
        );
    }
    if (!counterLedger) {
        return { journalEntryId: null, notes: [
            ...notes,
            `no counter ledger (party / cash) — skipping GL post`,
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

    // ── Build balanced JE lines ──────────────────────────────────────────
    // For a SALE: counter side debits the party; body side credits sales/tax/round-off.
    // For a PURCHASE: counter side credits the party; body side debits purchase/tax/round-off.
    const counterType: "DEBIT" | "CREDIT" = isSale ? "DEBIT" : "CREDIT";
    const bodyType:    "DEBIT" | "CREDIT" = isSale ? "CREDIT" : "DEBIT";

    // Body-side amounts (split where possible)
    let bodyAmount = goodsAmount;
    let rndLineAmt = roundOff;
    // Any tax amount that couldn't find its CGST/SGST/IGST ledger gets
    // folded into the body so the JE still balances.
    if (unledgered > 0)  { bodyAmount += unledgered; }
    if (!roundOffLedger) { bodyAmount += rndLineAmt; rndLineAmt = 0; }

    const lines: JeLine[] = [];
    lines.push({
        accountId:   counterLedger.id,
        type:        counterType,
        amount:      totalAmount,
        description: voucher.partyName ?? voucher.description,
    });
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
            description: `${voucher.type} ${voucher.reference}: ${voucher.partyName ?? voucher.description}`,
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

    // Update Account.balance for each line
    const ledgerById = new Map<number, LedgerLite>();
    for (const led of [counterLedger, bodyLedger, roundOffLedger]) {
        if (led) ledgerById.set(led.id, led);
    }
    for (const leg of taxLegs) {
        ledgerById.set(leg.ledger.id, leg.ledger);
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
