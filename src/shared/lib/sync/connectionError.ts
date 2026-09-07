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
