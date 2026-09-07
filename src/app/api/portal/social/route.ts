import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { resolveSocialActors, socialKey, getFriendsFor, type SocialActorRef } from "@/shared/lib/social/socialActor";
import { likeCommentSelect, shapeCounts } from "@/shared/lib/social/wallFeed";

// GET /api/portal/social — everything the portal social profile needs in one call:
//   joined  — has the customer opted in?
//   me      — their profile (handle/avatar/bio) + name/contact + counts
//   wall    — posts on THEIR wall
//   feed    — recent posts across the network (community feed)
//   friends — staff (every customer's default friends, implicit for v1)
const WALL_TAKE = 50;
const FEED_TAKE = 50;

export async function GET() {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    try {
        const profile = await prisma.customerSocialProfile.findUnique({
            where:  { personId: customerId! },
            select: { handle: true, coverUrl: true, bio: true, joinedAt: true },
        });
        if (!profile) return NextResponse.json({ joined: false as const });

        const [person, wallRows, feedRows, wallCount, friends] = await Promise.all([
            prisma.person.findUnique({
                where:  { id: customerId! },
                select: { name: true, avatarUrl: true, phones: selectPrimaryPhone, emails: selectPrimaryEmail },
            }),
            prisma.wallPost.findMany({
                where:   { ownerKind: "PERSON", ownerId: customerId! },
                orderBy: { createdAt: "desc" },
                take:    WALL_TAKE,
                select:  { id: true, body: true, createdAt: true, authorKind: true, authorId: true, ...likeCommentSelect(customerId!) },
            }),
            prisma.wallPost.findMany({
                orderBy: { createdAt: "desc" },
                take:    FEED_TAKE,
                select:  { id: true, body: true, createdAt: true, ownerKind: true, ownerId: true, authorKind: true, authorId: true, ...likeCommentSelect(customerId!) },
            }),
            prisma.wallPost.count({ where: { ownerKind: "PERSON", ownerId: customerId! } }),
            // Model A: all staff (auto-friends) + this customer's accepted peers.
            getFriendsFor({ kind: "PERSON", id: customerId! }),
        ]);

        // Batch-resolve the actors that appear in the wall + feed.
        const refs: SocialActorRef[] = [];
        for (const r of wallRows) refs.push({ kind: r.authorKind, id: r.authorId });
        for (const r of feedRows) {
            refs.push({ kind: r.authorKind, id: r.authorId });
            refs.push({ kind: r.ownerKind, id: r.ownerId });
        }
        const actors = await resolveSocialActors(refs);

        const wall = wallRows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actors.get(socialKey(r.authorKind, r.authorId))!,
            ...shapeCounts(r),
        }));
        const feed = feedRows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actors.get(socialKey(r.authorKind, r.authorId))!,
            owner:  actors.get(socialKey(r.ownerKind, r.ownerId))!,
            ...shapeCounts(r),
        }));

        return NextResponse.json({
            joined: true as const,
            me: {
                handle:      profile.handle,
                avatarUrl:   person?.avatarUrl ?? null,
                coverUrl:    profile.coverUrl,
                bio:         profile.bio,
                joinedAt:    profile.joinedAt,
                name:        person?.name ?? "You",
                phone:       person?.phones[0]?.phone ?? null,
                email:       person?.emails[0]?.email ?? null,
                wallCount,
                friendCount: friends.length,
            },
            wall,
            feed,
            friends,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load social");
    }
}
