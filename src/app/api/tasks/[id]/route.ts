import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const task = await prisma.task.findUnique({
        where: { id: Number(id) },
        include: {
            assignedTo: { select: { id: true, name: true } },
            createdBy:  { select: { id: true, name: true } },
            ticket: {
                select: {
                    id: true,
                    device: { select: { brand: true, model: true, customer: { select: { name: true } } } },
                },
            },
            logs: {
                orderBy: { createdAt: "asc" },
                include: { byUser: { select: { id: true, name: true } } },
            },
        },
    });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(task);
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = Number((session.user as { id?: string }).id);
    const { id } = await params;

    try {
        const body = await req.json();
        const prev = await prisma.task.findUnique({ where: { id: Number(id) } });

        const updated = await prisma.task.update({
            where: { id: Number(id) },
            data: {
                ...(body.title       !== undefined && { title: body.title }),
                ...(body.description !== undefined && { description: body.description }),
                ...(body.status      !== undefined && { status: body.status }),
                ...(body.priority    !== undefined && { priority: body.priority }),
                ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
                ...(body.assignedRole !== undefined && { assignedRole: body.assignedRole }),
                ...(body.dueAt !== undefined && { dueAt: body.dueAt ? new Date(body.dueAt) : null }),
                ...(body.status === "done" && !prev?.completedAt && { completedAt: new Date() }),
                ...(body.status && body.status !== "done" && { completedAt: null }),
            },
        });

        if (body.status && body.status !== prev?.status) {
            await prisma.taskLog.create({
                data: {
                    taskId:    Number(id),
                    action:    "status_changed",
                    note:      `${prev?.status} → ${body.status}`,
                    byUserId:  userId,
                },
            });
        }

        return NextResponse.json(updated);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await prisma.task.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
}
