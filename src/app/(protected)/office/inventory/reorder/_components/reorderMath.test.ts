// Unit tests: Reorder report row maths. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilterOptions, compareReorderRows, groupItemRows, buildBandSections, type ReorderRow, type Band } from "./reorderMath";

const row = (o: Partial<ReorderRow>): ReorderRow => ({
    id: 1, name: "Item", signal: "ok", shortfall: 0, isLow: false, group: null, brand: null, category: null, stock: 0, minOrderQty: null, ...o,
}) as ReorderRow;
const band = (o: Partial<Band>): Band => ({ key: "b", groupName: null, productIds: [], isLow: false, shortfall: 0, ...o }) as Band;

test("filter options: sorted values, and whether any row has none", () => {
    const f = buildFilterOptions([row({ brand: "Zeb" }), row({ brand: "Acer" }), row({ brand: null }), row({ brand: "Acer" })]);
    assert.deepEqual(f.brand, { values: ["Acer", "Zeb"], hasNone: true });
    assert.deepEqual(f.group, { values: [], hasNone: true });
});

test("signal sort: buy before review before ok; bigger shortfall first", () => {
    const rows = [row({ id: 1, name: "a", signal: "ok" }), row({ id: 2, name: "b", signal: "buy", shortfall: 2 }), row({ id: 3, name: "c", signal: "buy", shortfall: 9 }), row({ id: 4, name: "d", signal: "review" })];
    assert.deepEqual(rows.sort((x, y) => compareReorderRows(x, y, "signal", "desc")).map((r) => r.id), [3, 2, 4, 1]);
});

test("text sort: empty brand goes last both ways; ties fall back to name", () => {
    const rows = () => [row({ name: "x", brand: null }), row({ name: "b", brand: "acer" }), row({ name: "a", brand: "Acer" })];
    assert.deepEqual(rows().sort((x, y) => compareReorderRows(x, y, "brand", "asc")).map((r) => r.name), ["a", "b", "x"]);
    assert.deepEqual(rows().sort((x, y) => compareReorderRows(x, y, "brand", "desc")).map((r) => r.name), ["a", "b", "x"]);
});

test("group sections: low items first, keeps the given row order, 'No brand' bucket", () => {
    const g = groupItemRows([row({ id: 1, brand: "Acer" }), row({ id: 2, brand: null, isLow: true, shortfall: 3 }), row({ id: 3, brand: "Acer" })], "brand");
    assert.deepEqual(g.map((s) => [s.name, s.items.map((r) => r.id), s.lowCount, s.totalShortfall]), [
        ["No brand", [2], 1, 3],
        ["Acer", [1, 3], 0, 0],
    ]);
    assert.deepEqual(groupItemRows([row({})], "item"), []);
});

test("band sections: group view = one home; brand view repeats a band under each brand", () => {
    const rows = new Map([[1, row({ id: 1, brand: "Acer" })], [2, row({ id: 2, brand: "HP" })]]);
    const b = band({ productIds: [1, 2], groupName: "Laptops", isLow: true, shortfall: 4 });
    assert.deepEqual(buildBandSections([b], "group", rows).map((s) => s.name), ["Laptops"]);
    assert.deepEqual(buildBandSections([b], "brand", rows).map((s) => s.name).sort(), ["Acer", "HP"]);
    assert.deepEqual(buildBandSections([b], "item", rows), []);
});
