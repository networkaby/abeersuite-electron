/**
 * Report duplicate parties and products, and propose which row survives a merge.
 *
 * These duplicates PREDATE the Vyapar migration. An import on 25-Jul-2026 keyed
 * contact-less parties on `no-contact.<randomUUID>@placeholder.invalid`; a random
 * key can never be matched again, so running that import twice created every such
 * party twice. Names like TEKTRONIX and M. M. Traders carry two Person rows, both
 * dated 25 July, each with its own unreachable address.
 *
 * Reports by default and writes nothing; `--apply` performs the merges it listed.
 * Merging is destructive and does not undo, so the list gets human eyes first. The
 * proposal comes from asking the real `previewMerge()` what it would do, and
 * `--apply` then calls `mergeParty()` on exactly that plan — so what runs is what
 * was shown, not a second opinion computed later.
 *
 * Choosing the survivor, in order:
 *   1. transaction history — vouchers, tickets and devices are the expensive things
 *      to re-point, and the row that has them is the row the business has been using
 *   2. a real contact — a usable phone or a genuine email beats a placeholder
 *   3. an opening balance
 *   4. the older row, as a tie-break, since it is the one other records point at
 *
 *   pnpm vyapar:dup-report              # report only, writes nothing
 *   pnpm vyapar:dup-report -- --apply   # perform the clean merges
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Pool } from "pg";

const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

type Row = {
    kind: "person" | "company";
    id: number;
    name: string;
    created: string;
    accountId: number | null;
    opening: number;
    openingType: string | null;
    balance: number;
    phones: string[];
    emails: string[];
    vouchers: number;
    tickets: number;
    devices: number;
    glLines: number;
};

const isPlaceholder = (e: string) => /@placeholder\.invalid$/i.test(e);
const realContacts = (r: Row) => r.phones.length + r.emails.filter((e) => !isPlaceholder(e)).length;
const activity = (r: Row) => r.vouchers + r.tickets + r.devices + r.glLines;

/** Higher is better. Ordered by what is most expensive to lose. */
function rank(r: Row): number[] {
    return [activity(r), realContacts(r), Math.abs(r.opening) > 0 ? 1 : 0, -new Date(r.created).getTime()];
}

function betterOf(a: Row, b: Row): Row {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
    return a.id < b.id ? a : b;
}

