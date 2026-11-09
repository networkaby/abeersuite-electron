/**
 * Collections → the lean tree (agreed with the owner 2026-11-10).
 *
 * Audit on abeersuite_dev (copy of live, 2026-11-10): no pricing point, loyalty
 * rule, coupon rule or Attribute Master points at a collection, and none has a
 * slug, image or reorder band — so renaming, merging and emptying collections
 * changes no price, offer or stock alert.
 *
 * This run (phase 1):
 *   • rename  Shop by Customer → Shop by Need, Home Security → Home & Family,
 *             Retail Solutions → Shop & Retail, Professional & Office → Office & Business
 *   • merge   Small Business → Shop & Retail, Industrial Security → Office & Business
 *             (links moved, main collection moved, old one switched off)
 *   • empty   Other Products (every link dropped, main collection cleared, switched off)
 *   • off     Best Sellers (empty; the home page's Best sellers rail is computed from bills)
 *   • every product's list renumbered 0..n with InvProduct.categoryId = the first,
 *     updatedAt bumped only on products whose row changed, so counters pull them.
 *
 * Phase 2 (`--phase2`): each kit keeps exactly the products listed in
 * scripts/data/collection-kit-picks.json, Work From Home is switched off and its
 * short pick goes to Home & Family. Phase 1 alone leaves the kits untouched: the Setup Kits and Work From
 * Home, which today hold whole product types. The run prints, per kit, how its
 * products spread across Product Groups so the owner can choose what stays.
 *
 * Collections are found by NAME and the run stops if any is missing or already
 * renamed differently — never acts on a guessed id. Re-running is safe.
 *
 *   npx tsx scripts/reorganise-collections.ts -- --db <local url>                     # plan
 *   npx tsx scripts/reorganise-collections.ts -- --db <local url> --apply --rollback  # rehearse
 *   npx tsx scripts/reorganise-collections.ts -- --apply                               # live (backup < 1 h)
 *   … add --phase2 to any of the above for the kit trim, or --slugs to give
 *     every active collection without one a shop link (/name)
 */

import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { finish, openTarget } from "./vyapar/liveTarget";
import { slugify } from "../src/shared/lib/format/slugify";
import { isReservedShopSlug } from "../src/shared/lib/shop/storefrontSlugPath";

const RENAMES: Array<[from: string, to: string]> = [
    ["Shop by Customer", "Shop by Need"],
    ["Home Security", "Home & Family"],
    ["Retail Solutions", "Shop & Retail"],
    ["Professional & Office", "Office & Business"],
];
/** source → target, both by their NEW names (renames run first). */
const MERGES: Array<[from: string, into: string]> = [
    ["Small Business", "Shop & Retail"],
    ["Industrial Security", "Office & Business"],
];
const EMPTY = ["Other Products"];
const SWITCH_OFF = ["Best Sellers"];
const KITS = ["CCTV Starter Kit", "New PC Build", "Billing Counter Setup", "Office Network Setup", "Work From Home"];

type Cat = { id: number; name: string; isActive: boolean; parent: string | null };

async function cats(db: PoolClient): Promise<Map<string, Cat>> {
    const rows = (await db.query<Cat>(`
        select c.id, c.name, c."isActive", p.name parent
        from "InvCategory" c left join "InvCategory" p on p.id = c."parentId"`)).rows;
    return new Map(rows.map((r) => [r.name, r]));
}

async function count(db: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
    return Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
}

async function printTree(db: PoolClient, title: string): Promise<void> {
    const rows = (await db.query<{ name: string; parent: string | null; on: boolean; items: string; main: string }>(`
        select c.name, p.name parent, c."isActive" "on",
               (select count(*) from inv_product_collections l where l."categoryId" = c.id) items,
               (select count(*) from "InvProduct" x where x."categoryId" = c.id) main
        from "InvCategory" c left join "InvCategory" p on p.id = c."parentId"
        order by coalesce(p.name, c.name), p.name nulls first, c.name`)).rows;
    console.log(`\n── ${title} ──`);
    for (const r of rows) {
        const label = `${r.parent ? "    " : ""}${r.name}${r.on ? "" : "  (off)"}`;
        console.log(`  ${label.padEnd(36)} items ${r.items.padStart(4)}   main for ${r.main.padStart(4)}`);
    }
    const tagged = await count(db, `select count(distinct "productId") n from inv_product_collections`);
    console.log(`  products with at least one collection: ${tagged}`);
}

