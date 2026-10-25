/**
 * Put back the party classification the import overwrote — and nothing else.
 *
 * The owner classifies a party by WHAT IT IS: a supplier is a Sundry Creditor
 * whether they are owed money this month or not. Vyapar classifies by which way
 * the balance points. `runCustomerImport` writes `groupId` alongside an opening
 * balance and derives it from that balance's sign, so importing Vyapar's figures
 * silently re-sorted the masters into Vyapar's convention — six suppliers moved
 * from Sundry Creditors to Sundry Debtors because they happened to be in debit.
 *
 * The owner had already said this plainly:
 *
 *   "vyapar sundry creditor/debtor concept is different then ours, we treat
 *    supplier as creditor regardless balance type ... since we follow tally
 *    standard"
 *
 * That was taken as a reporting distinction. It was also a warning that the
 * import must not touch this field, and nothing checked that it hadn't.
 *
 * ── Deliberately narrow ─────────────────────────────────────────────────────
 * Restores `Account.groupId` only, for accounts that exist in BOTH databases,
 * and reports (never touches) anything else that differs. It does not create,
 * delete, rename, re-point or re-balance. The reference is the owner's own live
 * dump, so every value written is one they chose.
 *
 * Parties that exist only in the current database are new from Vyapar and are
 * left alone — there is nothing to restore them to.
 *
 *   pnpm vyapar:restore-party-class              # report only
 *   pnpm vyapar:restore-party-class -- --apply
 *
 * The reference database is built with:
 *   createdb abeersuite_dumpref && pg_restore -d abeersuite_dumpref <the live dump>
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";

const REFERENCE_DB = process.env.PARTY_REF_DB ?? "abeersuite_dumpref";

type Row = { name: string; grp: string; kind: string };

async function load(pool: Pool): Promise<Map<number, Row>> {
    const m = new Map<number, Row>();
    for (const r of (await pool.query(`
        select a.id, a.name, g.name grp,
               case when a."personId" is not null then 'person'
                    when a."companyId" is not null then 'company' else '-' end kind
        from "Account" a join "AccountGroup" g on g.id = a."groupId"
        where a."personId" is not null or a."companyId" is not null`)).rows) {
        m.set(Number(r.id), { name: String(r.name), grp: String(r.grp), kind: String(r.kind) });
    }
    return m;
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const cur = new Pool({ connectionString: url, ssl: false, max: 1 });
    const ref = new Pool({ connectionString: url.replace(/\/[^/?]+(\?|$)/, `/${REFERENCE_DB}$1`), ssl: false, max: 1 });
    console.log(`\ncurrent   ${url.replace(/^.*@/, "")}`);
    console.log(`reference ${REFERENCE_DB}  (the owner's live dump)\n`);

    const R = await load(ref), C = await load(cur);
    const groups = new Map<string, number>();
    for (const r of (await cur.query(`select id, name from "AccountGroup"`)).rows) groups.set(String(r.name), Number(r.id));

    const fix: Array<{ id: number; name: string; was: string; now: string; groupId: number }> = [];
    const kindDiff: Array<{ id: number; name: string; was: string; now: string }> = [];
    let onlyHere = 0, gone = 0, unknownGroup = 0;

    for (const [id, r] of R) {
        const c = C.get(id);
        if (!c) { gone++; continue; }
        if (c.kind !== r.kind) kindDiff.push({ id, name: r.name, was: r.kind, now: c.kind });
        if (c.grp === r.grp) continue;
        const gid = groups.get(r.grp);
        if (gid == null) { unknownGroup++; console.log(`  ⚠ "${r.name}" belongs in "${r.grp}", which this database does not have`); continue; }
        fix.push({ id, name: r.name, was: c.grp, now: r.grp, groupId: gid });
    }
    for (const id of C.keys()) if (!R.has(id)) onlyHere++;

    console.log(`GROUP to restore: ${fix.length}`);
    for (const f of fix) console.log(`  ${String(f.id).padStart(6)}  ${f.name.slice(0, 42).padEnd(44)}${f.was} → ${f.now}`);
    console.log(`\n  ${onlyHere} party account(s) exist only here — new from Vyapar, left alone`);
    console.log(`  ${gone} in the reference and not here — merged duplicates, left alone`);
    if (unknownGroup) console.log(`  ${unknownGroup} whose group this database does not have — listed above, left alone`);
    if (kindDiff.length) {
        console.log(`\n  ⚠ ${kindDiff.length} person/company difference(s) — NOT touched, that is a conversion, not a field:`);
        for (const k of kindDiff) console.log(`      ${k.id}  ${k.name}  ${k.was} → ${k.now}`);
    } else {
        console.log(`  person/company: no differences`);
    }

    if (!apply) { console.log(`\nNothing written. Re-run with --apply.\n`); await cur.end(); await ref.end(); return; }
    if (!fix.length) { console.log(`\nNothing to do.\n`); await cur.end(); await ref.end(); return; }

    for (const f of fix) await cur.query(`update "Account" set "groupId" = $2 where id = $1`, [f.id, f.groupId]);
    console.log(`\nrestored ${fix.length} party classification(s) — no other field touched`);

    await cur.end();
    await ref.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
