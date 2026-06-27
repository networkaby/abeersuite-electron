// Phase 4 Stage D — backfill the universal-voucher spine from legacy GL.
//
// IDEMPOTENT: creates a UniversalVoucher (+ VoucherGlLine children) for every
// JournalEntry that doesn't already have one (matched via sourceJournalEntryId —
// so rows already dual-written by the engine since Stage C are skipped). Each
// JE's `type`/`friendlyRef`/`partyAccountId` is resolved from its source
// Voucher / InvVoucher; stand-alone JEs fall back to type "JOURNAL".
//
// After backfilling it ASSERTS ZERO DRIFT: the per-(account,type) POSTED sum of
// VoucherGlLine must equal that of the legacy JournalLine. Exits non-zero on any
// mismatch (and on `--check` it ONLY runs the assertion, no writes).
//
// Run:  pnpm tsx src/scripts/backfill-universal-voucher.ts [--check]

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CHECK_ONLY = process.argv.includes("--check");

async function backfill(): Promise<number> {
    // JEs that already have a spine (engine dual-write since Stage C, or a prior
    // backfill run) — skip them.
    const existing = await prisma.universalVoucher.findMany({
        where:  { sourceJournalEntryId: { not: null } },
        select: { sourceJournalEntryId: true },
    });
    const done = new Set(existing.map((r) => r.sourceJournalEntryId!));

    const jes = await prisma.journalEntry.findMany({
        include: { lines: { select: { accountId: true, type: true, amount: true, description: true, branchId: true } } },
    });
    const todo = jes.filter((je) => !done.has(je.id));
    if (todo.length === 0) { console.log("backfill: nothing to do (all JEs already have a spine)."); return 0; }

    const jeIds = todo.map((j) => j.id);
    const [vouchers, invs] = await Promise.all([
        prisma.voucher.findMany({
            where:  { journalEntryId: { in: jeIds } },
            select: { journalEntryId: true, type: true, reference: true, partyAccountId: true, narration: true },
        }),
        prisma.invVoucher.findMany({
            where:  { journalEntryId: { in: jeIds } },
            select: { journalEntryId: true, type: true, reference: true, accountId: true },
        }),
    ]);
    const vMap = new Map(vouchers.filter((v) => v.journalEntryId != null).map((v) => [v.journalEntryId!, v]));
    const iMap = new Map(invs.filter((v) => v.journalEntryId != null).map((v) => [v.journalEntryId!, v]));

    let created = 0;
    for (const je of todo) {
        const v = vMap.get(je.id);
        const i = iMap.get(je.id);
        const type           = v?.type ?? i?.type ?? "JOURNAL";
        const friendlyRef    = v?.reference ?? i?.reference ?? null;
        const partyAccountId = v?.partyAccountId ?? i?.accountId ?? null;
        const narration      = v?.narration ?? null;

        await prisma.universalVoucher.create({
            data: {
                type,
                reference:            je.reference,        // mirrors the JE's unique ref
                friendlyRef,
                date:                 je.date,
                description:          je.description,
                narration,
                status:               je.status,
                partyAccountId,
                postedAt:             je.postedAt,
                cancelledAt:          je.cancelledAt,
                cancelledById:        je.cancelledById,
                cancelReason:         je.cancelReason,
                deletedAt:            je.deletedAt,
                deletedById:          je.deletedById,
                deleteReason:         je.deleteReason,
                createdById:          je.createdById,
                sourceJournalEntryId: je.id,
                lines: {
                    create: je.lines.map((l, idx) => ({
                        accountId:   l.accountId,
                        type:        l.type,
                        amount:      l.amount,
                        description: l.description,
                        branchId:    l.branchId,
                        seq:         idx,   // G4 ordinal; role null on backfilled legs
                    })),
                },
            },
        });
        created++;
    }
    console.log(`backfill: created ${created} spine row(s) from ${todo.length} JE(s).`);
    return created;
}

