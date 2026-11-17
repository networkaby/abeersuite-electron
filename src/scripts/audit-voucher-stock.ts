// Read-only audit — does every voucher's STOCK LEDGER match its GOODS LINES?
//
// `recompute-caches.ts` answers a narrower question: does the cached on-hand equal
// Σ(ledger)? That passes even when the ledger itself is wrong for a voucher (rows
// left behind by an edit, rows on a DRAFT spine, a posted sale that moved nothing).
// This script audits the voucher→ledger relationship instead, per (voucher, product).
//
// Checks:
//   A  ledger rows on a DRAFT spine        — counted in on-hand, invisible in the UI
//   B  ledger rows on a soft-DELETED spine — same
//   C  CANCELLED spine not netting to zero — counter-entry missing/partial
//   D  POSTED stock-moving voucher with goods lines but NO ledger rows
//   E  POSTED voucher: ledger qty ≠ line qty for a product (edit drift)
//   F  POSTED voucher: ledger row for a product with NO matching line (removed line leftover)
//
// PHYSICAL_STOCK (delta semantics) and BRANCH_TRANSFER (two netting rows) are
// excluded from the qty checks E/F — their ledger qty is intentionally not the
// line qty. They are still covered by A/B/C.
//
// Run:  pnpm tsx src/scripts/audit-voucher-stock.ts
//       pnpm tsx src/scripts/audit-voucher-stock.ts --all   (print every row, not the first 25)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawUrl = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SHOW_ALL = process.argv.includes("--all");
const n = (v: unknown) => Number(v ?? 0);
const EPS = 0.0005;
const key = (uv: number, pid: number) => `${uv}|${pid}`;

// Same classification the post route uses (vouchers/[id]/post/route.ts).
const IN_TYPES  = ["PURCHASE", "GRN", "REJECTION_IN", "SALE_RETURN"];
// POS / POS_RETURN post through /api/pos/* rather than the voucher post route, but
// their stock direction is the same — include them or the counter sales (the bulk
// of the ledger) escape the qty comparison entirely.
const OUT_TYPES = ["SALE", "POS", "ONLINE_INVOICE", "CHALLAN", "REJECTION_OUT", "PURCHASE_RETURN"];
// Never move stock on post — a ledger row here is itself suspicious.
const NO_STOCK_TYPES = ["SALES_ORDER", "PURCHASE_ORDER", "POS_ESTIMATE", "POS_ORDER", "ONLINE_ORDER"];
// Bespoke stock semantics — excluded from the qty comparison only.
const SPECIAL_TYPES = ["PHYSICAL_STOCK", "MANUFACTURING_JOURNAL", "BRANCH_TRANSFER"];

type Finding = { code: string; uv: number; voucherNo: string; type: string; status: string; productId: number; sku: string; detail: string };

