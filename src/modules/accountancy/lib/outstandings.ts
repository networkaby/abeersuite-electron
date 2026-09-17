// Outstandings computation — shared between Receivables, Payables, and Ledger
// outstanding reports. Walks the AccountGroup hierarchy under "Sundry Debtors"
// or "Sundry Creditors", collects open Invoice and Voucher rows, subtracts what
// has been linked against them, and buckets the outstanding by age.
//
// The netting itself lives in `billLink.ts` (`sumLinked`) — one symmetric,
// alive-filtered rule shared with the bill-wise link popup. Symmetric matters
// here: when a purchase is settled against a sale for a party who is both our
// customer and our supplier, the purchase sits on the SOURCE side of that link,
// and a target-only sum would leave it showing as fully open. Alive-filtered
// matters because a cancelled or deleted receipt must stop clearing its bill.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { sumLinked, loadPartyUnallocated } from "./billLink";
import { ledgerStatusFilterUv } from "./ledgerStatus";
import { autoLinkOrder, dueDateOf } from "./billLinkPlan";
import { OPENING_TYPE } from "./openingBills";
import { accountIdsUnderGroup } from "./accountGroups";
import { round2 } from "@/shared/lib/format/moneyInr";

export type AgeingBucket = "b0_30" | "b30_60" | "b60_90" | "b90_plus";

export type Buckets = Record<AgeingBucket, number>;

export type OutstandingBill = {
    // "sale" / "purchase" — InvVoucher (SALE / POS / PURCHASE)
    // "voucher"           — finance Voucher (CREDIT_NOTE / DEBIT_NOTE)
    // The legacy "invoice" kind was retired with the Invoice → InvVoucher
    // consolidation (2026-05-24).
    kind:        "voucher" | "sale" | "purchase";
    id:          number;
    /** The spine id — what a bill-wise link points at. `id` above is the id the
     *  row's drill-down link needs (detail id for sale/purchase), which is a
     *  different id space, so both are carried. Null only for pre-Phase-5 rows. */
    universalVoucherId: number | null;
    /** The spine's voucher type (SALE / POS / PURCHASE / CREDIT_NOTE / …) — what
     *  `referenceHref` needs to build the row's drill-down link, and what tells a
     *  reader which side of a dual-role party's book the row belongs to. */
    voucherType: string;
    ref:         string;
    billDate:    string;
    dueDate:     string;
    totalAmount: number;
    paid:        number;
    outstanding: number;
    daysOverdue: number;
    bucket:      AgeingBucket;
    /** Which way this bill's money runs, read off the party's own leg:
     *  `1` they owe us (a receipt settles it), `-1` we owe them (a payment
     *  does). A group report already knows its side, but a single party's
     *  screen shows both at once and has to ask the bill. */
    side:        1 | -1;
};

export type PartyOutstanding = {
    accountId:        number;
    accountName:      string;
    /** Everything the report's search box may match on, lower-cased and joined:
     *  party name, GSTIN and every phone number of the party. The
     *  bill rows add their own voucher no on top. Built once here so the screen
     *  filters with a single `includes` and never goes back to the DB to search. */
    searchKey:        string;
    personId:       number | null;
    companyId:        number | null;
    totalOutstanding: number;
    buckets:          Buckets;
    billCount:        number;
    /** Money on this party that a bill on the OTHER side could settle right now.
     *  0 means there is nothing to match, however overdue the bills are — so a
     *  list can stay quiet instead of inviting a click that finds nothing. */
    toLink:           number;
};

export type OutstandingBillFlat = OutstandingBill & {
    accountId:   number;
    accountName: string;
    searchKey:   string;
};

export type OutstandingsReport = {
    asOf:             string;
    groupName:        string;
    parties:          PartyOutstanding[];
    bills:            OutstandingBillFlat[];
    totalOutstanding: number;
    buckets:          Buckets;
};

