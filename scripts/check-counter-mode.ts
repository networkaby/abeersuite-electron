/**
 * Guards the two properties the counter replica's routing rests on.
 *
 * Runs against NO database — every assertion is about object identity or about a
 * guard that throws before a query is issued — so it is safe in CI and on a laptop.
 *
 * The two modes need different env AT IMPORT TIME and Node caches modules, so each
 * mode runs as its own process (see the package script) rather than trying to reset
 * module state mid-run.
 *
 *   pnpm check:counter-mode
 */


type Check = [name: string, ok: boolean];

/**
 * Vercel and every ordinary laptop: no LOCAL_DATABASE_URL, therefore no replica.
 *
 * The point is not merely that it "still works" — it is that `prisma` must be the
 * SAME OBJECT as `prismaLive`, with no Proxy in between. Anything else means
 * production is paying an indirection (and a behavioural risk) for a feature only
 * the shop counter uses.
 */
async function vercelMode(): Promise<Check[]> {
    delete process.env.LOCAL_DATABASE_URL;
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://u:p@live.invalid:5432/db";

    const m = await import("@/shared/lib/prisma/prismaClient");
    return [
        ["prisma IS prismaLive (no Proxy)", m.prisma === m.prismaLive],
        ["prismaAuthoritative IS prismaLive (no Proxy)", m.prismaAuthoritative === m.prismaLive],
        ["model delegate reachable", typeof (m.prisma as unknown as { user?: unknown }).user === "object"],
    ];
}

/**
 * A shop counter: replica configured.
 *
 * The delegate-identity checks are the ones that matter most. The array form of
 * `$transaction` needs genuine `PrismaPromise`s from a single client, and a Proxy
 * that wrapped each operation would hand back native promises instead — breaking
 * six real call sites (including a plain read report at api/accountancy/ledgers)
 * with "Invalid $transaction invocation", at runtime, in production. Asserting that
 * the Proxy hands back the client's OWN delegate objects is what proves nothing is
 * being wrapped.
 */
async function counterMode(): Promise<Check[]> {
    process.env.DATABASE_URL = "postgresql://u:p@live.invalid:5432/db";
    process.env.LOCAL_DATABASE_URL = "postgresql://u:p@localhost:5432/smx";

    const m = await import("@/shared/lib/prisma/prismaClient");
    const mode = await import("@/shared/lib/prisma/counterMode");
    const { isOfflineWriteBlocked } = await import("@/shared/lib/prisma/offlineError");

    const live = m.prismaLive as unknown as Record<string, unknown>;
    const proxy = m.prisma as unknown as Record<string, unknown>;

    const out: Check[] = [
        ["Proxy engaged when replica configured", m.prisma !== m.prismaLive],
        ["starts in LIVE mode", mode.getMode() === "LIVE"],
        ["READ_MODE defaults to live", mode.READ_PREFERENCE === "live"],
        // Both dials default to `live`, so a counter that sets neither behaves exactly
        // as it did before either existed. That is what makes WRITE_MODE=local an
        // opt-in per machine rather than a change of behaviour on upgrade.
        ["WRITE_MODE defaults to live", mode.WRITE_PREFERENCE === "live"],
        ["a local write is therefore a FALLBACK, not the destination", mode.localWriteIsFallback()],
        ["writes go live while live is up", mode.shouldWriteLocal() === false],
        ["replica not ready until the worker says so", mode.isReplicaReady() === false],
        // Raw passthrough, checked on the delegate OBJECT — not on its methods.
        // Prisma builds a fresh bound function on every method access, so even on a
        // plain unproxied client `c.user.findMany !== c.user.findMany`. Comparing
        // methods therefore proves nothing; comparing the delegate does.
        //
        // This used to compare against `prismaLive`'s delegate. It cannot any more:
        // `prismaLive` is now the client that NEVER redirects (the push path must not
        // be answered by the replica), while `prisma` resolves to the read-routed one,
        // and two $extends of the same base have distinct delegate objects. So assert
        // the property that actually matters — the Proxy hands back a STABLE real
        // delegate rather than building a wrapper per access, which is what would
        // break the array form of $transaction.
        ["delegate is stable across accesses (nothing wrapped per access)", proxy.user === proxy.user],
        ["…and for a second model", proxy.universalVoucher === proxy.universalVoucher],
        ["delegate is a real Prisma delegate", typeof (proxy.user as { findMany?: unknown }).findMany === "function"],
        [
            "$transaction is unwrapped",
            (m.prisma as unknown as { $transaction: unknown }).$transaction
            === (m.prismaLive as unknown as { $transaction: unknown }).$transaction,
        ],
    ];

    // Supabase goes away.
    mode.reportLiveDown();
    out.push(["demotes to LOCAL on live failure", mode.getMode() === "LOCAL"]);
    out.push(["LOCAL mode swaps to a different delegate", proxy.user !== live.user]);
    out.push(["...and it is still a real delegate", typeof (proxy.user as { create?: unknown }).create === "function"]);

    // No confirmed id range on this machine (there is no database here at all, and
    // the check fails closed), so every local write is refused. This is the gate that
    // replaced the 36-model allowlist: an unreserved sequence mints ids from 1, and
    // the push then upserts them over unrelated cloud rows.
    let blocked = false;
    try {
        await (proxy.user as { create: (a: unknown) => Promise<unknown> })
            .create({ data: { email: "x@y.z" } });
    } catch (e) {
        blocked = isOfflineWriteBlocked(e);
    }
    out.push(["write with no confirmed id range is refused", blocked]);

    // Deletes are refused on their own terms, ahead of the id-range check — the one
    // guard that survives regardless of how well provisioned the counter is.
    let deleteBlocked = false;
    try {
        await (proxy.user as { delete: (a: unknown) => Promise<unknown> })
            .delete({ where: { id: 1 } });
    } catch (e) {
        deleteBlocked = isOfflineWriteBlocked(e);
    }
    out.push(["delete while LOCAL throws OfflineWriteBlockedError", deleteBlocked]);

    // Raw execution is deliberately NO LONGER blocked at this layer. The replica is
    // where this machine's work is written now, not a read-only mirror; the capture
    // trigger records raw writes like any other, and the smx_app role still has no
    // DDL and no DELETE. It should fail on the (absent) connection, not on a guard.
    let rawBlocked = false;
    try {
        await (m.prisma as unknown as { $executeRawUnsafe: (s: string) => Promise<unknown> })
            .$executeRawUnsafe('UPDATE "User" SET name = name');
    } catch (e) {
        rawBlocked = isOfflineWriteBlocked(e);
    }
    out.push(["$executeRawUnsafe is not guard-blocked any more", !rawBlocked]);

    return out;
}

