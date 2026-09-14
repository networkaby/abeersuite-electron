// TEMPORARY — delete once the voucher-save round-trip work is done.
//
// Proves the batched statements introduced on the voucher-save path are correct
// against a REAL database. Two modes:
//
//   explain  (default, and the only mode used against live)
//       READ-ONLY. Every write statement goes through EXPLAIN, which makes
//       Postgres fully parse and plan it — catching a wrong table, a wrong
//       column, a bad cast, or an ON CONFLICT target with no matching unique
//       index — while executing nothing at all. The arithmetic that the plan
//       cannot show (array binding, the text->numeric element cast, the
//       per-account SUM, NULL stock staying NULL) is proved with plain SELECTs.
//       Not one row is written or locked.
//
//   execute  (opt in with VERIFY_MODE=execute; never against live)
//       Runs the real statements against real rows inside a transaction that is
//       ALWAYS rolled back, and checks the numbers actually moved.
//
// Run:  VERIFY_TARGET=live pnpm exec tsx src/scripts/verify-batch-sql.ts
//       VERIFY_MODE=execute pnpm exec tsx src/scripts/verify-batch-sql.ts

import * as dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

//   VERIFY_TARGET=live   → the real Supabase database, read from the env already
//                          loaded, so the credential never goes on a command line.
//   VERIFY_DATABASE_URL  → any explicit connection string.
//   (default)            → LOCAL_DATABASE_URL, the counter replica.
const target = (process.env.VERIFY_TARGET ?? "").toLowerCase();
const isLive = target === "live";
const url = isLive
    ? (process.env.DIRECT_URL || process.env.DATABASE_URL)
    : (process.env.VERIFY_DATABASE_URL || process.env.LOCAL_DATABASE_URL);
if (!url) { console.error("No database to verify against — set VERIFY_TARGET=live, VERIFY_DATABASE_URL, or LOCAL_DATABASE_URL."); process.exit(1); }

// Live is read-only, full stop: `execute` has to be asked for AND may not point
// at live, so there is no combination of flags that writes to the real books.
const mode = isLive ? "explain" : ((process.env.VERIFY_MODE ?? "explain").toLowerCase() === "execute" ? "execute" : "explain");

// Strip `sslmode=` exactly as prismaClient.ts does: newer pg-connection-string
// treats `require` as `verify-full`, which rejects Supabase's chain, and a mode in
// the string overrides the `ssl` option below.
const conn = url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(conn);
const pool = new Pool({ connectionString: conn, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 1 });

const describe = (u: string) => u.replace(/:\/\/[^@]*@/, "://***@");

const ok: string[] = [];
const bad: string[] = [];
const pass = (c: boolean, line: string) => (c ? ok : bad).push(line);

// ── The statements under test, verbatim from the application code ───────────
const SQL_GL_BALANCE = `
    UPDATE "Account" AS a
       SET "balance"   = a."balance" + v."delta",
           "updatedAt" = NOW()
      FROM (SELECT t."id", SUM(t."delta"::numeric) AS "delta"
              FROM UNNEST($1::int[], $2::text[]) AS t("id","delta")
             GROUP BY t."id") AS v
     WHERE a."id" = v."id"`;

const SQL_PRODUCT_STOCK = `
    UPDATE "InvProduct" AS p
       SET "stock"     = CASE WHEN v."absolute" THEN v."delta" ELSE p."stock" + v."delta" END,
           "mrpPaise"  = COALESCE(v."mrp", p."mrpPaise"),
           "updatedAt" = NOW()
      FROM (SELECT * FROM UNNEST($1::int[], $2::int[], $3::boolean[], $4::int[])
              AS t("id","delta","absolute","mrp")) AS v
     WHERE p."id" = v."id"`;

const SQL_BRANCH_STOCK = `
    INSERT INTO "inv_product_branches" ("productId","branchId","stock","updatedAt")
    SELECT t."productId", t."branchId", t."delta", NOW()
      FROM UNNEST($1::int[], $2::text[], $3::int[]) AS t("productId","branchId","delta")
    ON CONFLICT ("productId","branchId") DO UPDATE
       SET "stock"     = "inv_product_branches"."stock" + EXCLUDED."stock",
           "updatedAt" = NOW()`;

