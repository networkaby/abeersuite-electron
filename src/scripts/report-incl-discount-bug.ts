// REPORT ONLY — lists saved Sale / Purchase lines whose discount was worked out
// on a GST-inclusive price. Never writes: the queries run inside a READ ONLY
// transaction, so even a bug here cannot change a row.
//
// The bug (fixed 2026-10-25, see exclusiveRate in tradingVoucherKinds.ts): in
// "Price (incl)" mode the discount % → ₹ editor took the % of the typed price
// with GST still inside it. The server trusts the discount ₹ it is sent, so the
// wrong figure was saved:
//
//   ₹118 incl 18%, qty 1, 10% off → saved disc ₹11.80, GST ₹15.88, amount ₹104.08
//                                   should be      ₹10.00,     ₹16.20,        ₹106.20
//
// The saved `rate` is already the exclusive price (₹100), so each line with a
// discount % and a GST % is checked against both formulas:
//
//   disc = qty × rate × (1 + GST/100) × pct/100  → "incl discount": the bug
//   disc = qty × rate × pct/100                  → correct — skipped
//
// A second check lists lines whose GST % is not a real slab (the GST ₹ editor
// had the same bug and saved e.g. 15.25% for 18%). Those need a person to say
// what the slab should have been, so no "should be" is printed for them.
//
// It is a likely case, not a proven one: a discount ₹ typed by hand can match
// the bug formula by chance. A PERSON decides what to do about each bill.
//
//   pnpm report:incl-discount                    print the list
//   pnpm report:incl-discount --csv out.csv      also write it as CSV

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { scriptDbUrl } from "@/shared/lib/db/dbTargets";

const rawUrl = scriptDbUrl()
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 1 });

const csvAt = process.argv.indexOf("--csv");
const CSV = csvAt > 0 ? process.argv[csvAt + 1] : null;
const r2 = (v: number) => Math.round(v * 100) / 100;
const SLABS = [0, 0.25, 3, 5, 12, 18, 28];

type Row = {
    voucherNo: string; type: string; date: string; status: string; item: string;
    qty: number; rate: number; discPct: number; gstPct: number;
    savedDisc: number; shouldDisc: number | null; savedAmount: number; shouldAmount: number | null;
    diff: number | null; match: "incl discount" | "odd GST %";
};

async function main() {
    const client = await pool.connect();
    let lines: Array<Record<string, unknown>>;
    try {
        await client.query("BEGIN READ ONLY");
        ({ rows: lines } = await client.query(`
            SELECT v."voucherNo", v.type, to_char(v.date, 'YYYY-MM-DD') AS date, v.status::text AS status,
                   p.name AS item, l.quantity, l.rate, l."discountPct", l."discountAmt",
                   l."taxRate", l.amount
              FROM "VoucherInventoryLine" l
              JOIN "UniversalVoucher" v ON v.id = l."universalVoucherId"
              JOIN "InvProduct" p ON p.id = l."productId"
             WHERE v."cancelledAt" IS NULL AND l."taxRate" > 0
             ORDER BY v.date, v.id, l.id`));
        await client.query("COMMIT");
    } finally {
        client.release();
    }

    const out: Row[] = [];
    for (const l of lines) {
        const qty = Number(l.quantity), rate = Number(l.rate), pct = Number(l.discountPct);
        const gst = Number(l.taxRate), savedDisc = Number(l.discountAmt), savedAmount = Number(l.amount);
        const base = {
            voucherNo: String(l.voucherNo), type: String(l.type), date: String(l.date), status: String(l.status),
            item: String(l.item), qty, rate, discPct: pct, gstPct: gst, savedDisc, savedAmount,
        };
        if (!SLABS.includes(gst)) {
            out.push({ ...base, shouldDisc: null, shouldAmount: null, diff: null, match: "odd GST %" });
            continue;
        }
        if (pct <= 0) continue;
        const gross = qty * rate;
        const good = r2(gross * pct / 100);
        const bad = r2(gross * (1 + gst / 100) * pct / 100);
        // rate is stored to 2dp, so allow a paisa plus that rounding carried through.
        const tol = 0.011 + qty * 0.005 * (1 + gst / 100) * pct / 100;
        if (Math.abs(savedDisc - good) <= tol || Math.abs(savedDisc - bad) > tol) continue;
        const shouldAmount = r2((gross - good) * (1 + gst / 100));
        out.push({ ...base, shouldDisc: good, shouldAmount, diff: r2(shouldAmount - savedAmount), match: "incl discount" });
    }

    if (out.length === 0) {
        console.log("No lines found — nothing was saved with the inclusive-price discount bug.");
    } else {
        console.table(out.map((o) => ({
            bill: o.voucherNo, type: o.type, date: o.date, status: o.status, item: o.item.slice(0, 30),
            qty: o.qty, rate: o.rate, "disc%": o.discPct, "gst%": o.gstPct,
            "saved disc": o.savedDisc, "should disc": o.shouldDisc ?? "?",
            "saved amt": o.savedAmount, "should amt": o.shouldAmount ?? "?", "short by": o.diff ?? "?", match: o.match,
        })));
        const bad = out.filter((o) => o.match === "incl discount");
        const bills = new Set(out.map((o) => o.voucherNo)).size;
        console.log(`\n${out.length} line(s) on ${bills} bill(s).`);
        console.log(`  incl discount: ${bad.length} line(s), amount short by ₹${r2(bad.reduce((s, o) => s + (o.diff ?? 0), 0)).toFixed(2)} in total`);
        console.log(`  odd GST %:     ${out.length - bad.length} line(s) — check the slab by hand`);
    }

    if (CSV) {
        const cols = ["voucherNo", "type", "date", "status", "item", "qty", "rate", "discPct", "gstPct",
            "savedDisc", "shouldDisc", "savedAmount", "shouldAmount", "diff", "match"] as const;
        const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        writeFileSync(CSV, [cols.join(","), ...out.map((o) => cols.map((c) => esc(o[c])).join(","))].join("\n") + "\n");
        console.log(`CSV written: ${CSV}`);
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => pool.end());
