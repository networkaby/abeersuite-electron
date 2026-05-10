import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { ContactConflictError } from "@/shared/lib/format/contactWrite";
import { parsePagination } from "@/shared/lib/api";

const createPersonSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    // Multi-value contacts. The first entry is treated as primary unless an
    // entry explicitly carries `isPrimary: true`.
    phones: z.array(z.string().trim().min(1)).optional().default([]),
    emails: z.array(z.string().email()).optional().default([]),
    address: z.string().trim().optional().or(z.literal("")),
    agreedToTerms: z.boolean().optional(),
    accountGroup: z.enum(["Sundry Debtors", "Sundry Creditors"]).optional(),
    gstin:        z.string().trim().optional().or(z.literal("")),
    gstStateCode: z.string().trim().optional().or(z.literal("")),
    gstRegType:   z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional(),
});

type LookupResult = {
    id: number;
    name: string;
    phone: string | null;
    // Discriminator kept as "customer"/"company" for back-compat with existing
    // consumers (POS, QuickTicket, party pickers).
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies: { id: number; name: string; accountId: number | null }[];
};

async function lookupAccounts(term: string): Promise<LookupResult[]> {
    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where: {
                isActive: true,
                OR: [
                    { name: { contains: term, mode: "insensitive" } },
                    { phones: { some: { phone: { contains: term } } } },
                ],
            },
            include: {
                account: { select: { id: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                companies: {
                    where: { unlinkedAt: null },
                    include: {
                        company: {
                            select: { id: true, name: true, account: { select: { id: true } } },
                        },
                    },
                },
            },
            take: 8,
            orderBy: { createdAt: "desc" },
        }),
        prisma.company.findMany({
            where: {
                isActive: true,
                OR: [
                    { name: { contains: term, mode: "insensitive" } },
                    { phones: { some: { phone: { contains: term } } } },
                ],
            },
            include: {
                account: { select: { id: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
            },
            take: 8,
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return [
        ...persons.map(p => ({
            id: p.id,
            name: p.name,
            phone: p.phones[0]?.phone ?? null,
            type: "customer" as const,
            accountId: p.account?.id ?? null,
            linkedCompanies: p.companies.map(lc => ({
                id: lc.company.id,
                name: lc.company.name,
                accountId: lc.company.account?.id ?? null,
            })),
        })),
        ...companies.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phones[0]?.phone ?? null,
            type: "company" as const,
            accountId: c.account?.id ?? null,
            linkedCompanies: [] as { id: number; name: string; accountId: number | null }[],
        })),
    ].slice(0, 8);
}

// GET /api/people?phone=...&q=...&lookup=...
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone")?.trim();
    const q = searchParams.get("q")?.trim();
    const lookup = searchParams.get("lookup")?.trim();
    const { take, page } = parsePagination(searchParams);

    try {
        if (phone) return NextResponse.json(await lookupAccounts(phone));
        if (lookup) return NextResponse.json(await lookupAccounts(lookup));

        const persons = await prisma.person.findMany({
            where: {
                isActive: true,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { phones: { some: { phone: { contains: q } } } },
                        { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            take,
            skip: (page - 1) * take,
            include: {
                _count: { select: { companies: true } },
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                account: {
                    select: { id: true, _count: { select: { devices: true } } },
                },
            },
        });

        const normalised = persons.map(p => ({
            ...p,
            phone: p.phones[0]?.phone ?? null,
            email: p.emails[0]?.email ?? null,
            _count: {
                companies: p._count.companies,
                devices: p.account?._count?.devices ?? 0,
            },
        }));
        return NextResponse.json(normalised);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch people" }, { status: 500 });
    }
}

// POST /api/people — create person + auto-create ledger account + contact rows
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const parsed = createPersonSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;
    const phones = body.phones.filter(p => p.trim().length > 0);
    const emails = body.emails.filter(e => e.trim().length > 0);

    try {
        const person = await prisma.$transaction(async (tx) => {
            const p = await tx.person.create({
                data: {
                    name: body.name,
                    address: body.address || null,
                    agreedToTerms: body.agreedToTerms ?? false,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                    gstin:        body.gstin?.trim() || null,
                    gstStateCode: body.gstStateCode?.trim()
                                  || (body.gstin?.trim()?.slice(0, 2) || null),
                    gstRegType:   body.gstRegType ?? (body.gstin ? "REGULAR" : null),
                },
            });

            for (let i = 0; i < phones.length; i++) {
                await tx.phone.create({
                    data: { phone: phones[i], personId: p.id, isPrimary: i === 0 },
                });
            }
            for (let i = 0; i < emails.length; i++) {
                await tx.email.create({
                    data: { email: emails[i], personId: p.id, isPrimary: i === 0 },
                });
            }

            const groupName = body.accountGroup ?? "Sundry Debtors";
            const group = await tx.accountGroup.findFirst({
                where: { name: groupName },
                select: { id: true },
            });
            await tx.account.create({
                data: { personId: p.id, name: p.name, groupId: group?.id ?? null },
            });
            return p;
        });

        const full = await prisma.person.findUnique({
            where: { id: person.id },
            include: {
                account: { select: { id: true } },
                phones: true,
                emails: true,
            },
        });

        return NextResponse.json(full, { status: 201 });
    } catch (error) {
        if (error instanceof ContactConflictError) {
            return NextResponse.json({ error: error.message, field: error.field }, { status: 409 });
        }
        // Duck-type instead of instanceof — across the rsc bundling boundary the
        // Prisma error class identity isn't guaranteed to match.
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
        return NextResponse.json({ error: "Failed to create person" }, { status: 500 });
    }
}
