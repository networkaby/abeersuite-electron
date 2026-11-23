// Brings every stored phone to its one stored form (canonicalPhone): Indian
// numbers as bare 10 digits, foreign ones as `+` and the country code.
//
// `Phone.phone` is unique as TEXT, so `+919954999271` and `9954999271` used to
// sit side by side on one customer. This finds them and:
//
//   same owner, several shapes → keeps one row (primary first, then verified,
//                                then oldest), carries primary/verified onto it,
//                                deletes the rest, saves it in the stored form
//   one row, wrong shape       → rewrites it in the stored form
//   different owners           → REPORTED only; a person decides who owns it
//   not a number by the rule   → REPORTED only (e.g. a foreign number typed
//                                without its country code)
//
//   npx tsx src/scripts/fix-phone-duplicates.ts          report only
//   npx tsx src/scripts/fix-phone-duplicates.ts --fix    apply

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { canonicalPhone } from "@/shared/lib/format/phone";
import { scriptDbUrl } from "@/shared/lib/db/dbTargets";

const FIX = process.argv.includes("--fix");

const rawUrl = scriptDbUrl()
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Row = {
    id: number; phone: string; personId: number | null; companyId: number | null;
    isPrimary: boolean; verifiedAt: Date | null;
};

const ownerKey = (r: Row) => (r.personId != null ? `person:${r.personId}` : `company:${r.companyId}`);

async function main() {
    console.log(`Database: ${isLocalDb ? "LOCAL" : "REMOTE"} — ${FIX ? "FIX (writes)" : "report only"}`);
    const rows: Row[] = await prisma.phone.findMany({
        select: { id: true, phone: true, personId: true, companyId: true, isPrimary: true, verifiedAt: true },
        orderBy: { id: "asc" },
    });

    const groups = new Map<string, Row[]>();
    const invalid: Row[] = [];
    for (const r of rows) {
        const key = canonicalPhone(r.phone);
        if (!key) { invalid.push(r); continue; }
        groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    let merged = 0, rewritten = 0;
    const crossOwner: Array<[string, Row[]]> = [];

    for (const [key, list] of groups) {
        const owners = new Set(list.map(ownerKey));
        if (owners.size > 1) { crossOwner.push([key, list]); continue; }
        if (list.length === 1 && list[0].phone === key) continue;

        const keep = [...list].sort((a, b) =>
            Number(b.isPrimary) - Number(a.isPrimary)
            || Number(!!b.verifiedAt) - Number(!!a.verifiedAt)
            || a.id - b.id)[0];
        const drop = list.filter((r) => r.id !== keep.id);
        const verifiedAt = list.map((r) => r.verifiedAt).filter((d): d is Date => !!d)
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        const isPrimary = list.some((r) => r.isPrimary);

        if (drop.length) {
            merged++;
            console.log(`  merge ${ownerKey(keep)}  keep #${keep.id} "${keep.phone}" → "${key}"  drop ${drop.map((r) => `#${r.id} "${r.phone}"`).join(", ")}`);
        } else {
            rewritten++;
            console.log(`  rewrite #${keep.id} "${keep.phone}" → "${key}"`);
        }
        if (!FIX) continue;

        await prisma.$transaction(async (tx) => {
            if (drop.length) await tx.phone.deleteMany({ where: { id: { in: drop.map((r) => r.id) } } });
            await tx.phone.update({ where: { id: keep.id }, data: { phone: key, isPrimary, verifiedAt } });
            // Same reason as contactWrite.touchOwner: party lists search by number.
            if (keep.personId != null) await tx.person.update({ where: { id: keep.personId }, data: { updatedAt: new Date() } });
            else if (keep.companyId != null) await tx.company.update({ where: { id: keep.companyId }, data: { updatedAt: new Date() } });
        });
    }

    console.log(`\n${merged} duplicate set(s) ${FIX ? "merged" : "to merge"}, ${rewritten} row(s) ${FIX ? "rewritten" : "to rewrite"}.`);
    if (crossOwner.length) {
        console.log(`\n${crossOwner.length} number(s) on MORE THAN ONE customer — left alone, decide by hand:`);
        for (const [key, list] of crossOwner) {
            console.log(`  ${key}: ${list.map((r) => `#${r.id} "${r.phone}" ${ownerKey(r)}`).join(" | ")}`);
        }
    }
    if (invalid.length) {
        console.log(`\n${invalid.length} phone(s) that are not a number by the rule — left alone:`);
        for (const r of invalid) console.log(`  #${r.id} "${r.phone}" ${ownerKey(r)}`);
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
