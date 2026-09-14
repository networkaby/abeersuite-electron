// TEMPORARY measurement — delete once the voucher-save round-trip work is done.
//
// Counts the SQL statements the voucher-save hot path issues, with NO database
// and no network. A recording stub stands in for Prisma's TransactionClient, so
// every delegate call is one statement that would have gone over the wire. The
// statement count is what the optimisation is reducing; multiply by the
// round-trip time to Supabase to get the wait the cashier actually feels.
//
// Run: pnpm exec cross-env NODE_PATH=<stub> tsx src/scripts/count-save-stmts.ts

import { engineGlArm } from "@/modules/accountancy/lib/transactionEngine";
import { recordStockMovementsBatch } from "@/modules/inventory/lib/stockMovement";
import { buildInvVoucherGlLines } from "@/modules/accountancy/lib/postInvVoucher";

type Call = { key: string };
let calls: Call[] = [];

function makeTx(): never extends never ? any : never {
    const spine = { id: 9001, date: new Date(), type: "SALE", voucherNo: null, sourceCounterId: null, status: "DRAFT" };
    return new Proxy({}, {
        get(_t, model: string) {
            if (typeof model !== "string") return undefined;
            if (model === "then") return undefined;
            if (model.startsWith("$")) {
                return (...__a: unknown[]) => {
                    calls.push({ key: `raw.${model}` });
                    // $queryRaw callers expect rows; the ledger loader reads a list.
                    if (model === "$queryRaw" || model === "$queryRawUnsafe") {
                        return Promise.resolve([
                            { id: 11, name: "Sales A/c",   normalBalance: "CREDIT", groupType: "INCOME" },
                            { id: 12, name: "CGST Output", normalBalance: "CREDIT", groupType: "LIABILITY" },
                            { id: 13, name: "SGST Output", normalBalance: "CREDIT", groupType: "LIABILITY" },
                            { id: 14, name: "Cash",        normalBalance: "DEBIT",  groupType: "ASSET" },
                        ]);
                    }
                    return Promise.resolve(1);
                };
            }
            return new Proxy({}, {
                get(_t2, op: string) {
                    return (args: { where?: { id?: { in?: number[] } } }) => {
                        calls.push({ key: `${model}.${op}` });
                        if (model === "account" && op === "findMany") {
                            const ids = args?.where?.id?.in ?? [];
                            return Promise.resolve(ids.map((id) => ({ id, normalBalance: "DEBIT", group: { type: "ASSET" } })));
                        }
                        if (model === "account" && op === "findFirst") {
                            return Promise.resolve({ id: 1, name: "Stub Ledger", normalBalance: "CREDIT", group: { type: "INCOME" } });
                        }
                        if (model === "universalVoucher" && op === "findUnique") return Promise.resolve(spine);
                        if (model === "universalVoucher" && op === "create") return Promise.resolve({ id: spine.id });
                        if (model === "booksConfig") return Promise.resolve({ id: 1, restartMonth: 4, restartDay: 1 });
                        if (model === "voucherSeries" && op === "findUnique") {
                            return Promise.resolve({ kind: "SALE", nextSeq: 10, fyStartYear: 2026, resetGen: 0, prefix: "SV", padding: 4, separator: "-", format: "PREFIX_FY_SEQ" });
                        }
                        if (model === "voucherSeriesCounter") {
                            return Promise.resolve({ kind: "SALE", counterNumber: 1, nextSeq: 11, fyStartYear: 2026, resetGen: 0 });
                        }
                        if (op === "findMany") return Promise.resolve([]);
                        if (op === "findUnique" || op === "findFirst") return Promise.resolve(null);
                        return Promise.resolve({ id: 1 });
                    };
                },
            });
        },
    });
}

function report(label: string) {
    const byKey = new Map<string, number>();
    for (const c of calls) byKey.set(c.key, (byKey.get(c.key) ?? 0) + 1);
    console.log(`\n=== ${label} — ${calls.length} statements ===`);
    for (const [k, n] of [...byKey].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        console.log(`  ${String(n).padStart(3)}  ${k}`);
    }
    calls = [];
    return byKey;
}

async function main() {
    const LINES = 5;
    const tx = makeTx();

    // ── GL builder: how many statements just to find the ledgers by name.
    // NB the stub answers the FIRST candidate name every time, so this is the
    // BEST case; a shop whose chart uses the second or third spelling pays more.
    await buildInvVoucherGlLines(tx, {
        id: 1, type: "SALE", reference: null, date: new Date(), description: "probe",
        partyJson: null, subtotal: 1000, taxAmount: 180, shippingAmt: 0, roundOff: 0,
        totalAmount: 1180, sellerStateCode: "19", buyerStateCode: "19",
        tenders: [{ accountId: 14, amount: 1180 }], charges: [],
    });
    report("buildInvVoucherGlLines — ledger lookups by name");

    // ── GL arm: a 5-line cash sale posts Sales + CGST + SGST + one Cash tender.
    const glLines = [
        { accountId: 11, type: "CREDIT" as const, amount: 1000, description: "Sales" },
        { accountId: 12, type: "CREDIT" as const, amount: 90, description: "Output CGST" },
        { accountId: 13, type: "CREDIT" as const, amount: 90, description: "Output SGST" },
        { accountId: 14, type: "DEBIT" as const, amount: 1180, description: "Cash" },
    ];
    await engineGlArm(tx, {
        date: new Date(), description: "probe", lines: glLines, userId: 1,
        branchId: "BR-HQ", postedAt: new Date(), type: "SALE", existingSpineId: 9001,
    });
    report(`engineGlArm — ${glLines.length} GL lines (incl. numbering)`);

    // ── Stock arm: one move per item line.
    await recordStockMovementsBatch(tx, Array.from({ length: LINES }, (_, i) => ({
        universalVoucherId: 9001, productId: 100 + i, branchId: "BR-HQ",
        date: new Date(), inQty: 0, outQty: 2, rate: 100, amount: 200,
        productCurrentStock: 50,
    })));
    report(`recordStockMovementsBatch — ${LINES} item lines`);
}

main().catch((e) => { console.error("FAILED:", e?.stack ?? e); process.exit(1); });
