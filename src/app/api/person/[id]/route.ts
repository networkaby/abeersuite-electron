import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { Prisma } from "@/generated/prisma/client";
import { partyBankSchema, resolvePartyBank } from "@/shared/lib/schemas/partyBankSchema";
import { deleteOrDeactivatePerson } from "@/modules/customer/lib/deleteParty";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().optional().nullable(),
    agreedToTerms: z.boolean().optional(),
    gstin:             z.string().trim().optional().nullable(),
    gstStateCode:      z.string().trim().optional().nullable(),
    gstRegType:        z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional().nullable(),
    shippingStateCode: z.string().trim().max(2).optional().nullable(),
    // Customer Quality (internal-only). noDiscount's toggle is UI-gated by
    // customers:edit (credit-limit style); the API stays requireAuth like the
    // rest of the party writes.
    noDiscount:        z.boolean().optional(),
    customerGroupId:   z.number().int().positive().optional().nullable(),
    // Reactivate (or re-deactivate) — gated separately below on customers:delete,
    // the same tier that owns DELETE.
    isActive:          z.boolean().optional(),
    // The party's OWN bank account (how we pay them) — `null` clears it.
    bankJson:          partyBankSchema.nullable().optional(),
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
                    group: { select: { id: true, name: true } },
                    aliases: { select: { alias: true }, orderBy: { id: "asc" } },
                    devices: {
                        include: {
                            // A device's repair tickets hang off TicketRepair now.
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

    if (!person) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
        ...person,
        // Backward-compat scalar accessors from the primary contact rows.
        phone: person.phones[0]?.phone ?? null,
        email: person.emails[0]?.email ?? null,
        accountId: person.account!.id,
        creditLimit: person.account!.creditLimit,
        aliases: person.account!.aliases.map((a) => a.alias),
        accountGroupId: person.account!.group?.id ?? null,
        accountGroupName: person.account!.group?.name ?? null,
        openingBalance: person.account!.openingBalance,
        openingBalanceType: person.account!.openingBalanceType,
        openingBalanceDate: person.account!.openingBalanceDate,
        // Flatten each device's repair tickets back to the old device.tickets shape
        // (core ticket + status + repair fields), newest first.
        devices: person.account!.devices.map((d) => ({
            ...d,
            tickets: d.repairs
                .map((r) => ({ ...r.ticket, ...r }))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        })),
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

// Open to any signed-in user, same as POST /api/person: whoever can create a
// party mid-billing must be able to fix its typos too (CreatePersonDialog defers
// GST/shipping details to "edit later" — this route IS that later edit).
// DELETE below keeps its customers:delete gate.
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
    }

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

    // Bank particulars: validate IFSC / UPI before touching the row, so a typo
    // comes back as a sentence instead of a silently-stored bad account.
    let bankPatch: { bankJson: Prisma.InputJsonValue | typeof Prisma.DbNull } | null = null;
    if (body.bankJson !== undefined) {
        const bank = resolvePartyBank(body.bankJson);
        if ("error" in bank) return NextResponse.json({ error: bank.error }, { status: 400 });
        bankPatch = { bankJson: bank.value ?? Prisma.DbNull };
    }

    try {
        // A rename carries to the ledger in the same write — the Day Book and GL
        // reports read Account.name, so the two must never drift apart.
        const [person] = await prisma.$transaction([
            prisma.person.update({
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
                    ...(body.noDiscount !== undefined && { noDiscount: body.noDiscount }),
                    ...(body.customerGroupId !== undefined && { customerGroupId: body.customerGroupId }),
                    ...(body.isActive !== undefined && { isActive: body.isActive }),
                    ...(bankPatch ?? {}),
                },
            }),
            ...(body.name !== undefined
                ? [prisma.account.updateMany({ where: { personId: Number(id) }, data: { name: body.name } })]
                : []),
        ]);
        return NextResponse.json(person);
    } catch (e) {
        return handleApiError(e, "Failed to update person");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAnyPermission(PERMISSIONS.CUSTOMERS_DELETE);
    if (response) return response;

    const { id } = await params;
    const result = await deleteOrDeactivatePerson(Number(id));
    if (result.outcome === "blocked") {
        return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
}
