/**
 * Create the handful of ledgers Vyapar needs that the chart of accounts does not
 * have yet, from the `action: "create"` entries in vyapar-ledger-map.json.
 *
 * For this migration that is five: "Cheques in Hand", "3 Routing A/c", two Amazon
 * Pay wallets and "UNI BB Visa 2797". Everything else either matched an existing
 * ledger or was dropped as idle, so this stays deliberately small — it is not a
 * general chart-of-accounts builder.
 *
 * Idempotent and non-destructive: it only ever INSERTs a ledger that is missing,
 * matched by exact name. Re-running changes nothing. It never edits or moves an
 * existing ledger, because a ledger's group is an accounting decision and this
 * script is not the place to revisit one.
 *
 *   pnpm vyapar:create-ledgers            # dry run — prints what it would do
 *   pnpm vyapar:create-ledgers -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { readFileSync } from "node:fs";
import { Pool } from "pg";

const MAP = "prisma/seeds/data/vyapar-ledger-map.json";

type Mapping = {
    vyapar: string;
    kind: "expense" | "payment";
    action: "map" | "create" | "drop";
    account: string | null;
    group: string | null;
    fyTxns: number;
    fyAmount: number;
};

/**
 * The normal balance for each group we create into. Getting this wrong flips how
 * a ledger reads on the balance sheet, so it is stated rather than inferred.
 */
const NORMAL_BALANCE: Record<string, "DEBIT" | "CREDIT"> = {
    "Current Assets": "DEBIT",
    "Bank Accounts": "DEBIT",
    "Cash-in-Hand": "DEBIT",
    "Wallets": "DEBIT",
    "Credit Card": "CREDIT",   // a card is money owed, not money held
    "Bank OD A/c": "CREDIT",
    "BNPL A/c": "CREDIT",
    // An asset ledger is a debit balance like any other. Two expense heads are
    // capitalised into their own Fixed Assets ledgers rather than into the asset
    // ledgers they relate to, so the ROOM (Rs 4,00,001) stays distinguishable from
    // money spent getting it ready (Rs 10,000).
    "Fixed Assets": "DEBIT",
};

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) {
        throw new Error("REFUSING: run this against the local migration copy, not live.");
    }

    const mappings = JSON.parse(readFileSync(MAP, "utf8")).mappings as Mapping[];
    const wanted = mappings.filter((m) => m.action === "create");
    if (!wanted.length) { console.log("nothing to create."); return; }

    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const groups = new Map<string, number>(
        (await pool.query(`select id, name from "AccountGroup"`)).rows.map((r) => [r.name, r.id]),
    );
    const existing = new Set<string>(
        (await pool.query(`select name from "Account" where "personId" is null and "companyId" is null`))
            .rows.map((r) => r.name),
    );

    const plan: Array<{ name: string; group: string; groupId: number; nb: "DEBIT" | "CREDIT"; from: string }> = [];
    const problems: string[] = [];

    for (const m of wanted) {
        const name = m.account;
        if (!name) { problems.push(`"${m.vyapar}" is marked create but has no account name — fix DECISIONS in ledger-map.ts`); continue; }
        if (existing.has(name)) { console.log(`  = ${name}  (already there)`); continue; }
        if (!m.group) { problems.push(`"${name}" has no group — add it to CREATE_UNDER in ledger-map.ts`); continue; }
        const groupId = groups.get(m.group);
        if (!groupId) { problems.push(`"${name}" wants group "${m.group}", which does not exist in this database`); continue; }
        const nb = NORMAL_BALANCE[m.group];
        if (!nb) { problems.push(`no normal balance defined for group "${m.group}" — add it to NORMAL_BALANCE`); continue; }
        plan.push({ name, group: m.group, groupId, nb, from: m.vyapar });
    }

    for (const p of plan) {
        console.log(`  + ${p.name.padEnd(28)} [${p.group}]  ${p.nb}   ← Vyapar "${p.from}"`);
    }
    if (problems.length) {
        console.log("\nPROBLEMS — nothing written:");
        for (const p of problems) console.log(`  ✗ ${p}`);
        await pool.end();
        process.exit(1);
    }
    if (!plan.length) { console.log("\nall present, nothing to do."); await pool.end(); return; }

    if (!apply) {
        console.log(`\n${plan.length} ledger(s) would be created. Re-run with --apply to write.\n`);
        await pool.end();
        return;
    }

    for (const p of plan) {
        await pool.query(
            `insert into "Account" (name, "groupId", "normalBalance", "isActive", balance, "creditLimit", "createdAt", "updatedAt")
             values ($1, $2, $3::"NormalBalance", true, 0, 0, now(), now())`,
            [p.name, p.groupId, p.nb],
        );
        console.log(`  ✓ created ${p.name}`);
    }
    console.log(`\n${plan.length} ledger(s) created.\n`);
    await pool.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