export type LedgerOutstanding = {
    accountId:        number;
    accountName:      string;
    asOf:             string;
    bills:            OutstandingBill[];
    totalOutstanding: number;
    buckets:          Buckets;
    /** See `PartyOutstanding.toLink`. */
    toLink:           number;
};

const EMPTY_BUCKETS: Buckets = { b0_30: 0, b30_60: 0, b60_90: 0, b90_plus: 0 };

function emptyBuckets(): Buckets {
    return { ...EMPTY_BUCKETS };
}

function daysBetween(a: Date, b: Date): number {
    const ms = b.getTime() - a.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
}

function bucketFor(days: number): AgeingBucket {
    if (days <= 30) return "b0_30";
    if (days <= 60) return "b30_60";
    if (days <= 90) return "b60_90";
    return "b90_plus";
}

/**
 * Phase 4 G4b: the role=TENDER GL lines for each given journal entry, read from
 * the universal-voucher spine, keyed by the LEGACY JE id — a drop-in for the old
 * `InvVoucherTender.findMany` grouped by InvVoucher. Callers apply the non-AR
 * filter themselves (each knows its bill's AR-party account). Accepts the global
 * client or a tx.
 *
 * TRUST THIS TAG ONLY WHERE THERE IS NOTHING BETTER. New posts are tagged at
 * write time by the GL builder, but a tag is not the ledger and three kinds of
 * voucher have none:
 *
 *   • imported vouchers, which never had tender rows to tag in the first place;
 *   • anything posted before role-tagging existed. (This comment used to promise
 *     a `backfillTenderRoles` helper would have fixed those. No such helper
 *     exists anywhere in the repo — only this sentence survived it.)
 *   • until 2026-09-16, ANY voucher that had ever been edited: the edit path
 *     rebuilt its GL lines and silently dropped `role`, so a single edit untagged
 *     a bill for good. That is fixed at source (`glLineRow` is now the one
 *     mapper), but it cannot be undone for vouchers already edited.
 *
 * Nothing can rebuild a lost tag, because a tag has no ledger leg behind it. So
 * where the party's OWN leg can answer the question instead, read that — it
 * cannot be forgotten the way a tag can. `loadOpenBills` below does exactly that
 * and keeps this reading only as a fallback for pre-Phase-5 rows with no spine.
 */
export async function loadTenderLines(
    db: Prisma.TransactionClient,
    universalVoucherIds: number[],
): Promise<Map<number, { accountId: number; amount: number }[]>> {
    const out = new Map<number, { accountId: number; amount: number }[]>();
    const ids = [...new Set(universalVoucherIds)];
    if (ids.length === 0) return out;
    const lines = await db.voucherGlLine.findMany({
        where:  { role: "TENDER", universalVoucherId: { in: ids } },
        select: { accountId: true, amount: true, universalVoucherId: true },
    });
    for (const l of lines) {
        const arr = out.get(l.universalVoucherId) ?? [];
        arr.push({ accountId: l.accountId, amount: Number(l.amount) });
        out.set(l.universalVoucherId, arr);
    }
    return out;
}

/**
 * Every one of these parties' own legs on these bills, keyed `accountId:spineId`
 * and signed debit-positive. One query for the whole report — the per-bill
 * alternative is a query per row, which this report cannot afford.
 */
async function loadPartyLegsFor(
    accountIds: number[],
    spineIds: number[],
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (accountIds.length === 0 || spineIds.length === 0) return out;
    const lines = await prisma.voucherGlLine.findMany({
        where: {
            accountId:          { in: accountIds },
            universalVoucherId: { in: [...new Set(spineIds)] },
            universalVoucher:   ledgerStatusFilterUv(),
        },
        select: { accountId: true, universalVoucherId: true, type: true, amount: true },
    });
    for (const l of lines) {
        const key = `${l.accountId}:${l.universalVoucherId}`;
        const delta = l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount);
        out.set(key, round2((out.get(key) ?? 0) + delta));
    }
    return out;
}

