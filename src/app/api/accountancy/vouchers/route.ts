import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const lineSchema = z.object({
    accountId:   z.number().int().positive(),
    type:        z.enum(["DEBIT", "CREDIT"]),
    amount:      z.number().positive(),
    description: z.string().trim().optional(),
});

const createSchema = z.object({
    type:           z.enum(["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE"]),
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    narration:      z.string().trim().optional(),
    partyAccountId: z.number().int().positive().optional(),
    lines:          z.array(lineSchema).min(2, "At least 2 lines required"),
});

// GET /api/accountancy/vouchers?type=CONTRA&status=DRAFT&includeDeleted=1
export async function GET(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE" | null;
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeDeleted =
        searchParams.get("includeDeleted") === "1" &&
        (user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS) || user!.permissions.includes(PERMISSIONS.FINANCE_VOUCHER_DELETE));

    try {
        const vouchers = await prisma.voucher.findMany({
            where: {
                ...(type ? { type } : {}),
                ...(status ? { status } : {}),
                ...(includeDeleted ? {} : { deletedAt: null }),
                ...(from || to ? {
                    date: {
                        ...(from ? { gte: new Date(from) } : {}),
                        ...(to ? { lte: new Date(to) } : {}),
                    },
                } : {}),
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            include: {
                createdBy:    { select: { id: true, name: true } },
                partyAccount: { select: { id: true, code: true, name: true, personId: true, companyId: true } },
                _count:       { select: { lines: true } },
            },
        });

        // Voucher has no branch column — branch lives on the JE lines
        // (JournalLine.branchId, stamped on POST). Surface a single branch per
        // voucher (the first line carrying one) so branch-aware views like the
        // Day Book can show it. Most office/legacy GL vouchers have none → null.
        const jeIds = vouchers.map((v) => v.journalEntryId).filter((x): x is number => x != null);
        const branchLines = jeIds.length
            ? await prisma.journalLine.findMany({
                where:    { journalEntryId: { in: jeIds }, branchId: { not: null } },
                distinct: ["journalEntryId"],
                select:   { journalEntryId: true, branch: { select: { id: true, name: true } } },
            })
            : [];
        const branchByJe = new Map(branchLines.map((l) => [l.journalEntryId, l.branch]));

        return NextResponse.json(
            vouchers.map((v) => ({
                ...v,
                branch: v.journalEntryId != null ? (branchByJe.get(v.journalEntryId) ?? null) : null,
            })),
        );
    } catch (e) {
        return handleApiError(e, "Failed to fetch vouchers");
    }
}

// POST /api/accountancy/vouchers
export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;

    // Per-kind create gate (falls back to the generic finance:voucher:create).
    const { user, response } = await requireVoucherPermission(body.type, "create");
    if (response) return response;

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        // Create a DRAFT financial transaction via the Transaction Engine
        // (engine computes totalAmount + reference; posting is a separate step).
        const voucher = await prisma.$transaction((tx) =>
            engineCreateVoucher(tx, {
                type:           body.type,
                date:           new Date(body.date),
                userId:         user!.id,
                lines:          body.lines,
                narration:      body.narration ?? null,
                partyAccountId: body.partyAccountId ?? null,
                post:           false,
            }),
        );
        return NextResponse.json(voucher, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create voucher");
    }
}
