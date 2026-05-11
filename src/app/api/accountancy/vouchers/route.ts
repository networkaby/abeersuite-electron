import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
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
                partyAccount: { select: { id: true, code: true, name: true } },
                _count:       { select: { lines: true } },
            },
        });
        return NextResponse.json(vouchers);
    } catch (e) {
        return handleApiError(e, "Failed to fetch vouchers");
    }
}

// POST /api/accountancy/vouchers
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_CREATE);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    const totalAmount = body.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    try {
        const voucher = await prisma.$transaction(async (tx) => {
            const reference = await nextRefFromSeries(tx, body.type, user!.id);

            return tx.voucher.create({
                data: {
                    type:           body.type,
                    reference,
                    date:           new Date(body.date),
                    narration:      body.narration ?? null,
                    partyAccountId: body.partyAccountId ?? null,
                    totalAmount,
                    createdById:    user!.id,
                    lines: {
                        create: body.lines.map((l) => ({
                            accountId:   l.accountId,
                            type:        l.type,
                            amount:      l.amount,
                            description: l.description ?? null,
                        })),
                    },
                },
                include: { lines: true },
            });
        });
        return NextResponse.json(voucher, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create voucher");
    }
}
