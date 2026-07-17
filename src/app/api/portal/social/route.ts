import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey, type SocialActorRef } from "@/shared/lib/social/socialActor";

// GET /api/portal/social — the portal Social overview for the signed-in customer:
//   profile — their CustomerSocialProfile (joined? handle/bio), or { joined:false }
//   feed    — recent wall posts across the network (resolved author + owner)
//   friends — staff (every customer's default friends, implicit for v1)
const FEED_TAKE = 50;
const FRIENDS_TAKE = 50;

export async function GET() {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    try {
        const [profile, rows, staff] = await Promise.all([
            prisma.customerSocialProfile.findUnique({
                where:  { personId: customerId! },
                select: { handle: true, avatarUrl: true, bio: true, joinedAt: true },
            }),
            prisma.wallPost.findMany({
                orderBy: { createdAt: "desc" },
                take:    FEED_TAKE,
                select:  { id: true, body: true, createdAt: true, ownerKind: true, ownerId: true, authorKind: true, authorId: true },
            }),
            prisma.user.findMany({ take: FRIENDS_TAKE, orderBy: { name: "asc" }, select: { id: true } }),
        ]);

        // One batched actor resolve covers feed authors, feed owners, and friends.
        const refs: SocialActorRef[] = [];
        for (const r of rows) {
            refs.push({ kind: r.authorKind, id: r.authorId });
            refs.push({ kind: r.ownerKind, id: r.ownerId });
        }
        for (const s of staff) refs.push({ kind: "USER", id: s.id });
        const actors = await resolveSocialActors(refs);

        const feed = rows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actors.get(socialKey(r.authorKind, r.authorId))!,
            owner:  actors.get(socialKey(r.ownerKind, r.ownerId))!,
        }));
        const friends = staff.map((s) => actors.get(socialKey("USER", s.id))!);

        return NextResponse.json({
            profile: profile ? { joined: true as const, ...profile } : { joined: false as const },
            feed,
            friends,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load social");
    }
}