/**
 * A counter running the rollout setting: WRITE_MODE=local.
 *
 * The property that matters is that the choice of client no longer waits for a live
 * query to fail — writes go to the replica from the first request, with Supabase
 * perfectly reachable. That is the whole difference between "local is where we fall
 * back to" and "local is where we write".
 */
async function counterWriteLocalMode(): Promise<Check[]> {
    process.env.DATABASE_URL = "postgresql://u:p@live.invalid:5432/db";
    process.env.LOCAL_DATABASE_URL = "postgresql://u:p@localhost:5432/smx";
    process.env.WRITE_MODE = "local";

    const m = await import("@/shared/lib/prisma/prismaClient");
    const mode = await import("@/shared/lib/prisma/counterMode");
    const { isOfflineWriteBlocked } = await import("@/shared/lib/prisma/offlineError");

    const live = m.prismaLive as unknown as Record<string, unknown>;
    const proxy = m.prisma as unknown as Record<string, unknown>;

    const out: Check[] = [
        ["WRITE_MODE=local is picked up", mode.WRITE_PREFERENCE === "local"],
        ["writes go local with live UP and no demotion", mode.shouldWriteLocal()],
        ["…and the mode is still LIVE (not a demotion)", mode.getMode() === "LIVE"],
        ["prisma is NOT the live client", proxy.user !== live.user],
        // The offline voucher-type policy must NOT apply here: local is the normal
        // destination, so enforcing it would refuse those types permanently.
        ["a local write is no longer a fallback", mode.localWriteIsFallback() === false],
    ];

    // Deletes stay refused whatever the dials say.
    let deleteBlocked = false;
    try {
        await (proxy.user as { delete: (a: unknown) => Promise<unknown> }).delete({ where: { id: 1 } });
    } catch (e) {
        deleteBlocked = isOfflineWriteBlocked(e);
    }
    out.push(["delete is still refused under WRITE_MODE=local", deleteBlocked]);

    return out;
}

async function main(): Promise<void> {
    const which = process.argv[2];
    if (which !== "vercel" && which !== "counter" && which !== "counter-write-local") {
        console.error("usage: tsx scripts/check-counter-mode.ts <vercel|counter|counter-write-local>");
        console.error("       (run all three via `pnpm check:counter-mode`)");
        process.exit(2);
    }

    console.log(`[counter-mode] ${which}:`);
    const checks = which === "vercel" ? await vercelMode()
        : which === "counter-write-local" ? await counterWriteLocalMode()
            : await counterMode();

    let failed = 0;
    for (const [name, ok] of checks) {
        if (!ok) failed++;
        console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    }
    if (failed) {
        console.error(`[counter-mode] ${which}: ${failed} check(s) failed.`);
        process.exit(1);
    }
    process.exit(0);
}

void main();
