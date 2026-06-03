import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().optional().nullable(),
    agreedToTerms: z.boolean().optional(),
    gstin:             z.string().trim().optional().nullable(),
    gstStateCode:      z.string().trim().optional().nullable(),
    gstRegType:        z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional().nullable(),
    shippingStateCode: z.string().trim().max(2).optional().nullable(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const person = await prisma.person.findUnique({
        where: { id: Number(id) },
        include: {
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            account: {
                include: {
                    devices: {
                        include: {
                            tickets: {
                                orderBy: { createdAt: "desc" },
                                include: {
                                    ticketStatus: { select: { label: true, color: true } },
                                },
                            },
                        },
                    },
                },
            },
            companies: {
                where: { unlinkedAt: null },
                include: {
                    company: {
                        select: {
                            id: true,
                            name: true,
                            phones: selectPrimaryPhone,
                            account: { select: { id: true } },
                        },
                    },
                },
            },
        },
    });

    if (!person || !person.isActive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
        ...person,
        // Backward-compat scalar accessors from the primary contact rows.
        phone: person.phones[0]?.phone ?? null,
        email: person.emails[0]?.email ?? null,
        accountId: person.account!.id,
        creditLimit: person.account!.creditLimit,
        devices: person.account!.devices,
        companies: person.companies.map(link => ({
            ...link,
            company: {
                ...link.company,
                phone: link.company.phones[0]?.phone ?? null,
                accountId: link.company.account!.id,
            },
        })),
    });
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, updateSchema);
    if (error) return error;
    const body = data;

    // GSTIN ↔ state-code guard runs only when the caller sent a GST field —
    // otherwise the row's stored values stay untouched.
    let gstinPatch: Partial<{ gstin: string | null; gstStateCode: string | null; gstRegType: "REGULAR" | "COMPOSITION" | "SEZ" | "UNREGISTERED" | null }> | null = null;
    if (body.gstin !== undefined || body.gstStateCode !== undefined) {
        const integrity = normaliseGstinState({
            gstin:        body.gstin ?? "",
            gstStateCode: body.gstStateCode ?? "",
        });
        if (!integrity.ok) {
            return NextResponse.json({ error: integrity.error }, { status: 400 });
        }
        gstinPatch = {
            gstin:        integrity.value.gstin        || null,
            gstStateCode: integrity.value.gstStateCode || null,
            ...(body.gstRegType !== undefined && { gstRegType: body.gstRegType }),
        };
    }

    // shippingStateCode: when explicitly set (not null/undefined), must be valid.
    if (body.shippingStateCode && !isValidStateCode(body.shippingStateCode)) {
        return NextResponse.json(
            { error: `Invalid shippingStateCode "${body.shippingStateCode}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }

    try {
        const person = await prisma.person.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.agreedToTerms !== undefined && {
                    agreedToTerms: body.agreedToTerms,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                }),
                ...(gstinPatch ?? {}),
                ...(body.shippingStateCode !== undefined && {
                    shippingStateCode: body.shippingStateCode || null,
                }),
            },
        });
        return NextResponse.json(person);
    } catch (e) {
        return handleApiError(e, "Failed to update person");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const hasDevices = await prisma.device.count({ where: { account: { personId: Number(id) } } });
    if (hasDevices > 0) {
        return NextResponse.json({ error: "Cannot deactivate a person with devices" }, { status: 409 });
    }

    const person = await prisma.person.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(person);
}