/** Per-(account,type) POSTED, non-deleted GL sums from legacy vs spine — must match. */
async function assertZeroDrift(): Promise<boolean> {
    const [legacy, spine] = await Promise.all([
        prisma.journalLine.groupBy({
            by:    ["accountId", "type"],
            _sum:  { amount: true },
            where: { journalEntry: { status: "POSTED", deletedAt: null } },
        }),
        prisma.voucherGlLine.groupBy({
            by:    ["accountId", "type"],
            _sum:  { amount: true },
            where: { universalVoucher: { status: "POSTED", deletedAt: null } },
        }),
    ]);
    const key = (r: { accountId: number; type: string }) => `${r.accountId}:${r.type}`;
    const legMap = new Map(legacy.map((r) => [key(r), Number(r._sum.amount ?? 0)]));
    const spnMap = new Map(spine.map((r) => [key(r), Number(r._sum.amount ?? 0)]));

    const keys = new Set([...legMap.keys(), ...spnMap.keys()]);
    const mismatches: string[] = [];
    for (const k of keys) {
        const a = legMap.get(k) ?? 0;
        const b = spnMap.get(k) ?? 0;
        if (Math.abs(a - b) > 0.005) mismatches.push(`${k}: legacy ${a.toFixed(2)} ≠ spine ${b.toFixed(2)}`);
    }
    console.log(`\ndrift check: ${keys.size} (account,type) buckets compared.`);
    if (mismatches.length === 0) { console.log("ZERO DRIFT ✓ — spine GL == legacy GL"); return true; }
    console.log(`DRIFT ✗ — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches.slice(0, 25)) console.log("  " + m);
    return false;
}

// Phase 4 G1: for every legacy JOURNAL_ENTRY allocation, ensure a parallel
// UNIVERSAL_VOUCHER allocation exists (targetId = the spine that mirrors the JE).
// Idempotent — skips when the parallel row is already present. Additive: never
// touches the JOURNAL_ENTRY rows (readers cut over to UNIVERSAL_VOUCHER later).
async function backfillAllocations(): Promise<number> {
    const jeAllocs = await prisma.voucherAllocation.findMany({
        where:  { targetType: "JOURNAL_ENTRY" },
        select: { targetId: true, sourceType: true, sourceId: true, amount: true, method: true, reference: true, createdById: true },
    });
    if (jeAllocs.length === 0) return 0;

    const jeIds = [...new Set(jeAllocs.map((a) => a.targetId))];
    const spineByJe = new Map(
        (await prisma.universalVoucher.findMany({ where: { sourceJournalEntryId: { in: jeIds } }, select: { id: true, sourceJournalEntryId: true } }))
            .map((s) => [s.sourceJournalEntryId!, s.id]),
    );
    const existingUv = new Set(
        (await prisma.voucherAllocation.findMany({ where: { targetType: "UNIVERSAL_VOUCHER" }, select: { sourceType: true, sourceId: true, targetId: true } }))
            .map((a) => `${a.sourceType}:${a.sourceId}:${a.targetId}`),
    );

    let created = 0;
    for (const a of jeAllocs) {
        const spineId = spineByJe.get(a.targetId);
        if (spineId == null) continue;
        if (existingUv.has(`${a.sourceType}:${a.sourceId}:${spineId}`)) continue;
        await prisma.voucherAllocation.create({
            data: { targetType: "UNIVERSAL_VOUCHER", targetId: spineId, sourceType: a.sourceType, sourceId: a.sourceId, amount: a.amount, method: a.method, reference: a.reference, createdById: a.createdById },
        });
        created++;
    }
    return created;
}

// Phase 4 G1 (legacy retire): drop JOURNAL_ENTRY allocations now that
// postReceiptVoucher is spine-only and every reader reads UNIVERSAL_VOUCHER.
// Only deletes a JE allocation when its UV parallel exists (safety) —
// backfillAllocations above guarantees that.
async function dropLegacyAllocations(): Promise<number> {
    const jeAllocs = await prisma.voucherAllocation.findMany({
        where:  { targetType: "JOURNAL_ENTRY" },
        select: { id: true, targetId: true, sourceType: true, sourceId: true },
    });
    if (jeAllocs.length === 0) return 0;
    const spineByJe = new Map(
        (await prisma.universalVoucher.findMany({ where: { sourceJournalEntryId: { in: [...new Set(jeAllocs.map((a) => a.targetId))] } }, select: { id: true, sourceJournalEntryId: true } }))
            .map((s) => [s.sourceJournalEntryId!, s.id]),
    );
    const uvSet = new Set(
        (await prisma.voucherAllocation.findMany({ where: { targetType: "UNIVERSAL_VOUCHER" }, select: { sourceType: true, sourceId: true, targetId: true } }))
            .map((a) => `${a.sourceType}:${a.sourceId}:${a.targetId}`),
    );
    const toDelete = jeAllocs
        .filter((a) => { const sp = spineByJe.get(a.targetId); return sp != null && uvSet.has(`${a.sourceType}:${a.sourceId}:${sp}`); })
        .map((a) => a.id);
    if (toDelete.length > 0) await prisma.voucherAllocation.deleteMany({ where: { id: { in: toDelete } } });
    return toDelete.length;
}

// Phase 4 G2: stamp each pre-existing spine line with its legacy JournalLine
// twin's id (`VoucherGlLine.sourceJournalLineId`). New rows are stamped at
// write-time by the engine; this fills in spines created before G2. Pairs lines
// positionally — both sides were created from the same ordered `lines` array, so
// id-asc on each is the same logical order. Idempotent (skips already-stamped).
async function backfillGlLineSourceIds(): Promise<number> {
    const spines = await prisma.universalVoucher.findMany({
        where:  { sourceJournalEntryId: { not: null }, lines: { some: { sourceJournalLineId: null } } },
        select: { sourceJournalEntryId: true, lines: { select: { id: true, sourceJournalLineId: true }, orderBy: { id: "asc" } } },
    });
    if (spines.length === 0) return 0;
    const jes = await prisma.journalEntry.findMany({
        where:  { id: { in: spines.map((s) => s.sourceJournalEntryId!) } },
        select: { id: true, lines: { select: { id: true }, orderBy: { id: "asc" } } },
    });
    const jeLinesById = new Map(jes.map((j) => [j.id, j.lines.map((l) => l.id)]));

    let updated = 0;
    for (const s of spines) {
        const jeLineIds = jeLinesById.get(s.sourceJournalEntryId!) ?? [];
        if (jeLineIds.length !== s.lines.length) continue; // arity mismatch — skip rather than mis-link
        for (let i = 0; i < s.lines.length; i++) {
            if (s.lines[i].sourceJournalLineId != null) continue;
            await prisma.voucherGlLine.update({ where: { id: s.lines[i].id }, data: { sourceJournalLineId: jeLineIds[i] } });
            updated++;
        }
    }
    return updated;
}

// Phase 4 G2: re-home cost-pool rows off the legacy JournalLine onto the spine —
// set `sourceVoucherGlLineId` from the VoucherGlLine that twins the row's
// `sourceJournalLineId`. Idempotent. Leaves the legacy column intact (G5 drops).
async function backfillCostPoolGlLines(): Promise<number> {
    const rows = await prisma.additionalCostAllocation.findMany({
        where:  { sourceVoucherGlLineId: null, sourceJournalLineId: { not: null } },
        select: { id: true, sourceJournalLineId: true },
    });
    if (rows.length === 0) return 0;
    const glLines = await prisma.voucherGlLine.findMany({
        where:  { sourceJournalLineId: { in: [...new Set(rows.map((r) => r.sourceJournalLineId!))] } },
        select: { id: true, sourceJournalLineId: true },
    });
    const glByJl = new Map(glLines.map((g) => [g.sourceJournalLineId!, g.id]));

    let updated = 0;
    for (const r of rows) {
        const glId = glByJl.get(r.sourceJournalLineId!);
        if (glId == null) continue; // no twin yet — backfillGlLineSourceIds should have made it
        await prisma.additionalCostAllocation.update({ where: { id: r.id }, data: { sourceVoucherGlLineId: glId } });
        updated++;
    }
    return updated;
}

// Phase 4 G4d: populate the direct InvVoucher/Voucher → spine link
// (`universalVoucherId`) from the indirect sourceJournalEntryId↔journalEntryId
// hop, so the relationship survives the JournalEntry drop in G5. Idempotent.
async function backfillVoucherSpineLinks(): Promise<number> {
    const spines = await prisma.universalVoucher.findMany({
        where:  { sourceJournalEntryId: { not: null } },
        select: { id: true, sourceJournalEntryId: true },
    });
    const spineByJe = new Map(spines.map((s) => [s.sourceJournalEntryId!, s.id]));
    let updated = 0;
    const invs = await prisma.invVoucher.findMany({ where: { journalEntryId: { not: null }, universalVoucherId: null }, select: { id: true, journalEntryId: true } });
    for (const v of invs) {
        const sid = spineByJe.get(v.journalEntryId!);
        if (sid == null) continue;
        await prisma.invVoucher.update({ where: { id: v.id }, data: { universalVoucherId: sid } });
        updated++;
    }
    const vchs = await prisma.voucher.findMany({ where: { journalEntryId: { not: null }, universalVoucherId: null }, select: { id: true, journalEntryId: true } });
    for (const v of vchs) {
        const sid = spineByJe.get(v.journalEntryId!);
        if (sid == null) continue;
        await prisma.voucher.update({ where: { id: v.id }, data: { universalVoucherId: sid } });
        updated++;
    }
    return updated;
}

async function main() {
    if (!CHECK_ONLY) {
        await backfill();
        const allocs = await backfillAllocations();
        console.log(`allocation backfill: created ${allocs} parallel UNIVERSAL_VOUCHER allocation(s).`);
        const dropped = await dropLegacyAllocations();
        console.log(`legacy allocations dropped: ${dropped} JOURNAL_ENTRY allocation(s) removed.`);
        const glLineLinks = await backfillGlLineSourceIds();
        console.log(`G2 spine-line back-refs: stamped ${glLineLinks} VoucherGlLine.sourceJournalLineId.`);
        const costPoolLinks = await backfillCostPoolGlLines();
        console.log(`G2 cost-pool re-home: linked ${costPoolLinks} AdditionalCostAllocation to spine lines.`);
        const spineLinks = await backfillVoucherSpineLinks();
        console.log(`G4d spine links: set ${spineLinks} InvVoucher/Voucher.universalVoucherId.`);
    } else {
        console.log("--check: skipping writes, asserting drift only.");
    }
    const ok = await assertZeroDrift();
    if (!ok) process.exitCode = 1;
}

main()
    .then(() => prisma.$disconnect().then(() => process.exit(process.exitCode ?? 0)))
    .catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
