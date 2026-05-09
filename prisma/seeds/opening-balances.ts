// Seed opening balances for a books-beginning state.
// Sets Account.openingBalance / openingBalanceType / openingBalanceDate so
// loadMasterOpeningBalances() in src/modules/accountancy/lib/aggregateLedger.ts
// folds them into every report.
//
// Run: pnpm seed:opening-balances
// Idempotent — safe to run multiple times.

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false }, max: 1 });

// Indian fiscal year start that matches indianFiscalYearStart() in
// src/modules/accountancy/lib/period.ts. For testing purposes we anchor to
// 2026-04-01 so books-as-at any 2026-FY date pick these up.
const FY_START = "2026-04-01";

type Opening = {
    name: string;
    type: "DEBIT" | "CREDIT";
    amount: number;
};

// Minimal Tally-style books-beginning entry — proprietor's capital deposited
// into bank, with a small petty cash float. Σ DEBIT must equal Σ CREDIT or
// "Difference in Opening Balances" will pick up the gap.
const OPENINGS: Opening[] = [
    { name: "Bank Account", type: "DEBIT",  amount: 500_000 },
    { name: "Cash",         type: "DEBIT",  amount:  50_000 },
    { name: "Capital",      type: "CREDIT", amount: 550_000 },
];

async function setOpening(o: Opening): Promise<void> {
    const r = await pool.query(
        `UPDATE "Account"
            SET "openingBalance"     = $1,
                "openingBalanceType" = $2,
                "openingBalanceDate" = $3
          WHERE LOWER(name) = LOWER($4)
            AND "personId" IS NULL AND "companyId" IS NULL
          RETURNING id`,
        [o.amount, o.type, FY_START, o.name],
    );
    if (r.rowCount === 0) {
        console.warn(`  ! No ledger named "${o.name}" — skipped`);
        return;
    }
    console.log(`  ✓ ${o.name.padEnd(18)} ${o.type === "DEBIT" ? "Dr" : "Cr"} ₹${o.amount.toLocaleString("en-IN")}`);
}

async function main(): Promise<void> {
    console.log(`Setting opening balances dated ${FY_START} …`);
    const sumDr = OPENINGS.filter((o) => o.type === "DEBIT").reduce((s, o) => s + o.amount, 0);
    const sumCr = OPENINGS.filter((o) => o.type === "CREDIT").reduce((s, o) => s + o.amount, 0);
    if (sumDr !== sumCr) {
        console.warn(`  ⚠ Opening Dr ₹${sumDr} ≠ Cr ₹${sumCr} — diff (${sumDr - sumCr}) will park in "Difference in Opening Balances"`);
    }
    for (const o of OPENINGS) await setOpening(o);
    console.log("Done.");
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
