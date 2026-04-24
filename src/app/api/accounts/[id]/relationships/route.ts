import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const linkSchema = z.object({
    targetId: z.coerce.number().int().positive(),
    role: z.string().trim().optional().or(z.literal("")),
});

// GET /api/accounts/[id]/relationships
// Returns active links for an individual (their companies) or company (their individuals)
export async function GET(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const account = await prisma.account.findUnique({
            where: { id: Number(id) },
            select: { type: true },
        });
        if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (account.type === "individual") {
            const links = await prisma.accountRelationship.findMany({
                where: { individualId: Number(id), unlinkedAt: null },
                include: { company: { select: { id: true, name: true, type: true, phone: true, companyReg: true } } },
                orderBy: { linkedAt: "desc" },
            });
            return NextResponse.json(links);
        } else {
            const links = await prisma.accountRelationship.findMany({
                where: { companyId: Number(id), unlinkedAt: null },
                include: { individual: { select: { id: true, name: true, type: true, phone: true } } },
                orderBy: { linkedAt: "desc" },
            });
            return NextResponse.json(links);
        }
    } catch {
        return NextResponse.json({ error: "Failed to fetch relationships" }, { status: 500 });
    }
}

// POST /api/accounts/[id]/relationships
// Link this account to another. Body: { targetId, role? }
// If this account is individual → targetId must be company (and vice versa)
export async function POST(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = linkSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const { targetId, role } = parsed.data;

        const [self, target] = await Promise.all([
            prisma.account.findUnique({ where: { id: Number(id) }, select: { type: true } }),
            prisma.account.findUnique({ where: { id: targetId }, select: { type: true } }),
        ]);
        if (!self || !target) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        if (self.type === target.type) {
            return NextResponse.json({ error: "Can only link an individual to a company" }, { status: 400 });
        }

        const individualId = self.type === "individual" ? Number(id) : targetId;
        const companyId = self.type === "company" ? Number(id) : targetId;

        // Reactivate if previously unlinked
        const existing = await prisma.accountRelationship.findFirst({
            where: { individualId, companyId },
            orderBy: { linkedAt: "desc" },
        });
        if (existing && existing.unlinkedAt === null) {
            return NextResponse.json({ error: "Already linked" }, { status: 409 });
        }
        if (existing) {
            const reactivated = await prisma.accountRelationship.update({
                where: { id: existing.id },
                data: { unlinkedAt: null, linkedAt: new Date(), role: role || existing.role },
            });
            return NextResponse.json(reactivated);
        }

        const rel = await prisma.accountRelationship.create({
            data: { individualId, companyId, role: role || null },
        });
        return NextResponse.json(rel);
    } catch {
        return NextResponse.json({ error: "Failed to link accounts" }, { status: 500 });
    }
}

// DELETE /api/accounts/[id]/relationships?relationshipId=123
export async function DELETE(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id: _id } = await params;
        const { searchParams } = new URL(req.url);
        const relId = Number(searchParams.get("relationshipId"));
        if (!relId) return NextResponse.json({ error: "relationshipId required" }, { status: 400 });

        await prisma.accountRelationship.update({
            where: { id: relId },
            data: { unlinkedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to unlink accounts" }, { status: 500 });
    }
}
