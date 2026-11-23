// Make the bill-wise link data healthy on an existing database. Two jobs, both
// safe to re-run:
//
//   1. Stamp `UniversalVoucher.partyAccountId` where it is missing.
//      The office Receipt / Payment form never sent it, so every receipt and
//      payment ever entered there has a null party — the money is on the party's
//      ledger through its GL legs, but the voucher itself does not name the party,
//      so party-keyed readers cannot see it. Where exactly ONE party ledger (under
//      Sundry Debtors or Sundry Creditors) appears in a voucher's GL legs, that is
//      the party, beyond doubt. Vouchers touching several party ledgers are
//      reported and left alone: a scalar column cannot hold two, and nothing is
//      lost — bill-wise linking reads the GL legs, which name them all. A Contra
//      touches no party ledger, so it is skipped by the same rule.
//
//   2. Delete orphan `VoucherAllocation` rows — links whose voucher on one or both
//      ends no longer exists (hard-deleted before the delete path learned to take
//      its links with it). These are already harmless: `sumLinked` ignores a link
//      whose other end is not alive, which is what makes a deleted receipt stop
//      clearing its bill. This only sweeps up the debris.
//
//   pnpm repair:bill-links          report only, writes nothing (exit 1 if any)
//   pnpm repair:bill-links --fix    apply the repairs
//
// Safe on live: it never touches a GL line, an amount or a balance — only the
// party label on a voucher, and rows that point at vouchers that are gone.

import { prisma, pool } from "@/shared/lib/db/scriptPrisma";

import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
// The shared walk, read through THIS script's own connection. It used to be
// copied into this file because the shared one could only ever use the app's
// global client; it now takes the client it should read with.
import { accountIdsUnderGroup } from "@/modules/accountancy/lib/accountGroups";


const FIX = process.argv.includes("--fix");

async function stampParties(): Promise<{ fixed: number; ambiguous: string[]; none: number }> {
    const [debtors, creditors] = await Promise.all([
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS, prisma),
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_CREDITORS, prisma),
    ]);
    const partyIds = new Set([...debtors, ...creditors]);

    const vouchers = await prisma.universalVoucher.findMany({
        where:  { partyAccountId: null },
        select: { id: true, type: true, voucherNo: true, lines: { select: { accountId: true } } },
        orderBy: { id: "asc" },
    });

    let fixed = 0;
    let none = 0;
    const ambiguous: string[] = [];

    for (const v of vouchers) {
        const parties = [...new Set(v.lines.map((l) => l.accountId).filter((id) => partyIds.has(id)))];
        if (parties.length === 0) { none += 1; continue; }
        if (parties.length > 1) {
            ambiguous.push(`  ${v.type} ${v.voucherNo ?? `UV-${v.id}`} — ${parties.length} party ledgers (${parties.join(", ")})`);
            continue;
        }
        if (FIX) {
            await prisma.universalVoucher.update({ where: { id: v.id }, data: { partyAccountId: parties[0] } });
        }
        fixed += 1;
    }
    return { fixed, ambiguous, none };
}

async function sweepOrphanLinks(): Promise<{ ids: number[]; detail: string[] }> {
    const links = await prisma.voucherAllocation.findMany({
        select: { id: true, targetId: true, sourceId: true, amount: true, reference: true },
    });
    if (links.length === 0) return { ids: [], detail: [] };

    const ends = [...new Set(links.flatMap((l) => [l.targetId, l.sourceId]))];
    const present = new Set(
        (await prisma.universalVoucher.findMany({ where: { id: { in: ends } }, select: { id: true } }))
            .map((v) => v.id),
    );

    const orphans = links.filter((l) => !present.has(l.targetId) || !present.has(l.sourceId));
    return {
        ids:    orphans.map((l) => l.id),
        detail: orphans.map((l) => {
            const missing = [
                present.has(l.targetId) ? null : `target ${l.targetId}`,
                present.has(l.sourceId) ? null : `source ${l.sourceId}`,
            ].filter(Boolean).join(" + ");
            return `  link ${l.id} — ₹${Number(l.amount).toFixed(2)}${l.reference ? ` (${l.reference})` : ""} — gone: ${missing}`;
        }),
    };
}

async function main(): Promise<void> {
    console.log(`\n=== bill-wise link repair ===${FIX ? "" : "  (report only)"}\n`);

    const party = await stampParties();
    console.log(`Party stamp on vouchers with none:`);
    console.log(`  can be stamped  : ${party.fixed}`);
    console.log(`  several parties : ${party.ambiguous.length}`);
    console.log(`  no party at all : ${party.none}  (contras, pure P&L journals — correct as-is)`);
    if (party.ambiguous.length) {
        console.log(`\nSEVERAL PARTIES — left alone, the GL legs still name them all:`);
        party.ambiguous.forEach((l) => console.log(l));
    }

    const orphans = await sweepOrphanLinks();
    console.log(`\nOrphan links (both/one end gone): ${orphans.ids.length}`);
    if (orphans.detail.length) orphans.detail.forEach((l) => console.log(l));
    if (FIX && orphans.ids.length) {
        await prisma.voucherAllocation.deleteMany({ where: { id: { in: orphans.ids } } });
    }

    const work = party.fixed + orphans.ids.length;
    if (work === 0) {
        console.log(`\n✓ Nothing to repair.\n`);
        return;
    }
    if (FIX) console.log(`\n✓ Stamped ${party.fixed} voucher(s), removed ${orphans.ids.length} orphan link(s).\n`);
    else {
        console.log(`\nReport only — nothing was written. Re-run with --fix to apply.\n`);
        process.exitCode = 1;
    }
}

main()
    .catch((e: unknown) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
