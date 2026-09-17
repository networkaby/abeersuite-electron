// Prove the sync push refuses to resurrect a voucher line the office has already
// replaced — and, just as importantly, that it lets every ordinary counter write
// through. Nothing is left behind: every write happens inside one transaction that
// ends in a deliberate throw.
//
// The hazard it guards. `VoucherGlLine` and `VoucherInventoryLine` carry no
// `updatedAt`, so push.ts has no timestamp to arbitrate them with and each push is an
// unconditional upsert. The office edit routes delete a voucher's lines and re-create
// them with fresh ids, so a counter still holding an unpushed `_outbox` row for one of
// the discarded ids would re-create it under a still-POSTED voucher — unbalancing it,
// and drifting Account.balance, which is re-summed from the line table and trusts it.
//
// What it proves:
//
//   1. POS sale, one batch — a counter's own lines under its own voucher: APPLIED.
//   2. POS sale, split batch — the tail of a sale whose first lines are already
//      upstream: APPLIED. This is the false positive that would eat real money, and
//      it is why the guard cannot simply refuse lines on a POSTED voucher.
//   3. Handover accept — spine inserted already POSTED, lines after it: APPLIED.
//   4. Resurrection — the office rewrote the line set, a counter replays a discarded
//      line: DROPPED.
//   5. A cloud-range incoming id is never this guard's business: APPLIED.
//   6. A table that does not recycle ids is never touched: APPLIED.
//
// 1-6 again for VoucherInventoryLine, which the same office edit discards.
//
// Two notes on running it. It needs `server-only` resolvable — Next aliases that at
// build time and it is not on disk, so a bare `tsx` run fails before reaching any of
// this (verify-bill-links.ts has the same problem). And a rollback does not rewind a
// SEQUENCE, so each run consumes two line ids; the rows themselves never survive.
//
// Run: pnpm verify:line-resurrection

import * as dotenv from "dotenv";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import type { LineDelegate } from "@/shared/lib/sync/push";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const ROLLBACK = "ROLLBACK_OK";
const results: { name: string; ok: boolean; note?: string }[] = [];

