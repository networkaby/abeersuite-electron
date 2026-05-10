import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { getCompanyContacts } from "@/shared/lib/format/companyContacts";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().optional().nullable(),
    companyReg: z.string().trim().optional().nullable(),
    taxId: z.string().trim().optional().nullable(),
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
            persons: {
                where: { unlinkedAt: null },
                include: {
                    person: {
                        select: {
                            id: true,
                            name: true,
                            phones: selectPrimaryPhone,
                        },
                    },
                },
            },
        },
    });

    if (!company || !company.isActive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const contacts = await getCompanyContacts(companyId);
    // Backward-compat shape: expose `customers` (linked persons) and primary phone/email scalars.
    const linkedCustomers = company.persons.map(link => ({
        id: link.id,
        customer: {
            id: link.person.id,
            name: link.person.name,
            phone: link.person.phones[0]?.phone ?? null,
        },
    }));

    return NextResponse.json({
        ...company,
        devices: company.account?.devices ?? [],
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

    try {
        const company = await prisma.company.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.companyReg !== undefined && { companyReg: body.companyReg }),
                ...(body.taxId !== undefined && { taxId: body.taxId }),
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
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const hasDevices = await prisma.device.count({ where: { account: { companyId: Number(id) } } });
    if (hasDevices > 0) {
        return NextResponse.json({ error: "Cannot deactivate a company with devices" }, { status: 409 });
    }

    const company = await prisma.company.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(company);
}
