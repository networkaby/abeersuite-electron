import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { convertHelpSchema } from "@/shared/lib/schemas/helpSchema";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { findEntryWorker } from "@/modules/repairing/lib/entryWorker";
import { autoAdvance } from "@/modules/repairing/lib/autoAdvance";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";

// Convert a help ticket into a real downstream ticket — the "Converted" rung of the
// help ladder. `deal` drops it into the CRM pipeline as a lead (nurture / push the
// sale); `service` opens a repair ticket for a broken device. The downstream ticket
// is fully INDEPENDENT (no parent/child link); the help ticket simply closes with a
// CONVERTED_* outcome — the closed enquiry + its outcome is the whole record.

function parseId(raw: string): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** The Help Desk pipeline's terminal (Closed) stage. */
async function helpClosedStatusId(pipelineId: string): Promise<string | null> {
    const closed = await prisma.ticketStatus.findFirst({
        where: { pipelineId, isTerminal: true },
        orderBy: { order: "asc" },
        select: { id: true },
    });
    return closed?.id ?? null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const id = parseId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, convertHelpSchema);
        if (error) return error;

        const help = await prisma.ticket.findUnique({
            where: { id },
            select: {
                id: true, pipelineId: true, priority: true,
                ticketStatus: { select: { isTerminal: true } },
                help: {
                    select: {
                        contactName: true, phone: true, email: true,
                        personId: true, companyId: true, subject: true, outcome: true,
                    },
                },
            },
        });
        if (!help || !help.help) return NextResponse.json({ error: "Help ticket not found" }, { status: 404 });
        // Already closed (converted or otherwise) — nothing to convert.
        if (help.ticketStatus?.isTerminal || help.help.outcome != null) {
            return NextResponse.json({ error: "This help ticket is already closed" }, { status: 409 });
        }

        const closedStatusId = await helpClosedStatusId(help.pipelineId ?? "");
        if (!closedStatusId) return NextResponse.json({ error: "Help Desk pipeline has no Closed stage" }, { status: 503 });

        const author = await buildActorSnapshot(user.id);
        const h = help.help;

        // ── Convert → CRM lead ──────────────────────────────────────────────────
        if (data.target === "deal") {
            const deals = await getDealsPipeline(prisma);
            if (!deals) return NextResponse.json({ error: "Deals pipeline not configured" }, { status: 503 });
            const entry = deals.statuses.find((s) => s.isEntryPoint) ?? deals.statuses[0];
            if (!entry) return NextResponse.json({ error: "Deals pipeline has no stages" }, { status: 503 });

            const lead = await prisma.ticket.create({
                data: {
                    // Which till raised this — same column and resolver as every voucher.
                    sourceCounterId: await sourceCounterId(),
                    pipelineId: deals.id,
                    status: entry.id,
                    title: data.title?.trim() || h.subject || "Enquiry lead",
                    priority: help.priority,
                    createdBy: author,
                    deal: {
                        create: {
                            contactName: h.contactName,
                            phone: h.phone,
                            email: h.email,
                            personId: h.personId,
                            companyId: h.companyId,
                            valuePaise: data.valuePaise ?? null,
                            source: "Help Desk",
                        },
                    },
                },
                select: { id: true },
            });
            await prisma.ticket.update({
                where: { id: help.id },
                data: {
                    status: closedStatusId,
                    closedAt: new Date(),
                    help: { update: { outcome: "CONVERTED_TO_SALE" } },
                },
            });
            await prisma.ticketLog.create({
                data: { ticketId: help.id, status: closedStatusId, note: "Converted to a CRM lead", kind: "SYSTEM", author },
            });
            return NextResponse.json({ ok: true, targetType: "deal", convertedTicketId: lead.id, href: "/office/crm/deals" }, { status: 201 });
        }

        // ── Convert → Service (repair) ticket ───────────────────────────────────
        // Bill to the customer's ledger account when they're an existing party; a
        // brand-new walk-in (name only) creates an unbilled ticket (accountId null).
        const account = h.personId != null
            ? await prisma.account.findFirst({ where: { personId: h.personId }, select: { id: true } })
            : h.companyId != null
                ? await prisma.account.findFirst({ where: { companyId: h.companyId }, select: { id: true } })
                : null;
        const accountId = account?.id ?? null;

        const repairPipeline = await prisma.pipeline.findFirst({ where: { isDefault: true }, select: { id: true } });
        const repairPipelineId = repairPipeline?.id ?? "P1";

        const repair = await prisma.ticket.create({
            data: {
                // Which till raised this — same column and resolver as every voucher.
                sourceCounterId: await sourceCounterId(),
                priority: help.priority,
                pipelineId: repairPipelineId,
                accountId,
                createdBy: author,
                repair: {
                    create: {
                        device: {
                            create: {
                                type: data.deviceType,
                                brand: data.brand,
                                model: data.model,
                                problem: data.problem,
                                ...(accountId ? { accountId } : {}),
                            },
                        },
                    },
                },
            },
            select: { id: true, status: true },
        });
        await prisma.ticketLog.create({
            data: { ticketId: repair.id, status: repair.status, note: "Ticket created", author },
        });

        // Auto-enter the entry-point worker so the new repair ticket is immediately
        // workable (mirrors POST /api/tickets). Best-effort — never blocks convert.
        const entrySub = await findEntryWorker(repair.status);
        if (entrySub) {
            await prisma.ticket.update({ where: { id: repair.id }, data: { workerId: entrySub.id } });
            await prisma.ticketLog.create({
                data: { ticketId: repair.id, status: repair.status, workerId: entrySub.id, note: `Entered: ${entrySub.label}`, author },
            });
            await autoAdvance(repair.id, user.id).catch(() => { /* never blocks convert */ });
        }

        await prisma.ticket.update({
            where: { id: help.id },
            data: {
                status: closedStatusId,
                closedAt: new Date(),
                help: { update: { outcome: "CONVERTED_TO_SERVICE" } },
            },
        });
        await prisma.ticketLog.create({
            data: { ticketId: help.id, status: closedStatusId, note: "Converted to a service ticket", kind: "SYSTEM", author },
        });
        return NextResponse.json({ ok: true, targetType: "service", convertedTicketId: repair.id, href: `/office/repairing/tickets/${repair.id}` }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to convert help ticket");
    }
}
