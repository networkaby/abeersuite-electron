// Unit tests: how many statements a POS sale's shared steps send. Over the
// internet each one is a wait for the cashier, so a rise here must be deliberate.
// No database: a fake driver that finds every row and records the SQL.
// Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import type { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

// `server-only` exists only inside a Next build; outside one it is an empty module.
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = (request, ...rest) => (request === "server-only" ? {} : load(request, ...rest));
const code = async () => ({
    ...(await import("@/modules/accountancy/lib/balance")),
    ...(await import("@/modules/accountancy/lib/transactionEngine")),
    ...(await import("@/modules/inventory/lib/stockMovement")),
});

const sql: string[] = [];
const TEXT = 7, NUMBER = 0, BOOL = 5;
const TEXT_COLUMNS = /^(kind|label|yearFormat|partOrder|typeValue)$/;
const FLAG_COLUMNS = /Enabled$/;
const EMPTY_COLUMNS = /At$|From$|fyStartYear/;
const conn = {
    provider: "postgres", adapterName: "fake",
    queryRaw: async ({ sql: text }: { sql: string }) => {
        sql.push(text);
        const list = text.match(/RETURNING ([\s\S]*)$/)?.[1] ?? text.match(/^SELECT ([\s\S]*?) FROM/)?.[1] ?? "";
        const columnNames = list.split(", ").map((c) => c.replace(/.*\."/, "").replace(/"/g, ""));
        return {
            columnNames,
            columnTypes: columnNames.map((c) => (TEXT_COLUMNS.test(c) ? TEXT : FLAG_COLUMNS.test(c) ? BOOL : NUMBER)),
            rows: [columnNames.map((c) => (TEXT_COLUMNS.test(c) ? "x" : FLAG_COLUMNS.test(c) ? false : EMPTY_COLUMNS.test(c) ? null : 1))],
        };
    },
    executeRaw: async ({ sql: text }: { sql: string }) => { sql.push(text); return 1; },
    executeScript: async () => { },
    dispose: async () => { },
    getConnectionInfo: () => ({ supportsRelationJoins: false }),
    options: { usePhantomQuery: false },
    commit: async () => { },
    rollback: async () => { },
};
const client = new PrismaClient({
    adapter: {
        provider: "postgres", adapterName: "fake",
        connect: async () => ({ ...conn, startTransaction: async () => conn }),
    } as unknown as PrismaPg,
});

/** The statements `run` sends, without the transaction's own COMMIT. */
async function sent(run: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string[]> {
    sql.length = 0;
    await client.$transaction(async (tx) => { await run(tx); });
    return sql.filter((s) => s !== "COMMIT");
}

test("taking a voucher number: four statements", async () => {
    const { nextRefFromSeries } = await code();
    const got = await sent((tx) => nextRefFromSeries(tx, "POS", 2));
    assert.equal(got.length, 4, got.join("\n"));
});

test("a bill created Posted: one insert of the voucher, no re-read, no update", async () => {
    const { engineCreateSpine, enginePost, postedDescription } = await code();
    const got = await sent(async (tx) => {
        const id = await engineCreateSpine(tx, {
            type: "POS", status: "POSTED", voucherNo: "T-1", date: new Date(), branchId: "B", userId: 1, shiftId: 1,
            description: postedDescription("POS", "T-1", "Walk-in"), narration: "Walk-in",
        });
        await enginePost(tx, {
            type: "POS", date: new Date(), reference: "T-1", narration: "Walk-in", stockMoves: [],
            glLines: [{ accountId: 1, type: "DEBIT", amount: 10 }, { accountId: 2, type: "CREDIT", amount: 10 }],
        }, 1, { branchId: "B", existingSpineId: id, spineBornPosted: true });
    });
    const spine = got.filter((s) => s.includes('"UniversalVoucher"'));
    assert.equal(spine.length, 1, spine.join("\n"));
    assert.match(spine[0], /^INSERT/);
    assert.equal(got.filter((s) => /^INSERT[^(]*"VoucherGlLine"/.test(s)).length, 1);
});

test("stock: three statements for one line or ten", async () => {
    const { recordStockMovementsBatch } = await code();
    const line = (productId: number) => ({ universalVoucherId: 1, productId, branchId: "B", date: new Date(), inQty: 0, outQty: 1, rate: 1, amount: 1 });
    for (const n of [1, 10]) {
        const got = await sent((tx) => recordStockMovementsBatch(tx, Array.from({ length: n }, (_, i) => line(i + 1))));
        assert.equal(got.length, 3, got.join("\n"));
    }
});
