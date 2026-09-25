import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";

// ── SocialActor resolver ─────────────────────────────────────────────────────
//
// A WallPost's owner and author are FK-free polymorphic refs — either a staff
// User or a customer Person (see social.prisma). This is the single place that
// turns a `{ kind, id }` ref into a display actor (name / avatar / profile link /
// role badge), batched so a feed of N posts costs 2 queries, not 2N. Both the
// office wall and the portal wall render through it.

export type SocialActorKind = "USER" | "PERSON";

export interface SocialActorRef {
    kind: SocialActorKind;
    id: number;
}

export interface ResolvedSocialActor {
    kind: SocialActorKind;
    id: number;
    name: string;
    avatarUrl: string | null;
    /** Link to this actor's profile — office page for staff, portal page for customers. */
    href: string;
    /** Staff role id (drives UserAvatar tint); null for customers. */
    role: string | null;
    roleBadge: { label: string; color: string } | null;
    isCustomer: boolean;
}

export function socialKey(kind: SocialActorKind, id: number): string {
    return `${kind}:${id}`;
}

// Fallback used when a ref points at a row that no longer exists (deleted user /
// person) so the feed still renders instead of throwing.
function unknownActor(ref: SocialActorRef): ResolvedSocialActor {
    return {
        kind: ref.kind, id: ref.id, name: "Unknown", avatarUrl: null,
        href: "#", role: null, roleBadge: null, isCustomer: ref.kind === "PERSON",
    };
}

// Resolve a batch of refs → Map keyed by `socialKey`. Missing rows fall back to
// `unknownActor`. Accepts a tx client so it can run inside a transaction.
export async function resolveSocialActors(
    refs: SocialActorRef[],
    db: Prisma.TransactionClient = prisma,
): Promise<Map<string, ResolvedSocialActor>> {
    const userIds = [...new Set(refs.filter((r) => r.kind === "USER").map((r) => r.id))];
    const personIds = [...new Set(refs.filter((r) => r.kind === "PERSON").map((r) => r.id))];

    const [users, persons] = await Promise.all([
        userIds.length
            ? db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, name: true, avatarUrl: true, role: true, userRole: { select: { label: true, color: true } } },
            })
            : Promise.resolve([]),
        personIds.length
            ? db.person.findMany({
                where: { id: { in: personIds } },
                select: { id: true, name: true, avatarUrl: true, socialProfile: { select: { handle: true } } },
            })
            : Promise.resolve([]),
    ]);

    const map = new Map<string, ResolvedSocialActor>();
    for (const u of users) {
        map.set(socialKey("USER", u.id), {
            kind: "USER", id: u.id, name: u.name, avatarUrl: u.avatarUrl,
            href: `/office/user/${u.id}`,
            role: u.role,
            roleBadge: u.userRole ? { label: u.userRole.label, color: u.userRole.color } : null,
            isCustomer: false,
        });
    }
    for (const p of persons) {
        // A customer only participates once joined (handle present); still render
        // by name if a ref somehow predates the profile.
        map.set(socialKey("PERSON", p.id), {
            kind: "PERSON", id: p.id, name: p.name, avatarUrl: p.avatarUrl,
            href: p.socialProfile ? `/portal/social/u/${p.socialProfile.handle}` : "#",
            role: null, roleBadge: null, isCustomer: true,
        });
    }
    // Guarantee every requested ref has an entry.
    for (const ref of refs) {
        const k = socialKey(ref.kind, ref.id);
        if (!map.has(k)) map.set(k, unknownActor(ref));
    }
    return map;
}

// The social "friends" set — everyone in the community: all staff (User) plus all
// joined customers (Person with a social profile). Implicit model: everyone is
// friends with everyone. Optionally excludes one actor (the profile being viewed,
// so a profile doesn't list itself).
export async function getCommunityFriends(
    exclude?: SocialActorRef,
    db: Prisma.TransactionClient = prisma,
): Promise<ResolvedSocialActor[]> {
    const [staff, customers] = await Promise.all([
        db.user.findMany({ orderBy: { name: "asc" }, take: 200, select: { id: true } }),
        db.person.findMany({ where: { socialProfile: { isNot: null } }, orderBy: { name: "asc" }, take: 200, select: { id: true } }),
    ]);
    const refs: SocialActorRef[] = [
        ...staff.map((u) => ({ kind: "USER" as const, id: u.id })),
        ...customers.map((p) => ({ kind: "PERSON" as const, id: p.id })),
    ].filter((r) => !(exclude && r.kind === exclude.kind && r.id === exclude.id));
    const map = await resolveSocialActors(refs, db);
    return refs.map((r) => map.get(socialKey(r.kind, r.id))!);
}

// The friends of a specific actor under model A (staff auto-friend everyone;
// customers connect to each other by request):
//   • a staff member's friends = the whole community (all staff + joined customers)
//   • a customer's friends       = all staff (auto) + their ACCEPTED peer customers
export async function getFriendsFor(
    actor: SocialActorRef,
    db: Prisma.TransactionClient = prisma,
): Promise<ResolvedSocialActor[]> {
    if (actor.kind === "USER") return getCommunityFriends(actor, db);

    const personId = actor.id;
    const [staff, connections] = await Promise.all([
        db.user.findMany({ orderBy: { name: "asc" }, take: 200, select: { id: true } }),
        db.socialConnection.findMany({
            where:  { status: "ACCEPTED", OR: [{ requesterId: personId }, { addresseeId: personId }] },
            select: { requesterId: true, addresseeId: true },
        }),
    ]);
    const peerIds = connections.map((c) => (c.requesterId === personId ? c.addresseeId : c.requesterId));
    const refs: SocialActorRef[] = [
        ...staff.map((u) => ({ kind: "USER" as const, id: u.id })),
        ...peerIds.map((id) => ({ kind: "PERSON" as const, id })),
    ];
    const map = await resolveSocialActors(refs, db);
    return refs.map((r) => map.get(socialKey(r.kind, r.id))!);
}

// Convenience for a single ref.
export async function resolveSocialActor(
    ref: SocialActorRef,
    db: Prisma.TransactionClient = prisma,
): Promise<ResolvedSocialActor> {
    const map = await resolveSocialActors([ref], db);
    return map.get(socialKey(ref.kind, ref.id))!;
}