async function main() {
    const [ledgerRows, lineRows] = await Promise.all([
        prisma.invStockLedger.groupBy({ by: ["universalVoucherId", "productId"], _sum: { inQty: true, outQty: true }, _count: { _all: true } }),
        prisma.voucherInventoryLine.groupBy({ by: ["universalVoucherId", "productId"], _sum: { quantity: true, freeQty: true } }),
    ]);

    const spineIds = [...new Set([
        ...ledgerRows.map((r) => r.universalVoucherId),
        ...lineRows.map((r) => r.universalVoucherId),
    ])];
    const productIds = [...new Set([
        ...ledgerRows.map((r) => r.productId),
        ...lineRows.map((r) => r.productId),
    ])];

    const [spines, products] = await Promise.all([
        prisma.universalVoucher.findMany({
            where:  { id: { in: spineIds } },
            select: { id: true, type: true, status: true, voucherNo: true, date: true, cancelledAt: true },
        }),
        prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } }),
    ]);
    const spineById   = new Map(spines.map((s) => [s.id, s]));
    const productById = new Map(products.map((p) => [p.id, p]));

    const ledgerByKey = new Map(ledgerRows.map((r) => [key(r.universalVoucherId, r.productId), r]));
    const lineByKey   = new Map(lineRows.map((r) => [key(r.universalVoucherId, r.productId), r]));

    const findings: Finding[] = [];
    const push = (code: string, uv: number, productId: number, detail: string) => {
        const s = spineById.get(uv);
        findings.push({
            code, uv, productId, detail,
            voucherNo: s?.voucherNo ?? "(none)",
            type:      s?.type ?? "(orphan spine)",
            status:    s?.status ?? "?",
            sku:       productById.get(productId)?.sku ?? String(productId),
        });
    };

    // ── Walk every (voucher, product) pair seen in EITHER table ──────────────
    for (const k of new Set([...ledgerByKey.keys(), ...lineByKey.keys()])) {
        const [uvStr, pidStr] = k.split("|");
        const uv  = Number(uvStr);
        const pid = Number(pidStr);
        const spine = spineById.get(uv);
        const led = ledgerByKey.get(k);
        const lin = lineByKey.get(k);

        const ledgerNet = led ? n(led._sum.inQty) - n(led._sum.outQty) : 0;
        const hasLedger = led != null && led._count._all > 0;

        if (!spine) {
            if (hasLedger) push("X", uv, pid, `ledger rows point at a spine that no longer exists (net ${ledgerNet})`);
            continue;
        }

        // A / B / C — lifecycle states where the ledger must not carry weight.
        if (hasLedger && spine.status === "DRAFT") {
            push("A", uv, pid, `DRAFT spine carries ${led!._count._all} ledger row(s), net ${ledgerNet}`);
            continue;
        }
        if (hasLedger && spine.status === "CANCELLED" && Math.abs(ledgerNet) > EPS) {
            push("C", uv, pid, `CANCELLED spine does not net to zero — net ${ledgerNet}`);
            continue;
        }
        if (spine.status !== "POSTED") continue;

        if (hasLedger && NO_STOCK_TYPES.includes(spine.type)) {
            push("F", uv, pid, `${spine.type} must never move stock, but ledger nets ${ledgerNet}`);
            continue;
        }
        if (SPECIAL_TYPES.includes(spine.type)) continue;   // bespoke qty semantics

        const isIn  = IN_TYPES.includes(spine.type);
        const isOut = OUT_TYPES.includes(spine.type);
        if (!isIn && !isOut) {
            // Unknown type carrying stock — don't silently skip it (that is how the
            // first run of this script reported CLEAN while never checking POS).
            if (hasLedger || lin) push("U", uv, pid, `type "${spine.type}" is not classified by this audit — verify by hand`);
            continue;
        }

        const lineQty = lin ? n(lin._sum.quantity) + n(lin._sum.freeQty) : 0;
        const expected = isIn ? lineQty : -lineQty;

        if (lin && !hasLedger && lineQty > 0) {
            push("D", uv, pid, `POSTED ${spine.type} has a goods line (qty ${lineQty}) but NO stock ledger row`);
            continue;
        }
        if (!lin && hasLedger && Math.abs(ledgerNet) > EPS) {
            push("F", uv, pid, `ledger nets ${ledgerNet} but the voucher has no line for this product (removed-line leftover)`);
            continue;
        }
        if (hasLedger && Math.abs(ledgerNet - expected) > EPS) {
            push("E", uv, pid, `ledger nets ${ledgerNet}, lines expect ${expected} (Δ ${ledgerNet - expected})`);
        }
    }

    // ── Report ───────────────────────────────────────────────────────────────
    const LABEL: Record<string, string> = {
        A: "ledger rows on a DRAFT spine (counted in on-hand, hidden in the UI)",
        B: "ledger rows on a soft-DELETED spine",
        C: "CANCELLED spine whose ledger does not net to zero",
        D: "POSTED stock voucher with a goods line but NO ledger row",
        E: "POSTED voucher where ledger qty ≠ line qty (edit drift)",
        F: "ledger rows with no matching line / on a no-stock voucher type",
        X: "ledger rows pointing at a missing spine",
        U: "voucher type not classified by this audit (unchecked)",
    };

    console.log(`audited ${spineIds.length} vouchers · ${ledgerRows.length} (voucher,product) ledger groups · ${lineRows.length} line groups\n`);

    if (findings.length === 0) {
        console.log("CLEAN ✓ — every voucher's stock ledger matches its goods lines.");
        return;
    }

    const byCode = new Map<string, Finding[]>();
    for (const f of findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);

    for (const code of ["A", "B", "C", "D", "E", "F", "X", "U"]) {
        const rows = byCode.get(code);
        if (!rows?.length) continue;
        console.log(`[${code}] ${LABEL[code]} — ${rows.length}`);
        for (const f of (SHOW_ALL ? rows : rows.slice(0, 25))) {
            console.log(`    UV-${f.uv} ${f.voucherNo} (${f.type}/${f.status})  product ${f.productId} ${f.sku}: ${f.detail}`);
        }
        if (!SHOW_ALL && rows.length > 25) console.log(`    … ${rows.length - 25} more (run with --all)`);
        console.log("");
    }

    console.log(`TOTAL ${findings.length} finding(s).`);
    process.exitCode = 1;
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(process.exitCode ?? 0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
