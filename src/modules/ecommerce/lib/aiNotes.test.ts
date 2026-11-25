import test from "node:test";
import assert from "node:assert/strict";
import { splitRemovals } from "./photoChecklist";
import { nextStep, openList } from "./productAdmin";

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
    assert.deepEqual(openList([], "PENDING (Part 5) — No photo — take it", []), [{ text: "No photo — take it", level: "stop", part: 5, at: "" }]);
    assert.deepEqual(openList([], "Check the unit\nWas Unpublished before this check.", []).map((p) => p.text), ["Check the unit"]);
});

test("next step in Attention follows the reason, not only the run list", () => {
    const at = (attention: string) => nextStep({ stage: "ATTENTION", listed: false, photos: 3, weight: true, description: true, runs: [], openProblems: 1, attention });
    assert.equal(at("NOTE (Part 4) — x\nLast run: Part 4 · 25 Nov 2026, 5:30 pm · 1 problem(s) → Attention · next: Part 5 (photos — with Part 1, no search)").part, "5");
    assert.equal(at("NOTE (Part 4) — x\nLast run: Part 4 · 25 Nov 2026 · 1 problem(s) → Attention").act, "save");
    assert.equal(at("STOPPED (Part 1) — x\nLast run: Part 1 · stopped").part, "1");
});
