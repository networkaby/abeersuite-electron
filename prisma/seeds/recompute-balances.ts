// Recompute Account.balance from the JournalLine source of truth.
//
// `Account.balance` is a transaction-only running cache, incremented by every
// voucher post via `balanceDelta(nb, type, amount)`. If a post crashes
// mid-transaction, manual SQL touches a row, or a bug in any post helper
// drops a delta, the cache drifts away from the truth. This script recomputes
// the cache from `JournalLine` and reports (or fixes) the drift.
//
// Run:
//   pnpm seed:recompute-balances           # dry-run — print drift table
//   pnpm seed:recompute-balances --apply   # write the computed values back
//
// Math:
//   target = Σ balanceDelta(normalBalance, line.type, line.amount)
//   over all POSTED, non-deleted JournalLines for that account.
//   Master openings (Account.openingBalance) are NOT included — they live
//   on the master record and are folded in by effectiveLedgerBalance() at
//   display time, not stored in `balance`.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const apply = process.argv.includes("--apply");

// Mirrors src/modules/accountancy/lib/balance.ts balanceDelta — inlined so this
// script doesn't drag in the shared prisma client (which uses a different
// connection config and fails in CLI context).
function balanceDelta(nb: "DEBIT" | "CREDIT", entryType: "DEBIT" | "CREDIT", amount: number): number {
    return nb === entryType ? amount : -amount;
}

async function loadNormalBalanceMap(): Promise<Map<number, "DEBIT" | "CREDIT">> {
    const rows = await prisma.account.findMany({
        select: { id: true, normalBalance: true, group: { select: { type: true } } },
    });
    const map = new Map<number, "DEBIT" | "CREDIT">();
    for (const a of rows) {
        if (a.normalBalance) { map.set(a.id, a.normalBalance); continue; }
        const g = a.group?.type;
        if (g === "ASSET" || g === "EXPENSE") map.set(a.id, "DEBIT");
        else if (g) map.set(a.id, "CREDIT");
    }
    return map;
}

async function main() {
    console.log("Loading normal-balance map…");
    const nbMap = await loadNormalBalanceMap();

    console.log("Aggregating JournalLines (POSTED, not deleted)…");
    const sums = await prisma.voucherGlLine.groupBy({
        by: ["accountId", "type"],
        _sum: { amount: true },
        where: { universalVoucher: { status: "POSTED", deletedAt: null } },
    });

    const computed = new Map<number, number>();
    for (const r of sums) {
        const nb = nbMap.get(r.accountId);
        if (!nb) continue;
        const cur = computed.get(r.accountId) ?? 0;
        computed.set(r.accountId, cur + balanceDelta(nb, r.type, Number(r._sum.amount ?? 0)));
    }

    const accounts = await prisma.account.findMany({
        select: { id: true, code: true, name: true, balance: true },
        orderBy: { code: "asc" },
    });

    type Drift = { id: number; code: string; name: string; cached: number; computed: number; delta: number };
    const drift: Drift[] = [];
    for (const a of accounts) {
        const cached = Number(a.balance);
        const comp = computed.get(a.id) ?? 0;
        const delta = comp - cached;
        if (Math.abs(delta) > 0.005) {
            drift.push({ id: a.id, code: a.code ?? "—", name: a.name, cached, computed: comp, delta });
        }
    }

    console.log(`\nChecked ${accounts.length} accounts; ${computed.size} have posted JE activity.`);

    if (drift.length === 0) {
        console.log("✓ No drift — every Account.balance matches the JE-derived total.");
        await prisma.$disconnect();
        await pool.end();
        return;
    }

    console.log(`\n⚠️  ${drift.length} account(s) have drift:\n`);
    const f = (n: number) => n.toFixed(2).padStart(13);
    console.log("Code   Name                              Cached         Computed       Delta");
    console.log("─────  ────────────────────────────────  ─────────────  ─────────────  ─────────────");
    for (const d of drift) {
        console.log(`${d.code.padEnd(5)}  ${d.name.padEnd(32).slice(0, 32)}  ${f(d.cached)}  ${f(d.computed)}  ${f(d.delta)}`);
    }

    if (!apply) {
        console.log("\nDry-run only. Re-run with --apply to write the computed values back to Account.balance.");
        await prisma.$disconnect();
        await pool.end();
        return;
    }

    console.log("\nApplying fix in a single transaction…");
    await prisma.$transaction(
        drift.map((d) =>
            prisma.account.update({
                where: { id: d.id },
                data:  { balance: d.computed },
            }),
        ),
    );
    console.log(`✓ ${drift.length} account(s) repaired.`);

    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
