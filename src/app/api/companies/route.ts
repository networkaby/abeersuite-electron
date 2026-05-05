import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const createSchema = z.object({
    name: z.string().trim().min(1, "Company name is required"),
    phone: z.string().trim().optional().or(z.literal("")),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
    companyReg: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
});

// GET /api/companies?q=...
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();

    try {
        const companies = await prisma.company.findMany({
            where: {
                isActive: true,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { phone: { contains: q } },
                        { companyReg: { contains: q, mode: "insensitive" } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: {
                _count: { select: { customers: true } },
                account: {
                    select: { id: true, _count: { select: { devices: true } } },
                },
            },
        });

        const normalised = companies.map(c => ({
            ...c,
            _count: {
                customers: c._count.customers,
                devices: c.account?._count?.devices ?? 0,
            },
        }));
        return NextResponse.json(normalised);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
    }
}

// POST /api/companies — create company + auto-create ledger account
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    try {
        const company = await prisma.$transaction(async (tx) => {
            const c = await tx.company.create({
                data: {
                    name: body.name,
                    phone: body.phone || null,
                    email: body.email || null,
                    address: body.address || null,
                    companyReg: body.companyReg || null,
                    taxId: body.taxId || null,
                },
            });
            const sundryDebtors = await tx.accountGroup.findFirst({
                where: { name: "Sundry Debtors" },
                select: { id: true },
            });
            await tx.account.create({
                data: { companyId: c.id, name: c.name, groupId: sundryDebtors?.id ?? null },
            });
            return c;
        });

        const full = await prisma.company.findUnique({
            where: { id: company.id },
            include: { account: { select: { id: true } } },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
    }
}
