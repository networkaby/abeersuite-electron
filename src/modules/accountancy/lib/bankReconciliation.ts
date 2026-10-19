// Bank reconciliation — the bank's statement against the bank ledger's book entries.
//
// The bank is the truth. Every statement line ends up either matched to one or
// more book entries (a GL line on this bank ledger) or shown as "not in books"
// until someone books it. Book entries the bank has not shown yet are the
// ordinary in-transit items (a cheque issued, a deposit not yet credited).
//
// Matches live in BankStatementMatch and point at VoucherGlLine by a LOOSE id.
// A voucher edited (its lines rewritten) or removed leaves a match with no live
// GL line behind it: the read reports it `stale`, auto-match clears it, and the
// statement line goes back to unmatched for the fresh entry to pick up.
//
// Lock: Account.reconciledThrough. Lines dated BEFORE it are frozen — not
// imported, not matched, not unmatched. Lines ON it are open, because the owner
// locks during the day and the bank keeps posting till midnight.

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { startOfDayUtc, endOfDayUtc, toDateOnly, toDateOnlyUtc, formatDate } from "@/shared/lib/format/formatDate";
import {
    checkContinuity, fingerprintSource, occurrenceIndexes, orderStatementRows, sameAccountNumber, money2,
    referenceTokensOf, type StatementRow, type StatementMeta,
} from "@/shared/lib/import/bankStatement";
import { accountIdsUnderGroup } from "./accountGroups";
import { ledgerStatusFilterUv } from "./ledgerStatus";
import { collapseEditReversals } from "./collapseEditReversals";
import { toNumber } from "./balance";
import { agreementRun, fyStartOf, inOpening, openingCover, type AgreementBreak, type OpeningCover } from "./bankReconAgreement";
import { resolveSourceBatch } from "./journalEntrySource";
import { referenceHref, voucherSourceForType } from "./voucherUrls";

export class BankReconError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const EPS = 0.005;

// ── The ledger ───────────────────────────────────────────────────────────────

export interface BankLedger {
    id: number;
    name: string;
    groupName: string | null;
    /** yyyy-mm-dd or null */
    lock: string | null;
    reconciledAt: string | null;
    bank: { bankName: string; accountNumber: string; ifsc: string };
}

/** Every active ledger a statement can be reconciled against. */
export async function bankLedgerIds(): Promise<Set<number>> {
    const [banks, ods] = await Promise.all([
        accountIdsUnderGroup(ACCOUNT_GROUPS.BANK_ACCOUNTS),
        accountIdsUnderGroup(ACCOUNT_GROUPS.BANK_OD),
    ]);
    return new Set([...banks, ...ods]);
}

export async function loadBankLedger(accountId: number): Promise<BankLedger> {
    const ids = await bankLedgerIds();
    if (!ids.has(accountId)) throw new BankReconError("Not a bank ledger", 404);
    const a = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            id: true, name: true, bankJson: true, reconciledThrough: true, reconciledAt: true,
            group: { select: { name: true } },
        },
    });
    if (!a) throw new BankReconError("Ledger not found", 404);
    const bj = (a.bankJson ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof bj[k] === "string" ? (bj[k] as string) : "");
    return {
        id: a.id,
        name: a.name,
        groupName: a.group?.name ?? null,
        lock: a.reconciledThrough ? toDateOnlyUtc(a.reconciledThrough) : null,
        reconciledAt: a.reconciledAt ? a.reconciledAt.toISOString() : null,
        bank: { bankName: str("bankName"), accountNumber: str("accountNumber"), ifsc: str("ifsc") },
    };
}

