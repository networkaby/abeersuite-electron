/**
 * Carry loyalty points across, under the owner's 300-day rule.
 *
 * The rule, in the owner's words: *"since today any point earned within last 300
 * days keep them — yes they are getting extra days since new opening day is
 * 1-4-2026."* So:
 *
 *   • Points earned in the 300 days before today survive; older ones are dropped
 *     as expired.
 *   • Every surviving point is carried as ONE lot per party dated **1-Apr-2026**,
 *     the day the books open. Under the 320-day expiry that gives them until
 *     14-Feb-2027 — deliberately more life than they would have had, which the
 *     owner accepted rather than have points die weeks after changeover.
 *
 * ── Which backup, and why it matters ────────────────────────────────────────
 * The FULL backup, never the year-close file. Vyapar's Close Books kept only
 * loyalty from 2025-11-12 onward and rewrote the rest, which left 159 customers
 * with a LOWER spendable balance than they had actually earned — 66,063 points,
 * about ₹19,158, with one customer (Mahadev Saha Electrician) losing 42,676 of it.
 * That is live in the owner's Vyapar right now and is worth knowing independently
 * of this migration. The full history is the only honest source.
 *
 * ── FIFO, because a total is not a balance ──────────────────────────────────
 * Whether a point survives depends on WHEN it was earned, so redemptions have to
 * be matched against the lots they actually consumed. Replaying all 9,978 rows in
 * date order and consuming oldest-first is the only way to know which points are
 * left. Two wrinkles, both handled:
 *
 *   • Vyapar's points are fractional (19.09); ours are whole. Rounding per lot
 *     drifts the party total, so the party balance is rounded ONCE.
 *   • 42,314 points were redeemed beyond what was ever earned — Vyapar allowed a
 *     negative balance. FIFO cannot, so those redemptions take what exists and the
 *     shortfall is reported, never forced.
 *
 *   pnpm vyapar:loyalty              # report only
 *   pnpm vyapar:loyalty -- --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { extractItems, extractParties } from "./extract";
import { buildMaps } from "./mapping";
import { openVyb } from "./openVyb";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The FULL history — the year-close file lost points people had actually earned. */
const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
/** Owner's rule: keep what was earned in the last 300 days, measured from today. */
const KEEP_DAYS = 300;
/** Every surviving point is carried as one lot dated the day the books open. */
const LOT_DATE = new Date("2026-04-01T00:00:00Z");

