import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { z } from "zod";

const createSchema = z.object({
    text: z.string().trim().min(1).max(2000),
});

// GET /api/quick-notes — list the current user's notes, newest first
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const notes = await prisma.quickNote.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, text: true, createdAt: true },
        });
        return NextResponse.json(notes);
    } catch (error) {
        return handleApiError(error);
    }
}

// POST /api/quick-notes — create a note for the current user
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const body = await req.json();
        const { text } = createSchema.parse(body);
        const note = await prisma.quickNote.create({
            data: { userId: user.id, text },
            select: { id: true, text: true, createdAt: true },
        });
        return NextResponse.json(note, { status: 201 });
    } catch (error) {
        return handleApiError(error);
    }
}