/** Frozen = dated strictly before the lock. On the lock date is still open. */
export function isLocked(dateIso: string, lock: string | null): boolean {
    return lock != null && dateIso < lock;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface GlLineView {
    id: number;
    voucherId: number;
    voucherType: string;
    voucherNo: string;
    date: string;
    description: string;
    narration: string | null;
    reference: string | null;
    method: string | null;
    debit: number | null;
    credit: number | null;
    locked: boolean;
    match: { groupId: string; auto: boolean; statementLineIds: number[] } | null;
    source: { url: string; reference: string } | null;
}

export interface StatementLineView {
    id: number;
    importId: number;
    seq: number;
    date: string;
    narration: string;
    reference: string | null;
    withdrawal: number | null;
    deposit: number | null;
    balance: number | null;
    locked: boolean;
    /** Dated before the book-start year and proven inside the opening balance — explained, never matched. */
    inOpening: boolean;
    match: { groupId: string; auto: boolean; glLineIds: number[]; stale: boolean } | null;
}

export interface ReconSummary {
    /** Signed as the bank sees it: + = money in the bank, − = overdrawn. */
    booksBalance: number;
    /** Book entries the bank has not shown by `to` — any date, not only the period. */
    paymentsNotInBank: number;   // unmatched CREDIT legs
    depositsNotInBank: number;   // unmatched DEBIT legs
    /** Statement lines with no book entry by `to`. */
    depositsNotInBooks: number;
    withdrawalsNotInBooks: number;
    /** booksBalance + paymentsNotInBank − depositsNotInBank + depositsNotInBooks − withdrawalsNotInBooks */
    derivedBankBalance: number;
    /** Printed balance of the latest statement line on/before `to`, when known. */
    statementBalance: number | null;
    difference: number | null;
    counts: {
        statementUnmatched: number;
        statementUnmatchedOlder: number;
        glUnmatched: number;
        glUnmatchedOlder: number;
        stale: number;
    };
    /** The latest date every statement line up to it is matched, or null. */
    suggestedReconciledThrough: string | null;
    /**
     * The last day of the period through which books and bank are proven to
     * agree: every day from `from` up to it closes with the same balance on
     * both sides AND has every row on it ticked. A matching total is not proof
     * (two bank lines summing to one book entry may be two different sums of
     * money), so an unticked day ends the run even when the balances agree.
     * Null when the very first day already fails.
     */
    agreedThrough: string | null;
    /** The first day that fails, and why — null when the whole period agrees. */
    breakAt: AgreementBreak | null;
    /** The book-start year's opening, books against bank. Null when the ledger has no book entries yet. */
    openingCover: OpeningCover | null;
}

export interface ReconPayload {
    account: BankLedger;
    from: string;
    to: string;
    summary: ReconSummary;
    statementLines: StatementLineView[];
    glLines: GlLineView[];
    imports: Array<{
        id: number; fileName: string; profile: string; createdAt: string;
        fromDate: string | null; toDate: string | null;
        lineCount: number; skippedCount: number; beforeLock: number;
        importedBy: string;
    }>;
}

type MatchRow = { id: number; groupId: string; statementLineId: number; glLineId: number; auto: boolean };

/**
 * Every match on this ledger, with the live status of the GL line behind it.
 * `live` = the GL line exists, is on this ledger, and its voucher is in the
 * books. Anything else is stale.
 */
async function loadMatchState(accountId: number, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const matches: MatchRow[] = await db.bankStatementMatch.findMany({
        where: { statementLine: { accountId } },
        select: { id: true, groupId: true, statementLineId: true, glLineId: true, auto: true },
    });
    const glIds = [...new Set(matches.map((m) => m.glLineId))];
    const liveLines = glIds.length
        ? await db.voucherGlLine.findMany({
            where: { id: { in: glIds }, accountId, universalVoucher: { ...ledgerStatusFilterUv() } },
            select: { id: true },
        })
        : [];
    const live = new Set(liveLines.map((l) => l.id));
    const staleGroups = new Set(matches.filter((m) => !live.has(m.glLineId)).map((m) => m.groupId));
    return { matches, staleGroups };
}

/**
 * The book-start year's opening, books against bank (see openingCover). The
 * year is the one the opening balance belongs to: the day after its date when
 * one is set (so "as on 31 Mar" and "from 1 Apr" both land on 1 Apr), otherwise
 * the year of the ledger's first book entry.
 */
export async function loadOpeningCover(accountId: number, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<OpeningCover | null> {
    const acc = await db.account.findUnique({
        where: { id: accountId },
        select: { openingBalance: true, openingBalanceType: true, openingBalanceDate: true },
    });
    let fyStart: string | null = null;
    if (acc?.openingBalanceDate) {
        fyStart = fyStartOf(toDateOnlyUtc(new Date(acc.openingBalanceDate.getTime() + 86400000)));
    } else {
        const first = await db.voucherGlLine.findFirst({
            where: { accountId, universalVoucher: { ...ledgerStatusFilterUv() } },
            orderBy: { universalVoucher: { date: "asc" } },
            select: { universalVoucher: { select: { date: true } } },
        });
        if (first) fyStart = fyStartOf(toDateOnly(first.universalVoucher.date));
    }
    if (!fyStart) return null;
    const fy = startOfDayUtc(fyStart);

    // One after another, not Promise.all: `db` may be a transaction, and a
    // transaction is one connection — pg 9 refuses two queries on it at once.
    // Edit reversals net to nothing on the account, so a raw sum is right here.
    const before = await db.voucherGlLine.groupBy({
        by: ["type"],
        where: { accountId, universalVoucher: { ...ledgerStatusFilterUv(), date: { lt: fy } } },
        _sum: { amount: true },
    });
    const firstIn = await db.bankStatementLine.findFirst({
        where: { accountId, date: { gte: fy } },
        orderBy: [{ date: "asc" }, { seq: "asc" }],
        select: { balance: true, deposit: true, withdrawal: true },
    });
    const lastBefore = await db.bankStatementLine.findFirst({
        where: { accountId, date: { lt: fy }, balance: { not: null } },
        orderBy: [{ date: "desc" }, { seq: "desc" }],
        select: { balance: true },
    });
    let booksOpening = 0;
    if (acc?.openingBalance != null && acc.openingBalanceType) {
        const ob = toNumber(acc.openingBalance);
        booksOpening += acc.openingBalanceType === "DEBIT" ? ob : -ob;
    }
    for (const b of before) {
        const amt = b._sum.amount != null ? toNumber(b._sum.amount) : 0;
        booksOpening += b.type === "DEBIT" ? amt : -amt;
    }
    return openingCover({
        fyStart,
        booksOpening,
        firstInYear: firstIn
            ? {
                balance: firstIn.balance != null ? toNumber(firstIn.balance) : null,
                net: (firstIn.deposit != null ? toNumber(firstIn.deposit) : 0) - (firstIn.withdrawal != null ? toNumber(firstIn.withdrawal) : 0),
            }
            : null,
        lastBeforeYear: lastBefore?.balance != null ? toNumber(lastBefore.balance) : null,
    });
}

function glLineSelect() {
    return {
        id: true, type: true, amount: true, reference: true, method: true,
        universalVoucher: { select: { id: true, date: true, voucherNo: true, description: true, narration: true, type: true } },
    } as const;
}

export async function loadReconciliation(accountId: number, fromIso: string, toIso: string): Promise<ReconPayload> {
    const account = await loadBankLedger(accountId);
    const from = startOfDayUtc(fromIso);
    const to = endOfDayUtc(toIso);

    const [{ matches, staleGroups }, periodGl, allGlToDate, stLinesAll, imports, ledgerRow, cover] = await Promise.all([
        loadMatchState(accountId),
        prisma.voucherGlLine.findMany({
            where: { accountId, universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } } },
            orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }],
            select: glLineSelect(),
        }),
        // For the summary: every posted leg up to `to`, slim.
        prisma.voucherGlLine.findMany({
            where: { accountId, universalVoucher: { ...ledgerStatusFilterUv(), date: { lte: to } } },
            select: { id: true, type: true, amount: true, universalVoucher: { select: { id: true, date: true, description: true } } },
        }),
        prisma.bankStatementLine.findMany({
            where: { accountId, date: { lte: to } },
            orderBy: [{ date: "asc" }, { importId: "asc" }, { seq: "asc" }, { id: "asc" }],
            select: { id: true, importId: true, seq: true, date: true, narration: true, reference: true, withdrawal: true, deposit: true, balance: true },
        }),
        prisma.bankStatementImport.findMany({
            where: { accountId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
                id: true, fileName: true, profile: true, createdAt: true, fromDate: true, toDate: true,
                lineCount: true, skippedCount: true, beforeLock: true, importedBy: { select: { name: true } },
            },
        }),
        prisma.account.findUnique({
            where: { id: accountId },
            select: { openingBalance: true, openingBalanceType: true, openingBalanceDate: true },
        }),
        loadOpeningCover(accountId),
    ]);

    // Live matches only; stale groups read as unmatched everywhere below.
    const liveMatches = matches.filter((m) => !staleGroups.has(m.groupId));
    const byStatement = new Map<number, MatchRow[]>();
    const byGl = new Map<number, MatchRow[]>();
    for (const m of liveMatches) {
        (byStatement.get(m.statementLineId) ?? byStatement.set(m.statementLineId, []).get(m.statementLineId)!).push(m);
        (byGl.get(m.glLineId) ?? byGl.set(m.glLineId, []).get(m.glLineId)!).push(m);
    }
    const staleByStatement = new Map<number, MatchRow[]>();
    for (const m of matches) {
        if (!staleGroups.has(m.groupId)) continue;
        (staleByStatement.get(m.statementLineId) ?? staleByStatement.set(m.statementLineId, []).get(m.statementLineId)!).push(m);
    }

    // ── Summary, from everything up to `to` ────────────────────────────────
    const visibleAll = collapseEditReversals(allGlToDate);
    let books = 0;
    if (ledgerRow?.openingBalance != null && ledgerRow.openingBalanceType
        && (!ledgerRow.openingBalanceDate || ledgerRow.openingBalanceDate <= to)) {
        const ob = toNumber(ledgerRow.openingBalance);
        books += ledgerRow.openingBalanceType === "DEBIT" ? ob : -ob;
    }
    let paymentsNotInBank = 0, depositsNotInBank = 0, glUnmatched = 0, glUnmatchedOlder = 0;
    for (const l of visibleAll) {
        const amt = toNumber(l.amount);
        books += l.type === "DEBIT" ? amt : -amt;
        if (byGl.has(l.id)) continue;
        const d = toDateOnly(l.universalVoucher.date);
        if (l.type === "CREDIT") paymentsNotInBank += amt; else depositsNotInBank += amt;
        glUnmatched++;
        if (d < fromIso) glUnmatchedOlder++;
    }
    let depositsNotInBooks = 0, withdrawalsNotInBooks = 0, stUnmatched = 0, stUnmatchedOlder = 0;
    for (const s of stLinesAll) {
        const d = toDateOnlyUtc(s.date);
        if (byStatement.has(s.id) || inOpening(d, cover)) continue;
        depositsNotInBooks += s.deposit != null ? toNumber(s.deposit) : 0;
        withdrawalsNotInBooks += s.withdrawal != null ? toNumber(s.withdrawal) : 0;
        stUnmatched++;
        if (d < fromIso) stUnmatchedOlder++;
    }
    const derived = money2(books + paymentsNotInBank - depositsNotInBank + depositsNotInBooks - withdrawalsNotInBooks);
    // Latest printed balance on/before `to`.
    const withBalance = [...stLinesAll].reverse().find((s) => s.balance != null);
    const statementBalance = withBalance ? toNumber(withBalance.balance!) : null;

    // ── Rows for the two panes (the period) ────────────────────────────────
    const visiblePeriod = collapseEditReversals(periodGl);
    const { agreedThrough, breakAt } = agreementRun({
        fromIso,
        opening: ledgerRow?.openingBalance != null && ledgerRow.openingBalanceType
            ? {
                amount: ledgerRow.openingBalanceType === "DEBIT" ? toNumber(ledgerRow.openingBalance) : -toNumber(ledgerRow.openingBalance),
                date: ledgerRow.openingBalanceDate ? toDateOnlyUtc(ledgerRow.openingBalanceDate) : null,
            }
            : null,
        books: visibleAll.map((l) => ({
            date: toDateOnly(l.universalVoucher.date),
            net: l.type === "DEBIT" ? toNumber(l.amount) : -toNumber(l.amount),
        })),
        periodBooks: visiblePeriod.map((l) => ({ date: toDateOnly(l.universalVoucher.date), ticked: byGl.has(l.id) })),
        statement: stLinesAll.map((s) => ({
            date: toDateOnlyUtc(s.date),
            balance: s.balance != null ? toNumber(s.balance) : null,
            ticked: byStatement.has(s.id) || inOpening(toDateOnlyUtc(s.date), cover),
        })),
    });
    // "Lock upto" offers exactly where the green Balance band runs to — books =
    // bank and every row ticked — never further, and never behind the lock.
    const suggested = agreedThrough && agreedThrough > (account.lock ?? "0000-00-00") ? agreedThrough : null;
    const sourceMap = await resolveSourceBatch([...new Set(visiblePeriod.map((l) => l.universalVoucher.id))]);
    const glLines: GlLineView[] = visiblePeriod.map((l) => {
        const d = toDateOnly(l.universalVoucher.date);
        const ms = byGl.get(l.id);
        // Inventory vouchers resolve through their detail sidecar; GL and
        // journal vouchers open by spine id.
        const inv = sourceMap.get(l.universalVoucher.id);
        const type = l.universalVoucher.type;
        const kindSource = voucherSourceForType(type);
        const src = inv
            ? { url: inv.url, reference: inv.reference }
            : kindSource !== "inv"
                ? (() => { const u = referenceHref(kindSource, l.universalVoucher.id, type); return u ? { url: u, reference: l.universalVoucher.voucherNo ?? formatUvNo(l.universalVoucher.id) } : null; })()
                : null;
        return {
            id: l.id,
            voucherId: l.universalVoucher.id,
            voucherType: l.universalVoucher.type,
            voucherNo: l.universalVoucher.voucherNo ?? formatUvNo(l.universalVoucher.id),
            date: d,
            description: l.universalVoucher.description ?? "",
            narration: l.universalVoucher.narration ?? null,
            reference: l.reference ?? null,
            method: l.method ?? null,
            debit: l.type === "DEBIT" ? toNumber(l.amount) : null,
            credit: l.type === "CREDIT" ? toNumber(l.amount) : null,
            locked: isLocked(d, account.lock),
            match: ms ? { groupId: ms[0].groupId, auto: ms[0].auto, statementLineIds: ms.map((m) => m.statementLineId) } : null,
            source: src,
        };
    });

    const statementLines: StatementLineView[] = stLinesAll
        .filter((s) => toDateOnlyUtc(s.date) >= fromIso)
        .map((s) => {
            const d = toDateOnlyUtc(s.date);
            const ms = byStatement.get(s.id);
            const stale = staleByStatement.get(s.id);
            return {
                id: s.id,
                importId: s.importId,
                seq: s.seq,
                date: d,
                narration: s.narration,
                reference: s.reference,
                withdrawal: s.withdrawal != null ? toNumber(s.withdrawal) : null,
                deposit: s.deposit != null ? toNumber(s.deposit) : null,
                balance: s.balance != null ? toNumber(s.balance) : null,
                locked: isLocked(d, account.lock),
                inOpening: inOpening(d, cover),
                match: ms
                    ? { groupId: ms[0].groupId, auto: ms[0].auto, glLineIds: ms.map((m) => m.glLineId), stale: false }
                    : stale
                        ? { groupId: stale[0].groupId, auto: stale[0].auto, glLineIds: stale.map((m) => m.glLineId), stale: true }
                        : null,
            };
        });

    return {
        account,
        from: fromIso,
        to: toIso,
        summary: {
            booksBalance: money2(books),
            paymentsNotInBank: money2(paymentsNotInBank),
            depositsNotInBank: money2(depositsNotInBank),
            depositsNotInBooks: money2(depositsNotInBooks),
            withdrawalsNotInBooks: money2(withdrawalsNotInBooks),
            derivedBankBalance: derived,
            statementBalance,
            difference: statementBalance != null ? money2(statementBalance - derived) : null,
            counts: {
                statementUnmatched: stUnmatched,
                statementUnmatchedOlder: stUnmatchedOlder,
                glUnmatched,
                glUnmatchedOlder,
                stale: staleGroups.size,
            },
            suggestedReconciledThrough: suggested,
            agreedThrough,
            breakAt,
            openingCover: cover,
        },
        statementLines,
        glLines,
        imports: imports.map((i) => ({
            id: i.id, fileName: i.fileName, profile: i.profile, createdAt: i.createdAt.toISOString(),
            fromDate: i.fromDate ? toDateOnlyUtc(i.fromDate) : null,
            toDate: i.toDate ? toDateOnlyUtc(i.toDate) : null,
            lineCount: i.lineCount, skippedCount: i.skippedCount, beforeLock: i.beforeLock,
            importedBy: i.importedBy.name ?? "",
        })),
    };
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ImportInput {
    fileName: string;
    fileHash: string;
    profile: string;
    meta: StatementMeta;
    rows: StatementRow[];
    /** Save nothing; report what would happen. */
    dryRun: boolean;
    /** Save despite a continuity break the user has looked at. */
    force: boolean;
}

