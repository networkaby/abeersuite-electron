import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission, requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { requireWritableBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { buildJournalLines } from "@/modules/hr/lib/payrollServer";
import { formatPeriod } from "@/modules/hr/lib/payrollTypes";

// POST /api/hr/payroll/[id]/post — turn a draft run into the period's journal.
//
// ONE journal voucher: a credit to each included person's own ledger for their
// net, and a debit per expense ledger for the total behind it. The run is
// stamped POSTED with the JV's id and number inside the same transaction, so a
// run can never claim a voucher that was rolled back — and the overlap check at
// generation plus this status check mean a day cannot be accrued twice.
//
// Two gates: hr:payroll:run to run payroll at all, and the ordinary JOURNAL
// post gate, because this writes to the general ledger like any other voucher.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_PAYROLL_RUN);
    if (response) return response;

    const createGate = await requireVoucherPermission("JOURNAL", "create");
    if (createGate.response) return createGate.response;
    const postGate = await requireVoucherPermission("JOURNAL", "post");
    if (postGate.response) return postGate.response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    // A journal must name one real branch — the "All branches" sentinel is not
    // a branch, and would be stored as a foreign key matching nothing.
    const session = await auth();
    let branchId: string;
    try { branchId = requireWritableBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
        throw e;
    }

    try {
        const run = await prisma.payrollRun.findUnique({
            where: { id },
            include: { lines: { orderBy: { staffName: "asc" } } },
        });
        if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        if (run.status === "POSTED") {
            return NextResponse.json(
                { error: `Already posted as ${run.voucherRef ?? "a journal voucher"}.`, voucherId: run.voucherId },
                { status: 409 },
            );
        }
        if (run.status !== "DRAFT") {
            return NextResponse.json({ error: `A ${run.status.toLowerCase()} run cannot be posted` }, { status: 422 });
        }

        const fromIso = toDateOnlyUtc(run.periodFrom);
        const toIso = toDateOnlyUtc(run.periodTo);
        const period = formatPeriod(fromIso, toIso);
        const glLines = buildJournalLines(run.lines, fromIso, toIso);

        if (glLines.length < 2) {
            return NextResponse.json(
                { error: "Nobody on this run can be paid — every line is held back or missing a ledger" },
                { status: 422 },
            );
        }
        // Grouping the debits rounds once per ledger while the credits round
        // once per person, so the two sides can drift by a paisa or two. Better
        // to refuse than to post a journal the trial balance will argue with.
        if (!isBalanced(glLines)) {
            return NextResponse.json(
                { error: "The payroll journal does not balance — please report this run id" },
                { status: 500 },
            );
        }

        const headcount = run.lines.filter((l) => l.included).length;

        const result = await prisma.$transaction(async (tx) => {
            // Re-read the status inside the transaction: two people clicking
            // Post at the same moment must not produce two journals.
            const fresh = await tx.payrollRun.findUnique({ where: { id }, select: { status: true } });
            if (fresh?.status !== "DRAFT") throw new Error("ALREADY_POSTED");

            const voucher = await engineCreateVoucher(tx, {
                type:            "JOURNAL",
                date:            run.postingDate,
                userId:          caller!.id,
                lines:           glLines,
                narration:       `Salary payable ${period} — ${headcount} staff`,
                referenceSeries: "JOURNAL",
                post:            true,
                branchId,
            });

            await tx.payrollRun.update({
                where: { id },
                data: {
                    status:     "POSTED",
                    voucherId:  voucher.id,
                    voucherRef: voucher.reference,
                    postedById: caller!.id,
                    postedAt:   new Date(),
                },
            });

            return { voucherId: voucher.id, voucherRef: voucher.reference };
        });

        return NextResponse.json({ ok: true, headcount, ...result });
    } catch (e) {
        if (e instanceof Error && e.message === "ALREADY_POSTED") {
            return NextResponse.json({ error: "This run was posted a moment ago by someone else" }, { status: 409 });
        }
        return handleApiError(e, "Failed to post the payroll run");
    }
}
