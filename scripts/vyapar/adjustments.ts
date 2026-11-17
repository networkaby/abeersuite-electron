/**
 * PHASE 2b — the entries Vyapar can make and AbeerSuite cannot.
 *
 * Vyapar lets a receipt or payment carry a settlement discount in
 * `txn_discount_amount`: the customer owes ₹2,640, pays ₹2,000, and the remaining
 * ₹640 is written off on the receipt itself. AbeerSuite has no discount field on a
 * receipt or payment — the owner settles a rebate by raising a credit or debit note
 * — so the amount cannot ride on the voucher and has to become a voucher.
 *
 *   Payment-In (3) with discount  →  CREDIT_NOTE   Dr Discount Allowed · Cr party
 *   Payment-Out (4) with discount →  DEBIT_NOTE    Dr party · Cr Income Discount Received
 *
 * Each note is dated the SAME DAY as the receipt or payment it settles, so the two
 * sit together in the Day Book and on the party ledger, which is how the owner would
 * have entered it by hand.
 *
 * ── Why this is its own phase ───────────────────────────────────────────────
 * These are the only entries in the whole migration that AbeerSuite invents rather
 * than copies. Everything else is a Vyapar row transcribed into our shape; this is a
 * compensating entry for a feature gap, so it is built separately, listed in full,
 * and left for the owner to verify rather than folded quietly into the replay.
 *
 * ── How the gap was found ───────────────────────────────────────────────────
 * Not by reading Vyapar's documentation. Summing our modelled effect of every
 * transaction ever against Vyapar's own published party balance gave 3,677 of 3,754;
 * adding the discount gave 3,754 of 3,754. Those 77 parties had been dismissed a
 * week earlier as "a curiosity — 97.9% is fine". They were this, all along.
 *
 *   pnpm vyapar:adjustments              # list them, write nothing
 *   pnpm vyapar:adjustments -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { FY_START, extractItems, extractParties } from "./extract";
import { buildMaps } from "./mapping";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const PAYMENT_IN = 3, PAYMENT_OUT = 4;
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Note = {
    txnId: number; date: Date; party: string; partyAccountId: number;
    amount: number; kind: "CREDIT_NOTE" | "DEBIT_NOTE"; against: string;
};

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");
    console.log(`\ntarget: ${url.replace(/^.*@/, "")}`);

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-adj"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const named = (sql: string) => {
        const m = new Map<number, string>();
        for (const r of db.prepare(sql).all() as Array<Record<string, unknown>>) m.set(Number(r.id), String(r.nm).trim());
        return m;
    };
    const { maps } = await buildMaps(
        pool, extractParties(db), extractItems(db),
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        named(`select name_id id, full_name nm from kb_names where name_type = 2`),
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );

    const ledger = async (name: string) => {
        const r = await pool.query(`select id from "Account" where name = $1 limit 1`, [name]);
        if (!r.rows[0]) throw new Error(`ledger "${name}" is missing`);
        return Number(r.rows[0].id);
    };
    const discountAllowed = await ledger("Discount Allowed");
    const discountReceived = await ledger("Income Discount Received");

    const notes: Note[] = [];
    let unmapped = 0;
    for (const r of db.prepare(`
        select t.txn_id, t.txn_type ty, t.txn_name_id nid, date(t.txn_date) dt,
               coalesce(t.txn_discount_amount, 0) disc, coalesce(t.txn_cash_amount, 0) cash,
               n.full_name nm
        from kb_transactions t left join kb_names n on n.name_id = t.txn_name_id
        where t.txn_type in (?, ?) and coalesce(t.txn_discount_amount, 0) <> 0
          and date(t.txn_date) >= ? order by t.txn_date, t.txn_id`)
        .all(PAYMENT_IN, PAYMENT_OUT, FY_START) as Array<Record<string, unknown>>) {
        const acc = maps.party.get(Number(r.nid));
        if (!acc) { unmapped++; console.log(`  ⚠ txn ${r.txn_id} (${r.nm}) has no party account here`); continue; }
        const isIn = Number(r.ty) === PAYMENT_IN;
        notes.push({
            txnId: Number(r.txn_id), date: new Date(String(r.dt) + "T00:00:00Z"),
            party: String(r.nm ?? "-"), partyAccountId: acc.accountId, amount: Number(r.disc),
            kind: isIn ? "CREDIT_NOTE" : "DEBIT_NOTE",
            against: `${isIn ? "receipt" : "payment"} of ${inr(Number(r.cash))}`,
        });
    }

    console.log(`\nSETTLEMENT DISCOUNTS — Vyapar put these on the receipt/payment; we raise a note\n`);
    console.log(`  ${"date".padEnd(12)}${"note".padEnd(13)}${"amount".padStart(11)}   ${"party".padEnd(30)}settles`);
    for (const n of notes)
        console.log(`  ${n.date.toISOString().slice(0, 10).padEnd(12)}${n.kind.padEnd(13)}${inr(n.amount).padStart(11)}   ` +
            `${n.party.slice(0, 28).padEnd(30)}${n.against}`);
    const cn = notes.filter((n) => n.kind === "CREDIT_NOTE");
    const dn = notes.filter((n) => n.kind === "DEBIT_NOTE");
    console.log(`\n  ${cn.length} credit note(s) ${inr(cn.reduce((s, n) => s + n.amount, 0))}` +
        ` · ${dn.length} debit note(s) ${inr(dn.reduce((s, n) => s + n.amount, 0))}`);
    if (unmapped) console.log(`  ⚠ ${unmapped} skipped — no party account`);

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }

    // Refuse to double-post. These carry no Vyapar id on the voucher, so a second run
    // could not tell its own notes from new ones — the same trap that made the replay
    // refuse to run twice.
    const already = Number((await pool.query(
        `select count(*)::int n from "UniversalVoucher" where type in ('CREDIT_NOTE', 'DEBIT_NOTE')`)).rows[0].n);
    if (already > 0) {
        console.log(`\nREFUSING: ${already} credit/debit note(s) already exist and cannot be told from these.\n`);
        await pool.end(); close(); process.exit(1);
    }

    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { enginePost } = await import("@/modules/accountancy/lib/transactionEngine");
    const branch = (await pool.query(`select id from "Branch" order by "createdAt" limit 1`)).rows[0];
    const user = (await pool.query(`select id from "User" order by id limit 1`)).rows[0];

    let done = 0;
    for (const n of notes) {
        const amount = n.amount.toFixed(2);
        const lines = n.kind === "CREDIT_NOTE"
            ? [{ accountId: discountAllowed, type: "DEBIT", amount },
               { accountId: n.partyAccountId, type: "CREDIT", amount }]
            : [{ accountId: n.partyAccountId, type: "DEBIT", amount },
               { accountId: discountReceived, type: "CREDIT", amount }];
        await prisma.$transaction(async (tx) => {
            const res = await enginePost(tx, {
                type: n.kind, date: n.date, reference: undefined,
                narration: `settlement discount on ${n.against} (vyapar txn ${n.txnId})`,
                description: `${n.kind} ${n.txnId}`,
                glLines: lines, stockMoves: [],
            } as never, user.id, { branchId: branch.id, postedAt: n.date });
            // enginePost leaves the spine's party pointer unset, and the Day Book's
            // Party column reads that rather than the GL lines.
            if (res.universalVoucherId != null) {
                await tx.universalVoucher.update({
                    where: { id: res.universalVoucherId }, data: { partyAccountId: n.partyAccountId },
                });
            }
        }, { timeout: 60_000 });
        done++;
    }
    console.log(`\nposted ${done} note(s)\n`);
    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
