import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const createCustomerSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().optional().or(z.literal("")),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
    agreedToTerms: z.boolean().optional(),
});

// GET /api/customers?phone=...&q=...
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone")?.trim();
    const q = searchParams.get("q")?.trim();

    try {
        if (phone) {
            // Unified phone search across customers AND companies
            const [customers, companies] = await Promise.all([
                prisma.customer.findMany({
                    where: { phone: { contains: phone }, isActive: true },
                    include: {
                        account: { select: { id: true } },
                        companies: {
                            where: { unlinkedAt: null },
                            include: {
                                company: {
                                    select: { id: true, name: true, account: { select: { id: true } } },
                                },
                            },
                        },
                    },
                }),
                prisma.company.findMany({
                    where: { phone: { contains: phone }, isActive: true },
                    include: { account: { select: { id: true } } },
                }),
            ]);

            const results = [
                ...customers.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    type: "customer" as const,
                    accountId: c.account?.id ?? null,
                    linkedCompanies: c.companies.map(lc => ({
                        id: lc.company.id,
                        name: lc.company.name,
                        accountId: lc.company.account?.id ?? null,
                    })),
                })),
                ...companies.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    type: "company" as const,
                    accountId: c.account?.id ?? null,
                    linkedCompanies: [] as { id: number; name: string; accountId: number | null }[],
                })),
            ];

            return NextResponse.json(results);
        }

        // General list / search
        const customers = await prisma.customer.findMany({
            where: {
                isActive: true,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { phone: { contains: q } },
                        { email: { contains: q, mode: "insensitive" } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: {
                account: { select: { id: true } },
                _count: { select: { companies: true, devices: true } },
            },
        });

        return NextResponse.json(customers);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
    }
}

// POST /api/customers — create customer + auto-create ledger account
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const parsed = createCustomerSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    try {
        const customer = await prisma.$transaction(async (tx) => {
            const c = await tx.customer.create({
                data: {
                    name: body.name,
                    phone: body.phone || null,
                    email: body.email || null,
                    address: body.address || null,
                    agreedToTerms: body.agreedToTerms ?? false,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                },
            });
            // Auto-create ledger account (name mirrors customer name)
            await tx.account.create({ data: { customerId: c.id, name: c.name } });
            return c;
        });

        const full = await prisma.customer.findUnique({
            where: { id: customer.id },
            include: { account: { select: { id: true } } },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
    }
}