export interface ImportReport {
    importId: number | null;
    inserted: number;
    skipped: number;
    beforeLock: number;
    continuityBreaks: number;
    warnings: string[];
    fromDate: string | null;
    toDate: string | null;
}

function sha1(s: string) { return createHash("sha1").update(s).digest("hex"); }

export async function importStatement(accountId: number, userId: number, input: ImportInput): Promise<ImportReport> {
    const account = await loadBankLedger(accountId);
    const warnings: string[] = [];

    // Identity — the statement must be this ledger's.
    const stNo = input.meta.bankAccountNumber ?? null;
    if (stNo && account.bank.accountNumber) {
        if (!sameAccountNumber(stNo, account.bank.accountNumber)) {
            throw new BankReconError(
                `This statement is for account …${stNo.slice(-6)}, but the ledger "${account.name}" is …${account.bank.accountNumber.slice(-6)}.`,
            );
        }
    } else if (stNo && !account.bank.accountNumber) {
        warnings.push(`The ledger has no account number on record; the statement says …${stNo.slice(-6)}. Add it to the ledger's bank particulars so future uploads are checked.`);
    }
    if (input.meta.ifsc && account.bank.ifsc && input.meta.ifsc.toUpperCase() !== account.bank.ifsc.toUpperCase()) {
        throw new BankReconError(`IFSC on the statement (${input.meta.ifsc}) is not the ledger's (${account.bank.ifsc}).`);
    }

    // Whole file seen before?
    const dupFile = await prisma.bankStatementImport.findFirst({
        where: { accountId, fileHash: input.fileHash },
        select: { id: true, createdAt: true, fileName: true },
    });
    if (dupFile) {
        throw new BankReconError(`This exact file was already uploaded on ${toDateOnly(dupFile.createdAt)} as "${dupFile.fileName}".`, 409);
    }

    if (input.rows.length === 0) throw new BankReconError("No statement lines to import.");

    // Oldest first, whatever order the bank printed: `seq` is the order inside a
    // day, and the last line of a day is read as its closing balance.
    const rows = orderStatementRows(input.rows, input.meta.openingBalance ?? null);

    // Continuity inside the file.
    const cont = checkContinuity(rows, input.meta.openingBalance ?? null);
    if (cont.breaks.length && !input.force) {
        const b = cont.breaks[0];
        throw new BankReconError(
            `Running balance breaks on ${formatDate(rows[b.rowIndex].date)}: expected ${b.expected.toFixed(2)}, statement says ${b.actual.toFixed(2)}. A line is missing or doubled. Fix the file, or tick "save anyway".`,
            422,
        );
    }
    if (cont.breaks.length) warnings.push(`${cont.breaks.length} running-balance break(s) saved anyway.`);

    // Lock.
    const kept = rows.filter((r) => !isLocked(r.date, account.lock));
    const beforeLock = rows.length - kept.length;
    if (beforeLock) warnings.push(`${beforeLock} line(s) dated before the reconciled lock (${account.lock}) were not saved.`);

    // Fingerprints; skip what an earlier upload already saved.
    const nth = occurrenceIndexes(accountId, kept);
    const prints = kept.map((r, i) => sha1(fingerprintSource(accountId, r, nth[i])));
    const existing = prints.length
        ? await prisma.bankStatementLine.findMany({
            where: { accountId, fingerprint: { in: prints } },
            select: { fingerprint: true },
        })
        : [];
    const seen = new Set(existing.map((e) => e.fingerprint));
    const fresh: Array<{ row: StatementRow; print: string; seq: number }> = [];
    kept.forEach((row, i) => { if (!seen.has(prints[i])) fresh.push({ row, print: prints[i], seq: i }); });
    const skipped = kept.length - fresh.length;

    // Opening vs what we already hold: a gap or an overlap is worth saying.
    const dates = kept.map((r) => r.date).sort();
    const fromDate = input.meta.fromDate ?? dates[0] ?? null;
    const toDate = input.meta.toDate ?? dates[dates.length - 1] ?? null;
    if (input.meta.openingBalance != null && fromDate) {
        const prev = await prisma.bankStatementLine.findFirst({
            where: { accountId, date: { lt: startOfDayUtc(fromDate) }, balance: { not: null } },
            orderBy: [{ date: "desc" }, { seq: "desc" }],
            select: { date: true, balance: true },
        });
        if (prev && Math.abs(toNumber(prev.balance!) - input.meta.openingBalance) >= EPS) {
            warnings.push(
                `Opening balance ${input.meta.openingBalance.toFixed(2)} does not continue from the last saved line (${toDateOnlyUtc(prev.date)}: ${toNumber(prev.balance!).toFixed(2)}) — a statement in between may be missing.`,
            );
        }
    }

    const report: ImportReport = {
        importId: null, inserted: fresh.length, skipped, beforeLock,
        continuityBreaks: cont.breaks.length, warnings, fromDate, toDate,
    };
    if (input.dryRun) return report;
    if (fresh.length === 0) throw new BankReconError("Every line in this file is already saved — nothing new to import.", 409);

    const closing = [...kept].reverse().find((r) => r.balance != null)?.balance ?? null;
    const created = await prisma.$transaction(async (tx) => {
        const imp = await tx.bankStatementImport.create({
            data: {
                accountId,
                fileName: input.fileName.slice(0, 200),
                fileHash: input.fileHash,
                profile: input.profile,
                bankAccountNumber: stNo,
                ifsc: input.meta.ifsc ?? null,
                fromDate: fromDate ? startOfDayUtc(fromDate) : null,
                toDate: toDate ? startOfDayUtc(toDate) : null,
                openingBalance: input.meta.openingBalance ?? null,
                closingBalance: closing,
                lineCount: fresh.length,
                skippedCount: skipped,
                beforeLock,
                importedById: userId,
            },
            select: { id: true },
        });
        await tx.bankStatementLine.createMany({
            data: fresh.map(({ row, print, seq }) => ({
                importId: imp.id,
                accountId,
                seq,
                date: startOfDayUtc(row.date),
                narration: row.narration.slice(0, 500),
                reference: row.reference,
                withdrawal: row.withdrawal,
                deposit: row.deposit,
                balance: row.balance,
                fingerprint: print,
            })),
        });
        return imp;
    });
    report.importId = created.id;
    return report;
}

