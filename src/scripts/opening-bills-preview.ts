// What WOULD change if party opening balances became real vouchers.
//
// Today `Account.openingBalance` is a number on the master with no GL lines
// behind it. Reports add it on top at display time — `recompute-balances.ts`
// says so out loud: "Master openings are NOT included [in Account.balance] —
// they live at display time, not stored in `balance`."
//
// That has two consequences worth seeing BEFORE converting anything:
//
//   1. An opening balance is invisible to Receivables, Payables and bill-wise
//      linking, because all three read GL legs. Money owed from before the books
//      began simply does not appear as outstanding.
//   2. Turning it into a real voucher fixes that — but it also moves
//      `Account.balance`, and `checkCreditLimit` reads exactly that field. A
//      customer who looks clear today can start hitting their credit limit at
//      the counter. That is correct accounting, and it is still a live
//      behaviour change, so it should be a decision rather than a surprise.
//
// This script writes NOTHING. It reports both.
//
//   pnpm opening:preview

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Mirrors balance.ts — inlined, exactly as recompute-balances.ts does. */
function balanceDelta(nb: "DEBIT" | "CREDIT", entryType: "DEBIT" | "CREDIT", amount: number): number {
    return nb === entryType ? amount : -amount;
}

const money = (n: number) => n.toFixed(2).padStart(12);

async function main(): Promise<void> {
    const groups = await prisma.accountGroup.findMany({
        where: { isActive: true },
        select: { id: true, name: true, parentId: true },
    });
    // Track which ROOT each group descends from: "positive balance" means the
    // party owes us under Debtors and that we owe them under Creditors, so a
    // report that mixed the two would be telling two different stories at once.
    const rootOf = new Map<number, string>();
    for (const g of groups) {
        if (g.name === ACCOUNT_GROUPS.SUNDRY_DEBTORS || g.name === ACCOUNT_GROUPS.SUNDRY_CREDITORS) {
            rootOf.set(g.id, g.name);
        }
    }
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of groups) {
            if (g.parentId !== null && rootOf.has(g.parentId) && !rootOf.has(g.id)) {
                rootOf.set(g.id, rootOf.get(g.parentId)!); grew = true;
            }
        }
    }
    const included = new Set(rootOf.keys());

    const accounts = await prisma.account.findMany({
        where: {
            groupId: { in: [...included] },
            openingBalance: { not: null },
        },
        select: {
            id: true, name: true, balance: true, creditLimit: true, groupId: true,
            openingBalance: true, openingBalanceType: true, openingBalanceDate: true,
            normalBalance: true, group: { select: { name: true, type: true } },
        },
        orderBy: { name: "asc" },
    });

    const rows = accounts
        .filter((a) => Number(a.openingBalance) !== 0 && a.openingBalanceType)
        .map((a) => {
            const nb = a.normalBalance
                ?? (a.group?.type === "ASSET" || a.group?.type === "EXPENSE" ? "DEBIT" as const : "CREDIT" as const);
            const delta = balanceDelta(nb, a.openingBalanceType!, Number(a.openingBalance));
            const before = Number(a.balance);
            const after = before + delta;
            const limit = a.creditLimit === null ? 0 : Number(a.creditLimit);
            const isDebtor = (a.groupId !== null ? rootOf.get(a.groupId) : null) === ACCOUNT_GROUPS.SUNDRY_DEBTORS;
            return {
                id: a.id, name: a.name, group: a.group?.name ?? "", isDebtor,
                opening: Number(a.openingBalance), type: a.openingBalanceType!,
                dated: a.openingBalanceDate, before, after, limit,
                // Credit limits are only ever checked on a sale to a debtor, and
                // only a rise in what they owe can breach one.
                breaches: isDebtor && limit > 0 && after > limit && before <= limit,
                noLimitButOwes: isDebtor && limit === 0 && after > 0.005 && before <= 0.005,
            };
        });

    console.log(`\n=== opening balances → real vouchers: what would change ===\n`);
    // There is no org-level books-beginning date in the schema —
    // `Company.booksBeginningFrom` is the CUSTOMER company model, not a setting
    // for this business. So the conversion has to be given a date.
    console.log(`opening dates stored : ${rows.filter((r) => r.dated).length} of ${rows.length}`);
    console.log(`  (no org-level books-beginning date exists, so the conversion must be told one)`);
    console.log(`party ledgers to convert : ${rows.length}`);
    console.log(`  under Sundry Debtors   : ${rows.filter((r) => r.isDebtor).length}`);
    console.log(`  under Sundry Creditors : ${rows.filter((r) => !r.isDebtor).length}`);
    console.log(`  entered as DEBIT  : ${rows.filter((r) => r.type === "DEBIT").length}  ₹${rows.filter((r) => r.type === "DEBIT").reduce((s, r) => s + r.opening, 0).toFixed(2)}`);
    console.log(`  entered as CREDIT : ${rows.filter((r) => r.type === "CREDIT").length}  ₹${rows.filter((r) => r.type === "CREDIT").reduce((s, r) => s + r.opening, 0).toFixed(2)}`);

    const breaching = rows.filter((r) => r.breaches);
    const newlyOwing = rows.filter((r) => r.noLimitButOwes);

    console.log(`\n--- credit-limit effect at the counter (checkCreditLimit reads Account.balance) ---`);
    console.log(`would NEWLY exceed a set credit limit : ${breaching.length}`);
    for (const r of breaching) {
        console.log(`  ${r.name.padEnd(34).slice(0, 34)} balance ${money(r.before)} → ${money(r.after)}   limit ${money(r.limit)}`);
    }
    console.log(`\ndebtors with no limit set that would newly show a due : ${newlyOwing.length}`);
    console.log(`  (credit is deny-by-default, so these already cannot buy on credit — only the figure becomes visible)`);
    for (const r of newlyOwing.slice(0, 10)) {
        console.log(`  ${r.name.padEnd(34).slice(0, 34)} balance ${money(r.before)} → ${money(r.after)}`);
    }
    if (newlyOwing.length > 10) console.log(`  … and ${newlyOwing.length - 10} more`);

    console.log(`\n--- the ten biggest conversions ---`);
    for (const r of [...rows].sort((a, b) => b.opening - a.opening).slice(0, 10)) {
        console.log(`  ${r.name.padEnd(34).slice(0, 34)} ${r.type.padEnd(6)} ${money(r.opening)}   balance ${money(r.before)} → ${money(r.after)}`);
    }

    console.log(`\nNothing was written. This is a report only.\n`);
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