async function main(): Promise<void> {
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const rows = (await pool.query(`
        -- Tombstones are excluded everywhere below. mergeParty() does not hard-delete
        -- the loser: it retires the row, sets mergedIntoPersonId / mergedIntoCompanyId
        -- and detaches the Account. Counting those as live rows would report every
        -- completed merge as a duplicate forever, so a second run would look exactly
        -- as though the first had failed.
        with party as (
          select 'person'::text kind, p.id, p.name, p."createdAt" created, a.id account_id,
                 coalesce(a."openingBalance", 0) opening, a."openingBalanceType" otype, coalesce(a.balance, 0) bal
          from "Person" p left join "Account" a on a."personId" = p.id
          union all
          select 'company', c.id, c.name, c."createdAt", a.id,
                 coalesce(a."openingBalance", 0), a."openingBalanceType", coalesce(a.balance, 0)
          from "Company" c left join "Account" a on a."companyId" = c.id)
        select party.*,
          coalesce((select array_agg(ph.phone) from "Phone" ph
                    where (party.kind='person' and ph."personId"=party.id)
                       or (party.kind='company' and ph."companyId"=party.id)), '{}') phones,
          coalesce((select array_agg(e.email) from "Email" e
                    where (party.kind='person' and e."personId"=party.id)
                       or (party.kind='company' and e."companyId"=party.id)), '{}') emails,
          (select count(*) from "UniversalVoucher" v where v."partyAccountId" = party.account_id) vouchers,
          (select count(*) from "Ticket" t where t."accountId" = party.account_id) tickets,
          (select count(*) from "Device" d where d."accountId" = party.account_id) devices,
          (select count(*) from "VoucherGlLine" g where g."accountId" = party.account_id) gl_lines
        from party
        where lower(trim(party.name)) in (
          select lower(trim(n)) from (
            select name n from "Person"
            union all
            select name from "Company") x
          group by 1 having count(*) > 1)
        order by lower(trim(party.name)), party.id
    `)).rows.map((r): Row => ({
        kind: r.kind, id: r.id, name: r.name, created: String(r.created),
        accountId: r.account_id, opening: Number(r.opening), openingType: r.otype,
        balance: Number(r.bal), phones: r.phones ?? [], emails: r.emails ?? [],
        vouchers: Number(r.vouchers), tickets: Number(r.tickets),
        devices: Number(r.devices), glLines: Number(r.gl_lines),
    }));

    const groups = new Map<string, Row[]>();
    for (const r of rows) {
        const k = r.name.trim().toLowerCase();
        groups.set(k, [...(groups.get(k) ?? []), r]);
    }

    console.log(`\nDUPLICATE PARTIES — ${groups.size} names, ${rows.length} rows\n`);
    const plan: Array<{ kind: "person" | "company"; winner: Row; losers: Row[] }> = [];

    for (const [, g] of [...groups].sort()) {
        const winner = g.reduce(betterOf);
        const losers = g.filter((r) => r.id !== winner.id);
        console.log(`  ${winner.name}`);
        for (const r of g) {
            const tag = r.id === winner.id ? "KEEP  " : "retire";
            const contacts = [...r.phones, ...r.emails.map((e) => (isPlaceholder(e) ? "(placeholder)" : e))];
            console.log(
                `    ${tag} ${r.kind.padEnd(7)} id ${String(r.id).padStart(5)}  ${r.created.slice(0, 10)}` +
                `  acct ${String(r.accountId ?? "—").padStart(5)}` +
                `  open ${(r.opening ? inr(r.opening) + " " + (r.openingType ?? "") : "—").padStart(13)}` +
                `  activity ${String(activity(r)).padStart(3)}` +
                `  ${contacts.length ? contacts.join(" ") : "no contact"}`,
            );
        }
        // A shared name is NOT evidence of a duplicate. Where two rows each carry a
        // real phone and the numbers DIFFER, the likeliest explanation is two
        // different people who happen to share a name — "Gopal", "Nazrul islam".
        // Merging those would fuse two real customers into one ledger, which is far
        // worse than leaving a duplicate alone, and is not undoable.
        const withPhones = g.filter((r) => r.phones.length > 0);
        const distinct = new Set(withPhones.flatMap((r) => r.phones));
        const conflicting = withPhones.length > 1 && distinct.size > 1;

        // Mixed person/company groups cannot be merged by mergeParty — it takes one
        // kind. They need convertParty first and are flagged rather than proposed.
        const kinds = new Set(g.map((r) => r.kind));

        if (conflicting) {
            console.log(`    ⚠ DIFFERENT phone numbers (${[...distinct].join(" vs ")}) — likely two real people ` +
                `sharing a name, NOT a duplicate. Left alone.`);
        } else if (kinds.size > 1) {
            console.log(`    ⚠ mixed person AND company — mergeParty takes one kind; needs convertParty first`);
        } else {
            plan.push({ kind: winner.kind, winner, losers });
        }
        console.log();
    }

    // ── Ask the real preview what each merge would move ─────────────────────
    // Using previewMerge/mergeParty rather than SQL is the whole point: merging a
    // party means re-pointing vouchers, GL lines, tickets, devices and the tender
    // details buried in settlementJson, then summing both the cached balance and the
    // opening. Hand-written SQL would miss some of that, and miss it silently.
    const apply = process.argv.includes("--apply");
    const { previewMerge, mergeParty } = await import("@/modules/customer/lib/convertParty");
    console.log(`MERGE ${apply ? "— APPLYING" : "PREVIEW — what the real mergeParty() would do"}\n`);
    let blocked = 0, movable = 0, merged = 0;
    for (const p of plan) {
        for (const loser of p.losers) {
            const pv = await previewMerge(p.kind, p.winner.id, loser.id);
            const moved = Object.values(pv.accountRefs).reduce((s, n) => s + n, 0)
                + pv.partyRefs.phones + pv.partyRefs.emails + pv.partyRefs.deals;
            const label = p.winner.name.slice(0, 34).padEnd(36);
            if (pv.blockers.length) {
                blocked++;
                console.log(`  ✗ ${label} ${loser.id} → ${p.winner.id}   BLOCKED: ${pv.blockers.map((b) => b.kind).join(", ")}`);
                continue;
            }
            movable++;
            if (!apply) {
                console.log(`  ✓ ${label} ${loser.id} → ${p.winner.id}   moves ${moved} reference(s)`);
                continue;
            }
            try {
                await mergeParty(p.kind, p.winner.id, loser.id);
                merged++;
                console.log(`  ✓ ${label} ${loser.id} → ${p.winner.id}   merged (${moved} reference(s))`);
            } catch (e) {
                console.log(`  ✗ ${label} ${loser.id} → ${p.winner.id}   FAILED: ${(e as Error).message}`);
            }
        }
    }
    console.log(`\n  ${apply ? `${merged} merged` : `${movable} merge(s) ready`} · ${blocked} blocked`);

    // ── Products ────────────────────────────────────────────────────────────
    const prods = (await pool.query(`
        select p.id, p.name, p.sku, p."createdAt" created, coalesce(p."openingStock", 0) os,
               coalesce(p.stock, 0) stock,
               (select count(*) from inv_product_codes c where c."productId" = p.id) codes,
               (select count(*) from "VoucherInventoryLine" l where l."productId" = p.id) lines,
               (select count(*) from "InvStockLedger" s where s."productId" = p.id) ledger
        from "InvProduct" p
        where lower(trim(p.name)) in (
          select lower(trim(name)) from "InvProduct" group by 1 having count(*) > 1)
        order by lower(trim(p.name)), p.id
    `)).rows;
    console.log(`\nDUPLICATE PRODUCTS — ${prods.length} rows`);
    for (const r of prods) {
        console.log(`  ${String(r.name).slice(0, 40).padEnd(42)} id ${String(r.id).padStart(5)}  sku ${r.sku}` +
            `  ${String(r.created).slice(0, 10)}  opening ${String(r.os).padStart(6)}  codes ${r.codes}` +
            `  lines ${r.lines}  ledger ${r.ledger}`);
    }
    console.log(`\n  No product merge helper exists (mergeParty is parties only) — these want a manual decision.\n`);
    console.log(`Nothing was written.\n`);
    await pool.end();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