function check(name: string, ok: boolean, note?: string): void {
    results.push({ name, ok, note });
}

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { lineReplayWasSuperseded } = await import("@/shared/lib/sync/push");
    const { CLOUD_RANGE_END, blockStartFor } = await import("@/shared/lib/counter/idRange");

    // Counter 1's block, which is what a real till would mint from.
    const COUNTER = blockStartFor(1);
    const counterId = (n: number) => COUNTER + n;

    const user = await prisma.user.findFirst({ select: { id: true } });
    const account = await prisma.account.findFirst({ select: { id: true } });
    const product = await prisma.invProduct.findFirst({ select: { id: true } });
    if (!user || !account || !product) {
        console.log("Need at least one user, account and product to verify against — nothing done.");
        return;
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Spines are POSTED, exactly as a counter leaves them.
            const mkSpine = async (id: number) => {
                await tx.universalVoucher.create({
                    data: {
                        id, type: "POS", date: new Date(), description: "verify-line-resurrection",
                        status: "POSTED", createdById: user.id,
                        branchId: await systemBranchId(tx),
                    },
                });
                return id;
            };

            // ── VoucherGlLine ───────────────────────────────────────────────
            const glDelegate = tx.voucherGlLine as unknown as LineDelegate;
            const mkGl = (universalVoucherId: number, id: number, type: "DEBIT" | "CREDIT") =>
                tx.voucherGlLine.create({
                    data: { id, universalVoucherId, accountId: account.id, type, amount: 100 },
                });

            // (1) Counter voucher, no lines upstream yet — the first batch of a sale.
            const vSale = await mkSpine(counterId(1));
            check("GL 1. POS sale, first batch — applied",
                !(await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(10), vSale, new Map())));

            // (2) Two of its lines are already upstream; the tail arrives next batch.
            await mkGl(vSale, counterId(10), "DEBIT");
            await mkGl(vSale, counterId(11), "CREDIT");
            check("GL 2. POS sale, split batch — tail applied",
                !(await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(12), vSale, new Map())));

            // (3) Handover accept: spine already POSTED when its lines push. Same shape
            //     as (1) — the guard reads the LINES, not the spine's status.
            const vHandover = await mkSpine(counterId(2));
            check("GL 3. Handover accept, POSTED spine — applied",
                !(await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(20), vHandover, new Map())));

            // (4) The office rewrote this voucher's lines: cloud-range ids appear.
            //     A counter replaying one of the discarded lines must be refused.
            const vEdited = await mkSpine(counterId(3));
            await mkGl(vEdited, counterId(30), "DEBIT");          // counter's original
            await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: vEdited } });
            const office = await tx.voucherGlLine.create({
                data: { universalVoucherId: vEdited, accountId: account.id, type: "DEBIT", amount: 250 },
            });
            check("GL 4a. office replacement really is cloud-range",
                office.id < CLOUD_RANGE_END, `office line id ${office.id}`);
            check("GL 4b. Resurrection — dropped",
                await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(30), vEdited, new Map()));

            // (5) A cloud-range incoming id was not minted by a counter.
            check("GL 5. cloud-range incoming id — applied",
                !(await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", office.id, vEdited, new Map())));

            // (6) A table that does not recycle ids is never touched.
            check("GL 6. non-recycled table — applied",
                !(await lineReplayWasSuperseded(glDelegate, "PosShift", counterId(30), vEdited, new Map())));

            // The memo must return the same answer without re-querying.
            const memo = new Map<number, boolean>();
            const first = await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(30), vEdited, memo);
            const again = await lineReplayWasSuperseded(glDelegate, "VoucherGlLine", counterId(31), vEdited, memo);
            check("GL 7. memo holds one answer per voucher", first && again && memo.get(vEdited) === true);

            // ── VoucherInventoryLine — the same office edit discards these too ──
            const invDelegate = tx.voucherInventoryLine as unknown as LineDelegate;
            const mkInv = (universalVoucherId: number, id?: number) =>
                tx.voucherInventoryLine.create({
                    data: {
                        ...(id != null ? { id } : {}),
                        universalVoucherId, productId: product.id, quantity: 1, rate: 100, amount: 100,
                    },
                });

            const vInv = await mkSpine(counterId(4));
            check("INV 1. POS sale, first batch — applied",
                !(await lineReplayWasSuperseded(invDelegate, "VoucherInventoryLine", counterId(40), vInv, new Map())));

            await mkInv(vInv, counterId(40));
            check("INV 2. POS sale, split batch — tail applied",
                !(await lineReplayWasSuperseded(invDelegate, "VoucherInventoryLine", counterId(41), vInv, new Map())));

            const vInvEdited = await mkSpine(counterId(5));
            await mkInv(vInvEdited, counterId(50));
            await tx.voucherInventoryLine.deleteMany({ where: { universalVoucherId: vInvEdited } });
            const officeInv = await mkInv(vInvEdited);
            check("INV 3a. office replacement really is cloud-range",
                officeInv.id < CLOUD_RANGE_END, `office line id ${officeInv.id}`);
            check("INV 3b. Resurrection — dropped",
                await lineReplayWasSuperseded(invDelegate, "VoucherInventoryLine", counterId(50), vInvEdited, new Map()));
            check("INV 4. cloud-range incoming id — applied",
                !(await lineReplayWasSuperseded(invDelegate, "VoucherInventoryLine", officeInv.id, vInvEdited, new Map())));

            throw new Error(ROLLBACK);
        }, { timeout: 60_000, maxWait: 15_000 });
    } catch (e) {
        if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
    }

    let failed = 0;
    for (const r of results) {
        if (!r.ok) failed++;
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? `  (${r.note})` : ""}`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed. Everything rolled back.`);
    // Set the code and let the pool close itself. `process.exit()` here tears the
    // connection down mid-flight and libuv aborts on Windows — after a clean run, so
    // it reads as a failure that never happened.
    process.exitCode = failed === 0 ? 0 : 1;
    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
