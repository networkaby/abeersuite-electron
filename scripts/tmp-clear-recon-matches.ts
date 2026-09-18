/**
 * TEMPORARY — clear bank-reconciliation matches so Auto-match can be run again
 * from a clean slate and the tightened rule tested. Delete this file once the
 * testing is done; nothing in the app calls it.
 *
 * It touches ONE table, `BankStatementMatch`. It never deletes a statement
 * line, an upload, a voucher or a GL line, and it never moves the reconciled
 * lock. Un-matching is exactly what the ⟳ button on a row does, in bulk.
 *
 * Dry run is the default and it really is a different branch — nothing is
 * written until `--commit`, and the report says which branch actually ran.
 *
 * Usage:
 *   pnpm tsx scripts/tmp-clear-recon-matches.ts --ledger "SBI CC A/c 873"
 *       Dry run. Lists what would go, by auto / by hand, and what sits under
 *       the reconciled lock.
 *
 *   pnpm tsx scripts/tmp-clear-recon-matches.ts --ledger "SBI CC A/c 873" --commit
 *       Clears the AUTO matches only. Matches made by a person are left alone —
 *       that is human work and Auto-match will not put it back.
 *
 *   … --commit --include-manual     also clear the ones made by hand
 *   … --account 3                   pick the ledger by id instead of name
 *   … --ledger all                  every bank ledger that has matches
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const COMMIT = has("--commit");
const INCLUDE_MANUAL = has("--include-manual");
const LEDGER = val("--ledger");
const ACCOUNT_ID = val("--account") ? Number(val("--account")) : undefined;

const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
    if (!LEDGER && ACCOUNT_ID == null) {
        console.error("Say which ledger:  --ledger \"SBI CC A/c 873\"  |  --account 3  |  --ledger all");
        process.exit(1);
    }

    // Which ledgers are in scope. `BankStatementLine.accountId` is denormalised
    // with no relation field on Account (see the schema note), so "every ledger
    // that has a statement" is a distinct read on the lines, not a nested where.
    let ids: number[];
    if (ACCOUNT_ID != null) {
        ids = [ACCOUNT_ID];
    } else if (LEDGER === "all") {
        const rows = await prisma.bankStatementLine.findMany({
            select: { accountId: true }, distinct: ["accountId"],
        });
        ids = rows.map((r) => r.accountId);
    } else {
        const named = await prisma.account.findMany({ where: { name: LEDGER }, select: { id: true } });
        ids = named.map((a) => a.id);
    }
    const accounts = await prisma.account.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, reconciledThrough: true },
        orderBy: { name: "asc" },
    });
    if (accounts.length === 0) {
        console.error(`No ledger found for ${ACCOUNT_ID != null ? `id ${ACCOUNT_ID}` : `"${LEDGER}"`}.`);
        process.exit(1);
    }

    console.log(COMMIT ? "── COMMIT — matches will be deleted ──" : "── DRY RUN — nothing is written ──");
    let grandTotal = 0;

    for (const acc of accounts) {
        const matches = await prisma.bankStatementMatch.findMany({
            where: { statementLine: { accountId: acc.id } },
            select: { id: true, auto: true, statementLine: { select: { date: true } } },
        });
        const auto = matches.filter((m) => m.auto);
        const manual = matches.filter((m) => !m.auto);
        const target = INCLUDE_MANUAL ? matches : auto;
        // A statement line under the lock that ends up unmatched leaves the
        // existing lock standing on an unexplained line. This script does NOT
        // move the lock — Auto-match should put the same-day ones straight
        // back, but the count is worth seeing before pressing --commit.
        const lock = acc.reconciledThrough;
        const underLock = lock ? target.filter((m) => m.statementLine.date <= lock).length : 0;

        console.log(
            `\n${acc.name}  (id ${acc.id})   lock: ${iso(lock)}\n`
            + `   ${matches.length} match(es) — ${auto.length} by auto-match, ${manual.length} by hand\n`
            + `   to clear: ${target.length}${INCLUDE_MANUAL ? " (auto + by hand)" : " (auto only — by-hand matches kept)"}`
            + (underLock ? `\n   ⚠ ${underLock} of them sit on or before the lock (${iso(lock)}); the lock itself is not touched` : ""),
        );

        if (COMMIT && target.length > 0) {
            const r = await prisma.bankStatementMatch.deleteMany({ where: { id: { in: target.map((m) => m.id) } } });
            console.log(`   deleted ${r.count}`);
        }
        grandTotal += target.length;
    }

    console.log(
        `\n${COMMIT ? "Cleared" : "Would clear"} ${grandTotal} match(es) across ${accounts.length} ledger(s).`
        + (COMMIT
            ? "\nOpen Bank Reconciliation and press Auto-match to rebuild them under the new rule."
            : "\nNothing was written — this was the dry-run branch. Add --commit to actually clear."),
    );
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
