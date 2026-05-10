import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const createSchema = z.object({
    name: z.string().trim().min(1, "Company name is required"),
    phones: z.array(z.string().trim().min(1)).optional().default([]),
    emails: z.array(z.string().email()).optional().default([]),
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
                        { phones: { some: { phone: { contains: q } } } },
                        { companyReg: { contains: q, mode: "insensitive" } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: {
                _count: { select: { persons: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: { id: true, _count: { select: { devices: true } } },
                },
            },
        });

        const normalised = companies.map(c => ({
            ...c,
            phone: c.phones[0]?.phone ?? null,
            email: c.emails[0]?.email ?? null,
            _count: {
                customers: c._count.persons,
                devices: c.account?._count?.devices ?? 0,
            },
        }));
        return NextResponse.json(normalised);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
    }
}

// POST /api/companies — create company + auto-create ledger account + contact rows
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;
    const phones = body.phones.filter(p => p.trim().length > 0);
    const emails = body.emails.filter(e => e.trim().length > 0);

    try {
        const company = await prisma.$transaction(async (tx) => {
            const c = await tx.company.create({
                data: {
                    name: body.name,
                    address: body.address || null,
                    companyReg: body.companyReg || null,
                    taxId: body.taxId || null,
                },
            });

            for (let i = 0; i < phones.length; i++) {
                await tx.phone.create({
                    data: { phone: phones[i], companyId: c.id, isPrimary: i === 0 },
                });
            }
            for (let i = 0; i < emails.length; i++) {
                await tx.email.create({
                    data: { email: emails[i], companyId: c.id, isPrimary: i === 0 },
                });
            }

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
            include: {
                account: { select: { id: true } },
                phones: true,
                emails: true,
            },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        const e = error as { code?: string; meta?: { modelName?: string; target?: string[] | string } } | null;
        if (e?.code === "P2002") {
            const model = e.meta?.modelName?.toLowerCase();
            const tgt = Array.isArray(e.meta?.target) ? e.meta.target.join(",") : e.meta?.target;
            const isPhone = model === "phone" || (typeof tgt === "string" && tgt.includes("phone"));
            const isEmail = model === "email" || (typeof tgt === "string" && tgt.includes("email"));
            if (isPhone || isEmail) {
                const field = isPhone ? "phone" : "email";
                return NextResponse.json(
                    { error: `This ${field} is already used by another contact`, field },
                    { status: 409 },
                );
            }
        }
        console.error(error);
        return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
    }
}
