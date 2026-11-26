// Unit tests: a Live counter's own WhatsApp send — the once-only claim, the
// "no internet" retries, and who sends. Run with `pnpm test:unit`. Never calls
// Meta or a database: both are faked, and the flow below mirrors notifyBill's
// `deliver` (claim → send → save the outcome).
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { NotClaimed, claimOnce, claimToken, retryBeforeClaim, sendsFromCounter, type ClaimDb } from "./counterSend";
import { postWaMessage, sendWithFallback } from "./waSendOutcome";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const OK = () => json(200, { messages: [{ id: "wamid.1" }] });
const REFUSED = () => json(400, { error: { message: "Not registered", code: 133010 } });
const TIMEOUT = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const OFFLINE = () => new TypeError("fetch failed");
const unique = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

/** A one-row BillNotification table in Supabase, with switches to break it. */
function fakeTable(opts: { down?: boolean; createLandsThenThrows?: boolean } = {}) {
    let row: { waStatus: string; waError: string | null } | null = null;
    const db: ClaimDb & { row: () => typeof row; save: (s: string) => void } = {
        async create(token) {
            if (opts.down) throw new Error("Can't reach database server");
            if (row) throw unique();
            row = { waStatus: "pending", waError: token };
            if (opts.createLandsThenThrows) throw new Error("Connection reset after commit");
        },
        async find() {
            if (opts.down) throw new Error("Can't reach database server");
            return row;
        },
        row: () => row,
        save: (s) => { if (row) row = { ...row, waStatus: s }; },
    };
    return db;
}

/** Fake Meta: numbers answer in turn. Counts the calls it got. */
function fakeMeta(...replies: (Response | Error)[]) {
    let calls = 0;
    globalThis.fetch = async (_u, init) => {
        assert.ok(init?.signal, "every send has a time limit");
        const r = replies[calls++];
        if (!r) throw new Error("Meta was called more times than expected");
        if (r instanceof Error) throw r;
        return r;
    };
    return { calls: () => calls };
}

/** notifyBill's deliver(), cut down: claim, send (main number then one other), save. */
async function deliver(db: ReturnType<typeof fakeTable>) {
    const claim = await claimOnce(db, claimToken());
    if (!claim.mine) return { status: "already", wa: claim.wa };
    const send = () => postWaMessage("https://meta.invalid/messages", "t", {});
    const wa = await sendWithFallback(send, async () => [send]);
    db.save(wa.status);
    return { status: "sent", wa: wa.status };
}

test("sent: claimed once, Meta called once", async () => {
    const db = fakeTable();
    const meta = fakeMeta(OK());
    assert.deepEqual(await deliver(db), { status: "sent", wa: "sent" });
    assert.equal(meta.calls(), 1);
    assert.equal(db.row()?.waStatus, "sent");
});

test("a second save of the same bill sends nothing", async () => {
    const db = fakeTable();
    const meta = fakeMeta(OK());
    await deliver(db);
    assert.deepEqual(await deliver(db), { status: "already", wa: "sent" });
    assert.equal(meta.calls(), 1);
});

test("refused: the other number is tried, and its answer kept", async () => {
    const db = fakeTable();
    const meta = fakeMeta(REFUSED(), OK());
    assert.deepEqual(await deliver(db), { status: "sent", wa: "sent" });
    assert.equal(meta.calls(), 2);
});

test("timeout: unclear, no other number, never resent", async () => {
    const db = fakeTable();
    const meta = fakeMeta(TIMEOUT());
    assert.deepEqual(await deliver(db), { status: "sent", wa: "unclear" });
    assert.deepEqual(await deliver(db), { status: "already", wa: "unclear" });
    assert.equal(meta.calls(), 1);
});

test("internet drops during the send: unclear, not retried", async () => {
    const db = fakeTable();
    const meta = fakeMeta(OFFLINE());
    assert.equal((await deliver(db)).wa, "unclear");
    assert.equal(meta.calls(), 1);
});

test("offline before the claim: nothing claimed, nothing sent, retried, then gives up", async () => {
    const db = fakeTable({ down: true });
    const meta = fakeMeta();
    const waits: number[] = [];
    const out = await retryBeforeClaim(() => deliver(db), [0, 3_000, 15_000], async (ms) => waits.push(ms));
    assert.equal(out, null, "caller shows 'no internet'");
    assert.deepEqual(waits, [3_000, 15_000]);
    assert.equal(meta.calls(), 0);
    assert.equal(db.row(), null);
});

test("internet back on a retry: sent once", async () => {
    let down = true;
    const db = fakeTable();
    const flaky: typeof db = { ...db, create: async (t) => { if (down) { down = false; throw new Error("ECONNRESET"); } return db.create(t); }, find: async () => (down ? Promise.reject(new Error("x")) : db.find()) };
    const meta = fakeMeta(OK());
    // First try: create fails and the read-back fails too → NotClaimed → retried.
    const out = await retryBeforeClaim(() => deliver(flaky as never), [0, 1], async () => {});
    assert.deepEqual(out, { status: "sent", wa: "sent" });
    assert.equal(meta.calls(), 1);
});

test("the claim landed but the answer was lost: our token says it is ours", async () => {
    const db = fakeTable({ createLandsThenThrows: true });
    const meta = fakeMeta(OK());
    assert.deepEqual(await deliver(db), { status: "sent", wa: "sent" });
    assert.equal(meta.calls(), 1);
});

test("crash after the claim: the row stays pending and is never resent", async () => {
    const db = fakeTable();
    await claimOnce(db, claimToken()); // the process died right here
    const meta = fakeMeta();
    assert.deepEqual(await deliver(db), { status: "already", wa: "pending" });
    assert.equal(meta.calls(), 0);
});

test("a database error that is not a clash, with no row, is NotClaimed (safe to retry)", async () => {
    const db: ClaimDb = { create: async () => { throw new Error("timeout"); }, find: async () => null };
    await assert.rejects(claimOnce(db, claimToken()), NotClaimed);
});

test("who sends: only a Live counter, and not during an outage", () => {
    assert.equal(sendsFromCounter({ isCounter: true, write: "live", writeLocal: false }), true);
    assert.equal(sendsFromCounter({ isCounter: true, write: "live", writeLocal: true }), false, "outage → office, later");
    assert.equal(sendsFromCounter({ isCounter: true, write: "v_live", writeLocal: false }), false, "v_live keeps the office path");
    assert.equal(sendsFromCounter({ isCounter: true, write: "local", writeLocal: true }), false);
    assert.equal(sendsFromCounter({ isCounter: false, write: "live", writeLocal: false }), false, "the office server is not a counter");
});
