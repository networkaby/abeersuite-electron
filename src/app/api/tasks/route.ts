import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// GET /api/tasks?scope=own|team|org&filter=open|done|today|overdue
export async function GET(req: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = Number((session.user as { id?: string }).id);
    const userRoles: string[] = (session.user as { roles?: string[] }).roles
        ?? [(session.user as { role?: string }).role ?? ""];

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "own";
    const filter = searchParams.get("filter") ?? "open";

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);

    type WhereClause = Record<string, unknown>;
    const statusFilter: WhereClause = {};
    if (filter === "open")    statusFilter.status = { in: ["open", "in_progress"] };
    else if (filter === "done")    statusFilter.status = { in: ["done", "cancelled"] };
    else if (filter === "today")   { statusFilter.dueAt = { gte: today, lt: tomorrow }; statusFilter.status = { in: ["open", "in_progress"] }; }
    else if (filter === "overdue") { statusFilter.dueAt = { lt: today }; statusFilter.status = { in: ["open", "in_progress"] }; }

    let assigneeFilter: WhereClause = {};
    if (scope === "own") {
        assigneeFilter = { OR: [{ assignedToId: userId }, { assignedRole: { in: userRoles } }] };
    } else if (scope === "team") {
        assigneeFilter = { assignedRole: { in: userRoles } };
    }
    // scope === "org": no filter

    try {
        const tasks = await prisma.task.findMany({
            where: { ...assigneeFilter, ...statusFilter },
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
            include: {
                assignedTo: { select: { id: true, name: true } },
                createdBy:  { select: { id: true, name: true } },
                ticket: {
                    select: {
                        id: true,
                        device: { select: { brand: true, model: true, customer: { select: { name: true } } } },
                    },
                },
            },
        });
        return NextResponse.json(tasks);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
    }
}

// POST /api/tasks
export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = Number((session.user as { id?: string }).id);

    try {
        const body = await req.json();
        const task = await prisma.task.create({
            data: {
                title:        body.title,
                description:  body.description ?? null,
                source:       "manual",
                status:       "open",
                priority:     body.priority ?? "P2",
                assignedToId: body.assignedToId ?? null,
                assignedRole: body.assignedRole ?? null,
                ticketId:     body.ticketId ?? null,
                dueAt:        body.dueAt ? new Date(body.dueAt) : null,
                createdById:  userId,
            },
            include: {
                assignedTo: { select: { id: true, name: true } },
                createdBy:  { select: { id: true, name: true } },
            },
        });

        await prisma.taskLog.create({
            data: { taskId: task.id, action: "created", byUserId: userId },
        });

        return NextResponse.json(task, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
    }
}
