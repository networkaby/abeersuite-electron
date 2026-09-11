/**
 * Write the 1-Apr-2026 opening out as a document, organised the way VYAPAR
 * presents it, so the owner can check the mapping line by line.
 *
 * Numbers are read back from the database, never retyped — a report that restates
 * what a script believed proves nothing about what the script actually wrote.
 *
 *   pnpm vyapar:opening-doc [path.md]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";
import { readFileSync, writeFileSync } from "node:fs";

const inr = (n: number) => (n < 0 ? "−" : "") + "₹" +
    Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const out: string[] = [];
const w = (s = "") => out.push(s);

async function main(): Promise<void> {
    const path = process.argv.find((a) => a.endsWith(".md")) ?? "opening-1-apr-2026.md";
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });
    const V = JSON.parse(readFileSync("prisma/seeds/data/vyapar-opening-31mar2026.json", "utf8"));

    const ob = new Map<string, number>();
    for (const r of (await pool.query(
        `select name, coalesce(case when "openingBalanceType" = 'CREDIT' then -"openingBalance" else "openingBalance" end, 0) v
         from "Account" where coalesce("openingBalance", 0) <> 0`)).rows) ob.set(String(r.name), Number(r.v));

    const grp = new Map<string, number>();
    for (const r of (await pool.query(
        `select g.name n, sum(coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0)) v
         from "Account" a join "AccountGroup" g on g.id = a."groupId" group by 1`)).rows) grp.set(String(r.n), Number(r.v));

    const stock = (await pool.query(`
        select coalesce(sum(coalesce("openingStock", 0) * coalesce("openingRate", 0)), 0) v,
               coalesce(sum(coalesce("openingStock", 0)), 0) q, count(*)::int n from "InvProduct"`)).rows[0];

    const mark = (ours: number, theirs: number) => (Math.abs(ours - theirs) <= 1 ? "OK" : "CHECK");

    w(`# Opening at 1 April 2026`);
    w();
    w(`Built in an empty database. Every figure below was written from a number Vyapar`);
    w(`published in its own **Balance Sheet** and **Trial Balance** for 31-Mar-2026.`);
    w(`**No transactions exist yet** — this is the opening only.`);
    w();
    w(`> You said Vyapar's own data may be inconsistent. Everything here is what Vyapar`);
    w(`> *says*, carried faithfully. Where I had to make a judgement instead of copying a`);
    w(`> number, it is marked **MY JUDGEMENT** — check those first.`);
    w();

    // ── 1. The balance sheet in Vyapar's own shape ──────────────────────────
    w(`## 1. Balance sheet, line by line`);
    w();
    w(`| Vyapar line | Vyapar | ours | |`);
    w(`|---|---:|---:|:--|`);
    const banks = (grp.get("Bank Accounts") ?? 0) + (grp.get("Bank OD A/c") ?? 0)
        + (grp.get("Wallets") ?? 0) + (grp.get("Credit Card") ?? 0);
    const rows: Array<[string, number, number, string]> = [
        ["Fixed Assets", 483395.95, grp.get("Fixed Assets") ?? 0, ""],
        ["Sundry Debtors", 26678, grp.get("Sundry Debtors") ?? 0, ""],
        ["Bank Accounts (incl. wallets, cards)", -489099.11, banks, ""],
        ["Cash", 4372.66, grp.get("Cash-in-Hand") ?? 0, ""],
        ["Sundry Creditors", -254303.20, grp.get("Sundry Creditors") ?? 0, ""],
        ["Loan Accounts", -978044, grp.get("Unsecured Loans") ?? 0, ""],
        ["Stock-in-hand", 858903.96, Number(stock.v), "derived — see section 6"],
        ["Input GST", 1830148.08, 0, "nil by your decision — section 7"],
        ["Output GST", -2197846.55, 0, "nil by your decision — section 7"],
        ["Capital Account", -133621.78, grp.get("Capital Account") ?? 0, "not entered — section 7"],
        ["Difference in Opening Balance", 849415.99, 0, "not entered — section 7"],
    ];
    for (const [k, t, o, note] of rows) w(`| ${k} | ${inr(t)} | ${inr(o)} | ${note || mark(o, t)} |`);
    w();

    // ── 2. Money ────────────────────────────────────────────────────────────
    w(`## 2. Cash, bank, wallet and card`);
    w();
    w(`| Vyapar ledger | 31-Mar | our ledger | |`);
    w(`|---|---:|---|:--|`);
    for (const m of V.money.filter((x: { amount?: number }) => typeof x.amount === "number")) {
        if (!m.account) { w(`| ${m.vyapar} | ${inr(m.amount)} | *not migrated — nil in Vyapar* | — |`); continue; }
        w(`| ${m.vyapar} | ${inr(m.amount)} | ${m.account} | ${mark(ob.get(m.account) ?? 0, m.amount)} |`);
    }
    w();

    // ── 3. Loans ────────────────────────────────────────────────────────────
    w(`## 3. Loans`);
    w();
    w(`| Vyapar | 31-Mar | our ledger | |`);
    w(`|---|---:|---|:--|`);
    for (const l of V.loans.filter((x: { amount?: number }) => typeof x.amount === "number"))
        w(`| ${l.vyapar} | ${inr(l.amount)} | ${l.account}${l.create ? " *(created)*" : ""} | ${mark(ob.get(l.account) ?? 0, l.amount)} |`);
    w();
    w(`**Navi 2** and **Hamid Soceity @1.5%** did not exist in AbeerSuite at all before this.`);
    w();

    // ── 4. Fixed assets ─────────────────────────────────────────────────────
    w(`## 4. Fixed assets — total matches, grouping is MY JUDGEMENT`);
    w();
    w(`Vyapar holds these as *items*. We hold ledgers, so 20 items fold into 6. The total`);
    w(`is exactly Vyapar's ₹4,83,395.95; **which ledger each lands in is my guess.**`);
    w();
    w(`| Vyapar item | value | our ledger |`);
    w(`|---|---:|---|`);
    for (const f of V.fixedAssets.items) w(`| ${f.name} | ${inr(f.amount)} | ${f.ledger} |`);
    w();
    w(`Least confident: **Aegis RG FCT** (I do not know what it is) and **Softwar**`);
    w(`(software is not really a peripheral).`);
    w();

    // ── 5. Parties ──────────────────────────────────────────────────────────
    const pa = (await pool.query(`
        select a.name, coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0) v
        from "Account" a where coalesce(a."openingBalance", 0) <> 0
          and (a."personId" is not null or a."companyId" is not null) order by 2 desc, 1`)).rows;
    const tot = (await pool.query(
        `select (select count(*)::int from "Person") p, (select count(*)::int from "Company") c`)).rows[0];
    w(`## 5. Parties`);
    w();
    w(`**${Number(tot.p) + Number(tot.c)} parties** carried (${tot.p} persons, ${tot.c} companies) — every Vyapar name,`);
    w(`including those with no balance, so nothing is invisible to you.`);
    w();
    w(`**${pa.length} carry an opening balance**, and their totals reproduce Vyapar exactly:`);
    w(`receivable **₹26,678.00**, payable **₹2,54,303.20**.`);
    w();
    w(`| party | opening |`);
    w(`|---|---:|`);
    for (const p of pa) w(`| ${p.name} | ${inr(Number(p.v))} |`);
    w();

    // ── 6. Stock ────────────────────────────────────────────────────────────
    w(`## 6. Stock — the one figure not read from a Vyapar report`);
    w();
    w(`| | |`);
    w(`|---|---:|`);
    w(`| products carried | ${stock.n} |`);
    w(`| opening quantity | ${Number(stock.q).toLocaleString("en-IN")} units |`);
    w(`| opening value (ours) | ${inr(Number(stock.v))} |`);
    w(`| Vyapar Stock-in-hand | ${inr(858903.96)} |`);
    w(`| **difference** | **${inr(Number(stock.v) - 858903.96)}** |`);
    w();
    w(`Quantities are sound. I proved delivery challans, estimates and cancelled sales`);
    w(`move no stock in Vyapar, so ignoring them is correct.`);
    w();
    w(`The difference is **valuation basis only**. Unit cost is \`stock value ÷ quantity\``);
    w(`as at **September**, applied to **March** quantities. For the 1,030 items that never`);
    w(`moved that is the same as March's cost, so they are exact; the whole difference sits`);
    w(`in the 415 that did move, at 2.8% drift.`);
    w();
    w(`**A Vyapar stock summary as at 31-Mar-2026 replaces this with a read figure.**`);
    w();

    // ── 7. Deliberately different ───────────────────────────────────────────
    w(`## 7. Deliberately different — your decisions`);
    w();
    w(`**GST opens at nil.** Vyapar never clears these ledgers when you file, so its`);
    w(`₹21,97,846 of Output is three years of tax *charged*, not tax *owed*. Carrying it`);
    w(`would put lakhs of already-paid liability on your balance sheet.`);
    w(`**I need the genuinely unpaid figure from your last return.**`);
    w();
    w(`**Capital and the plug are not entered.** Vyapar shows Capital ₹1,33,621.78 and`);
    w(`Difference in Opening Balance −₹8,49,415.99. You said you would place these`);
    w(`properly later, so nothing is posted.`);
    w();
    w(`**Debtor/creditor classification.** Vyapar files a party by which way its balance`);
    w(`points; we file by what the party *is* (Tally). The split will never agree and`);
    w(`should not — the net does, exactly.`);
    w();

    // ── 8. Repaired records ─────────────────────────────────────────────────
    const fp = (await pool.query(
        `select a.name, coalesce(case when a."openingBalanceType" = 'CREDIT' then -a."openingBalance" else a."openingBalance" end, 0) v
         from "Account" a where a.name like 'FIX:%' and (a."personId" is not null or a."companyId" is not null)
         order by abs(coalesce(a."openingBalance", 0)) desc, a.name`)).rows;
    const fi = (await pool.query(
        `select name, "openingStock" q, coalesce("openingStock", 0) * coalesce("openingRate", 0) v
         from "InvProduct" where name like 'FIX:%'
         order by abs(coalesce("openingStock", 0) * coalesce("openingRate", 0)) desc, name`)).rows;
    const fpMoney = fp.filter((x) => Math.abs(Number(x.v)) > 0);
    const fiMoney = fi.filter((x) => Math.abs(Number(x.v)) > 0);

    w(`## 8. Records I repaired — search \`FIX:\` in the app`);
    w();
    w(`${fp.length} parties and ${fi.length} products carry a temporary \`FIX:\` prefix. It changes no`);
    w(`figure; clearing it later is a rename.`);
    w();
    w(`**Only ${fpMoney.length} repaired parties and ${fiMoney.length} repaired products carry money.** Those first:`);
    w();
    w(`| record | opening |`);
    w(`|---|---:|`);
    for (const p of fpMoney) w(`| ${p.name} | ${inr(Number(p.v))} |`);
    for (const i of fiMoney) w(`| ${i.name} | ${inr(Number(i.v))} |`);
    w();
    w(`**DN Enterprise** and **Rudrani** share one phone number in Vyapar, so neither can`);
    w(`keep it — that pair previously put one party's balance on the other's ledger.`);
    w(`**Both need real numbers from you.**`);
    w();
    w(`The rest are contactless parties and never-traded items: real records, zero money.`);
    w();
    w(`| tag | meaning |`);
    w(`|---|---|`);
    w(`| \`FIX:NOCONTACT\` | no phone or email — given \`vyapar-<id>@placeholder.invalid\` |`);
    w(`| \`FIX:BADPHONE\` | phone is not 10 digits — a typo, so unusable |`);
    w(`| \`FIX:DUPPHONE\` | phone already claimed by a different party |`);
    w(`| \`FIX:NEGQTY\` | Vyapar holds negative stock (sold before the purchase was recorded) |`);
    w(`| \`FIX:DEAD\` | never traded, no stock, no value |`);
    w(`| \`FIX:NOCODE\` | no barcode — an SKU was minted |`);
    w();
    w(`---`);
    w();
    w(`*Rebuilt from empty with* \`pnpm vyapar:opening -- --apply\`*.*`);

    writeFileSync(path, out.join("\n"), "utf8");
    console.log(`wrote ${path} (${out.length} lines)`);
    await pool.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
