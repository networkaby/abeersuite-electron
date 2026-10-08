import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { changeClaim } from "@/modules/message/lib/customerMessages";

// /api/messages/claim — who is handling a customer's chat (MessageClaim).
//
// GET  — who a chat can be handed to, shared with or @mentioned: everyone whose
//        Position carries chat access (messages:reply or admin bypass), with
//        that Position's title, plus @All / @Department / @Branch groups built
//        from the same Positions. The old User.role field plays no part.
// POST — { phone, action: take | leave }  or  { phone, action: invite | handover, userId }.
// Gated like replying: handling a chat means answering it.

type Group = { kind: "all" | "department" | "branch"; id: string; name: string; memberIds: number[] };

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const seats = await prisma.userPosition.findMany({
            where: {
                position: {
                    roleTemplates: {
                        some: { role: { permissions: { some: { permissionId: { in: [PERMISSIONS.MESSAGES_REPLY, PERMISSIONS.ADMIN_BYPASS] } } } } },
                    },
                },
            },
            select: {
                user: { select: { id: true, name: true } },
                position: {
                    select: {
                        title: true,
                        department: { select: { id: true, name: true } },
                        branch: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const people = new Map<number, { id: number; name: string; positions: string[] }>();
        const groups = new Map<string, Group>();
        const join = (kind: Group["kind"], id: string, name: string, userId: number) => {
            const key = `${kind}:${id}`;
            const g = groups.get(key) ?? { kind, id, name, memberIds: [] };
            if (!g.memberIds.includes(userId)) g.memberIds.push(userId);
            groups.set(key, g);
        };
        for (const { user, position } of seats) {
            const p = people.get(user.id) ?? { id: user.id, name: user.name, positions: [] };
            if (!p.positions.includes(position.title)) p.positions.push(position.title);
            people.set(user.id, p);
            join("all", "all", "All", user.id);
            if (position.department) join("department", position.department.id, position.department.name, user.id);
            if (position.branch) join("branch", position.branch.id, position.branch.name, user.id);
        }

        const staff = [...people.values()]
            .map((p) => ({ id: p.id, name: p.name, position: p.positions.join(", ") }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const order = { all: 0, department: 1, branch: 2 };
        const groupList = [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
        return NextResponse.json({ staff, groups: groupList });
    } catch (e) {
        return handleApiError(e, "Failed to list staff");
    }
}

const schema = z.discriminatedUnion("action", [
    z.object({ phone: z.string().trim().min(1), action: z.literal("take") }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("leave") }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("invite"), userId: z.number().int().positive() }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("handover"), userId: z.number().int().positive() }),
]);

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const { phone: raw, ...action } = data;
        const phone = phoneMatchKey(raw);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        await changeClaim(phone, user.id, action);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update who handles this chat");
    }
}