type RawBill = {
    kind:        OutstandingBill["kind"];
    id:          number;
    universalVoucherId: number | null;
    voucherType: string;
    accountId:   number;
    ref:         string;
    billDate:    Date;
    dueDate:     Date;
    totalAmount: number;
    paid:        number;
    side:        1 | -1;
};

// `invType` controls which side of inventory vouchers we sweep in:
//   "SALE"     — for Receivables (debtors, customers owe us)
//   "PURCHASE" — for Payables    (creditors, we owe vendors)
//   "BOTH"     — for single-ledger drill-down (show whatever's open against
//                this party regardless of direction)
async function loadOpenBills(
    accountIds: number[],
    asOf: Date,
    invType: "SALE" | "PURCHASE" | "BOTH",
): Promise<RawBill[]> {
    if (accountIds.length === 0) return [];

    const [vouchers, accounts] = await Promise.all([
        // Only bill-shaped vouchers (CREDIT_NOTE / DEBIT_NOTE) count as
        // outstanding here. RECEIPT / PAYMENT are settlements — they appear
        // in VoucherAllocation as `sourceType=VOUCHER` and nett against the
        // bill's JE; including them again as "open bills" would double-count
        // them as false positives. CONTRA / JOURNAL never sit against a party.
        // Phase 5 5E: bill-shaped finance vouchers ARE spines now. Total is computed
        // from the debit legs (no stored totalAmount on the spine).
        prisma.universalVoucher.findMany({
            where: {
                partyAccountId: { in: accountIds },
                // OPENING joins them. `openingBills.ts` turns a party's carried-
                // over balance into a real posted voucher precisely so it can be
                // aged and settled like any other bill — but it has no
                // VoucherDetail, so the inventory sweep further down can never
                // see it. Left out of here it linked fine in the popup and was
                // simply missing from Receivables and Payables: two views
                // disagreeing about the same money.
                type:           { in: ["CREDIT_NOTE", "DEBIT_NOTE", OPENING_TYPE] },
                deletedAt:      null,
                status:         { not: "CANCELLED" },
                date:           { lte: asOf },
            },
            select: {
                id: true, partyAccountId: true, voucherNo: true, date: true, type: true,
                lines: { select: { accountId: true, type: true, amount: true } },
            },
        }),
        prisma.account.findMany({
            where:  { id: { in: accountIds } },
            select: { id: true, personId: true, companyId: true },
        }),
    ]);

    const vchIds = vouchers.map((v) => v.id);

    // Build identity → account maps so we can resolve InvVoucher.partyId back
    // to the matching ledger row.
    const personToAcc: Record<number, number> = {};
    const companyToAcc:  Record<number, number> = {};
    for (const a of accounts) {
        if (a.personId !== null) personToAcc[a.personId] = a.id;
        if (a.companyId  !== null) companyToAcc[a.companyId]   = a.id;
    }
    const personIds = Object.keys(personToAcc).map(Number);
    const companyIds  = Object.keys(companyToAcc).map(Number);

    // OR-match clauses for the InvVoucher lookup. Phase 5 5D-4: the live party
    // link is on the spine (universalVoucher.partyAccountId); legacy rows are
    // resolved via the partyType+partyId pair against the identity maps.
    const partyOr: Array<
        | { universalVoucher: { partyAccountId: { in: number[] } } }
        | { partyType: string; partyId: { in: number[] } }
    > = [];
    partyOr.push({ universalVoucher: { partyAccountId: { in: accountIds } } });
    if (personIds.length > 0) partyOr.push({ partyType: "customer", partyId: { in: personIds } });
    if (companyIds.length  > 0) partyOr.push({ partyType: "company",  partyId: { in: companyIds  } });

    // POS InvVouchers carry AR exactly like a SALE — only their settlement
    // flow differs (immediate receipt voucher at the counter). They must
    // count as receivables-side bills so credit-on-POS sales (partial
    // payments, future feature) show up correctly here, and so the
    // PaidByJe allocation logic can net them out for cash-paid POS.
    const saleSideTypes = ["SALE", "POS"] as const;
    const purchaseSideTypes = ["PURCHASE"] as const;
    const invTypeFilter = invType === "BOTH"
        ? { in: [...saleSideTypes, ...purchaseSideTypes] }
        : invType === "SALE"
            ? { in: [...saleSideTypes] }
            : { in: [...purchaseSideTypes] };
    const invVouchers = accountIds.length === 0 ? [] : await prisma.voucherDetail.findMany({
        where: {
            // 5D-8 lifecycle + 5D-10 date + 5D-11 type on spine
            universalVoucher: { status: "POSTED", deletedAt: null, date: { lte: asOf }, type: invTypeFilter },
            OR: partyOr,
        },
        select: {
            id: true,
            totalAmount: true,
            universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true, type: true } },   // 5D-4 party + 5D-6 ref + 5D-10 date + 5D-11 type
            partyType: true, partyId: true, universalVoucherId: true,
            creditPeriodDays: true,
        },
    });

    // Settlements + tenders read off the universal-voucher spine, keyed by the
    // bill's universalVoucherId (G5 — the direct spine link, replaces the JE hop).
    const uvIds = invVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);

    const [paidByVch, tendersBySpine, paidBySpine, partyLegs] = await Promise.all([
        // CREDIT_NOTE/DEBIT_NOTE bill settlements — spine ids, link counted from either side.
        sumLinked(prisma, vchIds),
        // Up-front tenders via the spine (role=TENDER), keyed by universalVoucherId.
        loadTenderLines(prisma, uvIds),
        // Later settlements against the bill's spine row, from either side of the link.
        sumLinked(prisma, uvIds),
        // What each party's OWN leg on the bill says — the same reading the
        // bill-wise popup trusts. See the note over `legOf` below.
        loadPartyLegsFor(accountIds, uvIds),
    ]);

    /** `${accountId}:${spineId}` → signed party leg (debit positive). */
    const legOf = (accountId: number, spineId: number | null): number | null =>
        spineId === null ? null : partyLegs.get(`${accountId}:${spineId}`) ?? 0;

    const bills: RawBill[] = [];

    for (const v of vouchers) {
        if (v.partyAccountId === null) continue;

        let totalAmount = v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);

        // The party's own leg says which way this one runs — debit = they owe
        // us, credit = we owe them. A debit note debits the party and a credit
        // note credits them, so the fallback follows the type when a row has
        // no readable party leg at all.
        const leg = v.lines
            .filter((l) => l.accountId === v.partyAccountId)
            .reduce((s, l) => s + (l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount)), 0);
        const side: 1 | -1 = Math.abs(leg) > 0.005
            ? (leg > 0 ? 1 : -1)
            : (v.type === "CREDIT_NOTE" ? -1 : 1);

        if (v.type === OPENING_TYPE) {
            // An opening is worth what the PARTY leg says, not what the debit
            // legs add up to: its other side is Suspense, so on a payable
            // opening the debit leg is the suspense one. The leg's direction is
            // also the only thing that says which report the row belongs in —
            // debit = they owe us, credit = we owe them.
            if (Math.abs(leg) <= 0.005) continue;
            const legSide = leg > 0 ? "SALE" : "PURCHASE";
            if (invType !== "BOTH" && invType !== legSide) continue;
            totalAmount = Math.abs(leg);
        }

        bills.push({
            kind:        "voucher",
            id:          v.id,
            universalVoucherId: v.id,
            voucherType: v.type,
            accountId:   v.partyAccountId,
            ref:         v.voucherNo ?? formatUvNo(v.id),
            billDate:    v.date,
            dueDate:     dueDateOf(v.date),
            totalAmount,
            paid:        paidByVch[v.id] ?? 0,
            side,
        });
    }

    for (const v of invVouchers) {
        // Prefer the spine's live party link (5D-4); fall back to the legacy
        // partyType+partyId resolution dance for old rows.
        const accountId = v.universalVoucher?.partyAccountId
            ?? (v.partyId === null
                ? null
                : v.partyType === "customer"
                    ? personToAcc[v.partyId] ?? null
                    : v.partyType === "company"
                        ? companyToAcc[v.partyId] ?? null
                        : null);
        if (accountId === null) continue;
        const due = dueDateOf(v.universalVoucher!.date, v.creditPeriodDays);   // 5D-10: date on spine
        const total = Number(v.totalAmount);
        // Paid at sale time = sum of non-AR tenders on this voucher
        // (cash / bank / card / wallet). The AR tender row IS the
        // unsettled remainder; later Receipt vouchers chip away at it
        // via the VoucherAllocation → journalEntryId chain (paidByJe).
        //
        // What is still open is what the PARTY'S OWN LEG on this bill says, less
        // what has since been linked against it — the same rule `billLink.ts`
        // uses, so this report and the bill-wise popup can never disagree.
        //
        // The older reading (invoice total − legs tagged `role=TENDER`) trusted a
        // tag: a cash sale posted before tender-tagging has its cash leg untagged
        // and NO party leg at all, so the whole invoice was reported as money owed
        // by a customer who never owed it. A leg cannot be forgotten the way a tag
        // can — if the party owes nothing, there is nothing on their ledger to read.
        //
        // Bills with no spine (pre-Phase-5 rows) have no legs to read, so they keep
        // the tender reading; there is nothing better available for them.
        const signed = legOf(accountId, v.universalVoucherId);
        const linkedOnSpine = v.universalVoucherId !== null ? (paidBySpine[v.universalVoucherId] ?? 0) : 0;
        let paid: number;
        if (signed !== null) {
            // Direction is the leg's own: a debit is money owed to us (sale side),
            // a credit is money we owe (purchase side). A leg pointing the other
            // way belongs in the other report, not this one.
            const wantSide = v.universalVoucher!.type === "PURCHASE" ? -1 : 1;
            const legSide = signed > 0.005 ? 1 : signed < -0.005 ? -1 : 0;
            if (legSide !== wantSide) continue;
            const open = round2(Math.abs(signed) - linkedOnSpine);
            if (open <= 0.005) continue;
            paid = round2(total - open);
        } else {
            const vTenders = v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [];
            const paidAtSale = vTenders
                .filter((t) => t.accountId !== accountId)
                .reduce((s, t) => s + t.amount, 0);
            paid = paidAtSale + linkedOnSpine;
        }
        bills.push({
            kind:        v.universalVoucher!.type === "SALE" || v.universalVoucher!.type === "POS" ? "sale" : "purchase",
            id:          v.id,
            universalVoucherId: v.universalVoucherId,
            voucherType: v.universalVoucher!.type,
            accountId,
            ref:         v.universalVoucher?.voucherNo ?? "",
            billDate:    v.universalVoucher!.date,   // 5D-10
            dueDate:     due,
            totalAmount: total,
            paid,
            // A sale is money coming to us, a purchase money going out — and a
            // bill whose party leg disagreed with that was dropped above, so the
            // type is a safe reading of the side by the time we get here.
            side:        v.universalVoucher!.type === "PURCHASE" ? -1 : 1,
        });
    }

    return bills;
}

