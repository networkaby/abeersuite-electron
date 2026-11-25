import { test } from "node:test";
import assert from "node:assert/strict";
import { overReturnedProduct } from "./returnQty";

const l = (productId: number, quantity: number) => ({ productId, quantity });

test("a return that fits what is left passes", () => {
    assert.equal(overReturnedProduct([l(1, 2)], new Map([[1, 1]]), [l(1, 1)]), null);
});
test("another return already covers it", () => {
    assert.equal(overReturnedProduct([l(1, 1)], new Map([[1, 1]]), [l(1, 1)]), 1);
});
test("two lines of one product count together", () => {
    assert.equal(overReturnedProduct([l(1, 1), l(1, 1)], new Map(), [l(1, 1), l(1, 2)]), 1);
});
test("a product that was never sold is refused", () => {
    assert.equal(overReturnedProduct([l(1, 1)], new Map(), [l(2, 1)]), 2);
});
