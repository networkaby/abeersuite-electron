/**
 * GET /api/tickets/lookup?q=...
 *
 * Universal repair-status search for the home panel.
 * Any authenticated staff can call this — no extra permission gate.
 * (Owner's rule: every staff member must be able to answer "where is my repair?")
 *
 *   q = pure digits  → find ticket by ID (any status)
 *   q = text (≥ 2)   → find active tickets by customer name or phone (max 6)
 *
 * Returns: TicketLookupResult[]
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";

const ticketSelect = {
    id: true,
    status: true,
    expectedReturn: true,
    ticketStatus: { select: { label: true, color: true } },
    primaryOwner: { select: { name: true } },
    device: {
        select: {
            brand: true,
            model: true,
            account: {
                select: {
                    person: { select: { name: true } },
                    company: { select: { name: true } },
                },
            },
        },
    },
} as const;

function customerName(t: {
    device: {
        account: {
            person: { name: string } | null;
            company: { name: string } | null;
        } | null;
    };
}): string {
    return t.device.account?.person?.name
        ?? t.device.account?.company?.name
        ?? "Unknown";
}

export async function GET(req: Request) {
    const auth = await requireAuth();
    if (auth.response) return auth.response;

    try {
        const { searchParams } = new URL(req.url);
        const q = (searchParams.get("q") ?? "").trim();

        if (q.length < 2) return NextResponse.json([]);

        const isNumeric = /^\d+$/.test(q);

        if (isNumeric) {
            const ticket = await prisma.ticket.findUnique({
                where: { id: Number(q) },
                select: ticketSelect,
            });
            if (!ticket) return NextResponse.json([]);
            return NextResponse.json([{
                ...ticket,
                customerName: customerName(ticket),
                expectedReturn: ticket.expectedReturn?.toISOString() ?? null,
            }]);
        }

        // Text search — active tickets only, matched by customer name or phone
        const tickets = await prisma.ticket.findMany({
            where: {
                ticketStatus: { isTerminal: false },
                device: {
                    account: {
                        OR: [
                            { person: { name: { contains: q, mode: "insensitive" } } },
                            { person: { phones: { some: { phone: { contains: q } } } } },
                            { company: { name: { contains: q, mode: "insensitive" } } },
                            { company: { phones: { some: { phone: { contains: q } } } } },
                        ],
                    },
                },
            },
            select: ticketSelect,
            orderBy: { createdAt: "desc" },
            take: 6,
        });

        return NextResponse.json(
            tickets.map((t) => ({
                ...t,
                customerName: customerName(t),
                expectedReturn: t.expectedReturn?.toISOString() ?? null,
            }))
        );
    } catch (e) {
        return handleApiError(e);
    }
}
