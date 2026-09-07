/**
 * Guards the properties the counter replica's routing — and the v_live write relay's
 * boundary — rest on.
 *
 * Runs against NO database — every assertion is about object identity or about a
 * guard that throws before a query is issued — so it is safe in CI and on a laptop.
 *
 * The modes need different env AT IMPORT TIME and Node caches modules, so each mode
 * runs as its own process (see the package script) rather than trying to reset module
 * state mid-run.
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

/**
 * A counter relaying its writes to the office: WRITE_MODE=v_live with WRITE_API_URL.
 *
 * Two properties. Below the relay this mode IS `live` — writes pick the live client and
 * a local write is a fallback, so the offline policies still apply — and the relay's
 * boundary is the build's: only what a counter build serves may be forwarded, never a
 * read, never this machine's own routes, never a body Vercel would refuse.
 */
async function counterWriteRelayMode(): Promise<Check[]> {
    process.env.DATABASE_URL = "postgresql://u:p@live.invalid:5432/db";
    process.env.LOCAL_DATABASE_URL = "postgresql://u:p@localhost:5432/smx";
    process.env.WRITE_MODE = "v_live";
    process.env.WRITE_API_URL = "https://office.invalid/";

    const mode = await import("@/shared/lib/prisma/counterMode");
    const relay = await import("@/shared/lib/counter/relayPolicy");

    const decide = (method: string, pathname: string, contentLength: number | null = 100, alreadyRelayed = false) =>
        relay.decideRelay({ method, pathname, contentLength, alreadyRelayed }).relay;

    return [
        ["WRITE_MODE=v_live is picked up", mode.WRITE_PREFERENCE === "v_live"],
        ["WRITE_API_URL is normalised to an origin", mode.WRITE_API_URL === "https://office.invalid"],
        ["relaysWrites() is true", mode.relaysWrites()],
        ["writes go live while live is up (v_live IS live below the relay)", mode.shouldWriteLocal() === false],
        ["a local write is still a FALLBACK, so the offline policies apply", mode.localWriteIsFallback()],
        // Not a counter PC in this process (COUNTER_PC unset): the relay must stay
        // inert, which is also what keeps a misconfigured Vercel from relaying to itself.
        ["relay is inactive off a counter PC", relay.RELAY_ACTIVE === false],
        ["a POS sale relays", decide("POST", "/api/pos/sale")],
        ["a voucher post relays", decide("POST", "/api/inventory/vouchers/12/post")],
        ["a bare DELETE (no body) relays", decide("DELETE", "/api/parties/5", 0)],
        ["a read never relays", !decide("GET", "/api/pos/sale")],
        ["the login never relays", !decide("POST", "/api/auth/callback/credentials-staff")],
        ["this PC's status never relays", !decide("POST", "/api/counter/status")],
        ["the boot probe never relays", !decide("POST", "/api/health")],
        ["the outbox push never relays", !decide("POST", "/api/sync/push")],
        ["the counter-binding routes never relay", !decide("POST", "/api/pos/counters/3/claim-number")],
        ["backup and restore never relay", !decide("POST", "/api/settings/restore") && !decide("POST", "/api/settings/backup")],
        // No segment allowlist: a full build in counter mode serves routes the counter build
        // strips, and their writes must reach the office rather than run here against Supabase.
        ["a write outside the counter allowlist still relays", decide("DELETE", "/api/customer-tools/trash/person/8504", 0) && decide("POST", "/api/accountancy/journal-entries")],
        // The office decodes what the browser encodes, so the rules must see the decoded path.
        ["a percent-encoded excluded path never relays", !decide("POST", "/api/settings/%72estore") && !decide("POST", "/api/pos/%63ounters/3/claim-number")],
        ["a dot-segment path is normalised before the rules", !decide("POST", "/api/pos/../settings/restore")],
        ["a double-encoded path never relays", !decide("POST", "/api/pos/%2572estore")],
        ["an already-relayed request never relays again", !decide("POST", "/api/pos/sale", 100, true)],
        ["a body above Vercel's limit runs here", !decide("POST", "/api/settings/item-import", 5 * 1024 * 1024)],
        ["a body of unknown size runs here", !decide("POST", "/api/settings/item-import", null)],
        ["a non-API path never relays", !decide("POST", "/office/pos")],
    ];
}

/**
 * WRITE_MODE=v_live with NO WRITE_API_URL must degrade to `local`, never to `live`:
 * a half-configured till keeps its saves fast and captured, rather than quietly
 * writing to Supabase over the WAN — the slow path the relay exists to remove.
 */
async function counterWriteRelayUnconfigured(): Promise<Check[]> {
    process.env.DATABASE_URL = "postgresql://u:p@live.invalid:5432/db";
    process.env.LOCAL_DATABASE_URL = "postgresql://u:p@localhost:5432/smx";
    process.env.WRITE_MODE = "v_live";
    delete process.env.WRITE_API_URL;

    const mode = await import("@/shared/lib/prisma/counterMode");
    return [
        ["v_live without WRITE_API_URL degrades to local", mode.WRITE_PREFERENCE === "local"],
        ["…so writes go local from the first request", mode.shouldWriteLocal()],
        ["…and a local write is not a fallback there", mode.localWriteIsFallback() === false],
        ["relaysWrites() is false", mode.relaysWrites() === false],
    ];
}

const VARIANTS = {
    "vercel": vercelMode,
    "counter": counterMode,
    "counter-write-local": counterWriteLocalMode,
    "counter-write-relay": counterWriteRelayMode,
    "counter-write-relay-unconfigured": counterWriteRelayUnconfigured,
} as const;

async function main(): Promise<void> {
    const which = process.argv[2] as keyof typeof VARIANTS | undefined;
    if (!which || !(which in VARIANTS)) {
        console.error(`usage: tsx scripts/check-counter-mode.ts <${Object.keys(VARIANTS).join("|")}>`);
        console.error("       (run every variant via `pnpm check:counter-mode`)");
        process.exit(2);
    }

    console.log(`[counter-mode] ${which}:`);
    const checks = await VARIANTS[which]();

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
