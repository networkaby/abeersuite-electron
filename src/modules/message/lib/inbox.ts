import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { ResolvedUser } from "@/shared/lib/auth/permissions";
import { findUserIdsHoldingRoles } from "@/shared/lib/auth/roleHolders";

const ROOM_KEY = {
    system:  (userId: number)              => `system:${userId}`,
    personal:(userId: number)              => `personal:${userId}`,
    org:     ()                            => "org:all",
    dm:      (a: number, b: number)        => `dm:${Math.min(a,b)}:${Math.max(a,b)}`,
} as const;

type RoomSeed = {
    key: string;
    name: string;
    type: "SYSTEM_INBOX" | "PERSONAL_INBOX" | "ORG_GROUP" | "DIRECT_MESSAGE";
    ownerUserId?: number | null;
};

async function ensureRoom(seed: RoomSeed) {
    return prisma.chatRoom.upsert({
        where: { key: seed.key },
        update: {
            name: seed.name,
            type: seed.type,
            ownerUserId: seed.ownerUserId ?? null,
            isActive: true,
        },
        create: {
            key: seed.key,
            name: seed.name,
            type: seed.type,
            ownerUserId: seed.ownerUserId ?? null,
        },
    });
}

async function ensureMembership(roomId: string, userId: number) {
    return prisma.chatRoomMember.upsert({
        where: { roomId_userId: { roomId, userId } },
        update: {},
        create: { roomId, userId },
    });
}

// TODO: branch- / department-wise groups replace the dropped role groups.
// `ResolvedUser` already carries `branchIds` / `departmentIds`, so this is a
// like-for-like swap of what role rooms did — it needs ChatRoom.branchId /
// .departmentId columns plus BRANCH_GROUP / DEPARTMENT_GROUP enum values,
// i.e. one `prisma db push`. See PROJECT_BRAIN.md.
export async function ensureCoreRoomsForUser(user: Pick<ResolvedUser, "id">) {
    const existing = await prisma.chatRoom.findUnique({
        where: { key: ROOM_KEY.system(user.id) },
        select: { id: true },
    });
    if (existing) return;

    const systemRoom = await ensureRoom({
        key: ROOM_KEY.system(user.id),
        name: "System Inbox",
        type: "SYSTEM_INBOX",
        ownerUserId: user.id,
    });
    const orgRoom = await ensureRoom({
        key: ROOM_KEY.org(),
        name: "Organisation Group",
        type: "ORG_GROUP",
    });

    await Promise.all([
        ensureMembership(systemRoom.id, user.id),
        ensureMembership(orgRoom.id, user.id),
    ]);
}

export async function ensureDirectMessageRoom(userA: number, userB: number) {
    const key = ROOM_KEY.dm(userA, userB);
    const [nameA, nameB] = await Promise.all([
        prisma.user.findUnique({ where: { id: userA }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: userB }, select: { name: true } }),
    ]);
    const room = await ensureRoom({
        key,
        name: `${nameA?.name ?? userA} ↔ ${nameB?.name ?? userB}`,
        type: "DIRECT_MESSAGE",
    });
    await Promise.all([
        ensureMembership(room.id, userA),
        ensureMembership(room.id, userB),
    ]);
    return room;
}

/** Which rooms this user may see — one definition, shared by the list and the unread total. */
const accessibleRoomsWhere = (userId: number) => ({
    isActive: true,
    type: { not: "PERSONAL_INBOX" as const },
    OR: [
        { ownerUserId: userId },
        { type: "ORG_GROUP" as const },
        {
            type: "DIRECT_MESSAGE" as const,
            members: { some: { userId } },
        },
    ],
});

export async function listAccessibleRooms(user: ResolvedUser) {
    await ensureCoreRoomsForUser(user);

    const rooms = await prisma.chatRoom.findMany({
        where: accessibleRoomsWhere(user.id),
        include: {
            members: {
                where: { userId: user.id },
                select: { lastReadAt: true },
            },
            _count: { select: { messages: true } },
            messages: {
                take: 1,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    title: true,
                    body: true,
                    link: true,
                    messageType: true,
                    createdAt: true,
                    senderUser: { select: { name: true } },
                },
            },
        },
        orderBy: [
            { type: "asc" },
            { updatedAt: "desc" },
        ],
    });

    const roomIds = rooms.map((room) => room.id);
    const memberships = new Map(
        rooms.map((room) => [room.id, room.members[0]?.lastReadAt ?? null])
    );

    const unreadCounts = roomIds.length === 0
        ? new Map<string, number>()
        : new Map(
            (
                await Promise.all(roomIds.map(async (roomId) => {
                    const lastReadAt = memberships.get(roomId);
                    const count = await prisma.chatMessage.count({
                        where: {
                            roomId,
                            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
                        },
                    });
                    return [roomId, count] as const;
                }))
            )
        );

    return rooms.map((room) => ({
        id: room.id,
        key: room.key,
        type: room.type,
        name: room.name,
        unreadCount: unreadCounts.get(room.id) ?? 0,
        messageCount: room._count.messages,
        latestMessage: room.messages[0] ?? null,
    }));
}

