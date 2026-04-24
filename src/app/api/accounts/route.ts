import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const accountSchema = z.object({
    type: z.enum(["individual", "company"]).default("individual"),
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().optional().or(z.literal("")),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
    companyReg: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
});

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const phone = searchParams.get("phone");
        const search = searchParams.get("search");
        const type = searchParams.get("type"); // "individual" | "company"

        const accounts = await prisma.account.findMany({
            where: {
                isActive: true,
                ...(type ? { type } : {}),
                ...(phone ? { phone: { contains: phone } } : {}),
                ...(search ? {
                    OR: [
                        { name: { contains: search, mode: "insensitive" } },
                        { phone: { contains: search } },
                        { email: { contains: search, mode: "insensitive" } },
                        { companyReg: { contains: search, mode: "insensitive" } },
                    ],
                } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: {
                devices: { select: { id: true } },
                _count: { select: { asIndividual: { where: { unlinkedAt: null } }, asCompany: { where: { unlinkedAt: null } } } },
            },
        });
        return NextResponse.json(accounts);
    } catch {
        return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const parsed = accountSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account payload" }, { status: 400 });
        }
        const body = parsed.data;
        const account = await prisma.account.create({
            data: {
                type: body.type,
                name: body.name,
                phone: body.phone || null,
                email: body.email || null,
                address: body.address || null,
                companyReg: body.companyReg || null,
                taxId: body.taxId || null,
            },
        });
        return NextResponse.json(account);
    } catch {
        return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
    }
}
