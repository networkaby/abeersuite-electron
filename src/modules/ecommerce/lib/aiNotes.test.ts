import test from "node:test";
import assert from "node:assert/strict";
import { splitRemovals } from "./photoChecklist";
import { openList } from "./productAdmin";

const r = (url: string, why: string, kind?: string) => ({ url, why, kind });
const urls = (xs: { url: string }[]) => xs.map((x) => x.url);

test("removals: only with another photo of the view; last and untagged are held", () => {
    const kinds = new Map([["a", "front"], ["b", "front"], ["c", "box_back"]]);
    const x = splitRemovals(["a", "b", "c", "d"], [r("b", "quality"), r("c", "quality"), r("d", "quality")], kinds);
    assert.deepEqual([urls(x.gone), urls(x.held)], [["b"], ["c", "d"]]);
    assert.deepEqual(urls(splitRemovals(["a"], [r("a", "irrelevant")], kinds).held), ["a"]);
});

test("removals: two copies of one view never both go", () => {
    const x = splitRemovals(["a", "b"], [r("a", "duplicate", "front"), r("b", "duplicate", "front")], new Map());
    assert.deepEqual([urls(x.gone), urls(x.held)], [["a"], ["b"]]);
});

test("removals: a replacement added in the same run counts", () => {
    assert.deepEqual(urls(splitRemovals(["a"], [r("a", "quality", "front")], new Map([["n", "front"]]), ["n"]).gone), ["a"]);
});

test("open list: reason, flags, closed and temporary pass", () => {
    const saved = [{ text: "Old brand", level: "fix" as const, part: 4, at: "x", asideAt: "y" }];
    const closed = [{ text: "Done flag", level: "fix" as const, raisedBy: "AI", at: "x", by: "AI", how: "fixed" as const }];
    const out = openList(saved, "STOPPED (Part 1) — No label\nLast run: Part 1", ["New flag", "Done flag", "Old brand."], closed);
    assert.deepEqual(out.map((p) => p.text), ["No label", "New flag", "Old brand"]);
    assert.deepEqual(openList([], "Check the unit\nWas Unpublished before this check.", []).map((p) => p.text), ["Check the unit"]);
});