/**
 * Total unread across every accessible room — the number the Sidebar badge shows.
 * Deliberately lean (ids + my lastReadAt only, no latest message / counts) because
 * this is polled and event-refreshed from every page.
 */
export async function getUnreadTotal(user: ResolvedUser) {
    const rooms = await prisma.chatRoom.findMany({
        where: accessibleRoomsWhere(user.id),
        select: {
            id: true,
            members: {
                where: { userId: user.id },
                select: { lastReadAt: true },
            },
        },
    });
    if (rooms.length === 0) return 0;

    const counts = await Promise.all(rooms.map((room) => {
        const lastReadAt = room.members[0]?.lastReadAt ?? null;
        return prisma.chatMessage.count({
            where: {
                roomId: room.id,
                ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
            },
        });
    }));

    return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Unread in this user's system room only — the notification bell badge.
 *
 * Unlike the /api/notifications list this does NOT call ensureCoreRoomsForUser: it
 * rides the sidebar count poll, and a poll must never write. No room yet simply
 * means nothing to show; the room is created the moment the bell is opened.
 */
export async function getNotificationUnread(userId: number) {
    const room = await prisma.chatRoom.findUnique({
        where: { key: `system:${userId}` },
        select: {
            id: true,
            members: { where: { userId }, select: { lastReadAt: true } },
        },
    });
    if (!room) return 0;

    const lastReadAt = room.members[0]?.lastReadAt ?? null;
    return prisma.chatMessage.count({
        where: {
            roomId: room.id,
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
    });
}

export async function getAccessibleRoom(user: ResolvedUser, roomId: string) {
    const room = await prisma.chatRoom.findFirst({
        where: {
            id: roomId,
            isActive: true,
            OR: [
                { ownerUserId: user.id },
                { type: "ORG_GROUP" },
                {
                    type: "DIRECT_MESSAGE",
                    members: { some: { userId: user.id } },
                },
            ],
        },
    });

    if (!room) return null;

    await ensureMembership(room.id, user.id);
    return room;
}

export async function markRoomRead(userId: number, roomId: string, readAt?: Date) {
    return prisma.chatRoomMember.upsert({
        where: { roomId_userId: { roomId, userId } },
        update: { lastReadAt: readAt ?? new Date() },
        create: { roomId, userId, lastReadAt: readAt ?? new Date() },
    });
}

export async function createRoomMessage({
    roomId,
    senderUserId,
    messageType,
    title,
    body,
    link,
}: {
    roomId: string;
    senderUserId?: number | null;
    messageType: "SYSTEM" | "USER";
    title?: string | null;
    body: string;
    link?: string | null;
}) {
    const message = await prisma.chatMessage.create({
        data: {
            roomId,
            senderUserId: senderUserId ?? null,
            messageType,
            title: title ?? null,
            body,
            link: link ?? null,
        },
    });

    await prisma.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
    });

    return message;
}

/**
 * Fan a SYSTEM message out to every user who currently holds one of `roleIds`.
 *
 * Recipients come from `findUserIdsHoldingRoles`, which counts **Position
 * appointments** as well as the legacy `User.role` override. Before 2026-09-04
 * this matched on `User.role` alone: a user created the normal way holds their
 * duty by appointment and has `role = null`, so shop-order, return, delivery and
 * payment notifications reached nobody on a normally-seeded org.
 */
export async function createSystemInboxNotifications({
    roleIds,
    actorUserId,
    title,
    body,
    link,
}: {
    roleIds: string[];
    actorUserId?: number;
    title: string;
    body: string;
    link?: string;
}) {
    const userIds = await findUserIdsHoldingRoles(roleIds, { excludeUserId: actorUserId });
    if (userIds.length === 0) return;

    // The room may not exist yet for a user who has never opened the inbox.
    for (const id of userIds) await ensureCoreRoomsForUser({ id });

    // One query for every room, then one insert — not a query per recipient.
    const rooms = await prisma.chatRoom.findMany({
        where: { key: { in: userIds.map((id) => ROOM_KEY.system(id)) } },
        select: { id: true },
    });
    if (rooms.length === 0) return;

    await prisma.chatMessage.createMany({
        data: rooms.map((room) => ({
            roomId: room.id,
            senderUserId: null,
            messageType: "SYSTEM" as const,
            title,
            body,
            link: link ?? null,
        })),
    });

    await prisma.chatRoom.updateMany({
        where: { id: { in: rooms.map((r) => r.id) } },
        data: { updatedAt: new Date() },
    });
}
