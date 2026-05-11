// GL auto-posting for InvVoucher (SALE, PURCHASE).
// Builds a balanced JournalEntry from the voucher and runs Account.balance updates.
// NB: COGS / closing-stock is not posted per voucher — closing stock is computed
// live at report time via getClosingStockValue (matches Tally).
//
// Posting rules:
//   SALE   →  Dr <Party | Cash>  total
//             Cr Sales A/c       subtotal + shippingAmt
//             Cr <Tax ledger>    taxAmount        (if > 0)
//             Dr/Cr Round Off    |roundOff|       (if non-zero)
//   PURCH  →  Dr Purchase A/c    subtotal + shippingAmt
//             Dr <Tax ledger>    taxAmount        (if > 0)
//             Cr <Party | Cash>  total
//             Dr/Cr Round Off    |roundOff|       (if non-zero)

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { balanceDelta, toNumber } from "./balance";
import { defaultNormalBalanceForGroupType } from "./groupNature";

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
    SALES:        ["Sales A/c", "Sales", "Sales Account"],
    PURCHASE:     ["Purchase A/c", "Purchase", "Purchase Account"],
    CASH:         ["Cash", "Cash-in-Hand", "Cash A/c"],
    GST_OUTPUT:   ["IGST", "GST Output", "Output GST", "Output Tax"],
    GST_INPUT:    ["IGST", "GST Input", "Input GST", "Input Tax"],
    ROUND_OFF:    ["Round Off", "Rounded Off", "Round-Off"],
    SUNDRY_DEB:   [ACCOUNT_GROUPS.SUNDRY_DEBTORS],   // ledger fallback (rare)
    SUNDRY_CRED:  [ACCOUNT_GROUPS.SUNDRY_CREDITORS], // ledger fallback (rare)
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

async function nextJeRef(tx: Tx, prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const startsWith = `${prefix}-${year}-`;
    const cnt = await tx.journalEntry.count({ where: { reference: { startsWith } } });
    return `${startsWith}${String(cnt + 1).padStart(4, "0")}`;
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

    const isSale     = voucher.type === "SALE";
    const isPurchase = voucher.type === "PURCHASE";
    if (!isSale && !isPurchase) {
        return { journalEntryId: null, notes: ["voucher type does not post to GL"] };
    }

    const subtotal     = toNumber(voucher.subtotal);
    const taxAmount    = toNumber(voucher.taxAmount);
    const shippingAmt  = toNumber(voucher.shippingAmt);
    const roundOff     = toNumber(voucher.roundOff);
    const totalAmount  = toNumber(voucher.totalAmount);
    const goodsAmount  = subtotal + shippingAmt; // body of the sale/purchase

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

    // Body ledger (Sales for sale, Purchase for purchase)
    const bodyLedger = isSale
        ? await findLedgerByNames(tx, NAMES.SALES)
        : await findLedgerByNames(tx, NAMES.PURCHASE);

    if (!bodyLedger) {
        return { journalEntryId: null, notes: [
            `no ledger found for ${isSale ? "Sales" : "Purchase"} — skipping GL post`,
        ] };
    }

    // Counter side: party (credit sale / credit purchase) or cash
    let counterLedger: LedgerLite | null = isCash ? cashLedger : partyLedger;

    // Fallback chain for credit side when no party linked
    if (!counterLedger && !isCash) {
        if (isSale)     counterLedger = await findLedgerByNames(tx, NAMES.SUNDRY_DEB);
        else            counterLedger = await findLedgerByNames(tx, NAMES.SUNDRY_CRED);
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

    // Tax ledger (optional)
    let taxLedger: LedgerLite | null = null;
    if (taxAmount > 0) {
        taxLedger = await findLedgerByNames(tx, isSale ? NAMES.GST_OUTPUT : NAMES.GST_INPUT);
        if (!taxLedger) {
            notes.push(`no GST ledger found — tax of ${taxAmount.toFixed(2)} folded into ${bodyLedger.name}`);
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
    let taxLineAmt = taxAmount;
    let rndLineAmt = roundOff;
    if (!taxLedger)      { bodyAmount += taxLineAmt; taxLineAmt = 0; }
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
    if (taxLedger && taxLineAmt > 0) {
        lines.push({
            accountId:   taxLedger.id,
            type:        bodyType, // for SALE: credit GST; for PURCHASE: debit GST
            amount:      taxLineAmt,
            description: `${isSale ? "Output" : "Input"} tax`,
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
    const ref = await nextJeRef(tx, "JE");
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
    for (const led of [counterLedger, bodyLedger, taxLedger, roundOffLedger]) {
        if (led) ledgerById.set(led.id, led);
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
