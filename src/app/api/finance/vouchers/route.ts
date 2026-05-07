import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";

// Reference number prefixes per voucher type. Tally uses similar conventions:
// CV-2026-0001, PV-2026-0001, RV-2026-0001, CRN-2026-0001, DRN-2026-0001.
const PREFIX: Record<string, string> = {
    CONTRA:      "CV",
    PAYMENT:     "PV",
    RECEIPT:     "RV",
    CREDIT_NOTE: "CRN",
    DEBIT_NOTE:  "DRN",
};

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

// GET /api/finance/vouchers?type=CONTRA&status=DRAFT&includeDeleted=1
export async function GET(req: Request) {
    const { user, response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as "CONTRA" | "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE" | null;
    const status = searchParams.get("status") as "DRAFT" | "POSTED" | "CANCELLED" | null;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeDeleted =
        searchParams.get("includeDeleted") === "1" &&
        (user!.permissions.includes("admin:bypass") || user!.permissions.includes("finance:voucher:delete"));

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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch vouchers" }, { status: 500 });
    }
}

// POST /api/finance/vouchers
export async function POST(req: Request) {
    const { user, response } = await requirePermission("finance:voucher:create");
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    const totalAmount = body.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    try {
        const voucher = await prisma.$transaction(async (tx) => {
            // Generate reference number
            const year = new Date().getFullYear();
            const prefix = PREFIX[body.type];
            const startsWith = `${prefix}-${year}-`;
            const cnt = await tx.voucher.count({ where: { reference: { startsWith } } });
            const reference = `${startsWith}${String(cnt + 1).padStart(4, "0")}`;

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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to create voucher" }, { status: 500 });
    }
}
