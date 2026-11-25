// Unit tests: refused / unclear decision of a WhatsApp send. Run with `pnpm test:unit`. Never calls Meta.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isWaRefused, postWaMessage, sendWithFallback, waProblem, WA_UNCLEAR_TEXT } from "./waSendOutcome";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Fake = Response | Error;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const OK = () => json(200, { messages: [{ id: "wamid.1" }] });
const REFUSED = () => json(400, { error: { message: "Not registered", code: 133010 } });
const DOWN = () => json(500, { error: { message: "oops", code: 131000 } });

/** Numbers answer in turn; returns the outcome and how many calls Meta got. */
async function run(...replies: Fake[]) {
    let calls = 0;
    globalThis.fetch = async (_u, init) => {
        assert.ok(init?.signal, "every send has a time limit");
        const r = replies[calls++];
        if (r instanceof Error) throw r;
        return r;
    };
    const send = () => postWaMessage("https://meta.invalid/messages", "t", {});
    const out = await sendWithFallback(send, async () => replies.slice(1).map(() => send));
    return { out, calls };
}

test("accepted at once", async () => {
    const { out, calls } = await run(OK(), OK());
    assert.deepEqual(out, { status: "sent", messageId: "wamid.1" });
    assert.equal(calls, 1);
});

test("a refusal tries the other numbers; all refused keeps the first reason", async () => {
    const a = await run(REFUSED(), OK());
    assert.equal(a.out.status, "sent");
    assert.equal(a.calls, 2);
    const b = await run(REFUSED(), json(403, { error: { message: "second", code: 10 } }));
    assert.deepEqual(b.out, { status: "failed", error: "Not registered" });
});

const unclearCases: Record<string, () => Fake> = {
    "5xx": DOWN,
    "5xx html": () => new Response("<html>", { status: 502 }),
    timeout: () => new DOMException("timed out", "TimeoutError") as unknown as Error,
    "dropped connection": () => new TypeError("fetch failed"),
    "200 without id": () => json(200, { messages: [] }),
    "200 with null": () => json(200, null),
    "200 unreadable": () => new Response("<html>", { status: 200 }),
    "200 with an error": () => json(200, { error: { code: 100 } }),
    "4xx unreadable": () => new Response("nope", { status: 400 }),
    "4xx without a code": () => json(400, { error: { message: "x" } }),
    "4xx unknown error code": () => json(400, { error: { code: 1, message: "unknown" } }),
    "4xx temporary": () => json(400, { error: { code: 999, is_transient: true } }),
    "408": () => json(408, { error: { code: 100 } }),
    "reply cut in the middle": () =>
        new Response(new ReadableStream({ start: (c) => c.error(new Error("cut")) }), { status: 200 }),
};
for (const [name, reply] of Object.entries(unclearCases)) {
    test(`unclear stops: ${name}`, async () => {
        const { out, calls } = await run(reply(), OK());
        assert.equal(out.status, "unclear");
        assert.ok(out.error?.startsWith(WA_UNCLEAR_TEXT));
        assert.equal(calls, 1);
    });
}

test("number 2 unclear never reaches number 3", async () => {
    const { out, calls } = await run(REFUSED(), DOWN(), OK());
    assert.equal(out.status, "unclear");
    assert.equal(calls, 2);
});

test("a hung call is cut by the time limit and is unclear", async () => {
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => realTimeout(20);
    globalThis.fetch = (_u, init) => new Promise((_ok, no) => {
        const keep = setTimeout(() => undefined, 5_000);
        init!.signal!.addEventListener("abort", () => { clearTimeout(keep); no(init!.signal!.reason); });
    });
    try {
        const out = await sendWithFallback(() => postWaMessage("https://meta.invalid", "t", {}));
        assert.equal(out.status, "unclear");
    } finally {
        AbortSignal.timeout = realTimeout;
    }
});

test("an unknown error is never taken as a refusal; pending reads as not sure", () => {
    assert.equal(isWaRefused(new Error("x")), false);
    assert.equal(waProblem("sent"), null);
    assert.equal(waProblem("pending"), WA_UNCLEAR_TEXT);
});