async function kitReport(db: PoolClient, byName: Map<string, Cat>): Promise<void> {
    console.log(`\n── Phase 2 preview: what each kit holds, by Product Group (not changed by this run) ──`);
    for (const kit of KITS) {
        const c = byName.get(kit);
        if (!c) { console.log(`  ${kit}: not found`); continue; }
        const rows = (await db.query<{ grp: string | null; n: string }>(`
            select g.name grp, count(*) n
            from inv_product_collections l
            join "InvProduct" x on x.id = l."productId"
            left join "InvProductGroup" g on g.id = x."groupId"
            where l."categoryId" = $1
            group by g.name order by count(*) desc limit 8`, [c.id])).rows;
        const total = await count(db, `select count(*) n from inv_product_collections where "categoryId" = $1`, [c.id]);
        console.log(`  ${kit} (${total}): ${rows.map((r) => `${r.grp ?? "no group"} ${r.n}`).join(", ")}${rows.length === 8 ? ", …" : ""}`);
    }
}

async function apply(db: PoolClient): Promise<number> {
    let byName = await cats(db);

    for (const [from, to] of RENAMES) {
        if (byName.has(to) && !byName.has(from)) continue; // already done
        await db.query(`update "InvCategory" set name = $2, "updatedAt" = now() where id = $1`, [byName.get(from)!.id, to]);
    }
    byName = await cats(db);

    for (const [from, into] of MERGES) {
        const src = byName.get(from);
        const dst = byName.get(into)!;
        if (!src) continue;
        // Keep the source's position in each product's list; a product already in the target keeps its own row.
        await db.query(`
            insert into inv_product_collections ("productId", "categoryId", "sortOrder")
            select "productId", $2, "sortOrder" from inv_product_collections where "categoryId" = $1
            on conflict ("productId", "categoryId") do update
                set "sortOrder" = least(inv_product_collections."sortOrder", excluded."sortOrder")`, [src.id, dst.id]);
        await db.query(`delete from inv_product_collections where "categoryId" = $1`, [src.id]);
        await db.query(`update "InvCategory" set "isActive" = false, "updatedAt" = now() where id = $1`, [src.id]);
    }

    for (const name of EMPTY) {
        const c = byName.get(name);
        if (!c) continue;
        await db.query(`delete from inv_product_collections where "categoryId" = $1`, [c.id]);
        await db.query(`update "InvCategory" set "isActive" = false, "updatedAt" = now() where id = $1`, [c.id]);
    }
    for (const name of SWITCH_OFF) {
        const c = byName.get(name);
        if (c) await db.query(`update "InvCategory" set "isActive" = false, "updatedAt" = now() where id = $1 and "isActive"`, [c.id]);
    }

    return settleMains(db);
}

/** Every product: list renumbered 0..n in its existing order, main = the first. Returns product rows changed. */
async function settleMains(db: PoolClient): Promise<number> {
    await db.query(`
        with ranked as (
            select "productId", "categoryId",
                   row_number() over (partition by "productId" order by "sortOrder", "categoryId") - 1 rn
            from inv_product_collections)
        update inv_product_collections l set "sortOrder" = r.rn
        from ranked r
        where l."productId" = r."productId" and l."categoryId" = r."categoryId" and l."sortOrder" <> r.rn`);
    const res = await db.query(`
        update "InvProduct" x
        set "categoryId" = m.first, "updatedAt" = now()
        from (select p.id, (select l."categoryId" from inv_product_collections l
                            where l."productId" = p.id order by l."sortOrder" limit 1) first
              from "InvProduct" p) m
        where m.id = x.id and x."categoryId" is distinct from m.first`);
    return res.rowCount ?? 0;
}