// FIFO accessor for POS collect-on-the-go. Returns this customer's OPEN
// sale-side bills (SALE / POS), oldest-first, each with the journalEntryId a
// Receipt voucher allocates against. Self-contained and `tx`-aware so it can run
// inside the sale transaction. The shared `OutstandingBill` shape drops
// journalEntryId, which is why FIFO needs its own accessor.
//
// IT NO LONGER MATCHES `loadOpenBills`, whatever this comment used to claim.
// Since 30fa4e4f the report reads each bill's PARTY LEG; this still reads
// `total − role=TENDER lines − links`. Two consequences worth knowing before
// trusting it:
//
//   • A bill whose tender tags were lost — imported, pre-tagging, or edited
//     before `glLineRow` became the one GL mapper — reads as FULLY OPEN here
//     even when it was paid in cash. The report, reading the leg, gets it right.
//   • `type: { in: ["SALE", "POS"] }` below means bill-wise OPENING vouchers are
//     invisible to it, so counter surplus can never clear a carried-forward
//     balance. Every party on live was converted to bill-wise openings on
//     2026-09-16, so that is not a corner case any more.
//
// `planAutoLink` (autoLinkPlan.ts) is the newer reading — party-leg based, both
// sides, openings included — and is what the counter receipt panel and the
// office form now use. Moving this path onto it would fix both points above, but
// it changes how a live till allocates money, so it is a deliberate decision and
// not a drive-by edit.
export async function getOpenSaleBillsForFifo(
    tx: Prisma.TransactionClient,
    accountId: number,
    asOf: Date = new Date(),
): Promise<{ universalVoucherId: number; outstanding: number; billDate: Date; ref: string }[]> {
    const account = await tx.account.findUnique({
        where:  { id: accountId },
        select: { id: true, personId: true, companyId: true },
    });
    if (!account) return [];

    // Same OR-match as loadOpenBills: the live party link is on the spine (5D-4);
    // legacy rows resolve via partyType+partyId against the identity maps.
    const partyOr: Array<
        | { universalVoucher: { partyAccountId: { in: number[] } } }
        | { partyType: string; partyId: { in: number[] } }
    > = [{ universalVoucher: { partyAccountId: { in: [accountId] } } }];
    if (account.personId !== null) partyOr.push({ partyType: "customer", partyId: { in: [account.personId] } });
    if (account.companyId !== null) partyOr.push({ partyType: "company", partyId: { in: [account.companyId] } });

    const invVouchers = await tx.voucherDetail.findMany({
        where: {
            // 5D-8 lifecycle + 5D-10 date + 5D-11 type on spine
            universalVoucher: { status: "POSTED", deletedAt: null, date: { lte: asOf }, type: { in: ["SALE", "POS"] } },
            OR:        partyOr,
        },
        select: {
            id: true,
            totalAmount: true, universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } },   // 5D-4 + 5D-6 + 5D-10 date
            partyType: true, partyId: true, universalVoucherId: true,
            creditPeriodDays: true,
        },
    });

    const uvIds = invVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);

    const [tendersBySpine, paidBySpine] = await Promise.all([
        // Up-front tenders via the spine (role=TENDER), keyed by universalVoucherId.
        loadTenderLines(tx, uvIds),
        // Later settlements against the bill's spine row, from either side of the link.
        sumLinked(tx, uvIds),
    ]);

    const out: { universalVoucherId: number; outstanding: number; billDate: Date; ref: string; dueDate: Date }[] = [];
    for (const v of invVouchers) {
        if (v.universalVoucherId === null) continue;
        const resolved = v.universalVoucher?.partyAccountId ?? accountId; // single-ledger scope — partyOr already matched
        const total = Number(v.totalAmount);
        const vTenders = tendersBySpine.get(v.universalVoucherId) ?? [];
        const paidAtSale = vTenders
            .filter((t) => t.accountId !== resolved)
            .reduce((s, t) => s + t.amount, 0);
        const paid = paidAtSale + (paidBySpine[v.universalVoucherId] ?? 0);
        const outstanding = total - paid;
        if (outstanding > 0.005) {
            out.push({
                universalVoucherId: v.universalVoucherId,
                outstanding,
                billDate: v.universalVoucher!.date,
                dueDate:  dueDateOf(v.universalVoucher!.date, v.creditPeriodDays),
                ref:      v.universalVoucher?.voucherNo ?? "",
            });
        }
    }
    // The SAME order the office's Auto button uses — overdue first, then nearest
    // due, smaller bill on a tie. It used to be oldest bill date here and
    // something else there, which meant a surplus at the counter cleared one bill
    // and the same surplus in the office cleared another. That is the kind of
    // difference a customer notices and nobody can explain.
    const byId = new Map(out.map((b) => [b.universalVoucherId, b]));
    return autoLinkOrder(out.map((b) => ({
        universalVoucherId: b.universalVoucherId,
        dueDate:            b.dueDate.toISOString(),
        open:               b.outstanding,
    }))).map((o) => byId.get(o.universalVoucherId)!);
}