const SQL_LEDGER_MAP = `
    SELECT a."id", a."name", a."normalBalance"::text AS "normalBalance", g."type"::text AS "groupType"
      FROM "Account" a
      LEFT JOIN "AccountGroup" g ON g."id" = a."groupId"
     WHERE a."personId" IS NULL AND a."companyId" IS NULL AND a."isActive" = true
       AND LOWER(a."name") = ANY($1::text[])
     ORDER BY a."id" ASC`;

async function connect(): Promise<PoolClient> {
    try {
        return await pool.connect();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`\nCannot reach ${describe(url!)}\n  ${msg}\n`);
        if (/password authentication|role .* does not exist/i.test(msg)) {
            console.error(
                "That role's password no longer matches this Postgres — expected if the\n" +
                "server was reinstalled. Point the script at any database carrying this\n" +
                "schema:\n\n" +
                "  VERIFY_TARGET=live pnpm exec tsx src/scripts/verify-batch-sql.ts\n",
            );
        }
        await pool.end();
        process.exit(1);
    }
}

/** Parse + plan a write statement without running it. Throws if it is not valid. */
async function explain(c: PoolClient, name: string, sql: string, params: unknown[]) {
    try {
        await c.query(`EXPLAIN ${sql}`, params);
        pass(true, `${name}: parses and plans against the real schema`);
    } catch (e) {
        pass(false, `${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function checkSchema(c: PoolClient): Promise<boolean> {
    const missing = (await c.query(
        `SELECT t.name FROM UNNEST(ARRAY['Account','AccountGroup','InvProduct','Branch','inv_product_branches']) AS t(name)
          WHERE to_regclass('public."' || t.name || '"') IS NULL`,
    )).rows.map((r) => r.name);
    if (missing.length > 0) {
        console.error(`\n${describe(url!)} is reachable but does not carry this schema.`);
        console.error(`Missing table(s): ${missing.join(", ")}\n`);
        return false;
    }
    return true;
}

async function readOnlyChecks(c: PoolClient) {
    // 1-3. The three write statements, parsed and planned but never executed.
    await explain(c, "GL balance update", SQL_GL_BALANCE, [[1, 2, 1], ["10.25", "-4.50", "0.75"]]);
    await explain(c, "InvProduct stock + MRP", SQL_PRODUCT_STOCK, [[1, 2], [-3, 7], [false, true], [null, 12345]]);
    await explain(c, "branch balance insert-or-add", SQL_BRANCH_STOCK, [[1, 2], ["BR-HQ", "BR-HQ"], [-3, 7]]);

    // 4. The per-account SUM and the text->numeric element cast — the parts a plan
    //    cannot show. The first account is listed TWICE, exactly as a bill with two
    //    tender legs on one ledger does.
    const sum = await c.query(
        `SELECT t."id", SUM(t."delta"::numeric)::text AS "delta"
           FROM UNNEST($1::int[], $2::text[]) AS t("id","delta")
          GROUP BY t."id" ORDER BY t."id"`,
        [[1, 2, 1], ["10.25", "-4.50", "0.75"]],
    );
    const got = sum.rows.map((r) => `${r.id}=${Number(r.delta)}`).join(" ");
    pass(got === "1=11 2=-4.5", `repeat legs on one ledger sum exactly: ${got} (want 1=11 2=-4.5)`);

    // 5. Array binding with NULLs and booleans mixed in.
    const un = await c.query(
        `SELECT * FROM UNNEST($1::int[], $2::int[], $3::boolean[], $4::int[]) AS t("id","delta","absolute","mrp")`,
        [[1, 2], [-3, 7], [false, true], [null, 12345]],
    );
    pass(
        un.rowCount === 2 && un.rows[0].mrp === null && un.rows[1].mrp === 12345 && un.rows[1].absolute === true,
        `nullable/boolean array params bind correctly (mrp ${un.rows[0]?.mrp} / ${un.rows[1]?.mrp})`,
    );

    // 6. The null-stock rule the CASE preserves: an uninitialised cache must stay
    //    NULL under a plain increment, exactly as Prisma's increment left it.
    const nul = await c.query(`SELECT (NULL::int + 5) IS NULL AS stays_null, (CASE WHEN true THEN 5 ELSE NULL::int + 5 END) AS absolute_writes`);
    pass(
        nul.rows[0].stays_null === true && nul.rows[0].absolute_writes === 5,
        `NULL stock stays NULL on increment, and absolute writes the value (${nul.rows[0].stays_null}, ${nul.rows[0].absolute_writes})`,
    );

    // 7. ON CONFLICT needs a real unique index on exactly that pair.
    const idx = await c.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'inv_product_branches' AND indexdef LIKE '%UNIQUE%'`,
    );
    pass(idx.rowCount! > 0, `inv_product_branches has the unique index ON CONFLICT needs (${idx.rowCount} found)`);

    // 8. The one case where the new resolution could differ from the old.
    //
    //    Old: one `findFirst` per candidate name, no ORDER BY — with two ledgers
    //    sharing a name, Postgres picked whichever it felt like.
    //    New: one query, lowest id wins.
    //    Both walk the same names in the same order, so they can only disagree if
    //    a name is duplicated. If nothing is, the two are identical by construction.
    const dupes = await c.query(
        `SELECT LOWER("name") AS n, COUNT(*)::int AS c
           FROM "Account"
          WHERE "personId" IS NULL AND "companyId" IS NULL AND "isActive" = true
          GROUP BY LOWER("name") HAVING COUNT(*) > 1`,
    );
    pass(dupes.rowCount === 0,
        dupes.rowCount === 0
            ? "no duplicate ledger names — new resolution is identical to the old by construction"
            : `duplicate ledger names, so resolution could differ: ${dupes.rows.map((r) => `${r.n} x${r.c}`).join(", ")}`);

    // 9. The ledger-map loader, run for real — it is a SELECT. Every name the GL
    //    builder can ask for, so the output shows exactly which roles this chart
    //    of accounts can satisfy and which fall back.
    const ALL = [
        "sales a/c", "sales", "sales account",
        "purchase a/c", "purchase", "purchase account",
        "sales return a/c", "sales returns", "returns inward", "sales return",
        "purchase return a/c", "purchase returns", "returns outward", "purchase return",
        "cash", "cash-in-hand", "cash a/c",
        "cgst output", "output cgst", "cgst", "sgst output", "output sgst", "sgst",
        "igst output", "output igst", "igst", "gst output", "output gst", "output tax",
        "cgst input", "input cgst", "sgst input", "input sgst",
        "igst input", "input igst", "gst input", "input gst", "input tax",
        "round off", "rounded off", "round-off",
        "shipping income", "freight income", "carriage outward", "delivery charges income",
        "freight charges", "carriage inward", "inward freight",
        "discount allowed", "discount given", "trade discount allowed",
        "discount received", "trade discount received",
    ];
    const led = await c.query(SQL_LEDGER_MAP, [ALL]);
    pass(led.rowCount! > 0, `ledger map loader resolved ${led.rowCount} ledger(s) in ONE query: ${led.rows.map((r) => r.name).join(", ") || "none"}`);
}

async function executeChecks(c: PoolClient) {
    await c.query("BEGIN");
    try {
        const accounts = (await c.query(`SELECT "id","balance" FROM "Account" ORDER BY "id" LIMIT 3`)).rows;
        const products = (await c.query(`SELECT "id","stock" FROM "InvProduct" ORDER BY "id" LIMIT 3`)).rows;
        const branch   = (await c.query(`SELECT "id" FROM "Branch" ORDER BY "id" LIMIT 1`)).rows[0];
        if (accounts.length < 2 || products.length < 2 || !branch) {
            bad.push("not enough Account / InvProduct / Branch rows here to verify against");
            return;
        }

        const before = new Map(accounts.map((a) => [a.id, Number(a.balance)]));
        const r1 = await c.query(SQL_GL_BALANCE, [[accounts[0].id, accounts[1].id, accounts[0].id], ["10.25", "-4.50", "0.75"]]);
        const after1 = (await c.query(`SELECT "id","balance" FROM "Account" WHERE "id" = ANY($1::int[])`, [[accounts[0].id, accounts[1].id]])).rows;
        const d0 = Number(after1.find((r) => r.id === accounts[0].id)!.balance) - before.get(accounts[0].id)!;
        const d1 = Number(after1.find((r) => r.id === accounts[1].id)!.balance) - before.get(accounts[1].id)!;
        pass(Math.abs(d0 - 11) < 1e-9 && Math.abs(d1 + 4.5) < 1e-9 && r1.rowCount === 2,
            `GL balance update: rows=${r1.rowCount} moved ${d0} / ${d1} (want 11 / -4.5)`);

        const sBefore = new Map(products.map((p) => [p.id, p.stock === null ? null : Number(p.stock)]));
        const r2 = await c.query(SQL_PRODUCT_STOCK, [[products[0].id, products[1].id], [-3, 7], [false, false], [null, 12345]]);
        const after2 = (await c.query(`SELECT "id","stock","mrpPaise" FROM "InvProduct" WHERE "id" = ANY($1::int[])`, [[products[0].id, products[1].id]])).rows;
        const s0 = after2.find((r) => r.id === products[0].id)!, s1 = after2.find((r) => r.id === products[1].id)!;
        const w0 = sBefore.get(products[0].id) === null ? null : sBefore.get(products[0].id)! - 3;
        const w1 = sBefore.get(products[1].id) === null ? null : sBefore.get(products[1].id)! + 7;
        pass((s0.stock === null ? w0 === null : Number(s0.stock) === w0)
            && (s1.stock === null ? w1 === null : Number(s1.stock) === w1)
            && Number(s1.mrpPaise) === 12345 && r2.rowCount === 2,
            `InvProduct update: rows=${r2.rowCount} stock ${s0.stock}/${s1.stock} (want ${w0}/${w1}) mrp=${s1.mrpPaise}`);

        const bBefore = new Map(((await c.query(
            `SELECT "productId","stock" FROM "inv_product_branches" WHERE "productId" = ANY($1::int[]) AND "branchId" = $2`,
            [[products[0].id, products[1].id], branch.id],
        )).rows).map((r) => [r.productId, Number(r.stock)]));
        const r3 = await c.query(SQL_BRANCH_STOCK, [[products[0].id, products[1].id], [branch.id, branch.id], [-3, 7]]);
        const bAfter = (await c.query(
            `SELECT "productId","stock" FROM "inv_product_branches" WHERE "productId" = ANY($1::int[]) AND "branchId" = $2`,
            [[products[0].id, products[1].id], branch.id],
        )).rows;
        const w2 = (bBefore.get(products[0].id) ?? 0) - 3, w3 = (bBefore.get(products[1].id) ?? 0) + 7;
        pass(Number(bAfter.find((r) => r.productId === products[0].id)?.stock) === w2
            && Number(bAfter.find((r) => r.productId === products[1].id)?.stock) === w3 && r3.rowCount === 2,
            `branch balance upsert: rows=${r3.rowCount} (want ${w2} / ${w3})`);
    } finally {
        await c.query("ROLLBACK");   // nothing above is kept
    }
}

async function main() {
    const c = await connect();
    try {
        console.log(`\n${mode === "explain" ? "READ-ONLY" : "rolled-back"} verification against ${describe(url!)}\n`);
        if (!(await checkSchema(c))) { process.exitCode = 1; return; }
        if (mode === "explain") await readOnlyChecks(c);
        else await executeChecks(c);
    } finally {
        c.release();
        await pool.end();
    }

    for (const line of ok)  console.log(`  PASS  ${line}`);
    for (const line of bad) console.log(`  FAIL  ${line}`);
    console.log(bad.length === 0
        ? `\nAll batched statements verified${mode === "explain" ? " — nothing was written or locked." : ". Transaction rolled back."}`
        : "\nSOMETHING IS WRONG.");
    process.exitCode = bad.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