// ── Phase 2: Setup Kits trimmed to the owner's picks (scripts/data/collection-kit-picks.json) ──

type Pick = [id: number, label: string];
type Picks = { kits: Record<string, Pick[]>; keepAll: string[]; switchOff: string[]; add: Record<string, Pick[]> };

async function applyKits(db: PoolClient, picks: Picks, byName: Map<string, Cat>): Promise<number> {
    const id = (name: string) => byName.get(name)!.id;
    for (const [kit, list] of Object.entries(picks.kits)) {
        const keep = list.map(([pid]) => pid);
        await db.query(`delete from inv_product_collections where "categoryId" = $1 and not ("productId" = any($2::int[]))`, [id(kit), keep]);
        await addLinks(db, id(kit), keep);
    }
    for (const [name, list] of Object.entries(picks.add)) await addLinks(db, id(name), list.map(([pid]) => pid));
    for (const name of picks.switchOff) {
        await db.query(`delete from inv_product_collections where "categoryId" = $1`, [id(name)]);
        await db.query(`update "InvCategory" set "isActive" = false, "updatedAt" = now() where id = $1`, [id(name)]);
    }
    return settleMains(db);
}

/** Put products into a collection, at the END of each one's list (never changes an existing main). */
async function addLinks(db: PoolClient, categoryId: number, productIds: number[]): Promise<void> {
    await db.query(`
        insert into inv_product_collections ("productId", "categoryId", "sortOrder")
        select p, $1, coalesce((select max("sortOrder") + 1 from inv_product_collections where "productId" = p), 0)
        from unnest($2::int[]) p
        on conflict ("productId", "categoryId") do nothing`, [categoryId, productIds]);
}

async function checkPicks(db: PoolClient, picks: Picks, byName: Map<string, Cat>): Promise<void> {
    const names = [...Object.keys(picks.kits), ...picks.keepAll, ...picks.switchOff, ...Object.keys(picks.add)];
    const missing = names.filter((n) => !byName.get(n)?.isActive);
    if (missing.length) throw new Error(`Collection(s) missing or switched off: ${missing.join(", ")}. Run phase 1 first.`);
    const all = [...Object.values(picks.kits), ...Object.values(picks.add)].flat();
    const rows = (await db.query<{ id: number; name: string; isActive: boolean }>(
        `select id, name, "isActive" from "InvProduct" where id = any($1::int[])`, [all.map(([pid]) => pid)])).rows;
    const found = new Map(rows.map((r) => [r.id, r]));
    const bad = all.filter(([pid]) => !found.get(pid)?.isActive).map(([pid, l]) => `${pid} (${l})`);
    if (bad.length) throw new Error(`Picked product(s) missing or inactive: ${bad.join(", ")}`);
    for (const [title, groups] of [["Kits keep", picks.kits], ["Added", picks.add]] as const) {
        for (const [name, list] of Object.entries(groups)) {
            console.log(`
  ${title}: ${name} (${list.length})`);
            for (const [pid] of list) console.log(`    ${String(pid).padStart(5)}  ${found.get(pid)!.name}`);
        }
    }
}

// ── Slugs (`--slugs`): every active collection without a shop link gets one ──
// Same rule as autoShopSlug in src/shared/lib/shop/shopSlug.ts: slugify(name),
// then -2, -3 … while a page of the app, a product, group, collection or brand holds it.

