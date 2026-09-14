/**
 * Backfill the trade detail of vouchers the Vyapar replay wrote without one.
 *
 * The replay (replay.ts) posts each Vyapar invoice through the accounting engine:
 * a UniversalVoucher spine, its GL legs and its InvStockLedger rows. It never
 * wrote the VoucherDetail row or the VoucherInventoryLine goods lines, so every
 * replayed sale is invisible to the Sales register (which lists detail rows) and
 * fails to open from the Day Book ("Failed to load voucher for editing" — the
 * form's GET /api/inventory/vouchers/<detailId> has no row to find).
 *
 * This script rebuilds both from what the replay DID write, so the numbers on the
 * detail tie to the posted ledger to the paisa:
 *   • goods lines  — one per InvStockLedger row (qty, ex-tax value); the voucher's
 *                    tax legs (CGST+SGST+IGST) are spread over the lines in
 *                    proportion to value, the last line absorbing the rounding
 *   • subtotal     — Σ line amount (tax-inclusive, as calcVoucherTotals defines it)
 *   • discountAmt  — the Discount Allowed leg
 *   • shippingAmt  — the Shipping Income leg (charged to the customer)
 *   • charges      — Loyalty Points Redeemed as a signed (negative) charge row; a
 *                    sale with no goods lines carries its taxable value as a
 *                    charge to Sales A/c instead, so the form has a row to show
 *   • roundOff     — whatever remains between those parts and the GL total, so
 *                    totalAmount = subtotal + shipping − discount + roundOff + charges
 *   • tenders      — every other debit leg (cash / bank / UPI …) plus the party's
 *                    own outstanding leg, in settlementJson, the shape the form and
 *                    the GL builder already read
 *   • partyJson    — name, primary phone and address of the party behind
 *                    UniversalVoucher.partyAccountId (Person or Company)
 *
 * Idempotent: a spine that already has a VoucherDetail is skipped, and every
 * voucher is written in its own transaction. Dry-run by default.
 *
 *   pnpm vyapar:backfill-details -- --date 2026-09-10               # plan only
 *   pnpm vyapar:backfill-details -- --date 2026-09-10 --apply
 *   pnpm vyapar:backfill-details -- --from 2026-04-01 --to 2026-09-14 --apply
 *   pnpm vyapar:backfill-details -- --date 2026-09-10 --type SALE   # default type
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool, type PoolClient } from "pg";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];

type GlLeg = { id: number; accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string | null };
type StockRow = { productId: number; qty: number; amount: number };

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const type = arg("--type") ?? "SALE";
    const date = arg("--date");
    const from = arg("--from") ?? date;
    const to = arg("--to") ?? date;
    if (!from || !to) throw new Error("pass --date YYYY-MM-DD, or --from and --to");
    if (type !== "SALE") throw new Error(`only SALE is modelled so far (asked for ${type})`);

    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
    if (!url) throw new Error("no DIRECT_URL / DATABASE_URL");
    const pool = new Pool({ connectionString: url, max: 1 });
    const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
    console.log(`${apply ? "APPLY" : "DRY RUN"} · ${type} · ${from} → ${to} · db ${host}\n`);

    const c = await pool.connect();
    try {
        // Ledgers the replay's spec builder posts a sale against (voucherSpec.ts).
        const L = await ledgers(c, ["Sales A/c", "CGST", "SGST", "IGST", "Discount Allowed", "Loyalty Points Redeemed", "Shipping Income", "Round Off"]);

        const spines = (await c.query(
            `select u.id, u."voucherNo", u.date::text as date, u."partyAccountId", u.status
               from "UniversalVoucher" u
               left join "VoucherDetail" d on d."universalVoucherId" = u.id
              where u.type = $1 and u.date between $2::date and $3::date
                and u."deletedAt" is null and d.id is null
              order by u.date, u.id`,
            [type, from, to],
        )).rows as Array<{ id: number; voucherNo: string | null; date: string; partyAccountId: number | null; status: string }>;
        console.log(`${spines.length} ${type} voucher(s) without a detail row in the window\n`);

        let written = 0, problems = 0;
        for (const s of spines) {
            const label = `${s.voucherNo ?? "UV-" + s.id} (${s.date.slice(0, 10)}, spine ${s.id})`;
            try {
                const plan = await buildPlan(c, s, L);
                console.log(`${label}: ${plan.lines.length} line(s), total ${inr(plan.totalAmount)}, party ${plan.partyName ?? "—"}, tenders ${plan.tenders.length}${plan.notes.length ? " · " + plan.notes.join("; ") : ""}`);
                if (apply) {
                    await writePlan(c, s.id, plan);
                    written++;
                }
            } catch (e) {
                problems++;
                console.log(`${label}: SKIPPED — ${(e as Error).message}`);
            }
        }
        console.log(`\n${apply ? `wrote ${written}` : `would write ${spines.length - problems}`}, ${problems} problem(s)`);
        if (problems) process.exitCode = 1;
    } finally {
        c.release();
        await pool.end();
    }
}

async function ledgers(c: PoolClient, names: string[]): Promise<Record<string, number>> {
    const rows = (await c.query(`select id, name from "Account" where name = any($1)`, [names])).rows as Array<{ id: number; name: string }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.name] = Number(r.id);
    const missing = names.filter((n) => out[n] == null);
    if (missing.length) throw new Error(`ledger(s) not found: ${missing.join(", ")}`);
    return out;
}

type Plan = {
    lines: Array<{ productId: number; quantity: number; rate: number; taxRate: number; taxAmount: number; amount: number }>;
    subtotal: number; taxAmount: number; totalAmount: number;
    discountAmt: number | null; shippingAmt: number; roundOff: number;
    tenders: Array<{ accountId: number; amount: number; method: null; reference: null }>;
    charges: Array<{ accountId: number; amount: number; description: string | null; taxAmount: number | null }>;
    partyJson: { name: string | null; phone: string | null; address: string | null } | null;
    partyType: string | null; partyId: number | null; partyName: string | null;
    notes: string[];
};

async function buildPlan(c: PoolClient, s: { id: number; partyAccountId: number | null }, L: Record<string, number>): Promise<Plan> {
    const notes: string[] = [];
    const legs = (await c.query(
        `select id, "accountId", type, amount::float8 as amount, description from "VoucherGlLine" where "universalVoucherId" = $1 order by seq, id`,
        [s.id],
    )).rows as GlLeg[];
    if (legs.length === 0) throw new Error("no GL legs");
    const stock = (await c.query(
        `select "productId", "outQty"::float8 as qty, amount::float8 as amount from "InvStockLedger" where "universalVoucherId" = $1 order by id`,
        [s.id],
    )).rows as StockRow[];

    const sum = (pred: (l: GlLeg) => boolean) => r2(legs.filter(pred).reduce((t, l) => t + (l.type === "DEBIT" ? l.amount : -l.amount), 0));
    const credit = (acct: number) => -sum((l) => l.accountId === acct);   // credits positive
    const taxable   = credit(L["Sales A/c"]);
    const tax       = r2(credit(L.CGST) + credit(L.SGST) + credit(L.IGST));
    const shipping  = credit(L["Shipping Income"]);
    const discount  = sum((l) => l.accountId === L["Discount Allowed"]);
    const loyalty   = sum((l) => l.accountId === L["Loyalty Points Redeemed"]);
    const roundLeg  = sum((l) => l.accountId === L["Round Off"]);
    const partyAcct = s.partyAccountId;
    const known = new Set([L["Sales A/c"], L.CGST, L.SGST, L.IGST, L["Shipping Income"], L["Discount Allowed"], L["Loyalty Points Redeemed"], L["Round Off"]]);
    // What the customer settled or owes: every debit leg that is not a known
    // sale-side ledger. The party's own leg is the outstanding (AR) row.
    const tenders = legs
        .filter((l) => l.type === "DEBIT" && !known.has(l.accountId))
        .map((l) => ({ accountId: l.accountId, amount: r2(l.amount), method: null as null, reference: null as null }));
    const totalAmount = r2(tenders.reduce((t, x) => t + x.amount, 0));
    // A bill discounted to nothing has no tender or outstanding leg at all —
    // two such sales exist (100% Discount Allowed against the sale value).
    if (totalAmount <= 0 && discount + loyalty <= 0) throw new Error("no tender / outstanding leg — nothing was received or owed");
    if (totalAmount <= 0) notes.push("zero-total bill (fully discounted)");
    const stray = legs.filter((l) => l.type === "CREDIT" && !known.has(l.accountId) && l.accountId !== partyAcct);
    if (stray.length) notes.push(`unexpected credit leg(s) on account ${stray.map((l) => l.accountId).join(",")}`);

    // Goods lines from the stock rows. Tax is spread by ex-tax value; the last
    // line takes the rounding so Σ taxAmount equals the tax legs exactly.
    const stockValue = r2(stock.reduce((t, r) => t + r.amount, 0));
    const lines: Plan["lines"] = [];
    let taxLeft = tax;
    stock.forEach((r, i) => {
        const value = r2(r.amount);
        const last = i === stock.length - 1;
        const lineTax = last ? r2(taxLeft) : (stockValue > 0 ? r2(tax * value / stockValue) : 0);
        taxLeft = r2(taxLeft - lineTax);
        const rawRate = value > 0 ? (lineTax / value) * 100 : 0;
        const slab = GST_SLABS.find((x) => Math.abs(x - rawRate) < 0.35);
        lines.push({
            productId: r.productId,
            quantity:  r3(r.qty),
            rate:      r.qty > 0 ? r2(value / r.qty) : 0,
            taxRate:   slab ?? r2(rawRate),
            taxAmount: lineTax,
            amount:    r2(value + lineTax),
        });
    });
    if (stock.length && Math.abs(stockValue - taxable) > 0.02) notes.push(`stock value ${inr(stockValue)} ≠ sales leg ${inr(taxable)}`);

    const charges: Plan["charges"] = [];
    if (!stock.length && taxable > 0) {
        // Vyapar allows an invoice with a total and no items. Carry its value as a
        // charge to Sales A/c so the form has one row and the total still foots.
        charges.push({ accountId: L["Sales A/c"], amount: taxable, description: "Un-itemised sale (Vyapar)", taxAmount: tax || null });
        notes.push("no goods lines — value carried as a Sales A/c charge");
    }
    if (loyalty > 0) charges.push({ accountId: L["Loyalty Points Redeemed"], amount: -loyalty, description: "Loyalty points redeemed", taxAmount: null });

    // calcVoucherTotals: subtotal = Σ line.amount (incl. tax);
    // total = subtotal + shipping − discount + roundOff + chargesNet.
    const subtotal = r2(lines.reduce((t, l) => t + l.amount, 0));
    const taxAmount = lines.length ? r2(lines.reduce((t, l) => t + l.taxAmount, 0)) : tax;
    const chargesNet = r2(charges.reduce((t, x) => t + x.amount, 0));
    const roundOff = r2(totalAmount - (subtotal + shipping - discount + chargesNet));
    if (Math.abs(roundOff) > 2 + Math.abs(roundLeg)) throw new Error(`does not foot: round-off would be ${inr(roundOff)}`);

    // Party snapshot from the live account (person or company).
    let partyJson: Plan["partyJson"] = null, partyType: string | null = null, partyId: number | null = null, partyName: string | null = null;
    if (partyAcct != null) {
        const a = (await c.query(`select name, "personId", "companyId" from "Account" where id = $1`, [partyAcct])).rows[0] as { name: string; personId: number | null; companyId: number | null } | undefined;
        if (a?.personId != null) {
            const p = (await c.query(
                `select p.name, p.address, (select phone from "Phone" where "personId" = p.id order by "isPrimary" desc, id limit 1) as phone from "Person" p where p.id = $1`, [a.personId],
            )).rows[0] as { name: string; address: string | null; phone: string | null } | undefined;
            partyType = "customer"; partyId = a.personId; partyName = p?.name ?? a.name;
            partyJson = { name: partyName, phone: p?.phone ?? null, address: p?.address ?? null };
        } else if (a?.companyId != null) {
            const p = (await c.query(
                `select p.name, p.address, (select phone from "Phone" where "companyId" = p.id order by "isPrimary" desc, id limit 1) as phone from "Company" p where p.id = $1`, [a.companyId],
            )).rows[0] as { name: string; address: string | null; phone: string | null } | undefined;
            partyType = "company"; partyId = a.companyId; partyName = p?.name ?? a.name;
            partyJson = { name: partyName, phone: p?.phone ?? null, address: p?.address ?? null };
        } else if (a) {
            partyType = "account"; partyName = a.name;
            partyJson = { name: a.name, phone: null, address: null };
        }
    }

    return { lines, subtotal, taxAmount, totalAmount, discountAmt: discount > 0 ? discount : null, shippingAmt: shipping, roundOff, tenders, charges, partyJson, partyType, partyId, partyName, notes };
}

async function writePlan(c: PoolClient, spineId: number, p: Plan): Promise<void> {
    await c.query("begin");
    try {
        // Re-check inside the transaction so two runs cannot both insert.
        const dup = await c.query(`select id from "VoucherDetail" where "universalVoucherId" = $1`, [spineId]);
        if (dup.rowCount) throw new Error("detail row appeared meanwhile");
        await c.query(
            `insert into "VoucherDetail" ("universalVoucherId", "partyJson", "partyType", "partyId",
                                          "discountAmt", "shippingAmt", "shippingTaxAmt", "roundOff",
                                          subtotal, "taxAmount", "totalAmount", "settlementJson", "updatedAt")
             values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, now())`,
            [spineId, p.partyJson ? JSON.stringify(p.partyJson) : null, p.partyType, p.partyId,
             p.discountAmt, p.shippingAmt, p.roundOff, p.subtotal, p.taxAmount, p.totalAmount,
             JSON.stringify({ tenders: p.tenders, charges: p.charges })],
        );
        const existing = await c.query(`select count(*)::int as n from "VoucherInventoryLine" where "universalVoucherId" = $1`, [spineId]);
        if (existing.rows[0].n === 0) {
            for (const l of p.lines) {
                await c.query(
                    `insert into "VoucherInventoryLine" ("universalVoucherId", "productId", quantity, rate, "discountPct", "discountAmt", "taxRate", "taxAmount", amount)
                     values ($1, $2, $3, $4, 0, 0, $5, $6, $7)`,
                    [spineId, l.productId, l.quantity, l.rate, l.taxRate, l.taxAmount, l.amount],
                );
            }
        }
        await c.query("commit");
    } catch (e) {
        await c.query("rollback");
        throw e;
    }
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exitCode = 1; });
