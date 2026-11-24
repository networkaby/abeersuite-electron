/**
 * Is this operation part of a transaction (either form)?
 *
 * A query extension also runs for the operations inside a `$transaction`, and a read
 * redirected from there leaves the transaction: it answers from another database, so
 * it cannot see the rows the same transaction just wrote.
 *
 * `__internalParams` is Prisma's own, undocumented field — the only place this is said.
 * inTransaction.test.ts fails if an upgrade moves it.
 */
export function inTransaction(params: object): boolean {
    const internal = (params as { __internalParams?: { transaction?: unknown } }).__internalParams;
    return internal?.transaction != null;
}