async function applySlugs(db: PoolClient): Promise<number> {
    const taken = new Set((await db.query<{ slug: string }>(`
        select slug from "InvProduct" where slug is not null
        union select slug from "InvProductGroup" where slug is not null
        union select slug from "InvCategory" where slug is not null
        union select slug from "InvBrand" where slug is not null`)).rows.map((r) => r.slug));
    const rows = (await db.query<{ id: number; name: string }>(
        `select id, name from "InvCategory" where "isActive" and slug is null order by id`)).rows;
    let n = 0;
    for (const r of rows) {
        const base = slugify(r.name, { maxLength: 80 });
        let slug: string | null = null;
        for (let i = 1; base && i <= 50 && !slug; i++) {
            const c = i === 1 ? base : `${base}-${i}`;
            if (!taken.has(c) && !isReservedShopSlug(c)) slug = c;
        }
        if (!slug) { console.log(`  ! ${r.name}: no free link, left blank`); continue; }
        taken.add(slug);
        await db.query(`update "InvCategory" set slug = $2, "updatedAt" = now() where id = $1`, [r.id, slug]);
        console.log(`  ${r.name.padEnd(28)} → /${slug}`);
        n++;
    }
    return n;
}

async function verify(db: PoolClient): Promise<void> {
    const problems: string[] = [];
    const onOff = await count(db, `
        select count(*) n from inv_product_collections l join "InvCategory" c on c.id = l."categoryId" where not c."isActive"`);
    if (onOff) problems.push(`${onOff} link(s) still point at a switched-off collection`);
    const mismatch = await count(db, `
        select count(*) n from "InvProduct" x
        where x."categoryId" is distinct from (select l."categoryId" from inv_product_collections l
                                               where l."productId" = x.id and l."sortOrder" = 0)`);
    if (mismatch) problems.push(`${mismatch} product(s) whose main collection is not their first link`);
    const gaps = await count(db, `
        select count(*) n from (select "productId", max("sortOrder") mx, count(*) c
                                from inv_product_collections group by 1) t where mx <> c - 1`);
    if (gaps) problems.push(`${gaps} product(s) with gaps in their list order`);
    if (problems.length) throw new Error(`Check failed: ${problems.join("; ")}`);
    console.log(`\nChecks passed: no link to a switched-off collection, every main = first link, no order gaps.`);
}

async function main(): Promise<void> {
    const t = await openTarget();
    const { db } = t;
    let ok = false;
    let summary = "";
    try {
        const byName = await cats(db);
        if (process.argv.includes("--slugs")) {
            console.log("Shop links for active collections:");
            const n = await applySlugs(db);
            summary = `${n} collection link(s)`;
            ok = true;
            return;
        }
        if (process.argv.includes("--phase2")) {
            const picks = JSON.parse(readFileSync("scripts/data/collection-kit-picks.json", "utf8")) as Picks;
            await checkPicks(db, picks, byName);
            await printTree(db, "Before");
            if (t.go) {
                const touched = await applyKits(db, picks, byName);
                await verify(db);
                await printTree(db, "After");
                console.log(`
Products whose row changed (pulled again by counters): ${touched}`);
                summary = `kits trimmed, ${touched} product row(s) changed`;
            } else summary = "plan printed";
            ok = true;
            return;
        }
        const need = [
            ...RENAMES.map(([f, to]) => (byName.has(f) || byName.has(to) ? null : `${f} (or ${to})`)),
            ...MERGES.map(([f, into]) => (byName.has(f) || byName.has(into) ? null : f)),
            ...[...EMPTY, ...SWITCH_OFF].map((n) => (byName.has(n) ? null : n)),
        ].filter(Boolean);
        if (need.length) throw new Error(`Collection(s) not found by name: ${need.join(", ")}. Nothing changed.`);
        const clash = RENAMES.filter(([f, to]) => byName.has(f) && byName.has(to));
        if (clash.length) throw new Error(`Both old and new name exist: ${clash.map(([f, to]) => `${f} / ${to}`).join(", ")}`);

        await printTree(db, "Before");
        await kitReport(db, byName);

        if (t.go) {
            const touched = await apply(db);
            await verify(db);
            await printTree(db, "After");
            console.log(`\nProducts whose row changed (pulled again by counters): ${touched}`);
            summary = `collections reorganised, ${touched} product row(s) changed`;
        } else {
            summary = "plan printed";
        }
        ok = true;
    } finally {
        await finish(t, ok, summary);
    }
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
});