type Lot = { at: Date; left: number };

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const cutoff = new Date(today.getTime() - KEEP_DAYS * 86_400_000);

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-loy"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const cfg = (await pool.query(
        `select enabled e, "redeemValue" v, "expiryDays" d from "LoyaltyConfig" limit 1`)).rows[0];
    if (!cfg) throw new Error("no LoyaltyConfig row");
    console.log(`\ntarget: ${url.replace(/^.*@/, "")}`);
    console.log(`keeping points earned on or after ${cutoff.toISOString().slice(0, 10)}` +
        ` (${KEEP_DAYS} days before ${today.toISOString().slice(0, 10)})`);
    console.log(`carried as one lot per party dated ${LOT_DATE.toISOString().slice(0, 10)}` +
        ` → expires ${new Date(LOT_DATE.getTime() + Number(cfg.d) * 86_400_000).toISOString().slice(0, 10)}`);
    console.log(`loyalty is currently ${cfg.e ? "ON" : "OFF"} · redeem value ₹${cfg.v}/point`);

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

    // ── Replay every row FIFO to find which lots are still unconsumed ───────
    const lots = new Map<number, Lot[]>();
    const totals = new Map<number, { earned: number; redeemed: number }>();
    let overRedeemed = 0;
    const overParties = new Set<number>();

    for (const r of db.prepare(`
        select party_id pid, point_rewarded e, point_redeemed rd, rewarded_date dt
        from loyalty_txn where party_id is not null order by rewarded_date, id
    `).all() as Array<Record<string, unknown>>) {
        const pid = Number(r.pid);
        const earned = Number(r.e), redeemed = Number(r.rd);
        const L = lots.get(pid) ?? []; lots.set(pid, L);
        const t = totals.get(pid) ?? { earned: 0, redeemed: 0 }; totals.set(pid, t);

        if (earned > 0) {
            L.push({ at: new Date(String(r.dt).slice(0, 10) + "T00:00:00Z"), left: earned });
            t.earned += earned;
        }
        if (redeemed > 0) {
            t.redeemed += redeemed;
            let need = redeemed;
            for (const lot of L) {
                if (need <= 0.0001) break;
                const take = Math.min(lot.left, need);
                lot.left -= take; need -= take;
            }
            if (need > 0.01) { overRedeemed += need; overParties.add(pid); }
        }
    }

    // ── Keep only what was earned inside the window ─────────────────────────
    type Plan = { accountId: number; points: number; earned: number; redeemed: number };
    const plans: Plan[] = [];
    let carried = 0, expired = 0, unmapped = 0;

    for (const [pid, L] of lots) {
        const live = L.filter((l) => l.at >= cutoff).reduce((s, l) => s + l.left, 0);
        const dead = L.filter((l) => l.at < cutoff).reduce((s, l) => s + l.left, 0);
        expired += dead;
        const points = Math.round(live);
        if (points <= 0) continue;
        const acc = maps.party.get(pid);
        if (!acc) { unmapped += points; continue; }
        const t = totals.get(pid)!;
        plans.push({ accountId: acc.accountId, points, earned: Math.round(t.earned), redeemed: Math.round(t.redeemed) });
        carried += points;
    }

    const f = (n: number) => Math.round(n).toLocaleString("en-IN");
    const rs = (n: number) => "₹" + Math.round(n * Number(cfg.v)).toLocaleString("en-IN");
    console.log(`\n  carried  ${f(carried).padStart(10)} points  ${rs(carried).padStart(12)}   across ${plans.length} parties`);
    console.log(`  expired  ${f(expired).padStart(10)} points  ${rs(expired).padStart(12)}   earned before the cutoff, dropped`);
    if (unmapped) console.log(`  ⚠ ${f(unmapped)} points belong to parties with no account here`);
    if (overRedeemed > 0.01) {
        console.log(`  ⓘ ${f(overRedeemed)} points were redeemed beyond what was earned, across ${overParties.size} parties.`);
        console.log(`    Vyapar allowed a negative balance; FIFO cannot, so those redemptions took what existed.`);
    }

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }

    // ── Write ───────────────────────────────────────────────────────────────
    // Clear first. Re-running otherwise doubles every balance, and the previous
    // build of this data carried 9.39 lakh points under the old all-history rule —
    // stale rows that a later run must replace, not add to.
    console.log(`\nAPPLYING …`);
    const wiped = await pool.query(`delete from "LoyaltyLedger"`);
    const wipedLots = await pool.query(`delete from "LoyaltyLot"`);
    await pool.query(`update "LoyaltyAccount" set "totalEarned" = 0, "totalRedeemed" = 0`);
    console.log(`  cleared ${wipedLots.rowCount} lot(s) and ${wiped.rowCount} ledger row(s)`);

    const user = (await pool.query(`select id from "User" order by id limit 1`)).rows[0];
    for (const p of plans) {
        await pool.query(
            `insert into "LoyaltyAccount" ("accountId", "totalEarned", "totalRedeemed", "createdAt", "updatedAt")
             values ($1, $2, $3, now(), now())
             on conflict ("accountId") do update set "totalEarned" = $2, "totalRedeemed" = $3, "updatedAt" = now()`,
            [p.accountId, p.earned, p.redeemed]);
        await pool.query(
            `insert into "LoyaltyLot" ("accountId", "universalVoucherId", "pointsEarned", "pointsRemaining", "earnedAt", "createdAt")
             values ($1, null, $2, $2, $3, now())`, [p.accountId, p.points, LOT_DATE]);
        await pool.query(
            `insert into "LoyaltyLedger" ("accountId", "universalVoucherId", delta, reason, "balanceAfter", note, "createdById", "createdAt")
             values ($1, null, $2, 'ADMIN_ADJUST'::"LoyaltyReason", $2, $3, $4, now())`,
            [p.accountId, p.points,
             `carried from Vyapar — earned within ${KEEP_DAYS} days to ${today.toISOString().slice(0, 10)}`, user.id]);
    }
    console.log(`  wrote ${plans.length} account(s), ${f(carried)} points`);
    if (!cfg.e) console.log(`\n  ⓘ loyalty is OFF, so none of this is spendable until it is switched on.`);
    console.log("");

    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
