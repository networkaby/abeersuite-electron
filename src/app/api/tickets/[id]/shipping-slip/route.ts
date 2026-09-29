import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot, type ActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { statusHasWorkflowRole } from "@/shared/lib/constants/workflow";

// Simplified "send device to a service centre" slip. Rather than a new table,
// the slip is stored as a snapshot on the existing Ticket.context JSON bag under
// `shippingSlip`, and the service centre is a Sundry-Creditor party (Account) —
// NOT the legacy ServiceCenter list, which stays untouched beside this. The
// print page (/shipping-slip/[ticketId]) reads this snapshot back.
const slipSchema = z.object({
    partyAccountId: z.coerce.number().int().positive(),
    partyName: z.string().trim().min(1, "Service centre is required"),
    ref: z.string().trim().optional().nullable(),
    date: z.string().trim().optional(),
    device: z.object({
        type: z.string().trim().optional().default(""),
        brand: z.string().trim().optional().default(""),
        model: z.string().trim().optional().default(""),
        problem: z.string().trim().optional().default(""),
    }),
    accessories: z.string().trim().optional().nullable(),
    condition: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    // Contact box on the printed slip. Default (false) = the SHOP fronts the
    // contact "on behalf of owner" (name/phone below, falling back to the
    // print template's shop identity); true = print the real device owner.
    showOwner: z.boolean().default(false),
    contactName: z.string().trim().optional().nullable(),
    contactPhone: z.string().trim().optional().nullable(),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { user: resolvedUser, response } = await requireAuth();
        if (response) return response;

        const { id } = await params;
        const ticketId = Number(id);
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, status: true, context: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const { data, error } = await validateRequest(req, slipSchema);
        if (error) return error;

        const author = await buildActorSnapshot(resolvedUser.id);
        const createdBy = (author as unknown as ActorSnapshot).userName ?? null;

        const slip = {
            partyAccountId: data.partyAccountId,
            partyName: data.partyName,
            ref: data.ref?.trim() || null,
            date: data.date?.trim() || new Date().toISOString(),
            device: {
                type: data.device.type ?? "",
                brand: data.device.brand ?? "",
                model: data.device.model ?? "",
                problem: data.device.problem ?? "",
            },
            accessories: data.accessories?.trim() || null,
            condition: data.condition?.trim() || null,
            notes: data.notes?.trim() || null,
            showOwner: data.showOwner,
            contactName: data.contactName?.trim() || null,
            contactPhone: data.contactPhone?.trim() || null,
            createdAt: new Date().toISOString(),
            createdBy,
        };

        // Merge onto whatever else already lives in the soft context bag.
        const prevContext =
            ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
                ? (ticket.context as Record<string, unknown>)
                : {};

        // A device may loop through SEVERAL service centres until fixed or given
        // up — every save appends a FROZEN copy to `shippingSlips[]` (never
        // edited afterwards); `shippingSlip` stays as the latest for the print
        // default + legacy readers. Legacy single-slip tickets fold into the list.
        const prevList: unknown[] = Array.isArray(prevContext.shippingSlips)
            ? (prevContext.shippingSlips as unknown[])
            : prevContext.shippingSlip
                ? [prevContext.shippingSlip]
                : [];
        const seq = prevList.length + 1;
        const frozen = { ...slip, seq };

        await prisma.ticket.update({
            where: { id: ticketId },
            data: { context: { ...prevContext, shippingSlip: frozen, shippingSlips: [...prevList, frozen] } as Prisma.InputJsonValue },
        });

        // Timeline entry carries its own frozen copy on the dormant `data`
        // column — the log row never changes even as later slips are created.
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: ticket.status,
                note: `Shipping slip #${seq} created → ${data.partyName}${data.ref?.trim() ? ` (Ref: ${data.ref.trim()})` : ""}`,
                visibility: "INTERNAL",
                author,
                data: { shippingSlip: frozen },
            },
        });

        return NextResponse.json({ ok: true, slip: frozen });
    } catch (e) {
        return handleApiError(e, "Failed to save shipping slip");
    }
}

// Edit the LATEST slip in place — allowed only while the device hasn't been sent
// yet: the ticket must still be at the send stage (`shipToService` role, S62) and
// the latest slip must not be locked (locking happens on entry to S65). Keeps the
// slip's identity (seq / createdAt / createdBy) and stamps editedAt / editedBy.
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { user: resolvedUser, response } = await requireAuth();
        if (response) return response;

        const { id } = await params;
        const ticketId = Number(id);
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, status: true, context: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const { data, error } = await validateRequest(req, slipSchema);
        if (error) return error;

        const prevContext =
            ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
                ? (ticket.context as Record<string, unknown>)
                : {};
        const list: Record<string, unknown>[] = Array.isArray(prevContext.shippingSlips)
            ? [...(prevContext.shippingSlips as Record<string, unknown>[])]
            : prevContext.shippingSlip
                ? [prevContext.shippingSlip as Record<string, unknown>]
                : [];
        const last = list[list.length - 1];
        if (!last) return NextResponse.json({ error: "No service slip to edit" }, { status: 404 });
        if (last.locked) {
            return NextResponse.json({ error: "This slip was already sent and can no longer be edited" }, { status: 409 });
        }
        if (!statusHasWorkflowRole("shipToService", ticket.status)) {
            return NextResponse.json({ error: "The slip can only be edited while the ticket is at the send stage" }, { status: 409 });
        }

        const author = await buildActorSnapshot(resolvedUser.id);
        const editedBy = (author as unknown as ActorSnapshot).userName ?? null;

        // Overwrite the editable fields; preserve the slip's identity + creation stamps.
        const updated = {
            ...last,
            partyAccountId: data.partyAccountId,
            partyName: data.partyName,
            ref: data.ref?.trim() || null,
            date: data.date?.trim() || (last.date as string) || new Date().toISOString(),
            device: {
                type: data.device.type ?? "",
                brand: data.device.brand ?? "",
                model: data.device.model ?? "",
                problem: data.device.problem ?? "",
            },
            accessories: data.accessories?.trim() || null,
            condition: data.condition?.trim() || null,
            notes: data.notes?.trim() || null,
            showOwner: data.showOwner,
            contactName: data.contactName?.trim() || null,
            contactPhone: data.contactPhone?.trim() || null,
            editedAt: new Date().toISOString(),
            editedBy,
        };
        list[list.length - 1] = updated;

        await prisma.ticket.update({
            where: { id: ticketId },
            data: { context: { ...prevContext, shippingSlip: updated, shippingSlips: list } as Prisma.InputJsonValue },
        });

        const seq = (last.seq as number | undefined) ?? list.length;
        await prisma.ticketLog.create({
            data: {
                ticketId,
                status: ticket.status,
                note: `Shipping slip #${seq} edited → ${data.partyName}${data.ref?.trim() ? ` (Ref: ${data.ref.trim()})` : ""}`,
                visibility: "INTERNAL",
                author,
                data: { shippingSlip: updated },
            },
        });

        return NextResponse.json({ ok: true, slip: updated });
    } catch (e) {
        return handleApiError(e, "Failed to edit shipping slip");
    }
}
