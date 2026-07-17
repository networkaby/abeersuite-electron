import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey } from "@/shared/lib/social/socialActor";

// GET /api/portal/social/search?q= — find people (staff + joined customers) by
// name or @handle, each tagged with this customer's relationship to them.
type Status = "friend" | "pending_out" | "pending_in" | "none";

export async function GET(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 1) return NextResponse.json([]);

    try {
        const [staff, persons] = await Promise.all([
            prisma.user.findMany({
                where:   { name: { contains: q, mode: "insensitive" } },
                take:    10, orderBy: { name: "asc" }, select: { id: true },
            }),
            prisma.person.findMany({
                where: {
                    id: { not: customerId! },
                    socialProfile: { isNot: null },
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { socialProfile: { handle: { contains: q.toLowerCase() } } },
                    ],
                },
                take: 20, orderBy: { name: "asc" }, select: { id: true },
            }),
        ]);

        const personIds = persons.map((p) => p.id);
        const conns = personIds.length
            ? await prisma.socialConnection.findMany({
                where: {
                    OR: [
                        { requesterId: customerId!, addresseeId: { in: personIds } },
                        { addresseeId: customerId!, requesterId: { in: personIds } },
                    ],
                },
                select: { id: true, requesterId: true, addresseeId: true, status: true },
            })
            : [];

        const rel = new Map<number, { status: Status; requestId?: number }>();
        for (const c of conns) {
            const other = c.requesterId === customerId ? c.addresseeId : c.requesterId;
            if (c.status === "ACCEPTED") rel.set(other, { status: "friend" });
            else if (c.requesterId === customerId) rel.set(other, { status: "pending_out" });
            else rel.set(other, { status: "pending_in", requestId: c.id });
        }

        const refs = [
            ...staff.map((u) => ({ kind: "USER" as const, id: u.id })),
            ...persons.map((p) => ({ kind: "PERSON" as const, id: p.id })),
        ];
        const actors = await resolveSocialActors(refs);

        const results = [
            // Staff are auto-friends in model A.
            ...staff.map((u) => ({ actor: actors.get(socialKey("USER", u.id))!, status: "friend" as Status, requestId: undefined as number | undefined })),
            ...persons.map((p) => ({ actor: actors.get(socialKey("PERSON", p.id))!, ...(rel.get(p.id) ?? { status: "none" as Status }) })),
        ];
        return NextResponse.json(results);
    } catch (e) {
        return handleApiError(e, "Search failed");
    }
}
