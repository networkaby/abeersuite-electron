// TEMPORARY measurement — delete once the voucher-save round-trip work is done.
//
// Counts the SQL statements the voucher-save hot path issues, with NO database
// and no network. A recording stub stands in for Prisma's TransactionClient, so
// every delegate call is one statement that would have gone over the wire. The
// statement count is what the optimisation is reducing; multiply by the
// round-trip time to Supabase to get the wait the cashier actually feels.
//
// Run: pnpm exec cross-env NODE_PATH=<stub> tsx src/scripts/count-save-stmts.ts

import type { Prisma } from "@/generated/prisma/client";
import { engineGlArm } from "@/modules/accountancy/lib/transactionEngine";
import { recordStockMovementsBatch } from "@/modules/inventory/lib/stockMovement";
import { buildInvVoucherGlLines } from "@/modules/accountancy/lib/postInvVoucher";
import { postVoucherInTx } from "@/modules/inventory/lib/postVoucherInTx";

type Call = { key: string };
let calls: Call[] = [];

function makeTx(): Prisma.TransactionClient {
    const spine: { id: number; date: Date; type: string; voucherNo: string | null; sourceCounterId: number | null; status: string } =
        { id: 9001, date: new Date(), type: "SALE", voucherNo: null, sourceCounterId: null, status: "DRAFT" };
    // A Proxy standing in for every model delegate. It is not a TransactionClient
    // in the type system's eyes, but it answers every call the code under test
    // makes, which is the whole point.
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
                        // Stateful on purpose: engineGlArm flips the spine to POSTED and
                        // stamps its number, and the tail block afterwards only numbers a
                        // spine that is still DRAFT and still unnumbered. A stub that
                        // always answered "DRAFT, no number" would hide whether that guard
                        // holds — and a voucher numbered twice is two numbers burnt per
                        // sale and a hole in the register.
                        if (model === "universalVoucher" && op === "update") {
                            spine.status = "POSTED";
                            spine.voucherNo = spine.voucherNo ?? "01-SV-26-27-0010";
                            return Promise.resolve({ id: spine.id });
                        }
                        if (model === "universalVoucher" && op === "findUnique") return Promise.resolve({ ...spine });
                        if (model === "universalVoucher" && op === "create") return Promise.resolve({ id: spine.id });
                        if (model === "booksConfig") return Promise.resolve({ id: 1, restartMonth: 4, restartDay: 1 });
                        if (model === "voucherSeries" && op === "findUnique") {
                            // Shaped like a real VoucherSeries row so assembleReference
                            // can actually build a number (partOrder is a CSV it splits).
                            return Promise.resolve({
                                kind: "SALE", nextSeq: 10, startFrom: 1, fyStartYear: 2026, resetGen: 0,
                                partOrder: "counter,type,year,number", typeEnabled: true, typeValue: "SV",
                                yearEnabled: true, yearFormat: "FY_SHORT", padding: 4, separator: "-",
                            });
                        }
                        if (model === "voucherSeriesCounter") {
                            return Promise.resolve({ kind: "SALE", counterNumber: 1, nextSeq: 11, startFrom: 1, fyStartYear: 2026, resetGen: 0 });
                        }
                        if (op === "findMany") return Promise.resolve([]);
                        if (op === "findUnique" || op === "findFirst") return Promise.resolve(null);
                        return Promise.resolve({ id: 1 });
                    };
                },
            });
        },
    }) as unknown as Prisma.TransactionClient;
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
    // A FRESH stub per section. The spine stub is stateful (it remembers that it
    // has been numbered), so sharing one would let an earlier section's posting
    // make a later one look as though it skipped numbering.
    let tx = makeTx();

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
    tx = makeTx();

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
    tx = makeTx();

    // ── The whole post arm, as the create route now runs it in ONE transaction.
    //    This really executes postVoucherInTx against the recording stub, so a
    //    missing field or a wrong branch shows up here rather than at a till.
    await postVoucherInTx(tx, {
        voucher: {
            id: 501, universalVoucherId: 9001, type: "SALE", branchId: "BR-HQ",
            destinationBranchId: null, placeOfSupply: "19", deliveryMode: "COUNTER",
            partyType: null, partyId: null,
            settlementJson: { tenders: [{ accountId: 14, amount: 1180 }], charges: [] },
            partyJson: null,
            // subtotal is the sum of line amounts and is tax-INCLUSIVE here, so it
            // equals the bill total on a voucher with no shipping / discount / round-off.
            subtotal: 1180, taxAmount: 180, shippingAmt: 0, roundOff: 0, totalAmount: 1180,
            universalVoucher: { date: new Date(), voucherNo: null, description: "probe", branch: { gstStateCode: "19" } },
            lines: Array.from({ length: LINES }, (_, i) => ({
                productId: 100 + i, quantity: 2, rate: 100, amount: 200,
                product: { id: 100 + i, stock: 50 },
            })),
        },
        userId: 1, sellerStateCode: "19", buyerStateCode: "19",
    });
    report(`postVoucherInTx — whole post arm, ${LINES} lines (create+post path)`);
    tx = makeTx();

    // ── A stock-only kind (CHALLAN): no GL entry, so the tail block is what
    //    flips its spine to POSTED and gives it its number. This is the case the
    //    `journalEntryId == null` guard above must keep working — look for
    //    universalVoucher.updateMany and the voucherSeries* numbering below.
    await postVoucherInTx(tx, {
        voucher: {
            id: 502, universalVoucherId: 9001, type: "CHALLAN", branchId: "BR-HQ",
            destinationBranchId: null, placeOfSupply: null, deliveryMode: "COUNTER",
            partyType: null, partyId: null, settlementJson: null, partyJson: null,
            subtotal: 0, taxAmount: 0, shippingAmt: 0, roundOff: 0, totalAmount: 0,
            universalVoucher: { date: new Date(), voucherNo: null, description: "probe challan", branch: { gstStateCode: "19" } },
            lines: Array.from({ length: LINES }, (_, i) => ({
                productId: 100 + i, quantity: 2, rate: 100, amount: 200,
                product: { id: 100 + i, stock: 50 },
            })),
        },
        userId: 1, sellerStateCode: "", buyerStateCode: "",
    });
    report(`postVoucherInTx — CHALLAN (stock only, no GL), ${LINES} lines`);
    tx = makeTx();

    // ── Stock arm: one move per item line.
    await recordStockMovementsBatch(tx, Array.from({ length: LINES }, (_, i) => ({
        universalVoucherId: 9001, productId: 100 + i, branchId: "BR-HQ",
        date: new Date(), inQty: 0, outQty: 2, rate: 100, amount: 200,
        productCurrentStock: 50,
    })));
    report(`recordStockMovementsBatch — ${LINES} item lines`);
}

main().catch((e) => { console.error("FAILED:", e?.stack ?? e); process.exit(1); });