export async function removeImport(accountId: number, importId: number): Promise<{ lines: number }> {
    const account = await loadBankLedger(accountId);
    const imp = await prisma.bankStatementImport.findFirst({
        where: { id: importId, accountId },
        select: { id: true, lineCount: true, fromDate: true },
    });
    if (!imp) throw new BankReconError("Upload not found", 404);
    if (imp.fromDate && isLocked(toDateOnlyUtc(imp.fromDate), account.lock)) {
        throw new BankReconError("This upload reaches into the reconciled lock and cannot be removed. Clear the lock first.");
    }
    await prisma.bankStatementImport.delete({ where: { id: imp.id } });   // lines + matches cascade
    return { lines: imp.lineCount };
}

// ── Matching ─────────────────────────────────────────────────────────────────

type GlCandidate = { id: number; date: string; type: "DEBIT" | "CREDIT"; amount: number; text: string; tokens: Set<string> };
type StCandidate = { id: number; date: string; deposit: number | null; withdrawal: number | null; tokens: string[] };

/**
 * Pure pairing: for each statement line, the one book entry on the SAME DAY for
 * the SAME AMOUNT, same direction. Nothing else is ever a match: a book entry
 * must carry the date the bank shows (owner, 2026-10-01 — "we must entry on
 * same day same amount strictly"). When the book date is wrong, the screen
 * points at it by a shared reference instead, and the date is corrected.
 *
 * Two same-day entries for the same amount: a shared reference token (UTR,
 * UPI/IMPS ref, cheque number) picks between them. A tie on that too is left
 * alone — guessing wrong is worse than leaving it for a person.
 */
