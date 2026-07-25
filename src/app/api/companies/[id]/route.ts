import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { getCompanyContacts } from "@/modules/customer/lib/companyContacts";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { deleteOrDeactivateCompany } from "@/modules/customer/lib/deleteParty";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().optional().nullable(),
    companyReg: z.string().trim().optional().nullable(),
    taxId: z.string().trim().optional().nullable(),
    gstin:             z.string().trim().optional().nullable(),
    gstStateCode:      z.string().trim().optional().nullable(),
    gstRegType:        z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional().nullable(),
    shippingStateCode: z.string().trim().max(2).optional().nullable(),
    // Customer Quality (internal-only) — see PUT /api/person/[id].
    noDiscount:        z.boolean().optional(),
    customerGroupId:   z.number().int().positive().optional().nullable(),
    // Reactivate (or re-deactivate) — gated separately below on customers:delete,
    // the same tier that owns DELETE.
    isActive:          z.boolean().optional(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const companyId = Number(id);
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        include: {
            account: {
                include: {
                    group: { select: { id: true, name: true } },
                    devices: {
                        include: {
                            repairs: {
                                include: {
                                    ticket: {
                                        include: { ticketStatus: { select: { label: true, color: true } } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            persons: {
                where: { unlinkedAt: null },
                include: {
                    person: {
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

    if (!company) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const contacts = await getCompanyContacts(companyId);
    // Backward-compat shape: expose `customers` (linked persons) and primary phone/email scalars.
    const linkedCustomers = company.persons.map(link => ({
        id: link.id,
        customer: {
            id: link.person.id,
            accountId: link.person.account!.id,
            name: link.person.name,
            phone: link.person.phones[0]?.phone ?? null,
        },
    }));

    return NextResponse.json({
        ...company,
        accountId: company.account!.id,
        creditLimit: company.account!.creditLimit,
        accountGroupId: company.account!.group?.id ?? null,
        accountGroupName: company.account!.group?.name ?? null,
        openingBalance: company.account!.openingBalance,
        openingBalanceType: company.account!.openingBalanceType,
        openingBalanceDate: company.account!.openingBalanceDate,
        devices: company.account!.devices.map((d) => ({
            ...d,
            tickets: d.repairs
                .map((r) => ({ ...r.ticket, ...r }))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        })),
        customers: linkedCustomers,
        phone: contacts.phones[0]?.value ?? contacts.derivedPhones[0]?.value ?? null,
        email: contacts.emails[0]?.value ?? contacts.derivedEmails[0]?.value ?? null,
        contactRows: {
            phones: contacts.phones,
            emails: contacts.emails,
            derivedPhones: contacts.derivedPhones,
            derivedEmails: contacts.derivedEmails,
        },
    });
}

// Open to any signed-in user, same as PUT /api/person/[id]: whoever can create
// a company party mid-billing must be able to fix its typos too. DELETE below
// keeps its customers:delete gate.
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

    if (body.isActive !== undefined) {
        const { response: permResponse } = await requireAnyPermission(PERMISSIONS.CUSTOMERS_DELETE);
        if (permResponse) return permResponse;

        if (body.isActive) {
            // A merge/convert tombstone recovers only via Customer Tools Trash
            // (hard-delete-permitted), never a plain reactivate — its data already
            // moved to the winning row.
            const existing = await prisma.company.findUnique({
                where: { id: Number(id) },
                select: { mergedIntoCompanyId: true, convertedToPersonId: true },
            });
            if (existing?.mergedIntoCompanyId || existing?.convertedToPersonId) {
                return NextResponse.json(
                    { error: "This company was merged or converted — recover it from Customer Tools Trash instead" },
                    { status: 409 },
                );
            }
        }
    }

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
    if (body.shippingStateCode && !isValidStateCode(body.shippingStateCode)) {
        return NextResponse.json(
            { error: `Invalid shippingStateCode "${body.shippingStateCode}". Expected a 2-digit GSTIN state code.` },
            { status: 400 },
        );
    }

    try {
        const company = await prisma.company.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.companyReg !== undefined && { companyReg: body.companyReg }),
                ...(body.taxId !== undefined && { taxId: body.taxId }),
                ...(gstinPatch ?? {}),
                ...(body.shippingStateCode !== undefined && {
                    shippingStateCode: body.shippingStateCode || null,
                }),
                ...(body.noDiscount !== undefined && { noDiscount: body.noDiscount }),
                ...(body.customerGroupId !== undefined && { customerGroupId: body.customerGroupId }),
                ...(body.isActive !== undefined && { isActive: body.isActive }),
            },
        });
        return NextResponse.json(company);
    } catch (e) {
        return handleApiError(e, "Failed to update company");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.CUSTOMERS_DELETE);
    if (response) return response;

    const { id } = await params;
    const result = await deleteOrDeactivateCompany(Number(id));
    if (result.outcome === "blocked") {
        return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
}
