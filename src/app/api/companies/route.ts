import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { phoneEmailSchema, gstSchema } from "@/shared/lib/schemas/commonSchemas";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";

const createSchema = phoneEmailSchema.merge(gstSchema).extend({
    name: z.string().trim().min(1, "Company name is required"),
    address: z.string().trim().optional().or(z.literal("")),
    companyReg: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
    accountGroup: z.enum(["Sundry Debtors", "Sundry Creditors"]).optional(),
});

// GET /api/companies?q=...
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    // A role without `customers:view:creditors` passes this to hide suppliers
    // (Sundry Creditors) from the browse list — debtors and un-grouped stay in.
    const hideCreditors = searchParams.get("hideCreditors") === "1";

    try {
        const companies = await prisma.company.findMany({
            where: {
                isActive: true,
                ...(hideCreditors
                    ? { NOT: { account: { is: { group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } } } } }
                    : {}),
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
        return handleApiError(error, "Failed to fetch companies");
    }
}

// POST /api/companies — create company + auto-create ledger account + contact rows
//
// Open to any signed-in user, same as POST /api/person: PartySearchAndCreate
// creates a company party mid-billing (POS, vouchers, tickets), so gating on the
// Contacts page's `customers:create` blocked flows the role legitimately owns.
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    // GSTIN ↔ state-code integrity (Company has no separate textual state field).
    const integrity = normaliseGstinState({
        gstin:        body.gstin,
        gstStateCode: body.gstStateCode,
    });
    if (!integrity.ok) {
        return NextResponse.json({ error: integrity.error }, { status: 400 });
    }
    const shippingState = body.shippingStateCode?.trim() || "";
    if (shippingState && !isValidStateCode(shippingState)) {
        return NextResponse.json(
            { error: `Invalid shippingStateCode "${shippingState}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }

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
                    gstin:             integrity.value.gstin || null,
                    gstStateCode:      integrity.value.gstStateCode || null,
                    gstRegType:        body.gstRegType ?? (integrity.value.gstin ? "REGULAR" : null),
                    shippingStateCode: shippingState || null,
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

            const targetGroupName = body.accountGroup ?? ACCOUNT_GROUPS.SUNDRY_DEBTORS;
            const accountGroup = await tx.accountGroup.findFirst({
                where: { name: targetGroupName },
                select: { id: true },
            });
            await tx.account.create({
                // creditLimit 0 = cash-only by default; credit is granted later
                // by setting an explicit positive limit on the account.
                data: { companyId: c.id, name: c.name, groupId: accountGroup?.id ?? null, creditLimit: 0 },
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
        return handleApiError(error, "Failed to create company");
    }
}