export function planAutoMatch(statement: StCandidate[], gl: GlCandidate[]): Array<[number, number]> {
    const claimed = new Set<number>();
    const pairs: Array<[number, number]> = [];
    const sorted = [...statement].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    for (const s of sorted) {
        const amount = s.deposit ?? s.withdrawal;
        if (amount == null) continue;
        const wantType = s.deposit != null ? "DEBIT" : "CREDIT";
        const cands = gl
            .filter((g) => !claimed.has(g.id) && g.type === wantType && Math.abs(g.amount - amount) < EPS && g.date === s.date)
            .map((g) => ({ g, ref: s.tokens.some((t) => g.tokens.has(t) || g.text.includes(t.toLowerCase())) ? 1 : 0 }))
            .sort((a, b) => b.ref - a.ref);
        if (cands.length === 0) continue;
        if (cands.length > 1 && cands[0].ref === cands[1].ref) continue;
        claimed.add(cands[0].g.id);
        pairs.push([s.id, cands[0].g.id]);
    }
    return pairs;
}

export async function runAutoMatch(accountId: number, userId: number, fromIso: string, toIso: string) {
    const account = await loadBankLedger(accountId);
    const from = startOfDayUtc(fromIso);
    const to = endOfDayUtc(toIso);

    return prisma.$transaction(async (tx) => {
        // Stale matches go first — their statement lines are open again.
        const { matches, staleGroups } = await loadMatchState(accountId, tx);
        if (staleGroups.size) {
            await tx.bankStatementMatch.deleteMany({ where: { groupId: { in: [...staleGroups] } } });
        }
        const live = matches.filter((m) => !staleGroups.has(m.groupId));
        const matchedSt = new Set(live.map((m) => m.statementLineId));
        const matchedGl = new Set(live.map((m) => m.glLineId));

        // Sequential: one transaction is one connection (pg 9 refuses parallel queries on it).
        const stRows = await tx.bankStatementLine.findMany({
            where: { accountId, date: { gte: from, lte: to } },
            select: { id: true, date: true, deposit: true, withdrawal: true, narration: true, reference: true },
        });
        const glRows = await tx.voucherGlLine.findMany({
            where: {
                accountId,
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
            },
            select: glLineSelect(),
        });
        const cover = await loadOpeningCover(accountId, tx);
        const glVisible = collapseEditReversals(glRows);

        const statement: StCandidate[] = stRows
            .filter((s) => !matchedSt.has(s.id) && !isLocked(toDateOnlyUtc(s.date), account.lock) && !inOpening(toDateOnlyUtc(s.date), cover))
            .map((s) => ({
                id: s.id,
                date: toDateOnlyUtc(s.date),
                deposit: s.deposit != null ? toNumber(s.deposit) : null,
                withdrawal: s.withdrawal != null ? toNumber(s.withdrawal) : null,
                tokens: referenceTokensOf(s.reference, s.narration),
            }));
        const gl: GlCandidate[] = glVisible
            .filter((g) => !matchedGl.has(g.id) && !isLocked(toDateOnly(g.universalVoucher.date), account.lock))
            .map((g) => {
                const text = `${g.universalVoucher.description ?? ""} ${g.universalVoucher.narration ?? ""}`;
                return {
                    id: g.id,
                    date: toDateOnly(g.universalVoucher.date),
                    type: g.type,
                    amount: toNumber(g.amount),
                    text: `${g.reference ?? ""} ${text}`.toLowerCase(),
                    tokens: new Set(referenceTokensOf(g.reference, text)),
                };
            });

        const pairs = planAutoMatch(statement, gl);
        if (pairs.length) {
            await tx.bankStatementMatch.createMany({
                data: pairs.map(([statementLineId, glLineId]) => ({
                    groupId: randomUUID(), statementLineId, glLineId, auto: true, createdById: userId,
                })),
            });
        }
        return { matched: pairs.length, staleCleared: staleGroups.size, statementOpen: statement.length - pairs.length };
    }, { timeout: 30_000 });
}

