// TEMPORARY — delete with the other voucher-save measurement scripts.
//
// READ-ONLY. Times sequential `SELECT 1` round trips to the database, because a
// round trip is the unit the voucher-save work was reducing: the saving in
// seconds is (statements removed) x (this number). Writes nothing, reads nothing
// but a constant.
//
// Run: VERIFY_TARGET=live pnpm exec tsx src/scripts/measure-db-rtt.ts

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const N = 25;

function clean(u: string) { return u.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, ""); }
function hide(u: string) { return u.replace(/:\/\/[^@]*@/, "://***@"); }

async function timeOne(label: string, raw: string | undefined) {
    if (!raw) { console.log(`  ${label.padEnd(22)} (not set)`); return null; }
    const conn = clean(raw);
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(conn);
    const pool = new Pool({ connectionString: conn, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 1 });
    try {
        const c = await pool.connect();
        try {
            await c.query("SELECT 1");          // warm the connection; not counted
            const ms: number[] = [];
            for (let i = 0; i < N; i++) {
                const t = process.hrtime.bigint();
                await c.query("SELECT 1");
                ms.push(Number(process.hrtime.bigint() - t) / 1e6);
            }
            ms.sort((a, b) => a - b);
            const median = ms[Math.floor(ms.length / 2)];
            console.log(`  ${label.padEnd(22)} median ${median.toFixed(2)} ms   (min ${ms[0].toFixed(2)}, max ${ms[ms.length - 1].toFixed(2)})   ${hide(conn)}`);
            return median;
        } finally { c.release(); }
    } catch (e) {
        console.log(`  ${label.padEnd(22)} unreachable — ${e instanceof Error ? e.message : String(e)}`);
        return null;
    } finally { await pool.end(); }
}

async function main() {
    console.log(`\nSequential round-trip cost, ${N} samples each (read-only):\n`);
    const pooled = await timeOne("Supabase (pooler)", process.env.DATABASE_URL);
    const direct = await timeOne("Supabase (direct)", process.env.DIRECT_URL);
    const local  = await timeOne("local replica", process.env.LOCAL_DATABASE_URL);

    const rtt = pooled ?? direct;
    if (rtt) {
        const removed = 26;   // ~49 statements before, ~23 after, 5-line cash sale
        console.log(
            `\nFrom THIS machine, ${removed} fewer statements is about ` +
            `${((removed * rtt) / 1000).toFixed(2)} s off one 5-line sale.`,
        );
        console.log(
            "That is the number a till on WRITE_MODE=live pays, because it talks to\n" +
            "Supabase itself. Under v_live the statements run on Vercel (bom1) against\n" +
            "Supabase (ap-south-1) — same city — so each one costs far less there; the\n" +
            "relay hop from the shop is paid once per HTTP request either way.",
        );
    }
    if (local) {
        console.log(`\nOffline (WRITE_MODE=local) the same 26 statements are worth about ${(26 * local).toFixed(0)} ms — loopback, so the change is real but not felt.`);
    }
    console.log();
}

main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
