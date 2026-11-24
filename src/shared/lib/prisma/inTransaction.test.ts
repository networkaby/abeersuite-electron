// Unit tests: telling a transaction's reads apart. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { inTransaction } from "./inTransaction";

// No database: just enough of a driver adapter to open and close a transaction.
const conn = {
    provider: "postgres", adapterName: "fake",
    queryRaw: async () => ({ columnNames: [], columnTypes: [], rows: [] }),
    executeRaw: async () => 0,
    executeScript: async () => { },
    dispose: async () => { },
    getConnectionInfo: () => ({ supportsRelationJoins: false }),
    options: { usePhantomQuery: false },
    commit: async () => { },
    rollback: async () => { },
};
const adapter = {
    provider: "postgres", adapterName: "fake",
    connect: async () => ({ ...conn, startTransaction: async () => conn }),
} as unknown as PrismaPg;

const seen: boolean[] = [];
const client = new PrismaClient({ adapter }).$extends({
    query: {
        $allModels: {
            async $allOperations(params) {
                seen.push(inTransaction(params));
                return 0 as never;
            },
        },
    },
});

test("a plain read is not in a transaction", async () => {
    seen.length = 0;
    await client.invProduct.count();
    assert.deepEqual(seen, [false]);
});

test("a read inside an interactive transaction is", async () => {
    seen.length = 0;
    await client.$transaction(async (tx) => { await tx.invProduct.count(); });
    assert.deepEqual(seen, [true]);
});

test("a read inside an array transaction is", async () => {
    seen.length = 0;
    await client.$transaction([client.invProduct.count()]);
    assert.deepEqual(seen, [true]);
});
