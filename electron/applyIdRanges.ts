/**
 * Applies this counter's reserved id range to the local replica's sequences.
 *
 * Called at first-launch counter setup and again whenever shift-open returns an
 * `idRangeStart`. Every sequence behind an `@default(autoincrement())` model is moved
 * into this counter's block, so rows created locally can never collide with
 * cloud-assigned ids or with another counter's.
 *
 * ── All of the work happens in `_apply_id_range()` ───────────────────────────
 * That function is defined in `resources/local-schema.sql` and owned by `postgres`,
 * `SECURITY DEFINER`. This module used to run the DDL and the `ALTER SEQUENCE`s itself
 * on whatever URL it was handed — which is `smx_app`, a role with neither `CREATE ON
 * SCHEMA` nor sequence ownership. Both statements failed, the `catch` below swallowed
 * the errors, `_id_ranges` was never written, and `isOfflineRangeApplied()` in
 * prismaClient.ts read that absence as "no confirmed range" — permanently blocking
 * every offline write on the machine. Moving the privileged half into a definer
 * function means the app role needs nothing but EXECUTE.
 *
 * It also discovers the sequence list from the catalogue rather than a hand-kept
 * constant, and never moves a sequence backwards, so calling this repeatedly is safe.
 *
 * Never throws — returns `false` on any failure, same contract as
 * `localDbProvisioner.ts`.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/**
 * @param localUrl    Connection string for the embedded cluster. The app role is
 *                    enough — `_apply_id_range` supplies the privilege.
 * @param blockStart  The first id in this counter's reserved block, as returned by
 *                    `blockStartFor(counterNumber)`.
 * @returns `true` on success, `false` on any failure.
 */
export async function applyIdRanges(localUrl: string, blockStart: number): Promise<boolean> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 10_000 });
    try {
        await client.connect();

        const { rows } = await client.query<{ altered: number }>(
            `SELECT _apply_id_range($1) AS altered`,
            [blockStart],
        );
        const altered = rows[0]?.altered ?? 0;

        console.log(`[IdRanges] blockStart ${blockStart} applied; ${altered} sequence(s) moved.`);
        return true;
    } catch (err) {
        console.error("[IdRanges] Failed to apply id ranges:", err);
        return false;
    } finally {
        await client.end().catch(() => {});
    }
}
