// Give every branch-less voucher a branch.
//
// `UniversalVoucher.branchId` was nullable until 2026-09-17, and "org-level, no
// branch" was treated as a legitimate state for a money voucher. In practice it
// was not a state anybody chose — it was whatever the working-branch picker
// happened to be on. A voucher sitting on "All branches" saved a null, and the
// POS shift-close Contra and variance Journal never passed a branch at all even
// though the shift they came from names one. Those vouchers then drop out of
// every branch-wise report without saying so.
//
// The write paths are closed now (`requireWritableBranchId` refuses "All
// branches"; the engine takes `branchId` as a required argument). This script
// deals with the rows already written.
//
// The same backfill also ships as SQL in the migration, so it reaches live and
// every counter replica on deploy without anyone running a script. This script
// is how you PREVIEW it against live first — chiefly the Head Office bucket,
// which is the only part that is a judgement rather than a lookup.
//
// How each blank voucher gets its branch, in order:
//   1. Its source counter's branch — exact, not a guess. The counter belongs to
//      one branch and the voucher records which counter raised it.
//   2. Its shift's branch — for a voucher raised on a shift at no counter.
//   3. Head Office — the last resort for office vouchers that record neither.
//      Nothing else is knowable about them, and Head Office is where office
//      work is booked. Every one of these is listed individually in the report
//      so the fallback is never silent.
//
// Safe to re-run: a voucher with a branch is not looked at again.
//
//   pnpm backfill:voucher-branch            # dry run — writes nothing
//   pnpm backfill:voucher-branch --apply    # actually fill them in
//
// Run the dry run first and read the Head Office bucket. That bucket is the only
// part that is a judgement call rather than a lookup.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

/** How a voucher's branch was worked out — the report groups by this. */
type Source = "counter" | "shift" | "head-office";

async function main(): Promise<void> {
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { systemBranchId } = await import("@/shared/lib/org/systemBranch");

    const headOffice = await systemBranchId(prisma);
    const branchName = new Map(
        (await prisma.branch.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name]),
    );

    const blanks = await prisma.universalVoucher.findMany({
        where:   { branchId: null },
        select:  { id: true, type: true, voucherNo: true, date: true, sourceCounterId: true, sourceShiftId: true },
        orderBy: { id: "asc" },
    });

    if (blanks.length === 0) {
        console.log("Every voucher already carries a branch — nothing to do.");
        return;
    }

    // Resolve counter → branch and shift → branch in two queries, not one per
    // voucher: a few thousand blanks would otherwise be a few thousand round
    // trips to Supabase.
    const counterIds = [...new Set(blanks.map((v) => v.sourceCounterId).filter((n): n is number => n != null))];
    const shiftIds   = [...new Set(blanks.map((v) => v.sourceShiftId).filter((n): n is number => n != null))];

    const counterBranch = new Map(
        (await prisma.posCounter.findMany({
            where: { id: { in: counterIds } }, select: { id: true, branchId: true },
        })).map((c) => [c.id, c.branchId]),
    );
    const shiftBranch = new Map(
        (await prisma.posShift.findMany({
            where: { id: { in: shiftIds } }, select: { id: true, branchId: true },
        })).map((s) => [s.id, s.branchId]),
    );

    const plan = blanks.map((v) => {
        const fromCounter = v.sourceCounterId != null ? counterBranch.get(v.sourceCounterId) : undefined;
        if (fromCounter) return { v, branchId: fromCounter, source: "counter" as Source };
        const fromShift = v.sourceShiftId != null ? shiftBranch.get(v.sourceShiftId) : undefined;
        if (fromShift) return { v, branchId: fromShift, source: "shift" as Source };
        return { v, branchId: headOffice, source: "head-office" as Source };
    });

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(`${blanks.length} voucher(s) with no branch.\n`);

    for (const source of ["counter", "shift", "head-office"] as Source[]) {
        const rows = plan.filter((p) => p.source === source);
        if (rows.length === 0) continue;
        const label = source === "counter"     ? "from their source counter (exact)"
                    : source === "shift"       ? "from their shift (exact)"
                    :                            `to Head Office — ${branchName.get(headOffice) ?? headOffice} (fallback)`;
        console.log(`  ${String(rows.length).padStart(6)}  ${label}`);

        // The fallback bucket is a judgement call, so it gets listed in full
        // rather than counted. The exact buckets do not need reading.
        if (source === "head-office") {
            for (const { v } of rows) {
                console.log(`          UV-${v.id}  ${(v.voucherNo ?? "—").padEnd(16)} ${v.type.padEnd(12)} ${v.date.toISOString().slice(0, 10)}`);
            }
        }
    }

    if (!APPLY) {
        console.log("\nDry run — nothing written. Re-run with --apply to fill these in.");
        return;
    }

    // ── Apply ───────────────────────────────────────────────────────────────
    // Grouped by branch so this is one UPDATE per branch instead of one per
    // voucher. `branchId: null` stays in the where clause so a row somebody
    // else filled in between the read and the write is left alone.
    const byBranch = new Map<string, number[]>();
    for (const { v, branchId } of plan) {
        const ids = byBranch.get(branchId) ?? [];
        ids.push(v.id);
        byBranch.set(branchId, ids);
    }

    let written = 0;
    for (const [branchId, ids] of byBranch) {
        const { count } = await prisma.universalVoucher.updateMany({
            where: { id: { in: ids }, branchId: null },
            data:  { branchId },
        });
        written += count;
        console.log(`  ${String(count).padStart(6)}  →  ${branchName.get(branchId) ?? branchId}`);
    }

    const left = await prisma.universalVoucher.count({ where: { branchId: null } });
    console.log(`\nFilled ${written} voucher(s). ${left} still blank.`);
    if (left > 0) {
        console.log("Some rows were written while this ran — re-run to pick them up.");
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => {
        const { prisma } = await import("@/shared/lib/prisma/prismaClient");
        await prisma.$disconnect();
    });
