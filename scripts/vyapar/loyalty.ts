/**
 * Carry Vyapar's loyalty points across, keeping each lot's ORIGINAL earn date.
 *
 * The owner chose to apply AbeerSuite's 320-day expiry to the real earn dates
 * rather than restart the clock, so roughly ₹1.19L of old points retire on arrival
 * and ₹1.53L stays live. That is implemented by the data model itself rather than
 * by filtering: every surviving lot is created with the date it was actually
 * earned, and `liveBalance()` already ignores lots older than the cutoff. Nothing
 * here decides what is expired — the dates do, and they keep deciding as time
 * passes, which a one-off filter would not.
 *
 * Balances are reconstructed by replaying all 9,978 loyalty rows in date order and
 * consuming lots FIFO, because only that produces per-lot dates. Two things make it
 * awkward and both are handled rather than ignored:
 *
 *   • Vyapar's points are fractional (19.09) and ours are whole. Rounding each lot
 *     independently drifts the party's total, so the LIVE balance is rounded once
 *     per party and the difference is pushed onto that party's largest live lot.
 *     What a customer can actually spend is then exact.
 *   • 42,314 points were redeemed beyond what was ever earned — Vyapar allowed the
 *     balance to go negative. A FIFO model cannot represent that, so those
 *     redemptions consume what exists and the shortfall is reported, never forced.
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

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
/** Vyapar closed on this date; expiry is measured from it, not from whenever this runs. */
const AS_AT = new Date("2026-09-11T00:00:00Z");

