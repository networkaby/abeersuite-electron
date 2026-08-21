/**
 * Refuses to run a seed against a shop counter's local replica.
 *
 * The counter's Postgres is a MIRROR of Supabase, and the whole design rests on its
 * rows being byte-identical copies — same primary keys, same ids. Every `User.id` in
 * a JWT, every `universalVoucherId` on a ledger line, resolves against whichever
 * database answers, so identical ids are what make a token or a voucher mean the
 * same thing on both.
 *
 * A seed breaks that quietly. `bootstrap-seed` and `personal-bootstrap` both mint
 * rows with autoincrement ids, so seeding a replica would create a *different* row
 * under an id Supabase has already given to someone else. The failure that follows
 * is not an error — it is a session resolving to the wrong person, or a voucher line
 * pointing at the wrong document, with nothing logged anywhere.
 *
 * The replica is never seeded. It is created by `pg_restore` from a Supabase dump
 * and maintained by the sync worker; if it is wrong, the fix is to reseed it from a
 * dump, never to run a seed against it.
 */
export function assertNotCounterReplica(scriptName: string): void {
    if (process.env.COUNTER_PC !== "1" && !process.env.LOCAL_DATABASE_URL) return;

    console.error(
        `\n✖ ${scriptName} refused to run: this looks like a shop counter PC.\n\n` +
        `  COUNTER_PC=${process.env.COUNTER_PC ?? "(unset)"}  ` +
        `LOCAL_DATABASE_URL=${process.env.LOCAL_DATABASE_URL ? "(set)" : "(unset)"}\n\n` +
        `  The counter's database is a replica of Supabase and must only be built by\n` +
        `  pg_restore from a dump. Seeding it would mint rows whose ids collide with\n` +
        `  real Supabase rows — silently attaching sessions and ledger lines to the\n` +
        `  wrong records.\n\n` +
        `  To seed the REAL database from this machine, unset both variables first.\n`,
    );
    process.exit(1);
}
