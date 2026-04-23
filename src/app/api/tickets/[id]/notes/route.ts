import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

const noteSchema = z.object({
    note: z.string().trim().min(1, "Note text is required"),
    visibility: z.enum(["internal", "public"]).optional(),
});

// POST /api/tickets/[id]/notes
// Body: { note: string, visibility?: "internal" | "public" }
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = Number((session.user as { id?: string }).id);

        const { id } = await params;
        const ticketId = Number(id);
        const parsed = noteSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid note payload" }, { status: 400 });
        }
        const { note, visibility = "internal" } = parsed.data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, status: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const log = await prisma.ticketLog.create({
            data: {
                ticketId,
                status: ticket.status,
                note,
                visibility: visibility === "public" ? "public" : "internal",
                userId,
            },
        });

        return NextResponse.json(log, { status: 201 });
    } catch (error) {
        console.error("[notes POST]", error);
        return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
    }
}
