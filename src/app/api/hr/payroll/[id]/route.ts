import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { payrollRunPatchSchema } from "@/shared/lib/schemas/hrSchema";
import {
    PAYROLL_RUN_INCLUDE,
    candidateTotals,
    dateOnly,
    toRunDetail,
} from "@/modules/hr/lib/payrollServer";
import { formatPeriod } from "@/modules/hr/lib/payrollTypes";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";

// GET    /api/hr/payroll/[id] — the run and every line on it.
// PATCH  /api/hr/payroll/[id] — edit a DRAFT: hold people back, change the date.
// DELETE /api/hr/payroll/[id] — throw a DRAFT away. A posted run is never deleted.

function parseId(v: string): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** The run, plus the names the DTO needs — one extra query each, never per row. */
async function loadDetail(id: number) {
    const run = await prisma.payrollRun.findUnique({ where: { id }, include: PAYROLL_RUN_INCLUDE });
    if (!run) return null;

    const userIds = [...new Set([
        ...run.lines.map((l) => l.userId),
        run.createdById,
        ...(run.postedById ? [run.postedById] : []),
    ])];
    const accountIds = [...new Set(run.lines
        .map((l) => l.ledgerAccountId)
        .filter((v): v is number => v != null))];

    const [users, accounts, profiles] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
        prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
        prisma.staffProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, staffCode: true } }),
    ]);

    return toRunDetail(
        run,
        new Map(users.map((u) => [u.id, u.name])),
        new Map(accounts.map((a) => [a.id, a.name])),
        new Map(profiles.map((p) => [p.userId, p.staffCode])),
    );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    try {
        const detail = await loadDetail(id);
        if (!detail) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        return NextResponse.json(detail);
    } catch (e) {
        return handleApiError(e, "Failed to fetch the payroll run");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_PAYROLL_RUN);
    if (response) return response;

    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    const { data: body, error } = await validateRequest(req, payrollRunPatchSchema);
    if (error) return error;

    try {
        const run = await prisma.payrollRun.findUnique({
            where: { id },
            select: { id: true, status: true, periodFrom: true, periodTo: true },
        });
        if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        if (run.status !== "DRAFT") {
            return NextResponse.json({ error: "Only a draft run can be changed" }, { status: 422 });
        }

        if (body.postingDate) {
            const fromIso = toDateOnlyUtc(run.periodFrom);
            const toIso = toDateOnlyUtc(run.periodTo);
            if (body.postingDate < fromIso || body.postingDate > toIso) {
                return NextResponse.json(
                    { error: `The posting date must fall inside ${formatPeriod(fromIso, toIso)}` },
                    { status: 422 },
                );
            }
        }

        await prisma.$transaction(async (tx) => {
            // Excluding is always allowed. Including is not: a line the
            // generator could not pay (no ledger, no structure) carries a
            // skipReason, and ticking it would post a broken journal.
            if (body.exclude?.length) {
                await tx.payrollRunLine.updateMany({
                    where: { runId: id, id: { in: body.exclude } },
                    data:  { included: false },
                });
            }
            if (body.include?.length) {
                await tx.payrollRunLine.updateMany({
                    where: { runId: id, id: { in: body.include }, skipReason: null },
                    data:  { included: true },
                });
            }

            const lines = await tx.payrollRunLine.findMany({
                where:  { runId: id },
                select: { included: true, grossPaise: true, deductionsPaise: true, netPaise: true },
            });

            await tx.payrollRun.update({
                where: { id },
                data: {
                    ...(body.postingDate ? { postingDate: dateOnly(body.postingDate) } : {}),
                    ...(body.note !== undefined ? { note: body.note } : {}),
                    ...candidateTotals(lines),
                },
            });
        });

        const detail = await loadDetail(id);
        return NextResponse.json(detail);
    } catch (e) {
        return handleApiError(e, "Failed to update the payroll run");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_PAYROLL_RUN);
    if (response) return response;

    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    try {
        const run = await prisma.payrollRun.findUnique({ where: { id }, select: { status: true, voucherRef: true } });
        if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        if (run.status !== "DRAFT") {
            return NextResponse.json(
                { error: `This run is ${run.status.toLowerCase()}${run.voucherRef ? ` as ${run.voucherRef}` : ""}. Cancel the journal voucher in Accountancy instead.` },
                { status: 422 },
            );
        }
        // The lines go with it — PayrollRunLine.run is onDelete: Cascade.
        await prisma.payrollRun.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the payroll run");
    }
}
