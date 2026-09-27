/**
 * One readable line for a failed connection attempt.
 *
 * Node tries every address a hostname resolves to and, when all of them refuse, throws
 * an `AggregateError` whose own `message` is EMPTY — so "could not connect: " told
 * nobody that PostgreSQL was simply not running on 127.0.0.1:5432. This flattens the
 * inner errors into "ECONNREFUSED 127.0.0.1:5432, ECONNREFUSED [::1]:5432".
 */
export function connectionErrorText(err: unknown): string {
    if (err instanceof AggregateError && err.errors.length > 0) {
        return err.errors.map(connectionErrorText).join(", ");
    }
    if (err instanceof Error) {
        const e = err as NodeJS.ErrnoException & { address?: string; port?: number };
        if (e.code && e.address) {
            const host = e.address.includes(":") ? `[${e.address}]` : e.address;
            return `${e.code} ${host}${e.port ? `:${e.port}` : ""}`;
        }
        return e.message || e.code || String(err);
    }
    return String(err);
}

/**
 * The phrases a database that could not be REACHED leaves behind — as opposed to one
 * that answered and said no.
 *
 * Most arrive through Prisma's pg adapter, which renames the socket error: ENOTFOUND and
 * ECONNREFUSED become P1001 "Can't reach database server", ECONNRESET becomes P1017
 * "Server has closed the connection", ETIMEDOUT becomes P1008 "Operation has timed out".
 * A counter PC going offline hits P1001 before any TCP-level error appears. The raw codes
 * stay for errors that come straight from `pg`, and "timeout exceeded when trying to
 * connect" is the pool giving up on a checkout.
 */
const CONNECTION_FAILURE =
    /Connection terminated|connection timeout|Closed the connection|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Can't reach database|Operation has timed out|timeout exceeded when trying to connect/i;

/**
 * Did this fail because the database could not be reached, rather than because it
 * refused?
 *
 * Takes the error itself or its stored message — the outbox keeps only the text, and
 * has to tell the two apart long after the error object is gone.
 */
export function isConnectionFailure(err: unknown): boolean {
    const text = typeof err === "string"
        ? err
        : `${err instanceof Error ? err.message : ""} ${connectionErrorText(err)}`;
    return CONNECTION_FAILURE.test(text);
}
