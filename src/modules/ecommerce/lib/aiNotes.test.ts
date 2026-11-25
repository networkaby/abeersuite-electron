import test from "node:test";
import assert from "node:assert/strict";
import { isKept, splitRemovals, stillInGallery, viewsLost } from "./photoChecklist";
import { attentionAgain, draftOf, nextStep, prepHistory, raiseProblems, raisedLine, withProblems } from "./productAdmin";

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

test("a wrong product's photo takes its view's tick away, unless another photo shows it", () => {
    const tags = new Map([["a", "front"], ["b", "front"], ["c", "back"]]);
    assert.deepEqual([...viewsLost([r("a", "irrelevant"), r("c", "irrelevant")], ["a", "b", "c"], tags)], ["back"]);
    assert.deepEqual([...viewsLost([r("x", "irrelevant", "front")], ["c"], tags)], ["front"]);
    assert.deepEqual([...viewsLost([r("x", "irrelevant")], ["c"], tags)], []);
});

test("a removed photo found in the gallery again is offered for Remove, a kept one is not", () => {
    assert.deepEqual(urls(stillInGallery([r("a", "irrelevant"), r("b", "irrelevant"), r("z", "quality")], ["a", "b", "c"], ["b"])), ["a"]);
});

test("removals: a replacement added in the same run counts", () => {
    assert.deepEqual(urls(splitRemovals(["a"], [r("a", "quality", "front")], new Map([["n", "front"]]), ["n"]).gone), ["a"]);
});

const row = (shopDraftJson: unknown, shopAttention: string | null) => ({ shopDraftJson, shopStatus: "ATTENTION" as const, shopAttention });
const texts = (x: ReturnType<typeof draftOf>) => (x?.problems ?? []).map((p) => p.text);

test("an old row: reason and flags join the one list, dated; closed and passed ones are not raised again", () => {
    const old = {
        problems: [{ text: "Old brand", level: "fix", part: 4, at: "x", asideAt: "y" }],
        closed: [{ text: "Done flag", level: "fix", raisedBy: "AI", at: "x", by: "AI", how: "fixed" }],
        aiCopy: { flags: ["New flag", "Done flag", "Old brand."], notes: ["n"] }, notes: ["old"],
    };
    const x = draftOf(row(old, "STOPPED (Part 1) — No label\nLast run: Part 1"));
    assert.deepEqual(texts(x), ["No label", "New flag", "Old brand"]);
    assert.ok(x?.problems?.every((p) => p.at));
    assert.equal(x?.problems?.[0].part, 1);
    assert.deepEqual(x?.aiCopy?.flags, []);
    assert.deepEqual(texts(draftOf(row(null, "Check the unit\nWas Unpublished before this check."))), ["Check the unit"]);
});

test("a new row's reason is never read back as problems", () => {
    assert.deepEqual(texts(draftOf(row({ v: 2 }, "NOTE (Part 5) — x\nsmall print"))), []);
});

test("raise: no doubles, a pass holds, what the run no longer raises is history", () => {
    const a = raiseProblems(null, [raisedLine("A", 1), raisedLine("NOTE (Part 3) — B", 5)], { by: "AI part 1" });
    assert.deepEqual(a.problems?.map((p) => [p.text, p.level, p.part]), [["A", "stop", 1], ["B", "fix", 3]]);
    const passed = withProblems(a, a.problems!.map((p) => (p.text === "B" ? { ...p, asideAt: "t" } : p)));
    const b = raiseProblems(passed, [raisedLine("b.", 4), raisedLine("C", 4)], { replaces: () => true, by: "AI part 4" });
    assert.deepEqual(texts(b), ["C", "B"]);
    assert.deepEqual(b.closed?.map((c) => [c.text, c.by]), [["A", "AI part 4"]]);
    assert.equal(b.asideCount, 1);
    assert.equal(attentionAgain("x\nNOTE (Part 1) — A", a, b), "PENDING (Part 4) — C\nx");
});

test("Ready: open AI problems go to the history, passed ones stay", () => {
    const x = raiseProblems(null, [raisedLine("A", 1)], { by: "AI" });
    const h = prepHistory(withProblems(x, [...x.problems!, { text: "P", level: "fix", part: 4, at: "x", asideAt: "y" }]), "Save as ready");
    assert.deepEqual([texts(h), h?.closed?.map((c) => c.text)], [["P"], ["A"]]);
});

test("Keep survives a new framing", () => {
    const u = "https://res.cloudinary.com/x/image/upload/v1/shop/products/a.jpg";
    assert.equal(isKept([u], u), true);
    assert.equal(isKept([u], u.replace("a.jpg", "b.jpg")), false);
    assert.equal(isKept(undefined, u), false);
});

test("next step in Attention follows the reason, not only the run list", () => {
    const at = (attention: string) => nextStep({ stage: "ATTENTION", listed: false, photos: 3, weight: true, description: true, runs: [], openProblems: 1, attention });
    assert.equal(at("NOTE (Part 4) — x\nLast run: Part 4 · 25 Nov 2026, 5:30 pm · 1 problem(s) → Attention · next: Part 5 (photos — with Part 1, no search)").part, "5");
    assert.equal(at("NOTE (Part 4) — x\nLast run: Part 4 · 25 Nov 2026 · 1 problem(s) → Attention").act, "save");
    assert.equal(at("STOPPED (Part 1) — x\nLast run: Part 1 · stopped").part, "1");
});