function toOutstandingBill(raw: RawBill, asOf: Date): OutstandingBill | null {
    const outstanding = raw.totalAmount - raw.paid;
    if (outstanding <= 0.005) return null;
    const days = daysBetween(raw.billDate, asOf);
    return {
        kind:        raw.kind,
        id:          raw.id,
        universalVoucherId: raw.universalVoucherId,
        voucherType: raw.voucherType,
        ref:         raw.ref,
        billDate:    raw.billDate.toISOString(),
        dueDate:     raw.dueDate.toISOString(),
        totalAmount: raw.totalAmount,
        paid:        raw.paid,
        outstanding,
        daysOverdue: days,
        bucket:      bucketFor(days),
        side:        raw.side,
    };
}

/**
 * The searchable identifiers of each party account — name, GSTIN and phone
 * numbers — as one lower-cased blob per account id. Three small reads,
 * only the columns needed; the screen then searches without touching the DB.
 */
async function loadSearchKeys(
    accounts: { id: number; name: string; personId: number | null; companyId: number | null }[],
): Promise<Map<number, string>> {
    const personIds  = accounts.map((a) => a.personId).filter((v): v is number => v !== null);
    const companyIds = accounts.map((a) => a.companyId).filter((v): v is number => v !== null);

    const [persons, companies, phones] = await Promise.all([
        personIds.length === 0 ? [] : prisma.person.findMany({
            where:  { id: { in: personIds } },
            select: { id: true, gstin: true },
        }),
        companyIds.length === 0 ? [] : prisma.company.findMany({
            where:  { id: { in: companyIds } },
            select: { id: true, gstin: true, companyReg: true, taxId: true },
        }),
        personIds.length === 0 && companyIds.length === 0 ? [] : prisma.phone.findMany({
            where:  { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] },
            select: { phone: true, personId: true, companyId: true },
        }),
    ]);

    const personBits  = new Map<number, string[]>();
    const companyBits = new Map<number, string[]>();
    const push = (m: Map<number, string[]>, id: number, v: string | null) => {
        if (!v) return;
        const arr = m.get(id) ?? [];
        arr.push(v);
        m.set(id, arr);
    };
    for (const p of persons)   push(personBits, p.id, p.gstin);
    for (const c of companies) { push(companyBits, c.id, c.gstin); push(companyBits, c.id, c.companyReg); push(companyBits, c.id, c.taxId); }
    for (const ph of phones) {
        if (ph.personId  !== null) push(personBits,  ph.personId,  ph.phone);
        if (ph.companyId !== null) push(companyBits, ph.companyId, ph.phone);
    }

    const out = new Map<number, string>();
    for (const a of accounts) {
        const bits = [a.name];
        if (a.personId  !== null) bits.push(...(personBits.get(a.personId)   ?? []));
        if (a.companyId !== null) bits.push(...(companyBits.get(a.companyId) ?? []));
        out.set(a.id, bits.filter(Boolean).join(" ").toLowerCase());
    }
    return out;
}