export async function createMatch(accountId: number, userId: number, statementLineIds: number[], glLineIds: number[]) {
    const account = await loadBankLedger(accountId);
    if (statementLineIds.length === 0 || glLineIds.length === 0) throw new BankReconError("Pick at least one line on each side.");

    return prisma.$transaction(async (tx) => {
        // Sequential: one transaction is one connection (pg 9 refuses parallel queries on it).
        const st = await tx.bankStatementLine.findMany({
            where: { id: { in: statementLineIds }, accountId },
            select: { id: true, date: true, deposit: true, withdrawal: true },
        });
        const gl = await tx.voucherGlLine.findMany({
            where: { id: { in: glLineIds }, accountId, universalVoucher: { ...ledgerStatusFilterUv() } },
            select: { id: true, type: true, amount: true, universalVoucher: { select: { id: true, date: true, voucherNo: true } } },
        });
        const taken = await tx.bankStatementMatch.findMany({
            where: { OR: [{ statementLineId: { in: statementLineIds } }, { glLineId: { in: glLineIds } }] },
            select: { groupId: true, statementLineId: true, glLineId: true },
        });
        const cover = await loadOpeningCover(accountId, tx);
        if (st.length !== statementLineIds.length) throw new BankReconError("A statement line was not found on this ledger.");
        if (gl.length !== glLineIds.length) throw new BankReconError("A book entry was not found on this ledger, or its voucher is not posted.");
        for (const s of st) if (isLocked(toDateOnlyUtc(s.date), account.lock)) throw new BankReconError("A statement line is before the reconciled lock.");
        for (const s of st) if (inOpening(toDateOnlyUtc(s.date), cover)) throw new BankReconError("A statement line is already inside the opening balance — there is nothing in the books to match it to.");
        for (const g of gl) if (isLocked(toDateOnly(g.universalVoucher.date), account.lock)) throw new BankReconError("A book entry is before the reconciled lock.");

        // Same day, strictly: a book entry carries the date the bank shows it on.
        const bankDays = [...new Set(st.map((s) => toDateOnlyUtc(s.date)))];
        if (bankDays.length > 1) throw new BankReconError("These statement lines are on different days — match one day at a time.");
        const offDay = gl.filter((g) => toDateOnly(g.universalVoucher.date) !== bankDays[0]);
        if (offDay.length) {
            const g = offDay[0];
            throw new BankReconError(
                `The bank shows this on ${formatDate(bankDays[0])}, but ${g.universalVoucher.voucherNo ?? formatUvNo(g.universalVoucher.id)} is dated ${formatDate(toDateOnly(g.universalVoucher.date))}. Set the book entry's date to ${formatDate(bankDays[0])} first.`,
            );
        }

        // Already matched? Only a stale match may be replaced.
        if (taken.length) {
            const { staleGroups } = await loadMatchState(accountId, tx);
            const liveTaken = taken.filter((t) => !staleGroups.has(t.groupId));
            if (liveTaken.length) throw new BankReconError("One of these lines is already matched. Unmatch it first.");
            await tx.bankStatementMatch.deleteMany({ where: { groupId: { in: [...new Set(taken.map((t) => t.groupId))] } } });
        }

        const stNet = st.reduce((s, r) => s + (r.deposit != null ? toNumber(r.deposit) : 0) - (r.withdrawal != null ? toNumber(r.withdrawal) : 0), 0);
        const glNet = gl.reduce((s, r) => s + (r.type === "DEBIT" ? toNumber(r.amount) : -toNumber(r.amount)), 0);
        if (Math.abs(money2(stNet) - money2(glNet)) >= EPS) {
            throw new BankReconError(`The two sides do not agree: statement ${money2(stNet).toFixed(2)}, books ${money2(glNet).toFixed(2)}.`);
        }

        const groupId = randomUUID();
        await tx.bankStatementMatch.createMany({
            data: statementLineIds.flatMap((statementLineId) =>
                glLineIds.map((glLineId) => ({ groupId, statementLineId, glLineId, auto: false, createdById: userId })),
            ),
        });
        return { groupId, pairs: statementLineIds.length * glLineIds.length };
    });
}