type Lot = { at: Date; earned: number; left: number };

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-loy"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const cfg = (await pool.query(`select "expiryEnabled" e, "expiryDays" d, "redeemValue" v from "LoyaltyConfig"`)).rows[0];
    if (!cfg) throw new Error("no LoyaltyConfig row");
    const cutoff = cfg.e ? new Date(AS_AT.getTime() - Number(cfg.d) * 86_400_000) : new Date(0);
    console.log(`\nexpiry ${cfg.e ? `on, ${cfg.d} days → cutoff ${cutoff.toISOString().slice(0, 10)}` : "off"}` +
        ` · redeem value ₹${cfg.v}/point`);

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

    // ── Rebuild every party's lots, FIFO, in date order ─────────────────────
    const lots = new Map<number, Lot[]>();            // vyapar party id → lots
    const totals = new Map<number, { earned: number; redeemed: number }>();
    let overRedeemed = 0;
    const overParties = new Set<number>();

    for (const r of db.prepare(`
        select party_id pid, point_rewarded e, point_redeemed rd, rewarded_date rdt
        from loyalty_txn where party_id is not null order by rewarded_date, id
    `).all() as Array<Record<string, unknown>>) {
        const pid = Number(r.pid);
        const earned = Number(r.e), redeemed = Number(r.rd);
        const L = lots.get(pid) ?? []; lots.set(pid, L);
        const t = totals.get(pid) ?? { earned: 0, redeemed: 0 }; totals.set(pid, t);

        if (earned > 0) {
            L.push({ at: new Date(String(r.rdt).slice(0, 10) + "T00:00:00Z"), earned, left: earned });
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

    // ── Shape into rows, rounding the LIVE balance once per party ───────────
    type PartyPlan = { accountId: number; live: number; lots: Array<{ at: Date; earned: number; left: number }>;
                       totalEarned: number; totalRedeemed: number };
    const plans: PartyPlan[] = [];
    let unmapped = 0, liveTotal = 0, expiredTotal = 0;

    for (const [pid, L] of lots) {
        const acc = maps.party.get(pid);
        if (!acc) { unmapped++; continue; }
        const surviving = L.filter((l) => l.left > 0.0001);
        if (!surviving.length) continue;

        const liveExact = surviving.filter((l) => l.at >= cutoff).reduce((s, l) => s + l.left, 0);
        const expiredExact = surviving.filter((l) => l.at < cutoff).reduce((s, l) => s + l.left, 0);

        // Round each lot, then true the LIVE total up to the rounded party balance by
        // adjusting the largest live lot — so what the customer can spend is exact
        // even though the individual lots are approximations of fractional points.
        const rows = surviving.map((l) => ({ at: l.at, earned: Math.round(l.earned), left: Math.round(l.left) }));
        const liveRows = rows.filter((r) => r.at >= cutoff);
        const target = Math.round(liveExact);
        const drift = target - liveRows.reduce((s, r) => s + r.left, 0);
        if (drift !== 0 && liveRows.length) {
            const biggest = liveRows.reduce((a, b) => (b.left > a.left ? b : a));
            biggest.left += drift;
            biggest.earned = Math.max(biggest.earned, biggest.left);
        }

        liveTotal += target;
        expiredTotal += Math.round(expiredExact);
        const t = totals.get(pid)!;
        plans.push({
            accountId: acc.accountId, live: target, lots: rows,
            totalEarned: Math.round(t.earned), totalRedeemed: Math.round(t.redeemed),
        });
    }

    const f = (n: number) => Math.round(n).toLocaleString("en-IN");
    const rs = (n: number) => "₹" + Math.round(n * Number(cfg.v)).toLocaleString("en-IN");
    console.log(`\n${plans.length} parties carry points · ${plans.reduce((s, p) => s + p.lots.length, 0)} lots`);
    console.log(`   live    ${f(liveTotal).padStart(10)}  ${rs(liveTotal).padStart(12)}   (spendable)`);
    console.log(`   expired ${f(expiredTotal).padStart(10)}  ${rs(expiredTotal).padStart(12)}   (kept as history, not spendable)`);
    if (unmapped) console.log(`   ⚠ ${unmapped} vyapar parties hold points but have no AbeerSuite account`);
    if (overRedeemed > 0.01) {
        console.log(`   ⚠ ${f(overRedeemed)} points were redeemed beyond what was earned, across ${overParties.size} parties.`);
        console.log(`     Vyapar allowed a negative balance; FIFO cannot, so those redemptions took what existed.`);
    }

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await pool.end(); close(); return; }

    // ── Write ───────────────────────────────────────────────────────────────
    const user = (await pool.query(`select id from "User" order by id limit 1`)).rows[0];
    const existing = (await pool.query(`select count(*)::int n from "LoyaltyLot"`)).rows[0].n;
    if (Number(existing) > 0) {
        console.log(`\nREFUSING: ${existing} loyalty lot(s) already exist — this would double the balances.` +
            `\nClear them first (pnpm seed:purge-vouchers cascades them off the vouchers).\n`);
        await pool.end(); close(); process.exit(1);
    }

    let done = 0;
    for (const p of plans) {
        await pool.query(
            `insert into "LoyaltyAccount" ("accountId", "totalEarned", "totalRedeemed", "createdAt", "updatedAt")
             values ($1, $2, $3, now(), now())
             on conflict ("accountId") do update set "totalEarned" = $2, "totalRedeemed" = $3, "updatedAt" = now()`,
            [p.accountId, p.totalEarned, p.totalRedeemed],
        );
        for (const l of p.lots) {
            await pool.query(
                `insert into "LoyaltyLot" ("accountId", "universalVoucherId", "pointsEarned", "pointsRemaining", "earnedAt", "createdAt")
                 values ($1, null, $2, $3, $4, now())`,
                [p.accountId, l.earned, l.left, l.at],
            );
        }
        // One ledger row per party: the audit trail says these points were carried in,
        // which is what happened. Reconstructing 9,978 individual movements would imply
        // a history AbeerSuite did not record.
        await pool.query(
            `insert into "LoyaltyLedger" ("accountId", "universalVoucherId", delta, reason, "balanceAfter", note, "createdById", "createdAt")
             values ($1, null, $2, 'ADMIN_ADJUST'::"LoyaltyReason", $2, $3, $4, now())`,
            [p.accountId, p.live, `carried from Vyapar as at ${AS_AT.toISOString().slice(0, 10)}`, user.id],
        );
        done++;
    }
    console.log(`\nwrote ${done} loyalty accounts\n`);

    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
