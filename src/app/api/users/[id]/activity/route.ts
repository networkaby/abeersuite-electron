import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

type ActivityType =
    | "ticket_created"
    | "ticket_updated"
    | "wall_post"
    | "user_joined"
    | "login_untracked"
    | "logout_untracked";

interface ActivityItem {
    id: string;
    type: ActivityType;
    title: string;
    description: string;
    createdAt: string;
    meta?: {
        ticketId?: number;
        wallUserId?: number;
        wallUserName?: string;
    };
}

function getWindow(period: string) {
    const now = new Date();
    if (period === "7d") {
        return { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), lte: now };
    }
    if (period === "30d") {
        return { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lte: now };
    }
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { gte: start, lte: now };
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = Number(id);
    if (Number.isNaN(userId)) {
        return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    try {
        const { searchParams } = new URL(req.url);
        const periodParam = searchParams.get("period") ?? "today";
        const period = periodParam === "7d" || periodParam === "30d" ? periodParam : "today";
        const limit = Math.min(200, Math.max(10, Number(searchParams.get("limit") ?? 80)));
        const range = getWindow(period);

        const [user, logs, wallPosts] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, createdAt: true },
            }),
            prisma.ticketLog.findMany({
                where: { userId, createdAt: { gte: range.gte, lte: range.lte } },
                include: {
                    ticketStatus: { select: { label: true } },
                    ticket: { select: { id: true } },
                },
                orderBy: { createdAt: "desc" },
                take: limit,
            }),
            prisma.wallPost.findMany({
                where: { authorId: userId, createdAt: { gte: range.gte, lte: range.lte } },
                select: {
                    id: true,
                    createdAt: true,
                    wallUser: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                take: Math.max(30, Math.floor(limit / 2)),
            }),
        ]);

        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const ticketActivities: ActivityItem[] = logs.map((log) => {
            const isCreated = (log.note ?? "").toLowerCase().includes("ticket created");
            return {
                id: `ticket-log-${log.id}`,
                type: isCreated ? "ticket_created" : "ticket_updated",
                title: isCreated ? "Created ticket" : "Updated ticket",
                description: isCreated
                    ? `Ticket #${log.ticket.id} created`
                    : `Ticket #${log.ticket.id} moved to ${log.ticketStatus.label}${log.note ? ` - ${log.note}` : ""}`,
                createdAt: log.createdAt.toISOString(),
                meta: { ticketId: log.ticket.id },
            };
        });

        const wallActivities: ActivityItem[] = wallPosts.map((post) => ({
            id: `wall-post-${post.id}`,
            type: "wall_post",
            title: "Posted on wall",
            description: `Posted on ${post.wallUser.name}'s wall`,
            createdAt: post.createdAt.toISOString(),
            meta: { wallUserId: post.wallUser.id, wallUserName: post.wallUser.name },
        }));

        const activities = [...ticketActivities, ...wallActivities];

        if (user.createdAt >= range.gte && user.createdAt <= range.lte) {
            activities.push({
                id: `user-joined-${user.id}`,
                type: "user_joined",
                title: "Joined organization",
                description: "User account was created",
                createdAt: user.createdAt.toISOString(),
            });
        }

        activities.push(
            {
                id: `login-untracked-${user.id}`,
                type: "login_untracked",
                title: "Login tracking not available",
                description: "Login activity is not being stored yet",
                createdAt: new Date(0).toISOString(),
            },
            {
                id: `logout-untracked-${user.id}`,
                type: "logout_untracked",
                title: "Logout tracking not available",
                description: "Logout activity is not being stored yet",
                createdAt: new Date(0).toISOString(),
            }
        );

        const sorted = activities
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return NextResponse.json({
            period,
            total: sorted.length,
            items: sorted,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch activity");
    }
}
