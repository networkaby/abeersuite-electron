import { prisma } from "@/lib/prisma";
import type { ResolvedUser } from "@/lib/auth-guard";

const ROOM_KEY = {
    system:  (userId: number)              => `system:${userId}`,
    personal:(userId: number)              => `personal:${userId}`,
    role:    (roleId: string)              => `role:${roleId}`,
    org:     ()                            => "org:all",
    dm:      (a: number, b: number)        => `dm:${Math.min(a,b)}:${Math.max(a,b)}`,
} as const;

type RoomSeed = {
    key: string;
    name: string;
    type: "SYSTEM_INBOX" | "PERSONAL_INBOX" | "ROLE_GROUP" | "ORG_GROUP" | "DIRECT_MESSAGE";
    ownerUserId?: number | null;
    roleId?: string | null;
};

async function ensureRoom(seed: RoomSeed) {
    return prisma.chatRoom.upsert({
        where: { key: seed.key },
        update: {
            name: seed.name,
            type: seed.type,
            ownerUserId: seed.ownerUserId ?? null,
            roleId: seed.roleId ?? null,
            isActive: true,
        },
        create: {
            key: seed.key,
            name: seed.name,
            type: seed.type,
            ownerUserId: seed.ownerUserId ?? null,
            roleId: seed.roleId ?? null,
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

export async function ensureCoreRoomsForUser(user: Pick<ResolvedUser, "id" | "roles">) {
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
        ...user.roles
            .filter(Boolean)
            .map(async (roleId) => {
                const roleRoom = await ensureRoom({
                    key: ROOM_KEY.role(roleId),
                    name: `${roleId} Group`,
                    type: "ROLE_GROUP",
                    roleId,
                });
                await ensureMembership(roleRoom.id, user.id);
            }),
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

export async function listAccessibleRooms(user: ResolvedUser) {
    await ensureCoreRoomsForUser(user);

    const rooms = await prisma.chatRoom.findMany({
        where: {
            isActive: true,
            type: { not: "PERSONAL_INBOX" },
            OR: [
                { ownerUserId: user.id },
                { type: "ORG_GROUP" },
                { roleId: { in: user.roles.filter(Boolean) } },
                {
                    type: "DIRECT_MESSAGE",
                    members: { some: { userId: user.id } },
                },
            ],
        },
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
        roleId: room.roleId,
        unreadCount: unreadCounts.get(room.id) ?? 0,
        messageCount: room._count.messages,
        latestMessage: room.messages[0] ?? null,
    }));
}

export async function getAccessibleRoom(user: ResolvedUser, roomId: string) {
    const room = await prisma.chatRoom.findFirst({
        where: {
            id: roomId,
            isActive: true,
            OR: [
                { ownerUserId: user.id },
                { type: "ORG_GROUP" },
                { roleId: { in: user.roles.filter(Boolean) } },
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
    const distinctRoles = [...new Set(roleIds.filter(Boolean))];
    if (distinctRoles.length === 0) return;

    const users = await prisma.user.findMany({
        where: {
            role: { in: distinctRoles },
            ...(actorUserId ? { id: { not: actorUserId } } : {}),
        },
        select: { id: true, role: true },
    });

    for (const user of users) {
        await ensureCoreRoomsForUser({ id: user.id, roles: [user.role] });
        const room = await prisma.chatRoom.findUnique({
            where: { key: ROOM_KEY.system(user.id) },
            select: { id: true },
        });
        if (!room) continue;

        await createRoomMessage({
            roomId: room.id,
            messageType: "SYSTEM",
            title,
            body,
            link,
        });
    }
}