export async function removeMatchGroup(accountId: number, groupId: string) {
    const account = await loadBankLedger(accountId);
    const rows = await prisma.bankStatementMatch.findMany({
        where: { groupId, statementLine: { accountId } },
        select: { id: true, glLineId: true, statementLine: { select: { date: true } } },
    });
    if (rows.length === 0) throw new BankReconError("Match not found", 404);
    for (const r of rows) {
        if (isLocked(toDateOnlyUtc(r.statementLine.date), account.lock)) throw new BankReconError("This match is inside the reconciled lock.");
    }
    const glIds = [...new Set(rows.map((r) => r.glLineId))];
    const glDates = await prisma.voucherGlLine.findMany({
        where: { id: { in: glIds } },
        select: { universalVoucher: { select: { date: true } } },
    });
    for (const g of glDates) {
        if (isLocked(toDateOnly(g.universalVoucher.date), account.lock)) throw new BankReconError("This match is inside the reconciled lock.");
    }
    const { count } = await prisma.bankStatementMatch.deleteMany({ where: { groupId } });
    return { removed: count };
}

/**
 * The bank is the truth: a lock may not advance past a statement line nobody
 * has explained. Book entries the bank has not shown are allowed through —
 * that is what "cheque issued, not presented" means.
 */
export async function assertLockAllowed(accountId: number, throughIso: string): Promise<void> {
    // Lines already inside the proven opening balance are explained, not open.
    const [{ matches, staleGroups }, cover] = await Promise.all([loadMatchState(accountId), loadOpeningCover(accountId)]);
    const matchedSt = new Set(matches.filter((m) => !staleGroups.has(m.groupId)).map((m) => m.statementLineId));
    const lines = await prisma.bankStatementLine.findMany({
        where: { accountId, date: { lte: endOfDayUtc(throughIso) } },
        select: { id: true, date: true },
    });
    const open = lines.filter((l) => !matchedSt.has(l.id) && !inOpening(toDateOnlyUtc(l.date), cover));
    if (open.length) {
        const first = open.map((l) => toDateOnlyUtc(l.date)).sort()[0];
        throw new BankReconError(`${open.length} statement line(s) up to that date are not matched or booked yet — the first is on ${first}.`, 409);
    }
}