export async function getOutstandings(
    groupName: "Sundry Debtors" | "Sundry Creditors",
    asOf: Date = new Date(),
): Promise<OutstandingsReport> {
    const accountIds = await accountIdsUnderGroup(groupName);
    if (accountIds.length === 0) {
        return {
            asOf:             asOf.toISOString(),
            groupName,
            parties:          [],
            bills:            [],
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
        };
    }

    const invType = groupName === ACCOUNT_GROUPS.SUNDRY_DEBTORS ? "SALE" : "PURCHASE";
    // Two more queries for the WHOLE report — the per-party alternative is
    // `loadLinkableDocs` four times over per row, which this report cannot afford.
    const [accounts, bills, unallocated] = await Promise.all([
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true, personId: true, companyId: true },
            orderBy: [{ name: "asc" }],
        }),
        loadOpenBills(accountIds, asOf, invType),
        loadPartyUnallocated(prisma, accountIds, { asOf }),
    ]);

    // Only the parties that actually have an open bill need search identifiers —
    // a group can hold thousands of ledgers and most of them are settled.
    const withBills = new Set(bills.map((b) => b.accountId));
    const searchKeys = await loadSearchKeys(accounts.filter((a) => withBills.has(a.id)));

    const partyMap = new Map<number, PartyOutstanding>();
    const accountNameMap = new Map<number, string>();
    for (const a of accounts) {
        partyMap.set(a.id, {
            accountId:        a.id,
            accountName:      a.name,
            searchKey:        searchKeys.get(a.id) ?? a.name.toLowerCase(),
            personId:       a.personId,
            companyId:        a.companyId,
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
            billCount:        0,
            toLink:           unallocated.get(a.id)?.toLink ?? 0,
        });
        accountNameMap.set(a.id, a.name);
    }

    const flatBills: OutstandingBillFlat[] = [];

    for (const raw of bills) {
        const bill = toOutstandingBill(raw, asOf);
        if (!bill) continue;
        const party = partyMap.get(raw.accountId);
        if (!party) continue;
        party.buckets[bill.bucket] += bill.outstanding;
        party.totalOutstanding     += bill.outstanding;
        party.billCount            += 1;
        flatBills.push({
            ...bill,
            accountId:   raw.accountId,
            accountName: accountNameMap.get(raw.accountId) ?? "",
            // The party's identifiers plus this bill's own reference number.
            searchKey:   `${searchKeys.get(raw.accountId) ?? ""} ${bill.ref}`.toLowerCase(),
        });
    }

    // Most-overdue first; oldest bills are the ones to chase.
    flatBills.sort((a, b) => b.daysOverdue - a.daysOverdue);

    const parties = Array.from(partyMap.values())
        .filter((p) => p.totalOutstanding > 0.005)
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    const totalBuckets = emptyBuckets();
    let totalOutstanding = 0;
    for (const p of parties) {
        totalOutstanding   += p.totalOutstanding;
        totalBuckets.b0_30    += p.buckets.b0_30;
        totalBuckets.b30_60   += p.buckets.b30_60;
        totalBuckets.b60_90   += p.buckets.b60_90;
        totalBuckets.b90_plus += p.buckets.b90_plus;
    }

    return {
        asOf: asOf.toISOString(),
        groupName,
        parties,
        bills: flatBills,
        totalOutstanding,
        buckets: totalBuckets,
    };
}

export async function getLedgerOutstanding(
    accountId: number,
    asOf: Date = new Date(),
): Promise<LedgerOutstanding | null> {
    const account = await prisma.account.findUnique({
        where:  { id: accountId },
        select: { id: true, name: true },
    });
    if (!account) return null;

    const [bills, unallocated] = await Promise.all([
        loadOpenBills([accountId], asOf, "BOTH"),
        loadPartyUnallocated(prisma, [accountId], { asOf }),
    ]);
    const buckets = emptyBuckets();
    let totalOutstanding = 0;
    const out: OutstandingBill[] = [];

    for (const raw of bills) {
        const bill = toOutstandingBill(raw, asOf);
        if (!bill) continue;
        out.push(bill);
        buckets[bill.bucket] += bill.outstanding;
        totalOutstanding     += bill.outstanding;
    }

    out.sort((a, b) => +new Date(b.billDate) - +new Date(a.billDate));

    return {
        accountId:   account.id,
        accountName: account.name,
        asOf:        asOf.toISOString(),
        bills:       out,
        totalOutstanding,
        buckets,
        toLink:      unallocated.get(accountId)?.toLink ?? 0,
    };
}
