import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey, getFriendsFor } from "@/shared/lib/social/socialActor";
import { likeCommentSelect, shapeCounts } from "@/shared/lib/social/wallFeed";

// GET /api/portal/social/actor/[kind]/[id] — a portal-viewable public profile of
// any actor (a staff USER or a joined customer PERSON), plus their wall. Lets a
// signed-in customer visit a friend's or another customer's profile.
export async function GET(_: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { kind: kindRaw, id: idRaw } = await params;
    const id = Number(idRaw);
    const kind = kindRaw === "user" ? "USER" : kindRaw === "person" ? "PERSON" : null;
    if (!kind || !Number.isFinite(id)) return NextResponse.json({ error: "Invalid actor" }, { status: 400 });

    try {
        let actor: {
            kind: "USER" | "PERSON"; id: number; name: string; avatarUrl: string | null; coverUrl: string | null;
            role: string | null; roleBadge: { label: string; color: string } | null;
            handle: string | null; bio: string | null; joinedAt: string; isCustomer: boolean;
        };

        if (kind === "USER") {
            const u = await prisma.user.findUnique({
                where:  { id },
                select: { id: true, name: true, avatarUrl: true, coverUrl: true, role: true, bio: true, createdAt: true, userRole: { select: { label: true, color: true } } },
            });
            if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
            actor = {
                kind: "USER", id: u.id, name: u.name, avatarUrl: u.avatarUrl, coverUrl: u.coverUrl, role: u.role,
                roleBadge: u.userRole ? { label: u.userRole.label, color: u.userRole.color } : null,
                handle: null, bio: u.bio, joinedAt: u.createdAt.toISOString(), isCustomer: false,
            };
        } else {
            const p = await prisma.person.findUnique({
                where:  { id },
                select: { id: true, name: true, avatarUrl: true, socialProfile: { select: { handle: true, coverUrl: true, bio: true, joinedAt: true } } },
            });
            if (!p || !p.socialProfile) return NextResponse.json({ error: "Not found" }, { status: 404 });
            actor = {
                kind: "PERSON", id: p.id, name: p.name, avatarUrl: p.avatarUrl, coverUrl: p.socialProfile.coverUrl, role: null,
                roleBadge: null, handle: p.socialProfile.handle, bio: p.socialProfile.bio,
                joinedAt: p.socialProfile.joinedAt.toISOString(), isCustomer: true,
            };
        }

        // Implicit model: everyone is friends with everyone — all staff plus all
        // joined customers, minus the profile being viewed.
        const [wallRows, wallCount, friends] = await Promise.all([
            prisma.wallPost.findMany({
                where:   { ownerKind: kind, ownerId: id },
                orderBy: { createdAt: "desc" },
                take:    50,
                select:  { id: true, body: true, createdAt: true, authorKind: true, authorId: true, ...likeCommentSelect(customerId!) },
            }),
            prisma.wallPost.count({ where: { ownerKind: kind, ownerId: id } }),
            getFriendsFor({ kind, id }),
        ]);

        const actorMap = await resolveSocialActors(wallRows.map((r) => ({ kind: r.authorKind, id: r.authorId })));
        const wall = wallRows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actorMap.get(socialKey(r.authorKind, r.authorId))!,
            ...shapeCounts(r),
        }));

        const isSelf = kind === "PERSON" && id === customerId;

        // The viewing customer's relationship to this profile (drives the Add-friend button).
        let viewerStatus: "self" | "friend" | "pending_out" | "pending_in" | "none" = "friend";
        let requestId: number | undefined;
        if (isSelf) {
            viewerStatus = "self";
        } else if (kind === "PERSON") {
            const conn = await prisma.socialConnection.findFirst({
                where:  { OR: [{ requesterId: customerId!, addresseeId: id }, { requesterId: id, addresseeId: customerId! }] },
                select: { id: true, requesterId: true, status: true },
            });
            if (!conn) viewerStatus = "none";
            else if (conn.status === "ACCEPTED") viewerStatus = "friend";
            else if (conn.requesterId === customerId) viewerStatus = "pending_out";
            else { viewerStatus = "pending_in"; requestId = conn.id; }
        } // kind === "USER" → staff are auto-friends ("friend")

        return NextResponse.json({ actor, wall, friends, wallCount, friendCount: friends.length, isSelf, viewerStatus, requestId });
    } catch (e) {
        return handleApiError(e, "Failed to load profile");
    }
}
