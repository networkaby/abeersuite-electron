import { test } from "node:test";
import assert from "node:assert/strict";
import { LifecycleError, refuseInventoryDocument } from "./voucherLifecycle";

const fakeDb = (hasDoc: boolean) => ({
    voucherDetail: { findUnique: async () => (hasDoc ? { id: 7 } : null) },
}) as unknown as Parameters<typeof refuseInventoryDocument>[0];

test("a bill or stock document is refused on the accountancy routes", async () => {
    await assert.rejects(refuseInventoryDocument(fakeDb(true), 42), (e) => e instanceof LifecycleError && e.httpStatus === 409);
});

test("a payment / receipt / journal passes", async () => {
    await refuseInventoryDocument(fakeDb(false), 42);
});
