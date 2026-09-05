/**
 * Local integrity facts for `/api/sync/status` — things that are true of this
 * replica after the rebuilds ran, and that a person has to act on.
 *
 * Raw `pg` against the LOCAL database only, like outbox.ts: no egress, no Prisma
 * (the shared client would route the read wherever READ_MODE says).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/**
 * Gift cards whose ledger sums below zero.
 *
 * A single till cannot overdraw a card (the draw is conditional on the balance —
 * `redeemGiftCard`). Two tills apart can each see the full balance and both draw it;
 * once their txns meet, the rebuild sums both and the balance goes negative. That is
 * a real double spend and it is surfaced, not hidden: the badge shows it and
 * `redeemGiftCard` refuses the card until an admin posts an ADJUST.
 */
export async function countOverdrawnGiftCards(localUrl: string): Promise<number> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM "GiftCard" WHERE balance < -0.005`,
        );
        return parseInt(res.rows[0]?.n ?? "0", 10);
    } catch {
        return 0;
    } finally {
        await client.end().catch(() => { });
    }
}
