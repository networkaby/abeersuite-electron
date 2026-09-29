import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import type { DepositSlipInfo } from "@/shared/components/print/ThermalReceiptPreview";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { isMoneyGroupName } from "@/modules/accountancy/lib/moneyAccount";
import { canDepositToPartyBank, parsePartyBank, type PartyBankFields } from "@/shared/lib/parties/partyBank";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { parseDenomJson } from "@/shared/lib/accountancy/denomJson";

// ── Cash paid to a party = cash deposited into the party's bank ─────────────
//
// We don't hand a party cash. We deposit it straight into their own bank
// account, so a cash PAYMENT to a party prints the same Bank Deposit Slip a
// Contra cash → bank prints (the BANK_DEPOSIT template), carrying the PARTY's
// bank details and the note count.
//
// A PAYMENT qualifies when:
//   • the money side is Cash-in-Hand only (a bank payment needs no slip),
//   • every particulars (debit) line is ONE payee ledger linked to a person,
//     company or staff profile (one slip goes into one account), and
//   • that payee has an A/C No on file (canDepositToPartyBank).
// Anything else keeps the receipt-book payment voucher. The Payment form
// mirrors this rule (GlVoucherPage) so its denomination box and its
// "no bank details" message match what prints.

type SpineLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: Prisma.Decimal | number };
type SpineLike = { type: string; lines: SpineLine[]; denomJson?: unknown };

type DepositPayee = {
    /** Party name as the voucher addresses it. */
    name:       string;
    bank:       PartyBankFields;
    /** Our Cash-in-Hand ledger(s) the money leaves from. */
    cashLedger: string;
    /** What goes into the bank — the cash side, net of any deduction row. */
    amount:     number;
};

async function findDepositPayee(v: SpineLike): Promise<DepositPayee | null> {
    if (v.type !== "PAYMENT") return null;
    const debitIds = [...new Set(v.lines.filter((l) => l.type === "DEBIT").map((l) => l.accountId))];
    if (debitIds.length !== 1) return null;
    const creditIds = [...new Set(v.lines.filter((l) => l.type === "CREDIT").map((l) => l.accountId))];

    const accts = await prisma.account.findMany({
        where:  { id: { in: [...debitIds, ...creditIds] } },
        select: {
            id: true, name: true,
            group:         { select: { name: true } },
            person:        { select: { name: true, bankJson: true } },
            company:       { select: { name: true, bankJson: true } },
            staffLedgerOf: { select: { bankJson: true } },
        },
    });
    const byId = new Map(accts.map((a) => [a.id, a]));

    // Money side: a credit line on a Cash / Bank / OD ledger. A deduction row
    // (e.g. discount received) also posts on the credit side and is skipped.
    const moneyIds = creditIds.filter((id) => isMoneyGroupName(byId.get(id)?.group?.name));
    if (moneyIds.length === 0) return null;
    if (moneyIds.some((id) => byId.get(id)?.group?.name !== ACCOUNT_GROUPS.CASH_IN_HAND)) return null;

    const payee = byId.get(debitIds[0]);
    const owner = payee?.person ?? payee?.company ?? payee?.staffLedgerOf ?? null;
    if (!payee || !owner) return null;
    const bank = parsePartyBank(owner.bankJson);
    if (!canDepositToPartyBank(bank)) return null;

    const moneySet = new Set(moneyIds);
    const amount = v.lines
        .filter((l) => l.type === "CREDIT" && moneySet.has(l.accountId))
        .reduce((s, l) => s + Number(l.amount), 0);
    return {
        name:       payee.person?.name ?? payee.company?.name ?? payee.name,
        bank,
        cashLedger: moneyIds.map((id) => byId.get(id)?.name ?? "—").join(", "),
        amount,
    };
}

/** Org's note/coin list (high → low) for the slip's pen-fill rows, with a sane
 *  India fallback. Shared by the Contra and the party deposit slips. */
export async function loadSlipDenominations(): Promise<number[]> {
    const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { cashDenominationsJson: true } });
    const raw = od?.cashDenominationsJson;
    return Array.isArray(raw) && raw.length && raw.every((d) => typeof d === "number")
        ? (raw as number[])
        : [500, 200, 100, 50, 20, 10, 5, 2, 1];
}

/** Slip data for a cash PAYMENT deposited into the party's bank, or null when
 *  the voucher does not qualify (see the rule above). */
export async function buildPartyDepositSlip(v: SpineLike): Promise<{ slip: DepositSlipInfo; amount: number } | null> {
    const payee = await findDepositPayee(v);
    if (!payee) return null;
    const denom = parseDenomJson(v.denomJson);
    const org = getOrganisation();
    return {
        amount: payee.amount,
        slip: {
            mode:        "deposit",
            paidTo:      payee.name,
            // The PARTY's account only — never our bank as a fallback, or the
            // slip would send the party's money into our own account.
            bankName:    payee.bank.bankName    || null,
            branch:      payee.bank.branch      || null,
            accountName: payee.bank.beneficiary || payee.name,
            accountNo:   payee.bank.accountNumber,
            ifsc:        payee.bank.ifsc        || null,
            // We are the depositor — banks ask the depositor's PAN on large cash.
            pan:         org.pan                || null,
            fromLedger:  payee.cashLedger,
            denominations: await loadSlipDenominations(),
            counted: denom ? {
                notes: Object.entries(denom.notes)
                    .map(([d, count]) => ({ denom: Number(d), count }))
                    .sort((a, b) => b.denom - a.denom),
                cheques: [],
            } : null,
        },
    };
}
